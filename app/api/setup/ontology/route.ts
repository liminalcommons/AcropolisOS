import { isSetupComplete, markSetupComplete } from "@/lib/setup/state";
import { getSetupFile } from "@/lib/setup/config";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import {
  discoverScenarios,
  getScenariosRoot,
  scenarioOntologyDir,
} from "@/lib/setup/scenarios";
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
  if (typeof seed !== "string") {
    return Response.json({ error: "seed must be a string" }, { status: 400 });
  }
  const scenarios = await discoverScenarios(getScenariosRoot());
  if (!scenarios.some((s) => s.manifest.name === seed)) {
    return Response.json(
      {
        error: `seed must be one of ${scenarios
          .map((s) => s.manifest.name)
          .join(", ")}`,
      },
      { status: 400 },
    );
  }

  const srcOntology = scenarioOntologyDir(seed);
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
