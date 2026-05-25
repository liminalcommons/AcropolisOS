/**
 * Quick LLM ping test — just verify generateText works with the configured model.
 */
import { generateText } from "ai";
import { buildLanguageModel } from "../lib/agent/mastra";

async function main() {
  const model = buildLanguageModel();
  console.log("Calling LLM (generateText)...");
  const start = Date.now();
  const result = await generateText({
    model,
    prompt: "Reply with exactly: PONG",
  });
  console.log(`Response in ${Date.now() - start}ms:`, result.text);
}

main().catch((err) => { console.error("ERROR:", err?.message ?? err); process.exit(1); });
