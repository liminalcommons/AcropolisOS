// First-guess element kind for a GROWN type, from its name. evolve.ts can't
// reliably classify a brand-new concept, so this is a heuristic STARTING POINT
// the steward confirms/corrects on the proposal — it ALWAYS falls back to
// `concept` (= unclassified) when no signal matches, never a confident wrong
// guess. Name-only (field names are too noisy — every type may carry a
// guest_email FK). Pure.
import type { ElementKind } from "@/lib/ontology/schema";
import { pascalToSnake } from "@/lib/ontology/casing";

const KEYWORDS: Record<Exclude<ElementKind, "concept">, string[]> = {
  agent: ["member", "guest", "user", "person", "people", "staff", "volunteer", "customer", "client", "contact", "attendee", "participant", "resident", "tenant", "donor", "patient", "student", "employee", "host", "organizer", "author", "reader", "owner", "vendor", "supplier"],
  commitment: ["booking", "reservation", "agreement", "contract", "order", "subscription", "pledge", "commitment", "lease", "enrollment", "registration", "rsvp", "loan", "assignment", "deal", "obligation"],
  event: ["event", "log", "incident", "meeting", "session", "visit", "checkin", "checkout", "payment", "transaction", "shift", "appointment", "delivery", "message", "notification", "minute", "activity", "occurrence", "audit"],
  resource: ["bed", "room", "asset", "item", "product", "inventory", "resource", "space", "seat", "slot", "vehicle", "equipment", "tool", "book", "fund", "account", "budget", "venue", "facility", "supply", "material", "unit"],
};

// Priority: agent → commitment → event → resource → concept. Earlier wins when a
// name token matches more than one set.
const ORDER: Array<Exclude<ElementKind, "concept">> = ["agent", "commitment", "event", "resource"];

export function inferElementKind(typeName: string): ElementKind {
  // pascalToSnake first so PascalCase splits on case boundaries
  // (IncidentLog -> incident_log -> [incident, log]); already-snake names pass
  // through lowercased.
  const tokens = new Set(
    pascalToSnake(typeName)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  for (const kind of ORDER) {
    if (KEYWORDS[kind].some((kw) => tokens.has(kw))) return kind;
  }
  return "concept";
}
