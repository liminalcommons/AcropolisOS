import { z } from "zod";
import { InlineProperty, LinkType, ObjectType } from "../ontology/schema";

export const ProposalStatus = z.enum(["pending", "approved", "rejected"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const ProposalDiff = z.object({
  new_object_types: z.record(z.string(), ObjectType),
  new_link_types: z.record(z.string(), LinkType),
  new_shared_properties: z.record(z.string(), InlineProperty),
  modified_properties: z.record(z.string(), InlineProperty),
  impacted_tables: z.array(z.string()),
});
export type ProposalDiff = z.infer<typeof ProposalDiff>;

export function emptyDraft(): ProposalDiff {
  return {
    new_object_types: {},
    new_link_types: {},
    new_shared_properties: {},
    modified_properties: {},
    impacted_tables: [],
  };
}

export function recomputeImpactedTables(diff: ProposalDiff): string[] {
  return [...Object.keys(diff.new_object_types)].sort();
}
