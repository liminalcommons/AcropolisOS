import { getSetupFile } from "@/lib/setup/config";
import { getEnvFile } from "@/lib/setup/paths";
import { getUsersFile } from "@/lib/auth/config";
import { isSetupComplete, resolveInitialStep } from "@/lib/setup/state";
import { SetupWizard } from "@/components/setup-wizard";
import { InboxDropzone } from "@/components/inbox-dropzone";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const complete = await isSetupComplete(getSetupFile());
  // Resolve which step to start the wizard on. Fixes B12: before this,
  // a refresh mid-setup reset the wizard to step 1 even if .env was
  // already written.
  const initialStep = complete
    ? 3
    : await resolveInitialStep({
        envFile: getEnvFile(),
        usersFile: getUsersFile(),
      });
  return (
    <main className="min-h-screen bg-zinc-950">
      {complete ? null : <SetupWizard initialStep={initialStep} />}
      <div className="max-w-xl mx-auto px-8 pb-12">
        <InboxDropzone />
      </div>
    </main>
  );
}
