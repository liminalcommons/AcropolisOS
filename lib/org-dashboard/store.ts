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
// absent the store returns the DEFAULT (the current bed-list descriptor) so the
// page looks identical until the steward composes something.

import path from "node:path";
import fs from "node:fs/promises";
import type { CatalogKind } from "@/lib/widgets/catalog";

// A persisted widget descriptor — same shape as ADMIN_DASHBOARD_DESCRIPTORS /
// StoredDescriptor (compose.ts): kind + config + a stable id.
export interface WidgetDescriptor {
  id: string;
  kind: CatalogKind;
  config: unknown;
}

export interface OrgDashboardConfig {
  widgets: WidgetDescriptor[];
}

// uploads/ is bind-mounted (see docker-compose.yml) — writes survive restarts.
// Same dir + resolution as app/setup/actions.ts's org-profile.json.
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ORG_DASHBOARD_PATH = path.join(UPLOADS_DIR, "org-dashboard.json");

// ── DEFAULT ───────────────────────────────────────────────────────────────────
//
// The bed-inventory data_table that /org rendered hardcoded before step-2b.
// Returned verbatim when the dashboard file is absent, so the page is unchanged
// until the steward composes a view. This IS the former ADMIN_DASHBOARD_DESCRIPTORS.
export const DEFAULT_ORG_DASHBOARD: OrgDashboardConfig = {
  widgets: [
    {
      id: "admin-bed-list",
      kind: "data_table",
      config: {
        type: "bed",
        columns: ["code", "room", "is_bottom_bunk", "out_of_service", "notes"],
        limit: 100,
      },
    },
  ],
};

// ── readOrgDashboard ────────────────────────────────────────────────────────────
//
// Returns the persisted config, or DEFAULT_ORG_DASHBOARD when the file is
// absent / corrupt. Never throws on a missing or malformed file — the dashboard
// always has SOMETHING to render (the default is the floor).
export async function readOrgDashboard(): Promise<OrgDashboardConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(ORG_DASHBOARD_PATH, "utf8");
  } catch {
    return cloneDefault();
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
    // corrupt JSON — fall through to default
  }
  return cloneDefault();
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
// First composition starts from a CLEAN slate (drops the bed-list default) so
// the steward's composed dashboard is theirs, not default-plus-composed.
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

// ── clearOrgDashboard ───────────────────────────────────────────────────────────
//
// Reset to the default (delete the file). Next readOrgDashboard returns the
// bed-list default. Decision #2: easy to clear.
export async function clearOrgDashboard(): Promise<void> {
  try {
    await fs.unlink(ORG_DASHBOARD_PATH);
  } catch {
    // already absent — nothing to clear
  }
}

// ── internal ────────────────────────────────────────────────────────────────────

// Reads the persisted file as-is; returns an EMPTY config (not the default) when
// absent. Used by addOrgWidget so the first composed widget starts a clean,
// steward-owned dashboard instead of being appended after the bed-list default.
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

function cloneDefault(): OrgDashboardConfig {
  return {
    widgets: DEFAULT_ORG_DASHBOARD.widgets.map((w) => ({
      ...w,
      config: structuredClone(w.config),
    })),
  };
}
