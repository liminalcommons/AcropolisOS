import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { getProposalStore } from "@/lib/proposals/singleton";
import { EmptyHome } from "@/components/home/empty-home";
import { SeededHome } from "@/components/home/seeded-home";
import { LiveHome } from "@/components/home/live-home";

export const dynamic = "force-dynamic";

// Ontology keys are PascalCase (Member, MeetingMinute). Drizzle codegen emits
// snake_case lowercase table names (member, meeting_minute) — see
// lib/db/schema.generated.ts. Convert PascalCase → snake_case before
// interpolating into the SELECT, and accept either form in the SQL-injection
// guard so PascalCase keys are no longer rejected.
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

function toSnakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

async function countByType(typeKey: string): Promise<number | null> {
  if (!IDENT.test(typeKey)) return null;
  const table = toSnakeCase(typeKey);
  try {
    const db = getDb();
    const rows = await db.$client.unsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "${table}"`,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return null;
  }
}

// S3 · Two-mode page. Branches on the shape of the world:
//   empty  → no types yet                       → welcome + prompt seeds
//   seeded → types exist but 0 entities          → type-card grid (introductory)
//   live   → entities exist (or pending actions) → full Foundry shell
export default async function OntologyEditorPage(): Promise<React.ReactElement> {
  const ontology = await loadOntology(getRuntimeOntologyDir());
  const typeKeys = Object.keys(ontology.object_types).sort();
  const countEntries = await Promise.all(
    typeKeys.map(async (k) => [k, await countByType(k)] as const),
  );
  const counts = Object.fromEntries(countEntries) as Record<
    string,
    number | null
  >;
  const actionCount = Object.keys(ontology.action_types).length;
  const linkCount = Object.keys(ontology.link_types).length;

  const all = await getProposalStore().listProposals();
  const pending = all
    .filter((p) => p.status === "pending")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const typeCount = typeKeys.length;
  const entityCount = Object.values(counts).reduce<number>(
    (acc, n) => acc + (n ?? 0),
    0,
  );
  const pendingCount = pending.length;

  // Subtle cross-reference: /ontology-editor ↔ /ontology (schema graph)
  const nav = (
    <div className="fixed top-2 right-4 z-50">
      <Link
        href="/ontology"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Schema graph →
      </Link>
    </div>
  );

  if (typeCount === 0) {
    return <>{nav}<EmptyHome /></>;
  }
  if (entityCount === 0 && pendingCount === 0) {
    return (
      <>
        {nav}
        <SeededHome
          ontology={ontology}
          typeKeys={typeKeys}
          actionCount={actionCount}
          linkCount={linkCount}
        />
      </>
    );
  }
  return (
    <>
      {nav}
      <LiveHome
        ontology={ontology}
        typeKeys={typeKeys}
        counts={counts}
        pending={pending}
        actionCount={actionCount}
        linkCount={linkCount}
      />
    </>
  );
}
