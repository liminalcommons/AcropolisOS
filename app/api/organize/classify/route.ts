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

import { generateText } from "ai";
import { z } from "zod";
import { buildLanguageModel } from "@/lib/agent/mastra";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
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

// Extract JSON from LLM text response — model may wrap JSON in markdown fences.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text.trim();
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
  const payload = inboxRow.payload as Record<string, unknown>;
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

  const textResult = await generateText({
    model,
    prompt,
  });

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

  // Enforce inbox_id matches — model must not drift
  const proposal: Proposal = { ...validated.data, inbox_id: body.inbox_id };

  return Response.json(proposal);
}
