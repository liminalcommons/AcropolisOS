import { spawn } from "node:child_process";

// See lib/setup/paths.ts for why we use process.cwd() instead of __dirname.
const PKG_ROOT = process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd();

function runNpmScript(script: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["run", script], {
      cwd: PKG_ROOT,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

export async function runCodegen(): Promise<void> {
  await runNpmScript("codegen");
}

export async function runMigrations(): Promise<void> {
  // After codegen regenerates schema.generated.ts the DB schema needs to be
  // re-synced. We use db:push (same as the boot entrypoint) rather than
  // db:migrate because the hand-written SQL migrations don't include CREATE
  // TABLE statements for the codegen'd object tables — see lib/db/schema.ts
  // and docker-entrypoint.sh for the same reasoning.
  await runNpmScript("db:push");
}
