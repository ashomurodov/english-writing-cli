import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Package install directory — used only for bundled assets (prompts/).
 */
export const PKG_DIR = join(__dirname, "..");

/**
 * User data directory — ~/.english-tracker/
 * All logs, reports, stats, and git history live here.
 */
export const DATA_DIR = join(homedir(), ".english-tracker");

/**
 * Default editor: $EDITOR env var, or notepad on Windows, nano elsewhere.
 */
export function getEditor(): string {
  if (process.env.EDITOR) return process.env.EDITOR;
  return platform() === "win32" ? "notepad" : "nano";
}
