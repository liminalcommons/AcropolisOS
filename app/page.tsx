import { getDb } from "@/lib/db";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { getProposalStore } from "@/lib/proposals/singleton";
import { EmptyHome } from "@/components/home/empty-home";
import { SeededHome } from "@/components/home/seeded-home";
import { LiveHome } from "@/components/home/live-home";

export const dynamic = "force-dynamic";

const IDENT = /^[a-z][a-z0-9_]*$/;

async function countByType(typeKey: string): Promise<number | null> {
  if (!IDENT.test(typeKey)) return null;
  try {
    const db = getDb();
    const rows = await db.$client.unsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "${typeKey}"`,
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
export default async function Home(): Promise<React.ReactElement> {
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

  if (typeCount === 0) {
    return <EmptyHome />;
  }
  if (entityCount === 0 && pendingCount === 0) {
    return (
      <SeededHome
        ontology={ontology}
        typeKeys={typeKeys}
        actionCount={actionCount}
        linkCount={linkCount}
      />
    );
  }
  return (
    <LiveHome
      ontology={ontology}
      typeKeys={typeKeys}
      counts={counts}
      pending={pending}
      actionCount={actionCount}
      linkCount={linkCount}
    />
  );
}
