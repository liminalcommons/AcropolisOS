// Neutral route-level loading. Deliberately NOT board-shaped: this boundary is
// shown for EVERY route, so a board skeleton would falsely promise a board on
// /inbox, /graph, /audit, etc. Per-segment skeletons are a follow-up.
export default function Loading() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none"
        />
        Loading…
      </div>
    </div>
  );
}
