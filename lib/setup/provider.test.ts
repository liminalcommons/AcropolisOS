import { describe, expect, it, vi } from "vitest";
import { validateProviderKey, type FetchLike } from "./provider";

describe("validateProviderKey", () => {
  it("rejects unsupported provider", async () => {
    const res = await validateProviderKey({
      provider: "nope" as never,
      apiKey: "x",
      fetchImpl: vi.fn(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/provider/i);
  });

  it("rejects empty key for non-ollama provider", async () => {
    const res = await validateProviderKey({
      provider: "anthropic",
      apiKey: "   ",
      fetchImpl: vi.fn(),
    });
    expect(res.ok).toBe(false);
  });

  it("anthropic: 200 response => ok", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await validateProviderKey({
      provider: "anthropic",
      apiKey: "sk-test",
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "sk-test" }),
      }),
    );
  });

  it("anthropic: 401 response => failure with status", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401 }));
    const res = await validateProviderKey({
      provider: "anthropic",
      apiKey: "bad",
      fetchImpl,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/401/);
  });

  it("openai: uses Authorization Bearer header", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await validateProviderKey({
      provider: "openai",
      apiKey: "sk-openai",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-openai",
        }),
      }),
    );
  });

  it("groq: uses Authorization Bearer header", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await validateProviderKey({
      provider: "groq",
      apiKey: "gsk-x",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer gsk-x" }),
      }),
    );
  });

  it("ollama: probes the base URL /api/tags with no key required", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await validateProviderKey({
      provider: "ollama",
      apiKey: "",
      baseURL: "http://localhost:11434",
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.any(Object),
    );
  });

  it("ollama: defaults to http://localhost:11434 when no baseURL", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await validateProviderKey({
      provider: "ollama",
      apiKey: "",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.any(Object),
    );
  });

  it("network error => ok: false", async () => {
    const fetchImpl: FetchLike = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await validateProviderKey({
      provider: "anthropic",
      apiKey: "sk",
      fetchImpl,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ECONNREFUSED/);
  });
});
