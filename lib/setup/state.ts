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

/**
 * Resolve which wizard step to start on for a partial setup.
 *
 * Determines per-step completion from three independent signals:
 *   Step 1 done if LLM_PROVIDER + LLM_API_KEY are present in the env file
 *           (or LLM_PROVIDER alone for ollama, which has no key).
 *   Step 2 done if any user record exists in the users file.
 *   Step 3 done if the setup file marks completed=true (handled separately by
 *           the page — when complete, the wizard doesn't render at all).
 *
 * Returns the next OPEN step (1, 2, or 3). If everything looks done, returns
 * 3 — the caller should still check isSetupComplete() to decide whether to
 * render the wizard at all.
 *
 * Fixes B12: wizard state lost on page refresh. Before this, a partial
 * setup that succeeded through step 1 (LLM keys written to .env) would
 * reset to step 1 every refresh because step was kept only in useState.
 */
export async function resolveInitialStep(opts: {
  envFile: string;
  usersFile: string;
}): Promise<1 | 2 | 3> {
  const { providerConfigured, stewardExists } =
    await resolveSetupProgress(opts);
  if (!providerConfigured) return 1;
  if (!stewardExists) return 2;
  return 3;
}

export interface SetupProgress {
  /** LLM_PROVIDER (+key for non-ollama) present in the env file. */
  providerConfigured: boolean;
  /** At least one user record exists in the users file. */
  stewardExists: boolean;
}

/**
 * Per-step completion signals for the wizard cards. Unlike resolveInitialStep
 * (which collapses the signals into a single "next open step" 1|2|3), this
 * exposes each signal independently so the page can mark step 3 (LLM key) and
 * step 2 (steward) "ok" or "pending" without conflating them.
 *
 * Replaces the hardcoded status="pending" on the LLM-key card: the card's real
 * state is whether a provider is configured, which is exactly providerConfigured.
 */
export async function resolveSetupProgress(opts: {
  envFile: string;
  usersFile: string;
}): Promise<SetupProgress> {
  const [providerConfigured, stewardExists] = await Promise.all([
    hasProviderConfigured(opts.envFile),
    hasAnyUser(opts.usersFile),
  ]);
  return { providerConfigured, stewardExists };
}

async function hasProviderConfigured(envFile: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(envFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  const provider = raw.match(/^LLM_PROVIDER=(.+)$/m)?.[1]?.trim();
  if (!provider) return false;
  if (provider === "ollama") return true; // ollama is keyless
  return /^LLM_API_KEY=.+$/m.test(raw);
}

async function hasAnyUser(usersFile: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(usersFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as { users?: unknown };
    return Array.isArray(parsed.users) && parsed.users.length > 0;
  } catch {
    return false;
  }
}
