// lib/organize/target-table.ts
// Single write-path resolution chokepoint. Mirrors lib/widgets/read-api.ts
// (resolveType / tableFor): both read and write resolve type -> table through
// the IDENTICAL ontology-derived lookup, so neither can drift to a literal.
import { getTableName } from "drizzle-orm";
import { guest as guestTable, TABLES } from "@/lib/db/schema.generated";
import type { Ontology } from "@/lib/ontology/schema";
import { deriveVocabulary } from "@/lib/widgets/vocabulary";

export interface ResolvedTarget {
  token: string; // validated snake_case token
  objectType: string; // PascalCase ontology key
  table: typeof guestTable; // Drizzle table (cast exactly as read-api does)
}

/**
 * Resolve a target type to its Drizzle table via the ontology-derived
 * typeToObjectType inversion + the generated TABLES registry. Fail-closed:
 * returns null if the token is not in the loaded ontology OR has no TABLES
 * entry (ontology<->schema drift), so a missing key never reaches SQL.
 */
export function resolveTargetTable(
  ontology: Ontology,
  targetType: string,
): ResolvedTarget | null {
  const vocab = deriveVocabulary(ontology);
  if (!vocab.validTypes.includes(targetType)) return null;
  const objectType = vocab.typeToObjectType[targetType];
  if (objectType === undefined) return null;
  const table = (TABLES as Record<string, unknown>)[objectType];
  if (table === undefined || table === null) return null;
  // Defense in depth: a present-but-non-drizzle TABLES value would yield an
  // undefined table name and a malformed insert. Treat it as missing (fail-closed).
  const candidate = table as Parameters<typeof getTableName>[0];
  if (!getTableName(candidate)) return null;
  return { token: targetType, objectType, table: candidate as unknown as typeof guestTable };
}
