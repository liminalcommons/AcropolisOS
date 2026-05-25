/**
 * A1 proof script — calls generateText + zod validation directly with raw_inbox payloads
 * to verify the classify logic works end-to-end with the live LLM.
 *
 * Usage: npx tsx scripts/classify-proof.ts
 */

import { generateText } from "ai";
import { z } from "zod";
import { buildLanguageModel } from "../lib/agent/mastra";

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

const VALID_FIELDS: Record<TargetType, string[]> = {
  guest: ["full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes"],
  member: ["full_name", "email", "phone", "tier_role", "started_at", "notes"],
  booking: ["label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status"],
  event: ["title", "starts_at", "duration_hours", "attendance_cap", "organizer", "description", "status"],
  bed: ["code", "room", "is_bottom_bunk", "out_of_service", "notes"],
  room: ["code", "kind", "capacity", "floor", "notes"],
  shift: ["label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes"],
  work_trade_agreement: ["label", "guest", "bed_comp", "hours_per_week", "start_date", "end_date", "status", "notes"],
};

const ProposalSchema = z.object({
  inbox_id: z.string(),
  target_type: TARGET_TYPE_ENUM,
  field_map: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1),
  unmapped: z.array(z.string()),
  reasoning: z.string(),
});

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) return text.slice(braceStart, braceEnd + 1);
  return text.trim();
}

async function classifyRow(inboxId: string, payload: Record<string, unknown>) {
  const sourceKeys = Object.keys(payload);
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
    `Source row (inbox_id=${inboxId}):`,
    JSON.stringify(payload, null, 2),
    "",
    `Source keys: ${sourceKeys.join(", ")}`,
    "",
    "Output ONLY a valid JSON object with these exact keys:",
    `{ "inbox_id": "${inboxId}", "target_type": "<one of the allowed types>", "field_map": {"<source_key>": "<target_field>", ...}, "confidence": <0.0-1.0>, "unmapped": ["<source_key>", ...], "reasoning": "<brief explanation>" }`,
    "",
    "No prose before or after the JSON.",
  ].join("\n");

  const model = buildLanguageModel();
  const result = await generateText({ model, prompt });
  const raw = JSON.parse(extractJson(result.text));
  const validated = ProposalSchema.parse(raw);
  return { ...validated, inbox_id: inboxId };
}

async function main() {
  // Bob row — should classify as guest
  const bobId = "7f670cd6-5c4d-4129-a987-8285d3b81a77";
  const bobPayload = { age: "25", city: "Madrid", name: "Bob" };

  // Aïsha row — should classify as member (tier=work-trade)
  const aishaId = "7bc3f0a7-1c11-4cd2-b4b4-c1d8ebff9559";
  const aishaPayload = { last: "Diallo", tier: "wt", first: "Aïsha", skills: ["reception", "cleaning"] };

  console.log("=== Classifying Bob row ===");
  try {
    const bobProposal = await classifyRow(bobId, bobPayload);
    console.log(JSON.stringify(bobProposal, null, 2));
  } catch (err) {
    console.error("Bob error:", err);
  }

  console.log("\n=== Classifying Aïsha row ===");
  try {
    const aishaProposal = await classifyRow(aishaId, aishaPayload);
    console.log(JSON.stringify(aishaProposal, null, 2));
  } catch (err) {
    console.error("Aïsha error:", err);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
