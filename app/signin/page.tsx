import { Suspense } from "react";
import { SignInForm } from "@/components/signin-form";

export const dynamic = "force-dynamic";

/** Logto is the door only when its env trio is present (mirrors config.ts). */
function logtoConfigured(): boolean {
  return Boolean(
    process.env.LOGTO_ISSUER &&
      process.env.LOGTO_CLIENT_ID &&
      process.env.LOGTO_CLIENT_SECRET,
  );
}

export default function SignInPage() {
  const logtoEnabled = logtoConfigured();
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-8 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {logtoEnabled
            ? "acropolisOS uses your shared Castalia identity. Continue with Logto to sign in."
            : "acropolisOS uses your shared Castalia identity (Logto)."}
        </p>
        <Suspense fallback={null}>
          <SignInForm logtoEnabled={logtoEnabled} />
        </Suspense>
      </div>
    </main>
  );
}
