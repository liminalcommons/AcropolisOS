import { isSetupComplete } from "@/lib/setup/state";
import { getSetupFile } from "@/lib/setup/config";
import { getEnvFile } from "@/lib/setup/paths";
import { validateProviderKey } from "@/lib/setup/provider";
import { upsertEnvVars } from "@/lib/setup/env-write";
import { PROVIDERS, type Provider } from "@/lib/agent/mastra";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
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

  const { provider, apiKey, baseURL } = body as {
    provider?: unknown;
    apiKey?: unknown;
    baseURL?: unknown;
  };
  if (!isProvider(provider)) {
    return Response.json(
      { error: `provider must be one of ${PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }
  const key = typeof apiKey === "string" ? apiKey : "";
  const base = typeof baseURL === "string" ? baseURL : undefined;
  if (provider !== "ollama" && !key.trim()) {
    return Response.json({ error: "apiKey is required" }, { status: 400 });
  }

  const result = await validateProviderKey({ provider, apiKey: key, baseURL: base });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 422 });
  }

  const vars: Record<string, string> = { LLM_PROVIDER: provider };
  if (key.trim()) vars.LLM_API_KEY = key.trim();
  if (base) vars.LLM_BASE_URL = base;
  await upsertEnvVars(getEnvFile(), vars);

  return Response.json({ ok: true, provider });
}
