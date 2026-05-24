// F7 — Scenario chooser for no-show bookings.
//
// Server component. Auth-gated via buildChatRuntime + isAnonymous (same
// pattern as app/page.tsx). Route: /scenario/no-show/[bookingId]
//
// Renders three side-by-side scenario tiles for the manager to pick from.
// Selecting a tile submits a form that calls chooseScenario() server action,
// which logs the decision to incident_log and redirects to /.
//
// NO real action execution this cycle — no Stripe charge, no automated
// message. n8n workflow materialization is footnote-stubbed, lands in F2.

import { redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import {
  booking as bookingTable,
  bed as bedTable,
  room as roomTable,
  guest as guestTable,
} from "@/lib/db/schema.generated";
import { serverNow } from "@/lib/me/today";
import { chooseScenario } from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Types ───────────────────────────────────────────────────────────────────

type DotColor = "green" | "amber" | "red";

interface DotSpec {
  color: DotColor;
  label: string;
}

interface ScenarioSpec {
  id: string;
  title: string;
  framing: string;
  prediction: string;
  dots: {
    cost: DotSpec;
    reversibility: DotSpec;
    time: DotSpec;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDateShort(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00Z") : d;
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const DOT_COLOR_MAP: Record<DotColor, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};

// ─── Dot component ────────────────────────────────────────────────────────────

function StatusDot({ color, label }: DotSpec) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${DOT_COLOR_MAP[color]}`}
      title={label}
    />
  );
}

// ─── Scenario tile ────────────────────────────────────────────────────────────
//
// The entire tile is a form so the submit button can wrap the visible card.
// Using a form-wrapping button avoids needing client-side JS.

function ScenarioTile({
  spec,
  bookingId,
}: {
  spec: ScenarioSpec;
  bookingId: string;
}) {
  return (
    <form action={chooseScenario}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="scenario" value={spec.id} />
      <button
        type="submit"
        title={spec.prediction}
        className="w-full text-left border border-zinc-800 rounded-lg p-4 bg-zinc-900/50 hover:bg-zinc-900 hover:border-zinc-700 transition-colors cursor-pointer"
      >
        {/* Title */}
        <p className="text-sm font-semibold text-zinc-100 leading-snug">
          {spec.title}
        </p>

        {/* Framing sentence */}
        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
          {spec.framing}
        </p>

        {/* Dots row */}
        <div className="mt-3 flex items-center gap-3">
          {/* cost */}
          <span className="flex items-center gap-1.5">
            <StatusDot {...spec.dots.cost} />
            <span className="text-[10px] text-zinc-500">{spec.dots.cost.label}</span>
          </span>
          {/* reversibility */}
          <span className="flex items-center gap-1.5">
            <StatusDot {...spec.dots.reversibility} />
            <span className="text-[10px] text-zinc-500">{spec.dots.reversibility.label}</span>
          </span>
          {/* time */}
          <span className="flex items-center gap-1.5">
            <StatusDot {...spec.dots.time} />
            <span className="text-[10px] text-zinc-500">{spec.dots.time.label}</span>
          </span>
        </div>

        {/* Pick label */}
        <p className="mt-3 text-[10px] uppercase tracking-widest text-zinc-600">
          Pick this →
        </p>
      </button>
    </form>
  );
}

// ─── Scenario definitions ─────────────────────────────────────────────────────

const SCENARIOS: ScenarioSpec[] = [
  {
    id: "charge_50pct_no_show_fee",
    title: "Charge 50% no-show fee",
    framing:
      "Charge ~€30 via Booking.com's no-show mechanism. The guest is notified automatically by the channel.",
    prediction:
      "If you pick this: Booking.com processes the charge, guest receives an email. You keep half the nightly rate. Bed stays free for walk-ins.",
    dots: {
      cost: { color: "amber", label: "~€30 cost to guest" },
      reversibility: { color: "green", label: "Reversible via refund" },
      time: { color: "green", label: "~30s" },
    },
  },
  {
    id: "try_once_more_contact",
    title: "Try once more — call / text",
    framing:
      "Send a one-time message or call the guest. If no reply in 30 min, the bed is released.",
    prediction:
      "If you pick this: you or the night manager reaches out once. If they show up, great — the booking activates. If not, run the fee scenario next.",
    dots: {
      cost: { color: "green", label: "No cost" },
      reversibility: { color: "green", label: "Just a message" },
      time: { color: "amber", label: "~10 min for response" },
    },
  },
  {
    id: "full_refund_free_bed",
    title: "Full refund + free up the bed",
    framing:
      "Refund the pre-authorisation in full, mark the bed available, move on. Good-faith gesture for first-time guests.",
    prediction:
      "If you pick this: no charge is collected, the guest may rebook. Bed D2-C2 becomes immediately available for walk-ins or same-night bookings.",
    dots: {
      cost: { color: "green", label: "No cost to guest" },
      reversibility: { color: "amber", label: "Bed re-opened" },
      time: { color: "green", label: "~30s" },
    },
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NoShowScenarioPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}): Promise<React.ReactElement> {
  // Auth guard — middleware enforces; defense-in-depth here.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  const { bookingId } = await params;
  const db = getDb();

  // ── Fetch booking ──────────────────────────────────────────────────────────
  const [bk] = await db
    .select()
    .from(bookingTable)
    .where(eq(bookingTable.id, bookingId))
    .limit(1);

  // Not found or wrong status — soft error, not a 404
  if (!bk || bk.status !== "no_show") {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
        <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
          <p className="text-sm text-zinc-400">
            Booking <span className="font-mono text-zinc-200">{bookingId}</span>{" "}
            {!bk ? "not found" : `is not a no-show booking (status: ${bk.status})`}.
          </p>
          <Link href="/" className="text-xs text-zinc-500 underline underline-offset-2">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  // ── Fetch related rows ─────────────────────────────────────────────────────
  const [guest] = await db
    .select()
    .from(guestTable)
    .where(eq(guestTable.id, bk.guest))
    .limit(1);

  const [bed] = await db
    .select()
    .from(bedTable)
    .where(eq(bedTable.id, bk.bed))
    .limit(1);

  let bedCode = bed?.code ?? "—";
  // If bed belongs to a room, we already have the code — no extra join needed.

  // Compute hours late from expected 16:00 UTC check-in on from_date
  const expectedCheckin = new Date(`${bk.from_date}T16:00:00Z`);
  const now = serverNow();
  const hoursLateRaw = (now.getTime() - expectedCheckin.getTime()) / 3.6e6;
  const hoursLate = hoursLateRaw > 0 ? Math.floor(hoursLateRaw) : null;

  const guestName = guest?.full_name ?? "Guest";
  const fromLabel = fmtDateShort(bk.from_date);
  const toLabel = fmtDateShort(bk.to_date);

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">

        {/* ── Breadcrumb ── */}
        <Link
          href="/"
          className="text-[10px] uppercase tracking-widest text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          ← Dashboard
        </Link>

        {/* ── Header ── */}
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Scenario chooser{" "}
            <span className="text-zinc-500 font-normal">·</span>{" "}
            <span className="text-amber-300 font-normal">{guestName} no-show</span>
          </h1>
          <p className="text-sm text-zinc-400">
            {guestName} booked bed{" "}
            <span className="font-mono text-zinc-200">{bedCode}</span> for{" "}
            {fromLabel} → {toLabel}.{" "}
            {hoursLate !== null
              ? `${hoursLate}h past expected check-in.`
              : "Expected check-in: 4 pm."}
          </p>
        </div>

        {/* ── Scenario tiles ── */}
        <section className="space-y-4">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">
            Pick a path
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SCENARIOS.map((spec) => (
              <ScenarioTile key={spec.id} spec={spec} bookingId={bk.id} />
            ))}
          </div>
        </section>

        {/* ── n8n footnote ── */}
        <section>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="flex items-start gap-2.5">
              <span className="text-zinc-500 text-sm mt-0.5">⚙</span>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Whichever path you pick becomes an n8n workflow (the n8n container + MCP
                shim is the next infra cycle — F2). For example, &quot;charge no-show
                fee&quot; will become: Stripe charge → guest notification → ledger entry.
                View and edit later under{" "}
                <span className="text-zinc-400">Settings → Automations</span>.
              </p>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
