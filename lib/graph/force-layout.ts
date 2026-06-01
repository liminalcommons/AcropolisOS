// Pure, seeded force-directed layout. Deterministic (a seeded mulberry32 PRNG,
// no Date.now/Math.random) so it is unit-testable and SSR-safe; the client graph
// runs it once in a useMemo and lets users drag nodes thereafter. Repulsion +
// link spring + centering, fixed iteration count, clamped to the canvas.

export interface LayoutNode {
  id: string;
}
export interface LayoutEdge {
  source: string;
  target: string;
}
export interface LayoutOpts {
  width: number;
  height: number;
  seed: number;
  iterations?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function forceLayout(
  model: { nodes: LayoutNode[]; edges: LayoutEdge[] },
  opts: LayoutOpts,
): Map<string, { x: number; y: number }> {
  const { width: W, height: H, seed } = opts;
  const iterations = opts.iterations ?? 420;
  const CX = W / 2, CY = H / 2;
  const N = model.nodes.length;
  const out = new Map<string, { x: number; y: number }>();
  if (N === 0) return out;

  const rand = mulberry32(seed);
  // index nodes; seed positions on a jittered ring
  const idx: Record<string, number> = {};
  const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
  const radius = Math.min(W, H) * 0.32;
  model.nodes.forEach((n, i) => {
    idx[n.id] = i;
    const ang = (i / N) * Math.PI * 2;
    x[i] = CX + Math.cos(ang) * radius + (rand() - 0.5) * 60;
    y[i] = CY + Math.sin(ang) * radius + (rand() - 0.5) * 60;
  });

  const links = model.edges
    .map((e) => [idx[e.source], idx[e.target]] as const)
    .filter(([a, b]) => a !== undefined && b !== undefined);

  const REP = 5200, SPRING = 0.035, LINKLEN = 92, CENTER = 0.012, DAMP = 0.86, DT = 0.85;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = x[i] - x[j], dy = y[i] - y[j];
        const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        const f = REP / d2, fx = (f * dx) / d, fy = (f * dy) / d;
        vx[i] += fx; vy[i] += fy; vx[j] -= fx; vy[j] -= fy;
      }
    }
    for (const [a, b] of links) {
      let dx = x[b] - x[a], dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - LINKLEN) * SPRING, fx = (f * dx) / d, fy = (f * dy) / d;
      vx[a] += fx; vy[a] += fy; vx[b] -= fx; vy[b] -= fy;
    }
    for (let i = 0; i < N; i++) {
      vx[i] += (CX - x[i]) * CENTER; vy[i] += (CY - y[i]) * CENTER;
      x[i] += vx[i] * DT; y[i] += vy[i] * DT; vx[i] *= DAMP; vy[i] *= DAMP;
      x[i] = Math.max(0, Math.min(W, x[i]));
      y[i] = Math.max(0, Math.min(H, y[i]));
    }
  }

  model.nodes.forEach((n, i) => out.set(n.id, { x: Math.round(x[i]), y: Math.round(y[i]) }));
  return out;
}
