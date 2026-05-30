import type { Ontology } from "../ontology/schema";

// Resolve a YAML `default:` value to a concrete insert value. Static values pass
// through unchanged; dynamic date/timestamp tokens resolve to a live value at
// insert time:
//   @today        -> today's date (YYYY-MM-DD)
//   @now          -> current ISO timestamp
//   @today+Nd     -> today ± N days (date)
//   @now+Nd       -> now ± N days (timestamp)
// This is the app-side mirror of the DB column defaults the codegen emits
// (lib/codegen/defaults.ts). The commit write-path fills them itself rather than
// relying on the DB default — `drizzle-kit push` does not reliably ALTER existing
// columns to add a default — and the resolved values agree with the SQL ones.
export function resolveDefaultToken(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "@now") return new Date().toISOString();
  if (value === "@today") return new Date().toISOString().slice(0, 10);
  const day = /^@today([+-]\d+)d$/.exec(value);
  if (day) {
    return new Date(Date.now() + Number(day[1]) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  const ts = /^@now([+-]\d+)d$/.exec(value);
  if (ts) {
    return new Date(Date.now() + Number(ts[1]) * 86_400_000).toISOString();
  }
  return value;
}

// Per-type insert defaults derived from the ontology's `default:` fields — the
// single declarative source (scenario YAML), never a hostel literal. Reads both
// inline defaults and ref'd shared-property defaults, keyed by property name
// (= the generated column key), resolving dynamic tokens. Returns {} for any
// type/property without a default — fail-safe and domain-agnostic.
export function deriveTypeDefaults(
  ontology: Ontology,
  objectType: string,
): Record<string, unknown> {
  const ot = ontology.object_types[objectType];
  if (!ot) return {};
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(ot.properties)) {
    let raw: unknown;
    if (prop && typeof prop === "object" && "ref" in prop) {
      const shared = ontology.properties[(prop as { ref: string }).ref];
      raw =
        shared && typeof shared === "object" && "default" in shared
          ? (shared as { default?: unknown }).default
          : undefined;
    } else if (prop && typeof prop === "object" && "default" in prop) {
      raw = (prop as { default?: unknown }).default;
    }
    if (raw !== undefined) out[name] = resolveDefaultToken(raw);
  }
  return out;
}
