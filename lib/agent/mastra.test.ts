import { describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import {
  AGENT_NAME,
  DEFAULT_MODELS,
  buildAgent,
  buildLanguageModel,
  resolveProviderConfig,
} from "./mastra";

const baseEnv = { LLM_API_KEY: "sk-test" } as Record<string, string>;

describe("resolveProviderConfig", () => {
  it("defaults to anthropic with claude-sonnet-4-6 when LLM_PROVIDER unset", () => {
    const cfg = resolveProviderConfig(baseEnv);
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.model).toBe("claude-sonnet-4-6");
    expect(cfg.apiKey).toBe("sk-test");
  });

  it("respects LLM_PROVIDER=openai with flagship default model", () => {
    const cfg = resolveProviderConfig({ ...baseEnv, LLM_PROVIDER: "openai" });
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe(DEFAULT_MODELS.openai);
  });

  it("respects LLM_PROVIDER=groq with flagship default model", () => {
    const cfg = resolveProviderConfig({ ...baseEnv, LLM_PROVIDER: "groq" });
    expect(cfg.provider).toBe("groq");
    expect(cfg.model).toBe(DEFAULT_MODELS.groq);
  });

  it("respects LLM_PROVIDER=ollama with flagship default model", () => {
    const cfg = resolveProviderConfig({ LLM_PROVIDER: "ollama" });
    expect(cfg.provider).toBe("ollama");
    expect(cfg.model).toBe(DEFAULT_MODELS.ollama);
  });

  it("uses LLM_MODEL override when provided", () => {
    const cfg = resolveProviderConfig({
      ...baseEnv,
      LLM_PROVIDER: "anthropic",
      LLM_MODEL: "claude-opus-4-7",
    });
    expect(cfg.model).toBe("claude-opus-4-7");
  });

  it("throws on unknown provider name", () => {
    expect(() =>
      resolveProviderConfig({ ...baseEnv, LLM_PROVIDER: "bogus" }),
    ).toThrow(/LLM_PROVIDER/);
  });

  it("throws when api key missing for non-ollama provider", () => {
    expect(() => resolveProviderConfig({ LLM_PROVIDER: "anthropic" })).toThrow(
      /LLM_API_KEY/,
    );
  });

  it("does not require api key for ollama", () => {
    const cfg = resolveProviderConfig({ LLM_PROVIDER: "ollama" });
    expect(cfg.apiKey).toBeUndefined();
  });
});

describe("buildLanguageModel", () => {
  it("returns an AI SDK LanguageModel for the resolved provider", () => {
    const model = buildLanguageModel(baseEnv);
    expect(model).toBeTruthy();
    // AI SDK v6 LanguageModel exposes a modelId
    expect(typeof (model as { modelId?: string }).modelId).toBe("string");
    expect((model as { modelId?: string }).modelId).toBe("claude-sonnet-4-6");
  });
});

describe("buildAgent", () => {
  it("returns a Mastra Agent instance named acropolisos-chat", () => {
    const agent = buildAgent(baseEnv);
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.name).toBe(AGENT_NAME);
  });
});
