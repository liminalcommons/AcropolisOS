// lib/ontology/casing.ts
// The ONE allowed casing transform. NOTE: snake→Pascal is lossy in general
// (it cannot recover original capitalization), so it is used ONLY to build the
// snake token from a known Pascal key. The reverse lookup (token → ObjectType)
// is always built by INVERTING the real ontology keys — never by guessing.

/** "WorkTradeAgreement" → "work_trade_agreement" */
export function pascalToSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** "work_trade_agreement" → "WorkTradeAgreement" */
export function snakeToPascal(token: string): string {
  return token
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
