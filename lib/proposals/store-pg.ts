import { eq, desc } from "drizzle-orm";
import { proposal_drafts, proposals } from "../db/schema";
import type { Database } from "../db/client";
import {
  emptyDraft,
  normalizeDraft,
  recomputeImpactedTables,
  viewConfigKey,
  type FunctionProposal,
  type IngestProposal,
  type ProposalDiff,
  type ProposalStatus,
  type SeedProposal,
  type ViewConfigProposal,
} from "./diff";
import type {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
} from "../ontology/schema";
import {
  ProposalDraftNotFoundError,
  ProposalNotFoundError,
  type AppendSharedPropertyOptions,
  type Proposal,
  type ProposalDraftStore,
} from "./store";

function rowToProposal(row: {
  id: string;
  session_id: string;
  diff: unknown;
  status: string;
  created_at: Date;
}): Proposal {
  return {
    id: row.id,
    session_id: row.session_id,
    diff: row.diff as ProposalDiff,
    status: row.status as ProposalStatus,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export class PgProposalDraftStore implements ProposalDraftStore {
  constructor(private readonly db: Database) {}

  private async loadDraft(session_id: string): Promise<ProposalDiff> {
    const [row] = await this.db
      .select()
      .from(proposal_drafts)
      .where(eq(proposal_drafts.session_id, session_id))
      .limit(1);
    return row ? (row.diff as ProposalDiff) : emptyDraft();
  }

  private async saveDraft(
    session_id: string,
    diff: ProposalDiff,
  ): Promise<ProposalDiff> {
    await this.db
      .insert(proposal_drafts)
      .values({ session_id, diff })
      .onConflictDoUpdate({
        target: proposal_drafts.session_id,
        set: { diff, updated_at: new Date() },
      });
    return diff;
  }

  async appendObjectType(
    session_id: string,
    name: string,
    definition: ObjectType,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    draft.new_object_types[name] = definition;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return this.saveDraft(session_id, draft);
  }

  async appendLinkType(
    session_id: string,
    name: string,
    definition: LinkType,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    draft.new_link_types[name] = definition;
    return this.saveDraft(session_id, draft);
  }

  async appendSharedProperty(
    session_id: string,
    name: string,
    definition: InlineProperty,
    opts?: AppendSharedPropertyOptions,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    if (opts?.modifying) {
      draft.modified_properties[name] = definition;
    } else {
      draft.new_shared_properties[name] = definition;
    }
    return this.saveDraft(session_id, draft);
  }

  async appendActionType(
    session_id: string,
    name: string,
    definition: ActionType,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    draft.new_action_types[name] = definition;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return this.saveDraft(session_id, draft);
  }

  async appendFunction(
    session_id: string,
    proposal: FunctionProposal,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    draft.new_functions[proposal.filename] = proposal;
    return this.saveDraft(session_id, draft);
  }

  async appendView(
    session_id: string,
    proposal: ViewConfigProposal,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    draft.new_view_configs[viewConfigKey(proposal)] = proposal;
    return this.saveDraft(session_id, draft);
  }

  async appendSeed(
    session_id: string,
    proposal: SeedProposal,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    draft.new_seeds[proposal.object_type] = proposal;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return this.saveDraft(session_id, draft);
  }

  async appendIngest(
    session_id: string,
    name: string,
    proposal: IngestProposal,
  ): Promise<ProposalDiff> {
    const draft = await this.loadDraft(session_id);
    draft.new_ingests[name] = proposal;
    draft.impacted_tables = recomputeImpactedTables(draft);
    return this.saveDraft(session_id, draft);
  }

  async getDraft(session_id: string): Promise<ProposalDiff | null> {
    const [row] = await this.db
      .select()
      .from(proposal_drafts)
      .where(eq(proposal_drafts.session_id, session_id))
      .limit(1);
    return row ? (row.diff as ProposalDiff) : null;
  }

  async finalize(session_id: string): Promise<Proposal> {
    const [draftRow] = await this.db
      .select()
      .from(proposal_drafts)
      .where(eq(proposal_drafts.session_id, session_id))
      .limit(1);
    if (!draftRow) throw new ProposalDraftNotFoundError(session_id);
    const diff = normalizeDraft(draftRow.diff as ProposalDiff);
    const [inserted] = await this.db
      .insert(proposals)
      .values({ session_id, diff, status: "pending" })
      .returning();
    await this.db
      .delete(proposal_drafts)
      .where(eq(proposal_drafts.session_id, session_id));
    return rowToProposal(inserted);
  }

  async createPending(session_id: string, diff: ProposalDiff): Promise<Proposal> {
    const normalized = normalizeDraft(diff);
    normalized.impacted_tables = recomputeImpactedTables(normalized);
    const [inserted] = await this.db
      .insert(proposals)
      .values({ session_id, diff: normalized, status: "pending" })
      .returning();
    return rowToProposal(inserted);
  }

  async listProposals(): Promise<Proposal[]> {
    const rows = await this.db
      .select()
      .from(proposals)
      .orderBy(desc(proposals.created_at));
    return rows.map(rowToProposal);
  }

  async getProposal(id: string): Promise<Proposal | null> {
    const [row] = await this.db
      .select()
      .from(proposals)
      .where(eq(proposals.id, id))
      .limit(1);
    return row ? rowToProposal(row) : null;
  }

  async updateProposalDiff(
    id: string,
    diff: ProposalDiff,
  ): Promise<Proposal> {
    const [row] = await this.db
      .update(proposals)
      .set({ diff })
      .where(eq(proposals.id, id))
      .returning();
    if (!row) throw new ProposalNotFoundError(id);
    return rowToProposal(row);
  }

  async setStatus(id: string, status: ProposalStatus): Promise<Proposal> {
    const [row] = await this.db
      .update(proposals)
      .set({ status })
      .where(eq(proposals.id, id))
      .returning();
    if (!row) throw new ProposalNotFoundError(id);
    return rowToProposal(row);
  }
}
