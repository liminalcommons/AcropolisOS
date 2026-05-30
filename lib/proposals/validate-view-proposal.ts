// Governance fence (correction C4): a ViewConfigProposal's widget descriptors
// carry {id, kind, config}. Previously a descriptor whose config referenced a
// non-existent type/field was happily staged, approved + persisted, then
// SILENTLY no-op'd at render (per-user.ts / compose.ts are fail-closed → skip
// invalid). The steward got no signal that they approved a dead view.
//
// This module rejects such a descriptor LOUDLY at PROPOSE time — before it ever
// reaches the steward queue — by running the existing validateWidgetConfig
// (catalog.ts) per descriptor against the EFFECTIVE ontology.
//
// Enforcement point rationale: apply.ts does NOT have the loaded Ontology in
// scope (ApplyDeps carries only `ontologyRoot: string`, and the apply path's
// relevant ontology is the post-apply one that doesn't exist yet at the
// materialization loop). Threading an Ontology into ApplyDeps + every apply
// test's noopDeps would be invasive cross-cutting threading. The propose layer,
// by contrast, has the live ontology one hop away (loadOntology), the same
// pattern compose.ts already uses. A view can legitimately reference a type
// introduced in the SAME draft, so we overlay the draft's new_object_types on
// the live ontology before deriving the membership/field whitelist.

import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import type { Ontology } from "@/lib/ontology/schema";
import {
  validateWidgetConfig,
  type CatalogKind,
} from "@/lib/widgets/catalog";
import type { ViewConfigProposal } from "../views/view-proposal";
import type { ProposalDiff } from "./diff";

export type ViewProposalValidation =
  | { ok: true }
  | { ok: false; error: string; detail?: unknown };

/**
 * Pure core: validate every descriptor's config against the membership + field
 * whitelist derived from `ontology` (optionally overlaid with object types
 * proposed in the same draft so a view of a same-draft type is accepted). On
 * the FIRST invalid descriptor, returns ok:false with a structured error naming
 * the offending descriptor id + the catalog error code. No disk I/O.
 */
export function validateViewProposal(
  proposal: ViewConfigProposal,
  ontology: Ontology,
  draftObjectTypes?: Ontology["object_types"],
): ViewProposalValidation {
  // Overlay draft-proposed object types so a view of a type introduced in the
  // same proposal is valid; truly non-existent types remain rejected.
  const effective: Ontology = draftObjectTypes
    ? {
        ...ontology,
        object_types: { ...ontology.object_types, ...draftObjectTypes },
      }
    : ontology;

  for (const d of proposal.descriptors) {
    const result = validateWidgetConfig(
      d.kind as CatalogKind,
      d.config,
      effective,
    );
    if (!result.ok) {
      return {
        ok: false,
        error: `invalid view descriptor "${d.id}" (${d.kind}): ${result.error}`,
        detail: result.detail,
      };
    }
  }
  return { ok: true };
}

/**
 * Convenience wrapper used by the propose_view tools: loads the LIVE ontology
 * (one hop, the compose.ts pattern), overlays the current draft's proposed
 * object types, then runs the pure validation. Rejecting here means an invalid
 * descriptor never reaches the steward queue.
 */
export async function validateViewProposalAgainstLiveOntology(
  proposal: ViewConfigProposal,
  draft?: ProposalDiff | null,
): Promise<ViewProposalValidation> {
  const ontology = await loadOntology(getRuntimeOntologyDir());
  return validateViewProposal(
    proposal,
    ontology,
    draft?.new_object_types as Ontology["object_types"] | undefined,
  );
}

/** Thrown by propose_view when a descriptor config is invalid. */
export class InvalidViewProposalError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "InvalidViewProposalError";
  }
}
