// US-021: Ctx-backed data provider for Refine-generated routes.
//
// Refine talks to a DataProvider; this module adapts the typed OntologyCtx
// surface (lib/ontology/ctx.ts) into the small subset of methods the
// generated pages need. Resource names map onto ctx.objects.<Type> — so
// permission filtering (US-031) and audit (US-030) happen automatically
// without the pages having to reason about them.
//
// We intentionally keep this provider framework-agnostic — it exposes a
// minimal shape (getList/getOne/create/update/deleteOne) that the
// generated layout can hand to Refine, without us importing `@refinedev/*`
// types here.

import type { ObjectAccess, OntologyCtx } from "../ontology/ctx";

export interface GetListParams {
  resource: string;
  filters?: Record<string, unknown>;
}

export interface GetOneParams {
  resource: string;
  id: string;
}

export interface CreateParams {
  resource: string;
  variables: Record<string, unknown>;
}

export interface UpdateParams {
  resource: string;
  id: string;
  variables: Record<string, unknown>;
}

export interface DeleteOneParams {
  resource: string;
  id: string;
}

export interface OntologyDataProvider {
  readonly ctx: OntologyCtx;
  getList(params: GetListParams): Promise<{ data: unknown[]; total: number }>;
  getOne(params: GetOneParams): Promise<{ data: unknown }>;
  create(params: CreateParams): Promise<{ data: unknown }>;
  update(params: UpdateParams): Promise<{ data: unknown }>;
  deleteOne(params: DeleteOneParams): Promise<{ data: { ok: boolean } }>;
}

type AnyAccess = ObjectAccess<{ id: string }>;

function resolveAccess(ctx: OntologyCtx, resource: string): AnyAccess {
  const objects = ctx.objects as unknown as Record<string, AnyAccess | undefined>;
  const access = objects[resource];
  if (!access) {
    throw new Error(
      `unknown resource "${resource}" — expected one of ${Object.keys(objects).join(", ")}`,
    );
  }
  return access;
}

export function createOntologyDataProvider(
  ctx: OntologyCtx,
): OntologyDataProvider {
  return {
    ctx,
    async getList({ resource, filters }) {
      const access = resolveAccess(ctx, resource);
      const rows = await access.findMany(
        (filters ?? {}) as Partial<{ id: string }>,
      );
      return { data: rows, total: rows.length };
    },
    async getOne({ resource, id }) {
      const access = resolveAccess(ctx, resource);
      const row = await access.findById(id);
      if (!row) {
        throw new Error(`${resource} "${id}" not found`);
      }
      return { data: row };
    },
    async create({ resource, variables }) {
      const access = resolveAccess(ctx, resource);
      const row = await access.create(variables as { id: string });
      return { data: row };
    },
    async update({ resource, id, variables }) {
      const access = resolveAccess(ctx, resource);
      const row = await access.update(id, variables as Partial<{ id: string }>);
      if (!row) {
        throw new Error(`${resource} "${id}" not found`);
      }
      return { data: row };
    },
    async deleteOne({ resource, id }) {
      const access = resolveAccess(ctx, resource);
      const ok = await access.delete(id);
      return { data: { ok } };
    },
  };
}
