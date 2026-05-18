// Pure relative-timestamp formatter. No React, no side effects.
//
// Returns short, human-friendly strings:
//   < 5 s         → "just now"
//   < 60 s        → "30s ago"
//   < 60 min      → "5m ago"
//   < 24 h        → "2h ago"
//   1 day ago     → "yesterday"
//   2–6 days ago  → "3d ago"
//   ≥ 7 days ago  → "Mar 14" (locale "en-US", short month + day)
//
// Future timestamps fall back to the same buckets with the same labels
// (we treat the absolute delta — there's no UI need for "in 5m"). If the
// ISO string is unparseable we return it verbatim.
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const t = then.getTime();
  if (Number.isNaN(t)) return iso;

  const deltaMs = now.getTime() - t;
  const absMs = Math.abs(deltaMs);
  const sec = Math.floor(absMs / 1000);

  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;

  // Older than a week — show absolute short date (e.g. "Mar 14").
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
