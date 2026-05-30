// US-022: Dev hot-reload watcher.
//
// Run alongside `next dev` (e.g. via two terminals or a process manager):
//   $ npm run dev          # next dev
//   $ npm run dev:watch    # this script
//
// Watches the active seed's ontology yaml + custom views tsx files. On
// debounced change, regenerates ontology artifacts in-process (no npm
// subprocess) and POSTs a notice to the in-app reload endpoint so the
// browser toast pops. Next.js HMR picks up the regenerated files via the
// normal module graph.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOntologyCodegen } from "../lib/dev/codegen-runner";
import {
  createWatcher,
  defaultArtifactMatcher,
} from "../lib/dev/watcher";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DevWatchOptions {
  pkgRoot: string;
  seedName: string;
  notifyUrl: string | null;
  debounceMs: number;
}

async function notify(notifyUrl: string | null, payload: unknown): Promise<void> {
  if (!notifyUrl) return;
  try {
    await fetch(notifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // The dev server may not be running yet — silent retry on next change.
    process.stderr.write(
      `[dev-watch] notify failed (${notifyUrl}): ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

async function main(): Promise<void> {
  const opts: DevWatchOptions = {
    pkgRoot: path.resolve(__dirname, ".."),
    seedName: process.env.ACROPOLISOS_SEED ?? "small-community",
    notifyUrl:
      process.env.ACROPOLISOS_RELOAD_URL ??
      "http://localhost:3030/api/dev/reload",
    debounceMs: Number(process.env.ACROPOLISOS_WATCH_DEBOUNCE_MS ?? 150),
  };

  const seedRoot = path.join(opts.pkgRoot, "scenarios", opts.seedName, "ontology");
  const viewsRoot = path.join(opts.pkgRoot, "views");

  process.stdout.write(
    `[dev-watch] seed=${opts.seedName} debounce=${opts.debounceMs}ms\n` +
      `  ontology: ${seedRoot}\n` +
      `  views:    ${viewsRoot}\n` +
      `  notify:   ${opts.notifyUrl}\n`,
  );

  // Prime the artifacts so the first edit doesn't have a stale baseline.
  try {
    const initial = await runOntologyCodegen({
      pkgRoot: opts.pkgRoot,
      seedName: opts.seedName,
    });
    process.stdout.write(
      `[dev-watch] initial codegen in ${initial.durationMs}ms (${initial.wrote.length} files)\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[dev-watch] initial codegen failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  const watcher = createWatcher({
    roots: [seedRoot, viewsRoot],
    debounceMs: opts.debounceMs,
    match: defaultArtifactMatcher,
    onChange: async (paths) => {
      const started = Date.now();
      try {
        const result = await runOntologyCodegen({
          pkgRoot: opts.pkgRoot,
          seedName: opts.seedName,
        });
        process.stdout.write(
          `[dev-watch] codegen in ${result.durationMs}ms for ${paths.length} change(s)\n`,
        );
        await notify(opts.notifyUrl, {
          kind: paths.some((p) => p.endsWith(".tsx")) ? "view" : "ontology",
          at: Date.now(),
          paths,
          durationMs: Date.now() - started,
        });
      } catch (err) {
        process.stderr.write(
          `[dev-watch] codegen failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    },
  });
  await watcher.start();

  const shutdown = () => {
    watcher.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
