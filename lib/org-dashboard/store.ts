// Step-2b: minimal org-dashboard persistence — a SINGLE org-level dashboard config.
//
// THE DECISION (.opponent-log-acropolisos-viewgen.md): ONE admin view (the
// steward). Generated views land on the /org steward dashboard. NO per-user
// SavedView complexity, NO new ontology object, NO DB migration. A single
// JSON file under uploads/ (bind-mounted, survives container restarts — the
// SAME file-backed pattern as uploads/org-profile.json in app/setup/actions.ts).
//
// The config is a list of widget DESCRIPTORS — the exact { id, kind, config }
// shape the /org page already feeds to resolveDescriptors. When the file is
// absent the store returns EMPTY; the admin FLOOR (veto-queue + per-type
// metrics/tables) is DERIVED from the ontology by the /org page via
// adminDefaultBoard — no longer a hand-listed default in this store.

import path from "node:path";
import fs from "node:fs/promises";
import type { CatalogKind } from "@/lib/widgets/catalog";
import { deriveDefaultBoard, type SliceDescriptor } from "@/lib/widgets/derive-board";
import type { Ontology } from "@/lib/ontology/schema";
import type { CanReadType } from "@/lib/widgets/read-api";

// A persisted widget descriptor — same shape as ADMIN_DASHBOARD_DESCRIPTORS /
// StoredDescriptor (compose.ts): kind + config + a stable id.
export interface WidgetDescriptor {
  id: string;
  kind: CatalogKind;
  config: unknown;
  title?: string;
}

export interface OrgDashboardConfig {
  widgets: WidgetDescriptor[];
}

// uploads/ is bind-mounted (see docker-compose.yml) — writes survive restarts.
// Same dir + resolution as app/setup/actions.ts's org-profile.json.
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ORG_DASHBOARD_PATH = path.join(UPLOADS_DIR, "org-dashboard.json");

// ── adminDefaultBoard ───────────────────────────────────────────────────────
// The steward's DERIVED admin floor (replaces the old hand-listed
// DEFAULT_ORG_DASHBOARD): the open-agent_blocker veto-queue (decision board)
// first, then a count metric per readable type (living-ontology overview), then
// per-type tables/calendars — all from the ontology, permission-scoped, no
// domain literals. Returned when nothing is stored; the /org page resolves it
// through the SAME read-only fence as composed views.
export function adminDefaultBoard(
  ontology: Ontology,
  canReadType: CanReadType,
): SliceDescriptor[] {
  return deriveDefaultBoard(ontology, canReadType, { admin: true });
}

// ── readOrgDashboard ────────────────────────────────────────────────────────────
//
// Returns the persisted config, or an EMPTY config when the file is absent /
// corrupt. Never throws on a missing or malformed file. The admin FLOOR is no
// longer a hand-listed default here — it is DERIVED by the /org page via
// adminDefaultBoard when this returns empty.
export async function readOrgDashboard(): Promise<OrgDashboardConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(ORG_DASHBOARD_PATH, "utf8");
  } catch {
    return { widgets: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as OrgDashboardConfig).widgets)
    ) {
      return { widgets: (parsed as OrgDashboardConfig).widgets };
    }
  } catch {
    // corrupt JSON — fall through to empty
  }
  return { widgets: [] };
}

// ── writeOrgDashboard ───────────────────────────────────────────────────────────
export async function writeOrgDashboard(cfg: OrgDashboardConfig): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(ORG_DASHBOARD_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

// ── addOrgWidget ────────────────────────────────────────────────────────────────
//
// Append the descriptor, OR replace an existing widget with the same id (so
// "show me X again" replaces that widget rather than duplicating it — decision
// #2: calling compose_view again with the same type replaces that widget).
// First composition starts from a CLEAN, EMPTY slate (readOrgDashboardOrEmpty,
// not the derived floor) so the steward's composed dashboard is theirs.
export async function addOrgWidget(descriptor: WidgetDescriptor): Promise<void> {
  const current = await readOrgDashboardOrEmpty();
  const idx = current.widgets.findIndex((w) => w.id === descriptor.id);
  if (idx >= 0) {
    current.widgets[idx] = descriptor;
  } else {
    current.widgets.push(descriptor);
  }
  await writeOrgDashboard(current);
}

// ── removeOrgWidget ─────────────────────────────────────────────────────────────
//
// Filter out the descriptor with the matching id and write back. Returns whether
// the id was present (idempotent — removing an absent id is not an error). Dumb
// persistence: NO authorization here (auth lives in compose-view.ts).
export async function removeOrgWidget(id: string): Promise<boolean> {
  const current = await readOrgDashboardOrEmpty();
  const next = current.widgets.filter((w) => w.id !== id);
  const existed = next.length !== current.widgets.length;
  await writeOrgDashboard({ widgets: next });
  return existed;
}

// ── clearOrgDashboard ───────────────────────────────────────────────────────────
//
// Reset (delete the file). Next readOrgDashboard returns EMPTY, so the /org page
// falls back to the DERIVED admin floor (adminDefaultBoard). Decision #2: easy
// to clear.
export async function clearOrgDashboard(): Promise<void> {
  try {
    await fs.unlink(ORG_DASHBOARD_PATH);
  } catch {
    // already absent — nothing to clear
  }
}

// ── internal ────────────────────────────────────────────────────────────────────

// Reads the persisted file as-is; returns an EMPTY config when absent. Used by
// addOrgWidget so the first composed widget starts a clean, steward-owned
// dashboard. (readOrgDashboard ALSO returns empty when absent now — this helper
// is retained for the explicit "compose from clean" intent at the call site.)
async function readOrgDashboardOrEmpty(): Promise<OrgDashboardConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(ORG_DASHBOARD_PATH, "utf8");
  } catch {
    return { widgets: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as OrgDashboardConfig).widgets)
    ) {
      return { widgets: (parsed as OrgDashboardConfig).widgets };
    }
  } catch {
    // corrupt — treat as empty so a fresh compose starts clean
  }
  return { widgets: [] };
}
