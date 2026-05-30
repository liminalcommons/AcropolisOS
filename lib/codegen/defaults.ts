// Dynamic default tokens for date/timestamp properties. A static value is used
// verbatim; a token resolves to a Postgres SQL expression at the DB-column-default
// layer (codegen), so an INSERT that omits the column gets a live value.
export function isDynamicDefaultToken(v: unknown): v is string {
  return typeof v === "string" && /^@(now|today)([+-]\d+d)?$/.test(v);
}
// Postgres SQL default expression for a token on a date|timestamp column.
export function tokenToSqlDefault(token: string, colType: "date" | "timestamp"): string {
  const base = colType === "timestamp" ? "now()" : "CURRENT_DATE";
  const m = /^@(?:now|today)([+-]\d+)d$/.exec(token);
  if (!m) return base;
  const n = Number(m[1]);
  if (colType === "timestamp") return `(now() + interval '${n} days')`;
  return `(CURRENT_DATE + ${n})`;
}
