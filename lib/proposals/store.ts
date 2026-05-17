import { randomUUID } from "node:crypto";
import {
  emptyDraft,
  recomputeImpactedTables,
  viewKey,
  type FunctionProposal,
  type IngestProposal,
  type ProposalDiff,
  type ProposalStatus,
  type SeedProposal,
  type ViewProposal,
} from "./diff";
import type {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
} from "../ontology/schema";

export interface Proposal {
  id: string;
  session_id: string;
  diff: ProposalDiff;
  status: ProposalStatus;
  created_at: string;
}

export interface AppendSharedPropertyOptions {
  modifying?: boolean;
}

export interface ProposalDraftStore {
  appendObjectType(
    session_id: string,
    name: string,
    definition: ObjectType,
  ): Promise<ProposalDiff>;
  appendLinkType(
    session_id: string,
    name: string,
    definition: LinkType,
  ): Promise<ProposalDiff>;
  appendSharedProperty(
    session_id: string,
    name: string,
    definition: InlineProperty,
    opts?: AppendSharedPropertyOptions,
  ): Promise<ProposalDiff>;
  appendActionType(
    session_id: string,
    name: string,
    definition: ActionType,
  ): Promise<ProposalDiff>;
  appendFunction(
    session_id: string,
    proposal: FunctionProposal,
  ): Promise<ProposalDiff>;
  appendView(
    session_id: string,
    proposal: ViewProposal,
  ): Promise<ProposalDiff>;
  appendSeed(
    session_id: string,
    proposal: SeedProposal,
  ): Promise<ProposalDiff>;
  appendIngest(
    session_id: string,
    name: string,
    proposal: IngestProposal,
  ): Promise<ProposalDiff>;
  getDraft(session_id: string): Promise<ProposalDiff | null>;
  finalize(session_id: string): Promise<Proposal>;
  listProposals(): Promise<Proposal[]>;
  getProposal(id: string): Promise<Proposal | null>;
  updateProposalDiff(id: string, diff: ProposalDiff): Promise<Proposal>;
  setStatus(id: string, status: ProposalStatus): Promise<Proposal>;
}

export class ProposalDraftNotFoundError extends Error {
  constructor(session_id: string) {
    super(`no proposal draft for session "${session_id}"`);
    this.name = "ProposalDraftNotFoundError";
  }
}

export class ProposalNotFoundError extends Error {
  constructor(id: string) {
    super(`no proposal with id "${id}"`);
    this.name = "ProposalNotFoundError";
  }
}

export class InMemoryProposalDraftStore implements ProposalDraftStore {
  private readonly drafts = new Map<string, ProposalDiff>();
  private readonly proposals: Proposal[] = [];

  private ensureDraft(session_id: string): ProposalDiff {
    let draft = this.drafts.get(session_id);
    if (!draft) {
      draft = emptyDraft();
      this.drafts.set(session_id, draft);
    }
    return draft;
  }

  async appendObjectType(
    session_id: string,
    name: string,
    definition: ObjectType,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    draft.new_object_types[name] = definition;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return draft;
  }

  async appendLinkType(
    session_id: string,
    name: string,
    definition: LinkType,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    draft.new_link_types[name] = definition;
    return draft;
  }

  async appendSharedProperty(
    session_id: string,
    name: string,
    definition: InlineProperty,
    opts?: AppendSharedPropertyOptions,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    if (opts?.modifying) {
      draft.modified_properties[name] = definition;
    } else {
      draft.new_shared_properties[name] = definition;
    }
    return draft;
  }

  async appendActionType(
    session_id: string,
    name: string,
    definition: ActionType,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    draft.new_action_types[name] = definition;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return draft;
  }

  async appendFunction(
    session_id: string,
    proposal: FunctionProposal,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    draft.new_functions[proposal.filename] = proposal;
    return draft;
  }

  async appendView(
    session_id: string,
    proposal: ViewProposal,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    draft.new_views[viewKey(proposal.object_type, proposal.view)] = proposal;
    return draft;
  }

  async appendSeed(
    session_id: string,
    proposal: SeedProposal,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    draft.new_seeds[proposal.object_type] = proposal;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return draft;
  }

  async appendIngest(
    session_id: string,
    name: string,
    proposal: IngestProposal,
  ): Promise<ProposalDiff> {
    const draft = this.ensureDraft(session_id);
    draft.new_ingests[name] = proposal;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return draft;
  }

  async getDraft(session_id: string): Promise<ProposalDiff | null> {
    return this.drafts.get(session_id) ?? null;
  }

  async finalize(session_id: string): Promise<Proposal> {
    const draft = this.drafts.get(session_id);
    if (!draft) throw new ProposalDraftNotFoundError(session_id);
    const proposal: Proposal = {
      id: randomUUID(),
      session_id,
      diff: structuredClone(draft),
      status: "pending",
      created_at: new Date().toISOString(),
    };
    this.proposals.push(proposal);
    this.drafts.delete(session_id);
    return proposal;
  }

  async listProposals(): Promise<Proposal[]> {
    return [...this.proposals];
  }

  async getProposal(id: string): Promise<Proposal | null> {
    return this.proposals.find((p) => p.id === id) ?? null;
  }

  async updateProposalDiff(
    id: string,
    diff: ProposalDiff,
  ): Promise<Proposal> {
    const idx = this.proposals.findIndex((p) => p.id === id);
    if (idx === -1) throw new ProposalNotFoundError(id);
    this.proposals[idx] = {
      ...this.proposals[idx],
      diff: structuredClone(diff),
    };
    return this.proposals[idx];
  }

  async setStatus(id: string, status: ProposalStatus): Promise<Proposal> {
    const idx = this.proposals.findIndex((p) => p.id === id);
    if (idx === -1) throw new ProposalNotFoundError(id);
    this.proposals[idx] = { ...this.proposals[idx], status };
    return this.proposals[idx];
  }
}
