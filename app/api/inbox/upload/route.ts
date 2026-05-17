import { getInboxStore } from "@/lib/inbox/singleton";
import { parsePayload, type InboxPayload } from "@/lib/inbox/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PreparedRow {
  source_filename: string;
  mime_type: string;
  payload: InboxPayload;
}

export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const files = collectFiles(form);
  if (files.length === 0) {
    return Response.json({ error: "no files provided" }, { status: 400 });
  }

  const prepared: PreparedRow[] = [];
  for (const file of files) {
    const contents = await file.text();
    let rows: InboxPayload[];
    try {
      rows = parsePayload({
        mime: file.type || "application/octet-stream",
        filename: file.name,
        contents,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /unsupported/i.test(msg) ? 415 : 400;
      return Response.json({ error: msg }, { status });
    }
    for (const payload of rows) {
      prepared.push({
        source_filename: file.name,
        mime_type: file.type || "application/octet-stream",
        payload,
      });
    }
  }

  const store = getInboxStore();
  const inserted = await store.insertMany(prepared);
  return Response.json(
    { inboxIds: inserted.map((i) => i.id), count: inserted.length },
    { status: 201 },
  );
}

function collectFiles(form: FormData): File[] {
  const out: File[] = [];
  for (const value of form.getAll("files")) {
    if (value instanceof File) out.push(value);
  }
  // Allow common alternative field names for ergonomic clients.
  for (const value of form.getAll("file")) {
    if (value instanceof File) out.push(value);
  }
  return out;
}
