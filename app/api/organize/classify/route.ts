// A1: /api/organize/classify — structured proposal endpoint.
//
// Receives { inbox_id } (a raw_inbox row id), fetches the row server-side,
// runs generateText with explicit JSON schema instructions + zod validation
// to produce a structured classification proposal:
//   { inbox_id, target_type, field_map, confidence, unmapped, reasoning }
//
// target_type is a zod enum over EXISTING ontology types only — the model
// cannot propose a non-existent type. Validation enforces the boundary.
// NO commit happens here (A3). This endpoint is READ-ONLY proposal generation.
//
// Implementation note: generateText + JSON parse is used instead of
// generateObject because GLM-5.1 (via OpenCode Zen /zen/go/v1) does not
// support the json_schema response_format that ai-SDK v6 generateObject
// sends — the call hangs. generateText with explicit JSON instructions
// in the prompt works reliably and the zod parse gives the same safety.
//
// Hardening (A1 negativa fixes):
// - FIX 1: Non-object payloads (null/array/string/number) → 422 unclassifiable_payload
//           before any LLM call. Prevents Object.keys(null) crash and garbage proposals.
// - FIX 2: field_map values validated against VALID_FIELDS[target_type] after safeParse.
//           Any off-list value → 502 llm_field_error. validateFieldMap is exported for
//           unit testing. Makes existing-fields-only a hard guarantee.
// - FIX 3: generateText wrapped in try/catch → 503 llm_unavailable (mirrors
//           llm_not_configured block), so A2 UI can distinguish model-down from bad output.

import { generateText } from "ai";
import { z } from "zod";
import { buildLanguageModel } from "@/lib/agent/mastra";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { extractJson } from "@/lib/agent/extract-json";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Scope guard: ONLY existing ontology object types. The model cannot hallucinate
// a new type — zod enforces the enum boundary after parsing.
const TARGET_TYPE_ENUM = z.enum([
  "guest",
  "member",
  "booking",
  "event",
  "bed",
  "room",
  "shift",
  "work_trade_agreement",
]);
type TargetType = z.infer<typeof TARGET_TYPE_ENUM>;

// Valid target fields per ontology type (derived from types.generated.ts and
// schema.generated.ts). Passed into the prompt so the model can only map to
// real columns.
const VALID_FIELDS: Record<TargetType, string[]> = {
  guest: [
    "full_name", "email", "country", "phone",
    "arrived_at", "expected_departure", "current_status",
    "is_work_trader", "notes",
  ],
  member: [
    "full_name", "email", "phone", "tier_role",
    "started_at", "notes",
  ],
  booking: [
    "label", "guest", "bed", "from_date", "to_date",
    "rate_per_night", "currency", "source", "status",
  ],
  event: [
    "title", "starts_at", "duration_hours", "attendance_cap",
    "organizer", "description", "status",
  ],
  bed: [
    "code", "room", "is_bottom_bunk", "out_of_service", "notes",
  ],
  room: [
    "code", "kind", "capacity", "floor", "notes",
  ],
  shift: [
    "label", "kind", "starts_at", "duration_hours",
    "claimed_by", "status", "notes",
  ],
  work_trade_agreement: [
    "label", "guest", "bed_comp", "hours_per_week",
    "start_date", "end_date", "status", "notes",
  ],
};

// FIX 2: Pure exported helper — validates every field_map value is in
// VALID_FIELDS[targetType]. Exported for deterministic unit testing without HTTP/LLM.
export function validateFieldMap(
  targetType: TargetType,
  fieldMap: Record<string, string>,
): { ok: true } | { ok: false; invalid: string[] } {
  const allowed = VALID_FIELDS[targetType];
  if (!allowed) {
    return { ok: false, invalid: Object.values(fieldMap) };
  }
  const allowedSet = new Set(allowed);
  const invalid = Object.values(fieldMap).filter((v) => !allowedSet.has(v));
  if (invalid.length > 0) {
    return { ok: false, invalid };
  }
  return { ok: true };
}

const ProposalSchema = z.object({
  inbox_id: z.string(),
  target_type: TARGET_TYPE_ENUM,
  field_map: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1),
  unmapped: z.array(z.string()),
  reasoning: z.string(),
});

type Proposal = z.infer<typeof ProposalSchema>;

interface ClassifyBody {
  inbox_id: string;
}

function isClassifyBody(v: unknown): v is ClassifyBody {
  if (!v || typeof v !== "object") return false;
  const { inbox_id } = v as Record<string, unknown>;
  return typeof inbox_id === "string" && inbox_id.length > 0;
}

