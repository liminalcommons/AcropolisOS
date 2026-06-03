// /api/organize/batch-classify — sample-then-propose for a whole source group.
//
// Scalability companion to /api/organize/classify. Instead of classifying one
// raw_inbox row at a time, a steward picks a `source` (e.g. "csv-upload"); this
// route samples ~20 unclassified rows of that source, unions their payload keys,
// and asks the LLM ONCE for a single { target_type, field_map } proposal for the
// whole group. The steward reviews that single proposal, then approves a bulk
// apply via /api/organize/batch-apply (which ingests ALL rows of the source).
//
// READ-ONLY: like /api/organize/classify, this endpoint performs NO writes and
// never touches classified_as/at/by. It returns a proposal for human review.
//
// Reuse: buildTargetVocab + validateFieldMap are imported from the single-row
// classify route (the same ontology-derived vocabulary + field-map guard), and
// the prompt mirrors classify so the model is constrained to existing types.
//
// Steward-gated: only role === "steward" may run a batch proposal (the bulk
// apply it leads to is a privileged, high-blast-radius write).

import { generateText } from "ai";
import { z } from "zod";
import { buildLanguageModel } from "@/lib/agent/mastra";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { extractJson } from "@/lib/agent/extract-json";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { buildTargetVocab, validateFieldMap } from "@/app/api/organize/classify/route";
import { listBindings } from "@/lib/channels/bindings";
import { boundSourceFilter, isChannelSource, sourceKeyFromRow } from "@/lib/channels/eligibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAMPLE_SIZE = 20;

// ── Pure helpers (exported for deterministic unit testing without HTTP/LLM) ───

/**
 * Union of the keys of every object-shaped payload in the sample. Non-object
 * payloads (null / array / scalar) are skipped so a heterogeneous source does
 * not crash the proposal and every column that appears anywhere is surfaced to
 * the model.
 */
export function mergeSampleKeys(rows: Array<{ payload: unknown }>): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const p = r.payload;
    if (p !== null && typeof p === "object" && !Array.isArray(p)) {
      for (const k of Object.keys(p as Record<string, unknown>)) set.add(k);
    }
  }
  return [...set];
}

/** Split an array into fixed-size slices (last slice may be smaller). */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Request body ──────────────────────────────────────────────────────────────

const BodySchema = z.object({ source: z.string().min(1) });

interface SampleRow {
  payload: Record<string, unknown> | unknown;
}

