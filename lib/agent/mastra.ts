import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";

export type Provider =
  | "anthropic"
  | "openai"
  | "groq"
  | "ollama"
  | "opencode";

export const PROVIDERS: readonly Provider[] = [
  "anthropic",
  "openai",
  "groq",
  "ollama",
  "opencode",
] as const;

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.2",
  // OpenCode Go ($10/mo plan) covers open-weight models via /zen/go/v1.
  // Default to qwen3.6-plus for the strongest open-weight reasoner; users
  // who've topped up Zen credits can override LLM_BASE_URL=/zen/v1 and pick
  // closed models (claude-*, gpt-*, gemini-*) via the model picker.
  opencode: "qwen3.6-plus",
};

// OpenCode Zen is an OpenAI-compatible gateway. The `/go/` segment routes
// against the Go-plan subscription quota (covers open-weight models incl.
// qwen, glm, kimi, deepseek, minimax); the bare `/zen/v1` root requires Zen
// credit balance and returns CreditsError for Go-only accounts. Pinning to
// /zen/go/v1 keeps the steward setup single-field; users who topped up Zen
// can override via LLM_BASE_URL=https://opencode.ai/zen/v1 to unlock the
// closed/premium models (claude-*, gpt-*, gemini-*).
export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1" as const;

// Curated set of OpenCode Zen model IDs surfaced in the setup picker. The
// /v1/models endpoint lists the full set; this list is the steward-friendly
// subset (most likely to work on Go-tier and Zen pay-as-you-go).
export const OPENCODE_MODELS = [
  // Open-weight (Go-plan subscription via /zen/go/v1)
  "qwen3.6-plus",
  "glm-5.1",
  "glm-5",
  "kimi-k2.6",
  "kimi-k2.5",
  "deepseek-v4-flash",
  "minimax-m2.7",
  "minimax-m2.5",
  // Closed / Zen pay-as-you-go
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-5.5",
  "gpt-5",
  "gemini-3.1-pro",
] as const;

export const AGENT_NAME = "acropolisos-chat";

export const AGENT_INSTRUCTIONS = [
  "You are the acropolisOS chat agent.",
  "You help stewards and members of a small community explore and shape a typed ontology.",
  "Default to concise, direct answers. Ask before proposing schema changes.",

  // M4.4: PROACTIVE BLOCKER ESCALATION
  // When you hit any of these walls, call flag_blocker immediately — do NOT silently abandon work:
  // (a) apply_action returns confirmation_required and you cannot bypass it,
  // (b) the user's request is ambiguous and context reads cannot resolve it,
  // (c) a data point is missing (no Member row matches, an enum value is absent from the ontology),
  // (d) a permission gate the actor cannot satisfy is required,
  // (e) a policy of always_confirm blocks an action the user explicitly asked for.
  // After calling flag_blocker, explain in your reply that the work is queued on their /me page",
  // and you will resume once they resolve it.",
  "PROACTIVELY identify human bottlenecks: whenever you hit (a) a confirmation_required from apply_action you cannot bypass, (b) ambiguity you cannot resolve from reads, (c) missing data (no matching row, unknown enum value), (d) a permission gate the actor cannot satisfy, or (e) an always_confirm policy — call flag_blocker with blocked_actor_id set to the requesting actor (or the steward if steward power is needed), then tell the user the work is queued on their /me page and you will resume once they resolve it. Do NOT silently abandon work.",

  // M4.4: READ MEMBER CONTEXT FIRST on open-ended self-directed questions
  "Call query_member_context FIRST when the user asks 'what should I do?', 'what is on my plate?', 'help me', 'where are we?', or any open-ended self-directed question — read the agent_blockers and needed_actions widgets so you do not re-ask things already queued.",

  // M4.4: USE pin_widget_to_member_context for /me shaping
  "Use pin_widget_to_member_context when the user asks to add something to their /me page or 'pin this to my dashboard'.",

  // M4.4: AGENT REASONING CONTRACT for pathways resolution_mode
  // When resolution_mode = pathways, you MUST provide >= 2 genuinely distinct pathways,
  // each with: label, rationale (trade-off), action, and reversibility (easy/moderate/permanent).
  // Generating only 1 pathway means you already decided — use apply_action instead, not flag_blocker.
  "When calling flag_blocker with resolution_mode='pathways', you MUST provide at least 2 genuinely distinct pathways. Each pathway needs: label (short), rationale (trade-off), action ({type, params}), and reversibility ('easy'|'moderate'|'permanent'). Offering only 1 pathway means you already decided — call apply_action instead.",
].join(" ");

export interface ProviderConfig {
  provider: Provider;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

type EnvLike = Record<string, string | undefined>;

function isProvider(v: string): v is Provider {
  return (PROVIDERS as readonly string[]).includes(v);
}

export function resolveProviderConfig(env: EnvLike = process.env): ProviderConfig {
  const raw = (env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();
  if (!isProvider(raw)) {
    throw new Error(
      `LLM_PROVIDER "${raw}" is not supported. Use one of: ${PROVIDERS.join(", ")}`,
    );
  }
  const model = env.LLM_MODEL?.trim() || DEFAULT_MODELS[raw];
  const apiKey = env.LLM_API_KEY?.trim() || undefined;
  if (raw !== "ollama" && !apiKey) {
    throw new Error(
      `LLM_API_KEY is required when LLM_PROVIDER="${raw}". Set it in the environment or switch to ollama.`,
    );
  }
  const baseURL = env.LLM_BASE_URL?.trim() || undefined;
  return { provider: raw, model, apiKey, baseURL };
}

export function buildLanguageModel(env: EnvLike = process.env): LanguageModel {
  const cfg = resolveProviderConfig(env);
  switch (cfg.provider) {
    case "anthropic": {
      const provider = createAnthropic({
        apiKey: cfg.apiKey,
        ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      });
      return provider(cfg.model);
    }
    case "openai": {
      const provider = createOpenAI({
        apiKey: cfg.apiKey,
        ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      });
      return provider(cfg.model);
    }
    case "groq": {
      const provider = createGroq({
        apiKey: cfg.apiKey,
        ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      });
      return provider(cfg.model);
    }
    case "ollama": {
      const provider = createOllama({
        ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      });
      return provider(cfg.model);
    }
    case "opencode": {
      // OpenCode Zen exposes /v1/chat/completions for all routed models.
      // @ai-sdk/openai v6 defaults provider(model) to the new /v1/responses
      // API, which Zen only supports for a subset (claude-*, gpt-*). Force
      // .chat() so open-weight models (qwen, glm, kimi, deepseek, minimax)
      // also work.
      const provider = createOpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL ?? OPENCODE_BASE_URL,
      });
      return provider.chat(cfg.model);
    }
  }
}

export function buildAgent(env: EnvLike = process.env): Agent {
  const model = buildLanguageModel(env);
  // Mastra v1.35 accepts both ai-sdk v5 and v6 models via an over-narrow
  // structural union (MastraLanguageModelV2 vs LanguageModelV2). The runtime
  // is compatible; we cast through unknown to bridge the type-only mismatch.
  return new Agent({
    id: AGENT_NAME,
    name: AGENT_NAME,
    instructions: AGENT_INSTRUCTIONS,
    model: model as never,
  });
}
