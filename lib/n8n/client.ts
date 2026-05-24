// F2-step2b: n8n REST client.
// F2-step2c: createWorkflow + activateWorkflow added.
//
// Reads N8N_BASE_URL (default: http://n8n:5678) and N8N_API_KEY from env.
// The app container reaches n8n via internal Docker service DNS — the
// localhost:5678 host port is for the editor UI only.
//
// API reference: https://docs.n8n.io/api/api-reference/
// Endpoints used:
//   GET  /api/v1/workflows          — list
//   GET  /api/v1/workflows/:id      — get
//   POST /api/v1/workflows          — create
//   POST /api/v1/workflows/:id/activate — activate

const PLACEHOLDER = "SET_ME_VIA_N8N_UI";

export class N8nNotConfiguredError extends Error {
  constructor() {
    super(
      "n8n is not connected yet — set up the owner account at http://localhost:5678 " +
        "and add N8N_API_KEY to .env",
    );
    this.name = "N8nNotConfiguredError";
  }
}

function getConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.N8N_BASE_URL ?? "http://n8n:5678";
  const apiKey = process.env.N8N_API_KEY ?? "";
  if (!apiKey || apiKey === PLACEHOLDER) {
    throw new N8nNotConfiguredError();
  }
  return { baseUrl, apiKey };
}

async function n8nFetch(path: string): Promise<Response> {
  const { baseUrl, apiKey } = getConfig();
  const url = `${baseUrl}/api/v1${path}`;
  const resp = await fetch(url, {
    headers: {
      "X-N8N-API-KEY": apiKey,
      Accept: "application/json",
    },
  });
  return resp;
}

async function n8nPost(path: string, body: unknown): Promise<Response> {
  const { baseUrl, apiKey } = getConfig();
  const url = `${baseUrl}/api/v1${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return resp;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

// ── API methods ──────────────────────────────────────────────────────────────

/**
 * List all workflows defined in this n8n instance.
 * Returns an empty array if no workflows exist yet.
 */
export async function listWorkflows(): Promise<N8nWorkflow[]> {
  const resp = await n8nFetch("/workflows?limit=250");
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`n8n listWorkflows failed (${resp.status}): ${text}`);
  }
  const body = (await resp.json()) as {
    data?: N8nWorkflow[];
    // n8n v2 wraps results in { data: [...] }
  };
  return body.data ?? [];
}

/**
 * Get a single workflow by id. Returns null if not found (404).
 */
export async function getWorkflow(id: string): Promise<N8nWorkflow | null> {
  const resp = await n8nFetch(`/workflows/${encodeURIComponent(id)}`);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`n8n getWorkflow failed (${resp.status}): ${text}`);
  }
  return (await resp.json()) as N8nWorkflow;
}

// ── Write methods (F2-step2c) ────────────────────────────────────────────────

export interface N8nWorkflowSpec {
  /** Display name for the new workflow. */
  name: string;
  /**
   * Node definitions. If omitted, a single manual-trigger stub is used so
   * the workflow is valid and immediately openable in the n8n editor.
   */
  nodes?: unknown[];
  /** Connection map. Defaults to {} when omitted. */
  connections?: object;
}

/** Minimal valid manual-trigger node accepted by n8n v2. */
function manualTriggerNode(id: string) {
  return {
    parameters: {},
    id,
    name: "When clicking Test",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [250, 300],
  };
}

/** Cheap UUID-shaped string using Math.random (no crypto dependency). */
function pseudoUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a new workflow draft in n8n.
 *
 * When `spec.nodes` is omitted, a minimal manual-trigger stub is inserted so
 * n8n accepts the payload.  The workflow is created INACTIVE (manual triggers
 * cannot be activated; activateWorkflow is a no-op for those).
 *
 * Returns `{ id, name }` of the created workflow.
 * Throws `N8nNotConfiguredError` when the API key is absent.
 */
export async function createWorkflow(
  spec: N8nWorkflowSpec,
): Promise<{ id: string; name: string }> {
  const nodes = spec.nodes ?? [manualTriggerNode(pseudoUuid())];
  const payload = {
    name: spec.name,
    nodes,
    connections: spec.connections ?? {},
    settings: { executionOrder: "v1" },
  };
  const resp = await n8nPost("/workflows", payload);
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`n8n createWorkflow failed (${resp.status}): ${text}`);
  }
  const body = (await resp.json()) as { id: string; name: string };
  return { id: body.id, name: body.name };
}

/**
 * Activate an existing workflow so it responds to its trigger.
 *
 * Manual-trigger workflows cannot be activated — n8n returns 400 for those.
 * This is silently ignored (the draft is useful even inactive).
 *
 * Throws `N8nNotConfiguredError` when the API key is absent.
 */
export async function activateWorkflow(id: string): Promise<void> {
  const resp = await n8nPost(
    `/workflows/${encodeURIComponent(id)}/activate`,
    {},
  );
  if (!resp.ok) {
    // Manual triggers return 400 ("Workflow cannot be activated because it
    // has no trigger nodes that can start automatically").  That is expected
    // for stub workflows — swallow it.  Other errors are surfaced.
    if (resp.status === 400) return;
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`n8n activateWorkflow failed (${resp.status}): ${text}`);
  }
}
