import { cp, stat } from "node:fs/promises";

export async function copySeedOntology(
  source: string,
  destination: string,
): Promise<void> {
  await stat(source);
  await cp(source, destination, { recursive: true, force: true });
}
