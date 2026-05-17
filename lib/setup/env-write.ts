import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function formatValue(v: string): string {
  if (/[\s"'#]/.test(v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

export async function upsertEnvVars(
  file: string,
  vars: Record<string, string>,
): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const remaining = new Map(Object.entries(vars));
  const lines = existing.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m && remaining.has(m[1])) {
      const key = m[1];
      const val = remaining.get(key) as string;
      out.push(`${key}=${formatValue(val)}`);
      remaining.delete(key);
    } else {
      out.push(line);
    }
  }

  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();

  for (const [key, val] of remaining) {
    out.push(`${key}=${formatValue(val)}`);
  }

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, out.join("\n") + "\n", "utf8");
}
