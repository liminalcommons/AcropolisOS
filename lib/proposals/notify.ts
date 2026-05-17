// US-018: Submit-for-review notification fan-out.
//
// Non-steward members can finalize proposals through the inline chat panel.
// When they click "Submit for review", the proposal is already pending in the
// queue (finalize_proposal lands it there). This helper notifies stewards so
// they actually see the new item. v0 ships a console-log adapter; production
// will swap it for the same email/webhook channels US-028 wired for action
// side-effects (see lib/actions/side-effects.ts).

export interface NotifyStewardsInput {
  proposalId: string;
  submittedBy?: string;
}

export type NotifyStewards = (input: NotifyStewardsInput) => Promise<void>;

const consoleNotifier: NotifyStewards = async ({ proposalId, submittedBy }) => {
  console.log(
    `[acropolisos] proposal ${proposalId} submitted for review${
      submittedBy ? ` by ${submittedBy}` : ""
    }`,
  );
};

export async function notifyStewardsOfProposal(
  input: NotifyStewardsInput,
): Promise<void> {
  await consoleNotifier(input);
}