export async function POST(req: Request): Promise<Response> {
  // Auth gate — anonymous → 401.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Steward gate — batch proposals lead to high-blast-radius bulk writes.
  if (chatRuntime.actor.role !== "steward") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "missing_source" }, { status: 400 });
  }
  const { source } = parsed.data;

  const db = getDb();

  // Count + sample, both scoped to this source's UNCLASSIFIED rows.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(raw_inbox)
    .where(and(isNull(raw_inbox.classified_as), eq(raw_inbox.source, source)));

  if (total === 0) {
    return Response.json({ error: "no_rows_for_source", source }, { status: 404 });
  }

  let sample: SampleRow[] = await db
    .select({ payload: raw_inbox.payload })
    .from(raw_inbox)
    .where(and(isNull(raw_inbox.classified_as), eq(raw_inbox.source, source)))
    .orderBy(raw_inbox.received_at)
    .limit(SAMPLE_SIZE);

  // Channel allow-list (additive, behind the binding view): for a managed channel
  // source (telegram/discord), only sample rows whose (platform, external_id[,
  // sub_id]) the steward has BOUND and ENABLED. Unbound/ignored discovery stays
  // visible in the channels UI, it just isn't auto-pipelined here. Non-channel
  // sources (csv-upload etc.) are untouched — sourceKeyFromRow returns null and
  // the row passes unchanged.
  if (isChannelSource(source)) {
    const eligible = boundSourceFilter(await listBindings(db));
    sample = sample.filter((r) => {
      const key = sourceKeyFromRow(source, r.payload);
      return key === null ? true : eligible(key);
    });
    if (sample.length === 0) {
      return Response.json({ error: "no_bound_rows_for_source", source }, { status: 404 });
    }
  }

  const sampleKeys = mergeSampleKeys(sample);
  if (sampleKeys.length === 0) {
    // Every sampled payload is a non-object (null/array/scalar) — not batch-classifiable.
    return Response.json({ error: "unclassifiable_payloads", source }, { status: 422 });
  }

  // Ontology-derived vocabulary — model cannot invent a type or a column.
  let types: string[];
  let fields: Record<string, string[]>;
  try {
    ({ types, fields } = await buildTargetVocab());
  } catch (err) {
    return Response.json(
      { error: "ontology_unavailable", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const TARGET_TYPE_ENUM = z.enum(types as [string, ...string[]]);

  const typeDescriptions = types
    .map((t) => `  ${t}: fields=[${(fields[t] ?? []).join(", ")}]`)
    .join("\n");

  // Up to SAMPLE_SIZE example payloads so the model sees real value shapes.
  const sampleJson = sample
    .map((r, i) => `  [${i}] ${JSON.stringify(r.payload)}`)
    .join("\n");

  const prompt = [
    `You are classifying a BATCH of inbound rows that all share the source "${source}".`,
    "They are assumed to be the SAME kind of record. Choose ONE best-matching target type",
    "for the whole group from the allowed list below, and ONE field_map that applies to the group.",
    "Map source keys to real target fields (only the listed fields — do not invent columns).",
    "Keys you cannot confidently map to a real field go in 'unmapped'.",
    "",
    "Allowed types and their valid fields:",
    typeDescriptions,
    "",
    `Union of source keys across the sample: ${sampleKeys.join(", ")}`,
    "",
    `Sample rows (${sample.length} of ${total} total in this source):`,
    sampleJson,
    "",
    "Output ONLY a valid JSON object with these exact keys:",
    `{ "target_type": "<one of the allowed types>", "field_map": {"<source_key>": "<target_field>", ...}, "confidence": <0.0-1.0>, "unmapped": ["<source_key>", ...], "reasoning": "<brief explanation>" }`,
    "",
    "No prose before or after the JSON.",
  ].join("\n");

  const ProposalSchema = z.object({
    target_type: TARGET_TYPE_ENUM,
    field_map: z.record(z.string(), z.string()),
    confidence: z.number().min(0).max(1),
    unmapped: z.array(z.string()),
    reasoning: z.string(),
  });

  let model;
  try {
    model = buildLanguageModel();
  } catch (err) {
    return Response.json(
      { error: "llm_not_configured", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  let textResult: Awaited<ReturnType<typeof generateText>>;
  try {
    textResult = await generateText({ model, prompt });
  } catch (err) {
    return Response.json(
      { error: "llm_unavailable", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJson(textResult.text));
  } catch {
    return Response.json(
      { error: "llm_parse_error", raw: textResult.text.slice(0, 500) },
      { status: 502 },
    );
  }

  const validated = ProposalSchema.safeParse(parsedJson);
  if (!validated.success) {
    return Response.json(
      { error: "llm_schema_error", issues: validated.error.issues, raw: parsedJson },
      { status: 502 },
    );
  }

  // Re-validate every field_map value against the ontology-derived fields.
  const fieldMapCheck = validateFieldMap(
    validated.data.target_type,
    validated.data.field_map,
    fields,
  );
  if (!fieldMapCheck.ok) {
    return Response.json(
      { error: "llm_field_error", invalid_fields: fieldMapCheck.invalid },
      { status: 502 },
    );
  }

  return Response.json({
    source,
    target_type: validated.data.target_type,
    field_map: validated.data.field_map,
    confidence: validated.data.confidence,
    unmapped: validated.data.unmapped,
    reasoning: validated.data.reasoning,
    sample_size: sample.length,
    total_in_source: total,
  });
}
