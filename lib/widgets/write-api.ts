// Per-actor WRITE permission gate — the parallel of buildCanReadType, used to
// decide which CRUD affordances to render. This is UX gating only: the real
// boundary is the object write fence (wrapObjectAccess in ctx.ts), which every
// create/update/delete passes through server-side. Reuses the SAME tokens
// (object_type.permissions.write) + actorMatchesTokens as the fence.
import type { Actor } from "@/lib/ctx";
import { actorMatchesTokens, buildObjectPermissionsMap } from "@/lib/ontology/ctx";
import type { Ontology } from "@/lib/ontology/schema";
import { deriveVocabulary } from "./vocabulary";

export type CanWriteType = (catalogType: string) => boolean;

export function buildCanWriteType(actor: Actor | null, ontology: Ontology): CanWriteType {
  const permissions = buildObjectPermissionsMap(ontology);
  const vocab = deriveVocabulary(ontology);
  return (catalogType: string): boolean => {
    if (!vocab.validTypes.includes(catalogType)) return false;
    const objectTypeName = vocab.typeToObjectType[catalogType];
    const perms = permissions[objectTypeName];
    // FAIL CLOSED: no write tokens → deny (mirrors the deny-all write fence).
    const write = perms?.write;
    if (!write || write.length === 0) return false;
    // Type-level match (no row): role / customRole / '*'.
    if (actorMatchesTokens(actor, write, null, objectTypeName)) return true;
    // member_self can't be evaluated without a row; a type whose write is
    // gated on member_self admits CREATE for any authenticated member (they
    // will own the new row, which the fence re-checks with the row present).
    if (actor && write.includes("member_self")) return true;
    return false;
  };
}
