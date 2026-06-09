import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/** Logto is the door only when its env trio is present (mirrors config.ts). */
function logtoConfigured(): boolean {
  return Boolean(
    process.env.LOGTO_ISSUER &&
      process.env.LOGTO_CLIENT_ID &&
      process.env.LOGTO_CLIENT_SECRET,
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  magiclink: "That sign-in link is invalid or has expired. Ask for a fresh one.",
  Configuration:
    "Sign-in is misconfigured. The steward needs to check the Logto setup.",
};

/**
 * /signin is fully SERVER-RENDERED — no client component, no hydration
 * dependency. The Logto door is a real <form> POST to the Auth.js signin
 * endpoint carrying the CSRF token read from the cookie jar, so it works even
 * when client JS fails to hydrate (which it currently does app-wide — see the
 * hydration investigation). A plain form submit is a top-level navigation the
 * browser always honors.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const callbackUrl =
    (typeof sp.callbackUrl === "string" && sp.callbackUrl) || "/chat";
  const errorParam = typeof sp.error === "string" ? sp.error : undefined;
  const error = errorParam
    ? (ERROR_MESSAGES[errorParam] ?? "Sign-in failed. Please try again.")
    : null;
  const logtoEnabled = logtoConfigured();

  // Auth.js stores the CSRF token in an httpOnly cookie as `<token>|<hash>`;
  // the signin POST validates the submitted token against it. Read it here so
  // the server-rendered form carries a matching value.
  const jar = await cookies();
  const csrf =
    (jar.get("__Host-authjs.csrf-token") ?? jar.get("authjs.csrf-token"))
      ?.value.split("|")[0] ?? "";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-8 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          acropolisOS uses your shared Castalia identity (Logto).
        </p>

        <div className="mt-8 space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded border border-destructive/60 bg-destructive/15 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          {logtoEnabled ? (
            <form method="POST" action="/api/auth/signin/logto">
              <input type="hidden" name="csrfToken" value={csrf} />
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <button
                type="submit"
                className="w-full rounded bg-primary px-4 py-2 text-primary-foreground"
              >
                Continue with Logto
              </button>
            </form>
          ) : (
            <p className="rounded border border-border bg-card p-3 text-sm text-muted-foreground">
              Public sign-in isn’t configured yet. Access is via an operator
              sign-in link for now.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
