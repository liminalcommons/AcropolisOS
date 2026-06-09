// app/api/report/[slug]/route.ts
//
// Public read-only viewer for generated HTML reports over the tunnel.
// Reachable WITHOUT a session (/api/* is public per lib/middleware/route-decision)
// so a steward can open a report remotely, e.g.
//   https://acropolisos.castalia.one/api/report/<slug>
//
// Serves ONLY uploads/reports/<slug>.html, with a strict slug pattern (no path
// traversal — slug is [a-z0-9-], never contains '/' or '.'). uploads/ is gitignored
// runtime storage, so report CONTENT is never committed; this route is the only
// committed part. Content here is non-sensitive generated reports — never secrets.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!SLUG.test(slug)) {
    return new Response("not found", { status: 404 });
  }
  const file = join(process.cwd(), "uploads", "reports", `${slug}.html`);
  let html: string;
  try {
    html = await readFile(file, "utf8");
  } catch {
    return new Response("report not found", { status: 404 });
  }
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
