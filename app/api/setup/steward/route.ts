import { isSetupComplete } from "@/lib/setup/state";
import { getSetupFile } from "@/lib/setup/config";
import { FileUserStore } from "@/lib/auth/users";
import { getUsersFile } from "@/lib/auth/config";
import { mintMagicLink } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(req: Request): Promise<Response> {
  if (await isSetupComplete(getSetupFile())) {
    return Response.json({ error: "setup already complete" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || !isEmail(email.trim())) {
    return Response.json({ error: "valid email is required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return Response.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const store = new FileUserStore(getUsersFile());
  if ((await store.countStewards()) > 0) {
    return Response.json({ error: "steward already exists" }, { status: 409 });
  }

  let user;
  try {
    user = await store.create({
      email: email.trim(),
      password,
      role: "steward",
      customRoles: [],
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // Auto-login the freshly-created first steward so the wizard proceeds without
  // a separate manual sign-in. This is the ONLY auth-flow shortcut, and it is
  // reachable only on this success path — the countStewards() === 0 guard above
  // means a session is never established for anyone but the steward we just
  // created. We mint a single-use magic link for that email and hand the token
  // to next-auth signIn (the same authorize() the public magic-link path uses);
  // signIn writes the session cookie via the Next cookies() store. Best-effort:
  // a failure here (e.g. no request context) must not block steward creation,
  // so the steward can always fall back to /signin.
  try {
    const origin = new URL(req.url).origin;
    const { token } = await mintMagicLink({ email: user.email, baseUrl: origin });
    // Lazy import: @/lib/auth eagerly constructs NextAuth (which pulls in
    // next/server). Importing it here, only on this success path, keeps the
    // route's module graph free of that dependency for the validation/409 paths.
    const { signIn } = await import("@/lib/auth");
    await signIn("credentials", { magicToken: token, redirect: false });
  } catch {
    // Swallow: the steward exists; sign-in can still happen manually at /signin.
  }

  return Response.json({ id: user.id, email: user.email, role: user.role });
}
