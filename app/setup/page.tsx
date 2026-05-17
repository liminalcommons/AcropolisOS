import { redirect } from "next/navigation";
import { getSetupFile } from "@/lib/setup/config";
import { isSetupComplete } from "@/lib/setup/state";
import { SetupWizard } from "@/components/setup-wizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await isSetupComplete(getSetupFile())) {
    redirect("/chat");
  }
  return (
    <main className="min-h-screen bg-zinc-950">
      <SetupWizard />
    </main>
  );
}
