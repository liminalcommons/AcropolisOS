// Scenario manifest (scenario.json) — the §3/§13 manifest fields:
// name, description, default(bool), version. A scenario bundle is
// scenarios/<name>/{ontology,seed,views}/ + this manifest.
import { z } from "zod";

export const ScenarioManifest = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    default: z.boolean().default(false),
    version: z.string().min(1),
  })
  .strict();
export type ScenarioManifest = z.infer<typeof ScenarioManifest>;

export function parseScenarioManifest(raw: unknown): ScenarioManifest {
  return ScenarioManifest.parse(raw);
}
