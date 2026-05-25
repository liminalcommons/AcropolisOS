// Shared JSON-from-LLM-text extractor.
//
// glm-5.1 (via OpenCode Zen) has no structured-output mode, so models return
// JSON wrapped in prose / markdown code fences. This replicates the exact
// behavior previously inlined in app/api/organize/classify/route.ts so the
// classify route's output is unchanged — and is reused by the theme designer.
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text.trim();
}
