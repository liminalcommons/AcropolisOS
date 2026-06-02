// Pure decision for what ScenarioPicker does after POST /api/setup/ontology.
//
// On success the steward lands directly on the home board ("/") — the install
// route has already copied the ontology, run codegen + migrations, and marked
// setup complete, so there is nothing left to do manually (the old "reload the
// app to see it" toast was a dead end). Failures surface as a toast.

// Success navigates to the board, so a toast is only ever produced on failure.
export type InstallToast = { kind: "error"; message: string };

export type InstallOutcome =
  | { kind: "navigate"; to: "/" }
  | { kind: "toast"; toast: InstallToast };

export function decideInstallOutcome(
  res: { ok: boolean; status: number },
  body: { error?: unknown },
  _selected: string,
): InstallOutcome {
  if (res.ok) {
    return { kind: "navigate", to: "/" };
  }
  if (res.status === 409) {
    return {
      kind: "toast",
      toast: {
        kind: "error",
        message: "This deployment is already set up — the scenario is locked.",
      },
    };
  }
  return {
    kind: "toast",
    toast: {
      kind: "error",
      message:
        typeof body.error === "string"
          ? body.error
          : `Install failed (${res.status})`,
    },
  };
}
