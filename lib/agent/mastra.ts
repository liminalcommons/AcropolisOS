import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";

export type Provider = "anthropic" | "openai" | "groq" | "ollama";

export const PROVIDERS: readonly Provider[] = [
  "anthropic",
  "openai",
  "groq",
  "ollama",
] as const;

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.2",
};

export const AGENT_NAME = "acropolisos-chat";

export const AGENT_INSTRUCTIONS = [
  "You are the acropolisOS chat agent.",
  "You help stewards and members of a small community explore and shape a typed ontology.",
  "Default to concise, direct answers. Ask before proposing schema changes.",
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
