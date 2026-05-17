// US-022: File watcher + debounce policy for the dev hot-reload pipeline.
//
// The debouncer (createDebouncedTrigger) is the only piece with non-trivial
// timing — extracted so it tests against vi.useFakeTimers without bringing
// in any actual fs.watch traffic. The watcher itself is a thin glue layer
// that subscribes to fs.watch and forwards changes through the debouncer.

import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export type DebouncedCallback = (paths: string[]) => Promise<void> | void;

export interface DebouncedTrigger {
  push(path: string): void;
  flush(): Promise<void>;
}

export function createDebouncedTrigger(
  fn: DebouncedCallback,
  windowMs: number,
): DebouncedTrigger {
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  async function drain(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const batch = [...pending];
    pending = new Set();
    await fn(batch);
  }

  return {
    push(p: string) {
      pending.add(p);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void drain();
      }, windowMs);
    },
    async flush() {
      await drain();
    },
  };
}

export interface WatcherOptions {
  roots: string[];
  onChange: DebouncedCallback;
  debounceMs?: number;
  // Filter that decides which files matter. Default: any path under the
  // watched root counts; callers narrow via globs (ontology yamls, view
  // tsx files) by passing a predicate.
  match?: (relPath: string) => boolean;
}

export interface Watcher {
  start(): Promise<void>;
  stop(): void;
}

export function createWatcher(options: WatcherOptions): Watcher {
  const debounce = options.debounceMs ?? 150;
  const match = options.match ?? (() => true);
  const trigger = createDebouncedTrigger(options.onChange, debounce);
  const handles: { close(): void }[] = [];

  return {
    async start() {
      for (const root of options.roots) {
        const exists = await stat(root).then(
          (s) => s.isDirectory(),
          () => false,
        );
        if (!exists) continue;
        const h = watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const rel = String(filename).split(path.sep).join("/");
          if (!match(rel)) return;
          trigger.push(path.join(root, String(filename)));
        });
        handles.push(h);
      }
    },
    stop() {
      for (const h of handles) {
        try {
          h.close();
        } catch {
          /* noop */
        }
      }
      handles.length = 0;
    },
  };
}

// Default matcher for the acropolisOS hot-reload spec: ontology yamls +
// view tsx files. Exposed so other call sites can compose it.
export function defaultArtifactMatcher(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (norm.endsWith(".yaml") || norm.endsWith(".yml")) return true;
  if (norm.endsWith(".tsx") && norm.includes("views/")) return true;
  return false;
}
