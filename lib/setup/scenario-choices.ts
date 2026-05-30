import { discoverScenarios, getScenariosRoot } from "./scenarios";

// A scenario as a first-run pick-list choice (the manifest fields the setup UI
// needs — no filesystem paths leak to the client).
export interface ScenarioChoice {
  name: string;
  description: string;
  default: boolean;
}

// Discovered scenarios as choices, default-first then name-sorted. Server-only
// (reads the filesystem); a server component calls this and passes the plain
// result to the client setup wizard.
export async function listScenarioChoices(
  scenariosRoot: string = getScenariosRoot(),
): Promise<ScenarioChoice[]> {
  const found = await discoverScenarios(scenariosRoot);
  return found
    .map((s) => ({
      name: s.manifest.name,
      description: s.manifest.description,
      default: s.manifest.default,
    }))
    .sort((a, b) => {
      if (a.default !== b.default) return a.default ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}
