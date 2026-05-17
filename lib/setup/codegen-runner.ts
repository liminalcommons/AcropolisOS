import { spawn } from "node:child_process";
import path from "node:path";

const PKG_ROOT = path.resolve(__dirname, "..", "..");

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
  await runNpmScript("db:migrate");
}
