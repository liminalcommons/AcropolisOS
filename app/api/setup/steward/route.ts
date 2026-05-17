import { isSetupComplete } from "@/lib/setup/state";
import { getSetupFile } from "@/lib/setup/config";
import { FileUserStore } from "@/lib/auth/users";
import { getUsersFile } from "@/lib/auth/config";

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

  return Response.json({ id: user.id, email: user.email, role: user.role });
}
