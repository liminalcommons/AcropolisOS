// components/shell/theme-switcher.tsx
//
// Shell theme control: a PICKER of curated presets (no prompt). Clicking a
// swatch live-previews it across the whole shell (CSS vars on #app-shell-root)
// and persists the choice to member_context.theme_pref. The default preset
// stores no override (resetThemeAction → null) so it tracks the base palette.
"use client";

import { useState, useTransition } from "react";
import { Palette, Check, Loader2 } from "lucide-react";
import { TOKEN_KEYS, type TokenSet } from "@/lib/theme/tokens";
import { THEME_PRESETS, DEFAULT_PRESET_ID, type ThemePreset } from "@/lib/theme/presets";
import { applyThemeAction, resetThemeAction } from "@/app/theme-actions";

function applyPreview(tokens: TokenSet): void {
  const root = document.getElementById("app-shell-root");
  if (!root) return;
  for (const k of TOKEN_KEYS) root.style.setProperty(`--${k}`, tokens[k]);
}

export function ThemeSwitcher(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(preset: ThemePreset): void {
    applyPreview(preset.tokens); // instant live preview across the shell
    setActiveId(preset.id);
    startTransition(async () => {
      // Default preset tracks the base palette → store no override (null).
      if (preset.id === DEFAULT_PRESET_ID) await resetThemeAction();
      else await applyThemeAction(preset.tokens);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Palette className="h-4 w-4" /> Theme
        {pending && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-lg border border-border bg-card p-2.5 shadow-lg">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Pick a theme</p>
          <div className="grid grid-cols-2 gap-2">
            {THEME_PRESETS.map((p) => {
              const t = p.tokens;
              const active = activeId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={pending}
                  onClick={() => choose(p)}
                  aria-label={`Apply ${p.name} theme`}
                  aria-pressed={active}
                  className={`group relative overflow-hidden rounded-md border text-left transition-colors disabled:opacity-60 ${
                    active ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60"
                  }`}
                  style={{ backgroundColor: t.background }}
                >
                  <span className="flex items-center gap-1 px-2 pt-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.primary }} />
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.accent }} />
                    <span
                      className="h-3 w-3 rounded-full border"
                      style={{ backgroundColor: t.card, borderColor: t.border }}
                    />
                    {active && <Check className="ml-auto h-3.5 w-3.5" style={{ color: t.primary }} />}
                  </span>
                  <span className="block px-2 pb-2 pt-1 text-xs" style={{ color: t.foreground }}>
                    {p.name}
                    {p.id === DEFAULT_PRESET_ID && <span className="ml-1 opacity-60">· default</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
