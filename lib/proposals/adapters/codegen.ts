import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadOntology } from "../../ontology/load";
import {
  generateOntologyModule,
  generateZodModule,
} from "../../codegen/zod";
import { generateMastraToolsModule } from "../../codegen/mastra-tools";
import { generateDrizzleModule } from "../../codegen/drizzle";
import type {
  CodegenRunner,
  FileSnapshot,
  FileSnapshotEntry,
} from "../apply";

export interface CodegenLayout {
  packageRoot: string;
  ontologyOutDir?: string;
  agentOutDir?: string;
  dbOutDir?: string;
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function snapshotPath(filePath: string): Promise<FileSnapshotEntry> {
  return { path: filePath, previousContent: await readIfExists(filePath) };
}

async function writeStable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

export class GeneratedFilesCodegen implements CodegenRunner {
  constructor(private readonly layout: CodegenLayout) {}

  async regenerate(ontologyRoot: string): Promise<FileSnapshot> {
    const pkg = this.layout.packageRoot;
    const ontologyOutDir =
      this.layout.ontologyOutDir ?? path.join(pkg, "lib", "ontology");
    const agentOutDir =
      this.layout.agentOutDir ?? path.join(pkg, "lib", "agent");
    const dbOutDir = this.layout.dbOutDir ?? path.join(pkg, "lib", "db");

    const typesPath = path.join(ontologyOutDir, "types.generated.ts");
    const combinedPath = path.join(ontologyOutDir, "ontology.generated.ts");
    const toolsPath = path.join(agentOutDir, "tools.generated.ts");
    const drizzlePath = path.join(dbOutDir, "schema.generated.ts");

    const ontology = await loadOntology(ontologyRoot);
    const entries: FileSnapshotEntry[] = [
      await snapshotPath(typesPath),
      await snapshotPath(combinedPath),
      await snapshotPath(toolsPath),
      await snapshotPath(drizzlePath),
    ];

    await writeStable(typesPath, generateZodModule(ontology));
    await writeStable(combinedPath, generateOntologyModule(ontology));
    await writeStable(toolsPath, generateMastraToolsModule(ontology));
    await writeStable(drizzlePath, generateDrizzleModule(ontology));

    return { files: entries };
  }

  async restore(snapshot: FileSnapshot): Promise<void> {
    for (const entry of snapshot.files) {
      if (entry.previousContent === null) {
        await rm(entry.path, { force: true });
      } else {
        await writeStable(entry.path, entry.previousContent);
      }
    }
  }
}
