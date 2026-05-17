import { stat } from "node:fs/promises";
import * as tar from "tar";

export interface PackArchiveOptions {
  srcDir: string;
  outFile: string;
}

export async function packArchive(opts: PackArchiveOptions): Promise<void> {
  const s = await stat(opts.srcDir);
  if (!s.isDirectory()) {
    throw new Error(`packArchive: srcDir is not a directory: ${opts.srcDir}`);
  }
  await tar.create(
    { gzip: true, file: opts.outFile, cwd: opts.srcDir, portable: true },
    ["."],
  );
}

export interface ExtractArchiveOptions {
  inFile: string;
  destDir: string;
}

export async function extractArchive(
  opts: ExtractArchiveOptions,
): Promise<void> {
  await tar.extract({ file: opts.inFile, cwd: opts.destDir });
}
