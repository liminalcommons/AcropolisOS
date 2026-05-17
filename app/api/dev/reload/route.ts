// US-022: Dev hot-reload SSE endpoint.
//
// GET — Server-Sent Events stream that fans `reload` events from the
// in-process reload bus out to every connected browser tab. The toast
// component subscribes on mount.
//
// POST — Publishes a reload event onto the bus. The dev-watch script
// calls this after each codegen pass; the body's shape mirrors ReloadEvent
// so the SSE consumer sees the same payload.
//
// Dev-only contract: both routes are guarded by NODE_ENV === "development"
// so a production deploy can't inadvertently expose them. Returning 404
// (not 403) keeps the surface invisible.

import {
  getDefaultReloadBus,
  type ReloadEvent,
  type ReloadKind,
} from "@/lib/dev/reload-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RELOAD_KINDS: readonly ReloadKind[] = ["ontology", "view", "all"];

function isReloadKind(value: unknown): value is ReloadKind {
  return typeof value === "string" && (RELOAD_KINDS as readonly string[]).includes(value);
}

function parseReloadEvent(raw: unknown): ReloadEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isReloadKind(obj.kind)) return null;
  if (!Array.isArray(obj.paths)) return null;
  if (!obj.paths.every((p): p is string => typeof p === "string")) return null;
  const at =
    typeof obj.at === "number" && Number.isFinite(obj.at) ? obj.at : Date.now();
  return { kind: obj.kind, at, paths: obj.paths };
}

function devOnly<T>(handler: () => T | Promise<T>): T | Promise<T> | Response {
  if (process.env.NODE_ENV === "production") {
    return new Response("not found", { status: 404 });
  }
  return handler();
}

export function POST(req: Request): Promise<Response> | Response {
  return devOnly(async () => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    const event = parseReloadEvent(body);
    if (!event) {
      return Response.json(
        { ok: false, error: "invalid_event_shape" },
        { status: 400 },
      );
    }
    getDefaultReloadBus().publish(event);
    return Response.json({ ok: true });
  }) as Promise<Response>;
}

export function GET(): Response {
  const result = devOnly(() => {
    const bus = getDefaultReloadBus();
    const encoder = new TextEncoder();
    let unsub: (() => void) | null = null;
    let pinger: NodeJS.Timeout | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`: connected ${Date.now()}\n\n`));
        unsub = bus.subscribe((event) => {
          const frame =
            `event: reload\n` +
            `data: ${JSON.stringify(event)}\n\n`;
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            // controller closed — silent
          }
        });
        // Keep-alive ping every 25s so intermediaries don't drop the
        // connection during quiet stretches.
        pinger = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            /* noop */
          }
        }, 25_000);
      },
      cancel() {
        if (unsub) unsub();
        if (pinger) clearInterval(pinger);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  });
  if (result instanceof Response) return result;
  // GET handler is synchronous; devOnly returns Response or Promise<Response>.
  // Caller in tests/Next always receives Response here.
  throw new Error("unreachable: GET devOnly should return Response sync");
}
