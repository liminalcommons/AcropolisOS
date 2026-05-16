// @acropolisos/sdk — the surface function-backed actions import.
//
// A function-backed action is a TS file under `functions/` whose default
// export is the value returned by `defineAction({ schema, handler })`.
// The runner (lib/actions/function-backed.ts) validates that shape, parses
// the inbound params with the action's Zod schema, and invokes the handler
// with `{ params, ctx }`. The handler may only reach the runtime via
// `ctx.objects.*`, `ctx.links.*`, and `ctx.actions.*`.
//
// Keeping the surface minimal is intentional: a fatter SDK invites authors
// to import the DB, fetch, or `child_process` for one-off needs. We push
// that pressure back onto ctx instead.

import type { z } from "zod";
import type { OntologyCtx } from "../ontology/ctx";

export type AnyZodSchema = z.ZodType<unknown>;

export interface ActionHandlerArgs<TParams> {
  params: TParams;
  ctx: OntologyCtx;
}

export type ActionHandler<TParams, TResult> = (
  args: ActionHandlerArgs<TParams>,
) => Promise<TResult>;

export interface ActionDescriptor<TSchema extends AnyZodSchema, TResult> {
  readonly __isAcropolisAction: true;
  readonly schema: TSchema;
  readonly handler: ActionHandler<z.infer<TSchema>, TResult>;
}

export interface DefineActionInput<TSchema extends AnyZodSchema, TResult> {
  schema: TSchema;
  handler: ActionHandler<z.infer<TSchema>, TResult>;
}

export function defineAction<TSchema extends AnyZodSchema, TResult>(
  input: DefineActionInput<TSchema, TResult>,
): ActionDescriptor<TSchema, TResult> {
  if (!input || typeof input !== "object") {
    throw new TypeError("defineAction: input must be an object");
  }
  if (!input.schema || typeof (input.schema as { parse?: unknown }).parse !== "function") {
    throw new TypeError("defineAction: schema must be a Zod schema");
  }
  if (typeof input.handler !== "function") {
    throw new TypeError("defineAction: handler must be a function");
  }
  return {
    __isAcropolisAction: true,
    schema: input.schema,
    handler: input.handler,
  };
}

export function isActionDescriptor(
  value: unknown,
): value is ActionDescriptor<AnyZodSchema, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __isAcropolisAction?: unknown }).__isAcropolisAction === true &&
    typeof (value as { schema?: { parse?: unknown } }).schema?.parse === "function" &&
    typeof (value as { handler?: unknown }).handler === "function"
  );
}
