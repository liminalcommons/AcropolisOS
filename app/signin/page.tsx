import { Suspense } from "react";
import { SignInForm } from "@/components/signin-form";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-md px-8 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-400">
          acropolisOS uses a local credentials store. Use the steward email and
          password you created during setup.
        </p>
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
