// components/shell/theme-switcher.tsx
//
// LeftNav theme control: prompt → AI-designed palette → LIVE preview on the
// whole shell → Keep (persist to member_context.theme_pref) or Reset (drop
// overrides + clear theme_pref). The live preview writes CSS vars directly onto
// #app-shell-root; descendants read those inline vars, overriding the
// server-rendered values. removeProperty restores the server theme.
"use client";

import { useState, useTransition } from "react";
import { Palette, RotateCcw, Check, Loader2 } from "lucide-react";
import { TOKEN_KEYS, type TokenSet } from "@/lib/theme/tokens";
import { designThemeAction, applyThemeAction, resetThemeAction } from "@/app/theme-actions";

function applyPreview(tokens: TokenSet | null): void {
  const root = document.getElementById("app-shell-root");
  if (!root) return;
  for (const k of TOKEN_KEYS) {
    if (tokens) root.style.setProperty(`--${k}`, tokens[k]);
    else root.style.removeProperty(`--${k}`);
  }
}

export function ThemeSwitcher(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<TokenSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate(): void {
    setError(null);
    startTransition(async () => {
      const r = await designThemeAction(prompt);
      if (r.status === "ok") {
        setPreview(r.tokens);
        applyPreview(r.tokens); // live preview on the shell root
      } else {
        setError(r.reason);
      }
    });
  }

  function keep(): void {
    if (!preview) return;
    startTransition(async () => {
      await applyThemeAction(preview);
      setPreview(null);
      setOpen(false);
    });
  }

  function reset(): void {
    applyPreview(null); // drop live overrides
    setPreview(null);
    setError(null);
    startTransition(async () => {
      await resetThemeAction();
      setOpen(false);
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Palette className="h-4 w-4" /> Theme
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-card p-2.5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="Describe the look (e.g. warm earthy, oceanic, high-contrast)…"
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || prompt.trim().length === 0}
              onClick={generate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
              Generate
            </button>
            {preview && (
              <button
                type="button"
                disabled={pending}
                onClick={keep}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary px-2.5 py-1 text-xs text-primary hover:bg-primary/15 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Keep
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={reset}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>
          {error && (
            <p className="text-[11px] text-destructive">Couldn’t design that theme ({error}). Try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
