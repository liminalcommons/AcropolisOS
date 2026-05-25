// M4.3: Widget type contracts — shared between /me server component
// and query_member_context agent tool. No framework imports; pure types + zod.
//
// V1 additions (widget catalog substrate): the four catalog kinds are additive —
// they do not change any existing kind or WidgetBundle shape. The hardcoded
// dashboard gets replaced by catalog-driven rendering in V3; until then both
// coexist. Catalog kinds are validated via WIDGET_CATALOG[kind].configSchema
// in compose_dashboard (lib/widgets/compose.ts) — the WidgetDescriptorSchema
// here remains permissive (kind + config) so stored descriptors from both
// old and new paths pass basic parsing.

import { z } from "zod";

// V1: catalog kinds added alongside the original action-context kinds.
// The agent composes dashboards from these; the PinnedWidget renderer
// delegates to CatalogWidget for the new kinds (V3 wiring).
export const CATALOG_WIDGET_KINDS = [
  "metric",
  "data_table",
  "roster",
  "calendar",
] as const;
export type CatalogWidgetKind = (typeof CATALOG_WIDGET_KINDS)[number];

export const WIDGET_KINDS = [
  "agent_blockers",
  "needed_actions",
  "available_actions",
  "recent_context",
  "inbox_unread",
  "note",
  "turnover_cleaning",
  "table",
  "agent_html",
  // V1 catalog kinds — composition-over-generation; data driven by queryBinding
  ...CATALOG_WIDGET_KINDS,
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const WidgetDescriptorSchema = z.object({
  id: z.string(),
  kind: z.enum(WIDGET_KINDS),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type WidgetDescriptor = z.infer<typeof WidgetDescriptorSchema>;

export type ReasonKind =
  | "approval"
  | "confirmation"
  | "ambiguity"
  | "missing_data"
  | "consent"
  | "decision"
  | "risky_action";

export type ResolutionMode = "pathways" | "text_input" | "confirm_binary";

// Reversibility signal shown as dots in the UI — nudges toward cheap-to-undo.
export type Reversibility = "easy" | "moderate" | "permanent";

export interface BlockerPathway {
  id: string;
  label: string;           // short label, e.g. "Auto-prorate to sustaining"
  rationale: string;       // one-line trade-off
  action: { type: string; params: Record<string, unknown> };
  reversibility: Reversibility;
}

export interface InputSchema {
  kind: "string" | "number" | "date" | "object_ref";
  target_type?: string;
  prompt: string;
}

export interface ConfirmAction {
  label: string;
  action: { type: string; params: Record<string, unknown> };
}

export type WidgetBundle =
  | {
      id: string;
      kind: "agent_blockers";
      data: {
        blockers: Array<{
          id: string;
          reason_kind: ReasonKind;
          summary: string;
          detail: string;
          blocked_work_ref: string | null;
          resolution_mode: ResolutionMode;
          pathways: BlockerPathway[] | null;
          input_schema: InputSchema | null;
          confirm_action: ConfirmAction | null;
          created_at: string;
        }>;
      };
    }
  | {
      id: string;
      kind: "needed_actions";
      data: {
        items: Array<{
          notification_id: string;
          kind: string;
          title: string;
          link_url: string | null;
        }>;
      };
    }
  | {
      id: string;
      kind: "available_actions";
      data: {
        groups: Array<{
          target_type: string;
          actions: Array<{
            action_type: string;
            description: string;
            sample_targets: Array<{ id: string; label: string }>;
          }>;
        }>;
      };
    }
  | {
      id: string;
      kind: "recent_context";
      data: {
        since: string;
        entries: Array<{
          at: string;
          via: string;
          subject_type: string;
          subject_id: string;
          summary: string;
        }>;
      };
    }
  | {
      id: string;
      kind: "inbox_unread";
      data: {
        unread_count: number;
        items: Array<{
          id: string;
          kind: string;
          title: string;
          created_at: string;
        }>;
      };
    }
  | { id: string; kind: "note"; data: { markdown: string } }
  | {
      id: string;
      kind: "turnover_cleaning";
      data: {
        as_of: string;
        rows: Array<{
          bed_code: string;
          checkout_guest: string | null;
          checkin_guest: string | null;
          gap_label: string;
        }>;
      };
    }
  | {
      id: string;
      kind: "table";
      title?: string;
      data: {
        rows: Array<{ label: string; value: string }>;
      };
    }
  | {
      id: string;
      kind: "agent_html";
      title?: string;
      data: {
        html: string;
      };
    }
  // ── V1 catalog kinds ──────────────────────────────────────────────────────
  // These replace the hardcoded fetchers in V3. Config drives the queryBinding.
  | {
      id: string;
      kind: "metric";
      config: { type: string; agg: string; filter?: { field: string; value: string } };
      data: { value: number; label: string };
    }
  | {
      id: string;
      kind: "data_table";
      config: { type: string; columns: string[]; limit?: number };
      data: { columns: string[]; rows: Record<string, unknown>[] };
    }
  | {
      id: string;
      kind: "roster";
      config: { type: string; fields: string[]; limit?: number };
      data: { fields: string[]; entries: Record<string, unknown>[] };
    }
  | {
      id: string;
      kind: "calendar";
      config: { type: string; date_field: string; limit?: number };
      data: { date_field: string; buckets: Record<string, Record<string, unknown>[]> };
    };

export interface MeBundle {
  member_id: string;
  rendered_at: string;
  widgets: WidgetBundle[];
}
