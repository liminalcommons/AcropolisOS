// The view PAYLOAD kind for the proposal loop. CONFIG, not code: a scope plus a
// list of widget descriptors (kind + config). §11 invariant 2/3: the AI never
// hand-codes TSX; a view is governed config that render() consumes.
import { z } from "zod";

// C1: the `derived-<index>` id namespace is RESERVED for floor slots in
// merge.ts (mergeApprovedIntoFloor maps floor[i] → id `derived-${i}`). A
// proposal may deliberately REPLACE a floor slot by matching its id, but an
// author-supplied `derived-N` would silently clobber whatever floor slot
// happens to land at index N. Reject it at the schema so floor replacement is
// always intentional, never an id collision.
const RESERVED_DERIVED_ID = /^derived-\d+$/;

const Descriptor = z
  .object({
    id: z
      .string()
      .min(1)
      .refine((id) => !RESERVED_DERIVED_ID.test(id), {
        message:
          "id matching /^derived-\\d+$/ is reserved for floor slots in merge.ts",
      }),
    kind: z.enum(["metric", "data_table", "roster", "calendar"]),
    config: z.unknown(),
    title: z.string().optional(),
  })
  .strict();

export const ViewConfigProposal = z
  .object({
    scope: z.enum(["org", "role", "viewer"]),
    scope_key: z.string(),
    descriptors: z.array(Descriptor),
  })
  .strict()
  .refine((v) => v.scope !== "org" || v.scope_key === "", {
    message: "org scope requires an empty scope_key",
    path: ["scope_key"],
  });
export type ViewConfigProposal = z.infer<typeof ViewConfigProposal>;

// Key a view config proposal in the diff map by its target scope.
export function viewConfigKey(p: { scope: string; scope_key: string }): string {
  return `${p.scope}:${p.scope_key}`;
}
