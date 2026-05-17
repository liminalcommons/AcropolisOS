import path from "node:path";

// See lib/setup/paths.ts for why we use process.cwd() instead of __dirname.
const PKG_ROOT = process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd();
const DEFAULT_SETUP_FILE = path.join(PKG_ROOT, "data", "setup.json");

export function getSetupFile(): string {
  return process.env.ACROPOLISOS_SETUP_FILE ?? DEFAULT_SETUP_FILE;
}
