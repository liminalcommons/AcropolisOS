// Server-side magic-link sign-in. GET /api/magic?token=<token>
//
// Why server-side: the next-auth/react client signIn() hangs on the
// Credentials provider's 302 response (it awaits a JSON body that never
// arrives), leaving the page stuck on a spinner even though the cookie was
// set. Doing the sign-in here means the BROWSER only ever follows plain HTTP
// redirects — no client hydration, no cached dev chunk, works on any device.
//
// /api/ is a public middleware prefix, so this is reachable while
// unauthenticated. The token is validated + consumed inside the credentials
// authorize() (the magicToken branch); an invalid/expired/used token simply
// fails to authenticate and we bounce to /signin with an error flag.
import { type NextRequest, NextResponse } from "next/server";
import { signIn } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const fail = new URL("/signin?error=magiclink", req.nextUrl.origin);
  if (!token) return NextResponse.redirect(fail);

  try {
    // On success signIn sets the session cookie and throws a NEXT_REDIRECT to
    // "/", which we re-throw so Next issues the 302 (carrying Set-Cookie).
    await signIn("credentials", { magicToken: token, redirectTo: "/" });
  } catch (err) {
    if (isRedirect(err)) throw err;
    return NextResponse.redirect(fail);
  }
  // signIn normally redirects (throws); reaching here means no redirect was
  // issued — treat as a failed sign-in.
  return NextResponse.redirect(fail);
}
