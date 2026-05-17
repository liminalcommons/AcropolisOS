import { getSetupFile } from "@/lib/setup/config";
import { isSetupComplete } from "@/lib/setup/state";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const complete = await isSetupComplete(getSetupFile());

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="max-w-xl px-8 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">
          acropolisOS setup
        </h1>
        <p className="mt-3 text-zinc-400">
          {complete
            ? "Setup is already complete. Sign in to continue."
            : "Welcome. The install is up. The setup wizard will run here."}
        </p>
        <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm text-zinc-500">
          <dt>Status</dt>
          <dd>{complete ? "complete" : "pending"}</dd>
          <dt>Next</dt>
          <dd>steward sign-in, ontology pick, action approvals</dd>
        </dl>
      </div>
    </main>
  );
}
