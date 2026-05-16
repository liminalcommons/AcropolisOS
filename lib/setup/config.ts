import path from "node:path";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SETUP_FILE = path.join(PKG_ROOT, "data", "setup.json");

export function getSetupFile(): string {
  return process.env.ACROPOLISOS_SETUP_FILE ?? DEFAULT_SETUP_FILE;
}
