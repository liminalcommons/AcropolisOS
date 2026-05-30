"use server";

// Generated CRUD writes for /[type]. Every write goes THROUGH the object write
// fence (runtime.ctx.objects[type].create/update/delete = wrapObjectAccess),
// which enforces the per-type permissions.write tokens and throws
// PermissionError on denial — we never touch the raw store. Anonymous callers
// are refused before any store access (server actions are POSTable cross-origin).
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { pascalToSnake } from "@/lib/ontology/casing";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { PermissionError } from "@/lib/ontology/ctx";
import { buildObjectRow, buildObjectPatch } from "@/lib/ontology/object-form";
import type { ChatRuntime } from "@/lib/agent/chat-runtime";
import type { Ontology } from "@/lib/ontology/schema";

export type CrudResult = { ok: true; id?: string } | { ok: false; error: string };

interface WriteAccess {
  create: (row: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  delete: (id: string) => Promise<boolean>;
}

// Accept the PascalCase ontology key OR the snake token (board cards link with
// the token) — identical resolution to the read pages.
function resolveType(ontology: Ontology, typeParam: string): string | undefined {
  return ontology.object_types[typeParam]
    ? typeParam
    : Object.keys(ontology.object_types).find((k) => pascalToSnake(k) === typeParam);
}

function accessFor(runtime: ChatRuntime, type: string): WriteAccess | undefined {
  // The fenced store types create()/update() on the concrete row shape ({id:string});
  // we drive it with a built Record. Cast through unknown — the fence still
  // enforces permissions + the store validates the row at insert.
  return (runtime.ctx.objects as unknown as Record<string, WriteAccess>)[type];
}

function friendly(e: unknown, op: string, type: string): string {
  if (e instanceof PermissionError) return `You don't have permission to ${op} ${type}.`;
  return e instanceof Error ? e.message : String(e);
}

export async function createObjectAction(
  typeParam: string,
  values: Record<string, string>,
): Promise<CrudResult> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) return { ok: false, error: "unauthorized" };

  const ontology = await loadOntology(getRuntimeOntologyDir());
  const type = resolveType(ontology, typeParam);
  if (!type) return { ok: false, error: "unknown type" };
  const access = accessFor(runtime, type);
  if (!access) return { ok: false, error: "unknown type" };

  const built = buildObjectRow(ontology, type, values, {
    id: randomUUID(),
    ownerUserId: runtime.actor?.userId,
  });
  if (!built.ok) return { ok: false, error: built.errors.join("; ") };

  try {
    await access.create(built.row);
  } catch (e) {
    return { ok: false, error: friendly(e, "create", type) };
  }
  revalidatePath(`/${typeParam}`);
  if (type !== typeParam) revalidatePath(`/${type}`);
  return { ok: true, id: String(built.row.id) };
}

export async function updateObjectAction(
  typeParam: string,
  id: string,
  values: Record<string, string>,
): Promise<CrudResult> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) return { ok: false, error: "unauthorized" };

  const ontology = await loadOntology(getRuntimeOntologyDir());
  const type = resolveType(ontology, typeParam);
  if (!type) return { ok: false, error: "unknown type" };
  const access = accessFor(runtime, type);
  if (!access) return { ok: false, error: "unknown type" };

  const built = buildObjectPatch(ontology, type, values);
  if (!built.ok) return { ok: false, error: built.errors.join("; ") };

  try {
    const updated = await access.update(id, built.row);
    if (updated === null) return { ok: false, error: "Row not found or not visible to you." };
  } catch (e) {
    return { ok: false, error: friendly(e, "update", type) };
  }
  revalidatePath(`/${typeParam}/${id}`);
  revalidatePath(`/${typeParam}`);
  return { ok: true, id };
}

export async function deleteObjectAction(typeParam: string, id: string): Promise<CrudResult> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) return { ok: false, error: "unauthorized" };

  const ontology = await loadOntology(getRuntimeOntologyDir());
  const type = resolveType(ontology, typeParam);
  if (!type) return { ok: false, error: "unknown type" };
  const access = accessFor(runtime, type);
  if (!access) return { ok: false, error: "unknown type" };

  try {
    const ok = await access.delete(id);
    if (!ok) return { ok: false, error: "Row not found." };
  } catch (e) {
    return { ok: false, error: friendly(e, "delete", type) };
  }
  revalidatePath(`/${typeParam}`);
  return { ok: true, id };
}
