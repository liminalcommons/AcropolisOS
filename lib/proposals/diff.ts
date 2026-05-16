import { z } from "zod";
import {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
} from "../ontology/schema";

export const ProposalStatus = z.enum(["pending", "approved", "rejected"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const FunctionProposal = z
  .object({
    filename: z.string().min(1),
    ts_body: z.string(),
  })
  .strict();
export type FunctionProposal = z.infer<typeof FunctionProposal>;

export const ViewProposal = z
  .object({
    object_type: z.string().min(1),
    view: z.string().min(1),
    tsx_body: z.string(),
  })
  .strict();
export type ViewProposal = z.infer<typeof ViewProposal>;

export const SeedProposal = z
  .object({
    object_type: z.string().min(1),
    rows_jsonl: z.string(),
  })
  .strict();
export type SeedProposal = z.infer<typeof SeedProposal>;

export const IngestProposal = z
  .object({
    inbox_ids: z.array(z.string().min(1)).min(1),
    target_object_type: z.string().min(1),
    mapping: z.record(z.string(), z.string()),
  })
  .strict();
export type IngestProposal = z.infer<typeof IngestProposal>;

export const ProposalDiff = z.object({
  new_object_types: z.record(z.string(), ObjectType),
  new_link_types: z.record(z.string(), LinkType),
  new_shared_properties: z.record(z.string(), InlineProperty),
  modified_properties: z.record(z.string(), InlineProperty),
  new_action_types: z.record(z.string(), ActionType),
  new_functions: z.record(z.string(), FunctionProposal),
  new_views: z.record(z.string(), ViewProposal),
  new_seeds: z.record(z.string(), SeedProposal),
  new_ingests: z.record(z.string(), IngestProposal),
  impacted_tables: z.array(z.string()),
});
export type ProposalDiff = z.infer<typeof ProposalDiff>;

export function emptyDraft(): ProposalDiff {
  return {
    new_object_types: {},
    new_link_types: {},
    new_shared_properties: {},
    modified_properties: {},
    new_action_types: {},
    new_functions: {},
    new_views: {},
    new_seeds: {},
    new_ingests: {},
    impacted_tables: [],
  };
}

export function viewKey(object_type: string, view: string): string {
  return `${object_type}:${view}`;
}

export function recomputeImpactedTables(diff: ProposalDiff): string[] {
  const tables = new Set<string>(Object.keys(diff.new_object_types));
  for (const seed of Object.values(diff.new_seeds)) {
    tables.add(seed.object_type);
  }
  for (const ingest of Object.values(diff.new_ingests)) {
    tables.add(ingest.target_object_type);
  }
  for (const action of Object.values(diff.new_action_types)) {
    if (action.creates_object) tables.add(action.creates_object);
  }
  return [...tables].sort();
}
