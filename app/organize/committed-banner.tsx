// Critic #5: next-action affordance after a proposal commit.
//
// When a steward Confirms a proposal on /organize, the prior receipt read only
// "Committed — <type> row <id>" — a dead end. The steward had no signal of WHERE
// their data now lives or what to do next, breaking the feedback loop of their
// own action.
//
// CommittedBanner closes that loop: it keeps the receipt (type + row id) AND adds
// a navigation affordance into the committed type's generated view (/{type}, the
// app/(generated)/[type] route that accepts the snake token). The steward sees
// their messy data integrated into the ontology and knows where to operate next —
// reinforcing the core flow: data in → ontology grows → UI generates → operate.
//
// Pure presentational: no server-action imports, so it renders under vitest's
// node env (renderToStaticMarkup) without dragging in the auth/next-auth chain.

import Link from "next/link";
import { prettify } from "@/lib/prettify";

export function CommittedBanner({
  target_type,
  typed_row_id,
}: {
  target_type: string;
  typed_row_id: string;
}) {
  // Readable label (work_trade → "Work Trade"); the route uses the raw snake
  // token so it matches the (generated)/[type] page's accepted param.
  const label = prettify(target_type);

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <p className="text-emerald-400">
        Committed — {label} row{" "}
        <span className="font-mono opacity-70">{typed_row_id}</span>
      </p>
      <Link
        href={`/${target_type}`}
        className="inline-flex items-center whitespace-nowrap rounded-md border border-emerald-800/50 bg-emerald-900/15 px-3 py-1 font-medium text-emerald-300 hover:bg-emerald-900/30 transition-colors"
      >
        View in {label} →
      </Link>
    </div>
  );
}
