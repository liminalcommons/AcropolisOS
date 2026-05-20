// M4.3: Widget type contracts — shared between /me server component
// and query_member_context agent tool. No framework imports; pure types + zod.

import { z } from "zod";

export const WIDGET_KINDS = [
  "agent_blockers",
  "needed_actions",
  "available_actions",
  "recent_context",
  "inbox_unread",
  "note",
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
          unblock_hint: {
            action_type: string;
            suggested_params: Record<string, unknown>;
          } | null;
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
  | { id: string; kind: "note"; data: { markdown: string } };

export interface MeBundle {
  member_id: string;
  rendered_at: string;
  widgets: WidgetBundle[];
}
