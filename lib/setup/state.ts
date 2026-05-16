import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface SetupFileShape {
  completed?: boolean;
  completedAt?: string;
  stewardEmail?: string;
}

export async function isSetupComplete(file: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as SetupFileShape;
    return parsed.completed === true;
  } catch {
    return false;
  }
}

export async function markSetupComplete(
  file: string,
  meta: { stewardEmail?: string } = {},
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const payload: SetupFileShape = {
    completed: true,
    completedAt: new Date().toISOString(),
    ...(meta.stewardEmail ? { stewardEmail: meta.stewardEmail } : {}),
  };
  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}
