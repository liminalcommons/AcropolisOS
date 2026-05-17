import { OPENCODE_BASE_URL, PROVIDERS, type Provider } from "../agent/mastra";

export type FetchLike = typeof fetch;

export interface ValidateInput {
  provider: Provider;
  apiKey: string;
  baseURL?: string;
  fetchImpl?: FetchLike;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// Strip a trailing /v1 (and any trailing slashes) so we can re-append the
// canonical /v1/models path without ending up with /v1/v1/models against
// OpenAI-compatible gateways that already include /v1 in their base URL.
const stripV1 = (u: string) => u.replace(/\/+$/, "").replace(/\/v1$/, "");

const PROBE: Record<
  Provider,
  (apiKey: string, baseURL?: string) => { url: string; headers: HeadersInit }
> = {
  anthropic: (apiKey, baseURL) => ({
    url: `${stripV1(baseURL ?? "https://api.anthropic.com")}/v1/models`,
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  }),
  openai: (apiKey, baseURL) => ({
    url: `${stripV1(baseURL ?? "https://api.openai.com")}/v1/models`,
    headers: { Authorization: `Bearer ${apiKey}` },
  }),
  groq: (apiKey, baseURL) => ({
    url: `${stripV1(baseURL ?? "https://api.groq.com/openai")}/v1/models`,
    headers: { Authorization: `Bearer ${apiKey}` },
  }),
  ollama: (_apiKey, baseURL) => ({
    url: `${(baseURL ?? "http://localhost:11434").replace(/\/+$/, "")}/api/tags`,
    headers: {},
  }),
  opencode: (apiKey, baseURL) => ({
    url: `${stripV1(baseURL ?? OPENCODE_BASE_URL)}/v1/models`,
    headers: { Authorization: `Bearer ${apiKey}` },
  }),
};

export async function validateProviderKey(
  input: ValidateInput,
): Promise<ValidationResult> {
  const { provider, baseURL } = input;
  const apiKey = input.apiKey.trim();
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, error: `unsupported provider: ${provider}` };
  }
  if (provider !== "ollama" && !apiKey) {
    return { ok: false, error: "API key is required" };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const probe = PROBE[provider](apiKey, baseURL);
  try {
    const res = await fetchImpl(probe.url, { headers: probe.headers });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return {
      ok: false,
      error: `provider returned ${res.status} ${res.statusText || ""}`.trim(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
