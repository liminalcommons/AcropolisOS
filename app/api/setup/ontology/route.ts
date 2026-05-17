import path from "node:path";
import { isSetupComplete, markSetupComplete } from "@/lib/setup/state";
import { getSetupFile } from "@/lib/setup/config";
import {
  getRuntimeOntologyDir,
  getSeedRoot,
  isSeedName,
  SEED_NAMES,
} from "@/lib/setup/paths";
import { copySeedOntology } from "@/lib/setup/seed-copy";
import { runCodegen, runMigrations } from "@/lib/setup/codegen-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const { seed } = body as { seed?: unknown };
  if (typeof seed !== "string" || !isSeedName(seed)) {
    return Response.json(
      { error: `seed must be one of ${SEED_NAMES.join(", ")}` },
      { status: 400 },
    );
  }

  const srcOntology = path.join(getSeedRoot(), seed);
  const destOntology = getRuntimeOntologyDir();

  try {
    await copySeedOntology(srcOntology, destOntology);
    await runCodegen();
    await runMigrations();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  await markSetupComplete(getSetupFile());
  return Response.json({ ok: true, seed });
}
