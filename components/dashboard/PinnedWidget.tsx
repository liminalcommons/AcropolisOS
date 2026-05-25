// F6: PinnedWidget — renderer dispatch for vibecoded + typed pinned widgets.
//
// Switches on widget.kind:
//   turnover_cleaning — beds needing cleaning tomorrow (checkout today + new checkin tomorrow).
//   table            — generic key-value table from widget.props.rows.
//   agent_html       — arbitrary HTML from the agent; sandboxed in <iframe srcdoc>.
//   (other/unknown)  — neutral fallback box; never throws.
//
// Security: agent_html is always rendered in a sandboxed iframe with
// sandbox="allow-same-origin" (allows CSS reads) but NOT allow-scripts.
// Arbitrary agent-produced HTML cannot execute JS or navigate out of the frame.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  booking as bookingTable,
  bed as bedTable,
  guest as guestTable,
} from "@/lib/db/schema.generated";
import { TODAY } from "@/lib/me/today";

// The pinned widget shape stored in MemberContext.pinned_widgets (text/jsonb).
// Kept loose (kind + props) so agent-produced widgets don't require a codegen
// round-trip for every new kind.
export interface PinnedWidgetShape {
  id: string;
  kind: string;
  title?: string;
  props?: Record<string, unknown>;
  // Legacy field — older widgets stored config instead of props.
  config?: Record<string, unknown>;
}

// ─── Turnover / cleaning widget ──────────────────────────────────────────────

const TOMORROW_ISO = new Date(TODAY.getTime() + 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const TODAY_ISO = TODAY.toISOString().slice(0, 10);

type BedCleanRow = {
  code: string;
  out: string;
  in: string;
};

async function buildTurnoverRows(): Promise<BedCleanRow[]> {
  const db = getDb();

  // Beds checking out today (to_date === TODAY).
  const checkoutsToday = await db
    .select({ bedId: bookingTable.bed, guestId: bookingTable.guest })
    .from(bookingTable)
    .where(eq(bookingTable.to_date, TODAY_ISO));

  // Beds checking in tomorrow (from_date === TOMORROW).
  const checkinsToMorrow = await db
    .select({ bedId: bookingTable.bed, guestId: bookingTable.guest })
    .from(bookingTable)
    .where(eq(bookingTable.from_date, TOMORROW_ISO));

  // Beds that need cleaning = checked out today AND have a new guest arriving tomorrow.
  const checkoutBedIds = new Set(checkoutsToday.map((b) => b.bedId));
  const checkinBedIds = new Set(checkinsToMorrow.map((b) => b.bedId));
  const cleaningBedIds = [...checkoutBedIds].filter((id) => checkinBedIds.has(id));

  if (cleaningBedIds.length === 0) return [];

  // Gather guest names for display.
  const guestNames: Record<string, string> = {};
  const allGuestIds = new Set([
    ...checkoutsToday.map((b) => b.guestId),
    ...checkinsToMorrow.map((b) => b.guestId),
  ]);
  for (const guestId of allGuestIds) {
    const [g] = await db
      .select({ name: guestTable.full_name })
      .from(guestTable)
      .where(eq(guestTable.id, guestId))
      .limit(1);
    if (g) guestNames[guestId] = g.name;
  }

  // Fetch bed codes for the cleaning beds.
  const bedCodes: Record<string, string> = {};
  for (const bedId of cleaningBedIds) {
    const [b] = await db
      .select({ id: bedTable.id, code: bedTable.code })
      .from(bedTable)
      .where(eq(bedTable.id, bedId))
      .limit(1);
    if (b) bedCodes[bedId] = b.code;
  }

  return cleaningBedIds.map((bedId) => {
    const outRow = checkoutsToday.find((b) => b.bedId === bedId);
    const inRow = checkinsToMorrow.find((b) => b.bedId === bedId);
    return {
      code: bedCodes[bedId] ?? bedId.slice(0, 8),
      out: outRow ? (guestNames[outRow.guestId] ?? "—") : "—",
      in: inRow ? (guestNames[inRow.guestId] ?? "—") : "—",
    };
  });
}

async function TurnoverCleaningWidget() {
  const rows = await buildTurnoverRows();

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No beds need cleaning for tomorrow&apos;s arrivals.
      </p>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="font-normal pb-1 pr-3">Bed</th>
          <th className="font-normal pb-1 pr-3">Checkout (today)</th>
          <th className="font-normal pb-1">Next check-in (tomorrow)</th>
        </tr>
      </thead>
      <tbody className="text-foreground">
        {rows.map((r) => (
          <tr key={r.code} className="border-t border-border">
            <td className="py-1 pr-3 font-mono">{r.code}</td>
            <td className="py-1 pr-3">{r.out}</td>
            <td className="py-1">{r.in}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Table widget ─────────────────────────────────────────────────────────────

function TableWidget({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No rows.</p>;
  }
  return (
    <table className="w-full text-xs">
      <tbody className="text-foreground">
        {rows.map((r, i) => (
          <tr key={i} className={i > 0 ? "border-t border-border" : ""}>
            <td className="py-1 pr-4 text-muted-foreground w-1/2">{r.label}</td>
            <td className="py-1">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Agent HTML widget ────────────────────────────────────────────────────────

function AgentHtmlWidget({ html }: { html: string }) {
  // sandbox="allow-same-origin" — allows CSS-based reads but blocks JS execution.
  // This is the security boundary: agent-produced HTML cannot run scripts or
  // navigate the parent frame.
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-same-origin"
      className="w-full rounded border-0"
      style={{ minHeight: "160px" }}
      title="Agent widget"
    />
  );
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function PinnedWidget({ widget }: { widget: PinnedWidgetShape }) {
  const props = widget.props ?? widget.config ?? {};
  const title = widget.title ?? widget.kind;

  return (
    <div className="border border-border rounded-lg p-4 bg-card/30">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
        {title}
      </p>
      {widget.kind === "turnover_cleaning" ? (
        <TurnoverCleaningWidget />
      ) : widget.kind === "table" ? (
        <TableWidget rows={(props.rows as Array<{ label: string; value: string }>) ?? []} />
      ) : widget.kind === "agent_html" ? (
        <AgentHtmlWidget html={(props.html as string) ?? ""} />
      ) : (
        // Unknown / legacy kinds — neutral fallback, never throw.
        <p className="text-xs text-muted-foreground">
          widget: <span className="font-mono text-muted-foreground">{widget.kind}</span>
        </p>
      )}
    </div>
  );
}
