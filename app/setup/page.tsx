import { getSetupFile } from "@/lib/setup/config";
import { isSetupComplete } from "@/lib/setup/state";
import { SetupWizard } from "@/components/setup-wizard";
import { InboxDropzone } from "@/components/inbox-dropzone";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const complete = await isSetupComplete(getSetupFile());
  return (
    <main className="min-h-screen bg-zinc-950">
      {complete ? null : <SetupWizard />}
      <div className="max-w-xl mx-auto px-8 pb-12">
        <InboxDropzone />
      </div>
    </main>
  );
}
