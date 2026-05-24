// F2-step2b: n8n REST client.
//
// Reads N8N_BASE_URL (default: http://n8n:5678) and N8N_API_KEY from env.
// The app container reaches n8n via internal Docker service DNS — the
// localhost:5678 host port is for the editor UI only.
//
// API reference: https://docs.n8n.io/api/api-reference/
// Endpoints used: GET /api/v1/workflows, GET /api/v1/workflows/:id
//
// create/activate/run workflow operations are step 2c — not implemented here.

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