export async function POST(req: Request): Promise<Response> {
  // Auth gate — reject anonymous actors
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isClassifyBody(body)) {
    return Response.json({ error: "missing_inbox_id" }, { status: 400 });
  }

  // Fetch the raw_inbox row server-side — provenance traces to a real row
  const db = getDb();
  const rows = await db
    .select()
    .from(raw_inbox)
    .where(eq(raw_inbox.id, body.inbox_id))
    .limit(1);

  if (rows.length === 0) {
    return Response.json({ error: "inbox_row_not_found" }, { status: 404 });
  }

  const inboxRow = rows[0];

  // FIX 1: Guard against non-object payloads before any LLM call.
  // null/array/string/number all reach here via jsonb — Object.keys(null) throws
  // an uncaught 500 and arrays/strings produce nonsense sourceKeys.
  const rawPayload = inboxRow.payload;
  if (
    rawPayload === null ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload)
  ) {
    return Response.json(
      { error: "unclassifiable_payload" },
      { status: 422 },
    );
  }

  const payload = rawPayload as Record<string, unknown>;
  const sourceKeys = Object.keys(payload);

  // Build the classification prompt, injecting allowed types + fields so the
  // model cannot invent non-existent ontology terms.
  const typeDescriptions = (Object.keys(VALID_FIELDS) as TargetType[])
    .map((t) => `  ${t}: fields=[${VALID_FIELDS[t].join(", ")}]`)
    .join("\n");

  const prompt = [
    "You are classifying a single messy inbound row from a community hostel's raw inbox.",
    "Choose the BEST matching target type from the allowed list below.",
    "Map source keys to real target fields (only the listed fields — do not invent columns).",
    "Keys you cannot confidently map to a real field go in 'unmapped'.",
    "",
    "Allowed types and their valid fields:",
    typeDescriptions,
    "",
    `Source row (inbox_id=${body.inbox_id}):`,
    JSON.stringify(payload, null, 2),
    "",
    `Source keys: ${sourceKeys.join(", ")}`,
    "",
    "Output ONLY a valid JSON object with these exact keys:",
    `{ "inbox_id": "${body.inbox_id}", "target_type": "<one of the allowed types>", "field_map": {"<source_key>": "<target_field>", ...}, "confidence": <0.0-1.0>, "unmapped": ["<source_key>", ...], "reasoning": "<brief explanation>" }`,
    "",
    "No prose before or after the JSON.",
  ].join("\n");

  let model;
  try {
    model = buildLanguageModel();
  } catch (err) {
    return Response.json(
      { error: "llm_not_configured", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  // FIX 3: Wrap generateText — glm-5.1 calls are slow (~60-120s) and can time out
  // or return 5xx. Bare await lets that throw an uncaught 500. Mirror the
  // llm_not_configured 503 block so A2 UI can distinguish model-down from bad output.
  let textResult: Awaited<ReturnType<typeof generateText>>;
  try {
    textResult = await generateText({
      model,
      prompt,
    });
  } catch (err) {
    return Response.json(
      {
        error: "llm_unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }

  // Parse and validate — zod enforces the type enum and field structure.
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(textResult.text));
  } catch {
    return Response.json(
      { error: "llm_parse_error", raw: textResult.text.slice(0, 500) },
      { status: 502 },
    );
  }

  const validated = ProposalSchema.safeParse(parsed);
  if (!validated.success) {
    return Response.json(
      {
        error: "llm_schema_error",
        issues: validated.error.issues,
        raw: parsed,
      },
      { status: 502 },
    );
  }

  // FIX 2: Validate every field_map value is in VALID_FIELDS[target_type].
  // ProposalSchema only checks z.record(z.string(), z.string()); values are
  // unconstrained. The LLM can emit a non-existent column that passes zod and
  // would reach A3's ctx.objects.<Type>.create → DB error / silent data loss.
  const fieldMapCheck = validateFieldMap(
    validated.data.target_type,
    validated.data.field_map,
  );
  if (!fieldMapCheck.ok) {
    return Response.json(
      {
        error: "llm_field_error",
        invalid_fields: fieldMapCheck.invalid,
      },
      { status: 502 },
    );
  }

  // Enforce inbox_id matches — model must not drift
  const proposal: Proposal = { ...validated.data, inbox_id: body.inbox_id };

  return Response.json(proposal);
}
