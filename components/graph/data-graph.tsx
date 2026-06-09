// Client renderer for the org DATA graph: object instances as nodes, their
// declared refs as edges, force-laid-out. Plain CONTROLLED nodes/edges (NOT
// useNodesState — that broke v12 measurement here); positions come from the pure
// forceLayout. Read-only + viewer-scoped upstream. Click a node to re-center the
// view on its neighborhood (ego mode, server re-derives); hover to trace links;
// toggle types to de-clutter. Custom nodes carry hidden <Handle>s or v12 drops edges.
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { forceLayout } from "@/lib/graph/force-layout";
import { KIND_COLOR } from "./legend";
import type { DataGraphModel } from "@/lib/graph/data-graph";

interface InstanceNodeData extends Record<string, unknown> {
  label: string;
  kind: string | null;
  typeToken: string;
  dimmed: boolean;
}
type InstanceNodeType = Node<InstanceNodeData, "instance">;

function colorFor(kind: string | null): string {
  return (kind && KIND_COLOR[kind]) || KIND_COLOR.concept;
}

function InstanceNode({ data }: NodeProps<InstanceNodeType>): React.ReactElement {
  const color = colorFor(data.kind);
  return (
    <div
      className="nopan rounded-md border px-2 py-1 shadow-sm"
      style={{
        borderColor: color,
        borderLeftWidth: 4,
        backgroundColor: "var(--card)",
        opacity: data.dimmed ? 0.16 : 1,
        maxWidth: 170,
      }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-[11px] font-medium text-foreground" title={data.label}>
          {data.label}
        </span>
      </div>
      <div className="text-[8px] uppercase tracking-wide text-muted-foreground">
        {data.typeToken.replace(/_/g, " ")}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

const nodeTypes = { instance: InstanceNode };

export interface DataGraphTypeInfo {
  token: string;
  kind: string | null;
}

export function DataGraph({
  model,
  allTypes,
  hidden,
  focus,
  hops,
}: {
  model: DataGraphModel;
  allTypes: DataGraphTypeInfo[];
  hidden: string[];
  focus: { type: string; id: string } | null;
  hops: number;
}): React.ReactElement {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);

  const positions = useMemo(
    () => forceLayout(model, { width: 1200, height: 760, seed: 7 }),
    [model],
  );

  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string): void => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of model.edges) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return m;
  }, [model]);

  const keep = useMemo(
    () => (hover ? new Set<string>([hover, ...(adj.get(hover) ?? [])]) : null),
    [hover, adj],
  );

  const nodes: InstanceNodeType[] = useMemo(
    () =>
      model.nodes.map((n) => ({
        id: n.id,
        type: "instance" as const,
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { label: n.label, kind: n.kind, typeToken: n.type, dimmed: keep ? !keep.has(n.id) : false },
      })),
    [model, positions, keep],
  );

  const edges: Edge[] = useMemo(
    () =>
      model.edges.map((e) => {
        const on = !keep || (keep.has(e.source) && keep.has(e.target));
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 8, opacity: on ? 1 : 0.08 },
          labelBgStyle: { fill: "var(--card)", fillOpacity: on ? 0.85 : 0.08 },
          style: { stroke: on ? "var(--muted-foreground)" : "var(--border)", strokeWidth: 1, opacity: on ? 0.7 : 0.07 },
        };
      }),
    [model, keep],
  );

  // ── URL-driven controls (server re-derives) ──
  const hrefFor = (next: { hide?: string[]; focus?: { type: string; id: string } | null; hops?: number }): string => {
    const sp = new URLSearchParams();
    sp.set("view", "data");
    const hideList = next.hide ?? hidden;
    if (hideList.length) sp.set("hide", hideList.join(","));
    const f = next.focus === undefined ? focus : next.focus;
    if (f) sp.set("focus", `${f.type}/${f.id}`);
    const h = next.hops ?? hops;
    if (f && h !== 1) sp.set("hops", String(h));
    return `/graph?${sp.toString()}`;
  };

  const toggleType = (token: string): void => {
    const set = new Set(hidden);
    if (set.has(token)) set.delete(token);
    else set.add(token);
    router.push(hrefFor({ hide: [...set] }));
  };

  const onNodeClick = (_e: ReactMouseEvent, node: Node): void => {
    const i = node.id.indexOf(":");
    if (i < 0) return;
    router.push(hrefFor({ focus: { type: node.id.slice(0, i), id: node.id.slice(i + 1) }, hops: 1 }));
  };

  return (
    <div className="h-[calc(100vh-3rem)] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_e, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.08}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={22} />
        <Controls position="bottom-right" style={{ zIndex: 20, margin: "0.75rem" }} />
        <Panel position="top-left">
          <div className="max-w-[15rem] space-y-2 rounded-lg border border-border bg-card/90 p-3 text-xs backdrop-blur">
            <div className="font-medium text-foreground">
              Org data graph
              <span className="ml-1 font-normal text-muted-foreground">
                · {model.nodes.length} nodes · {model.edges.length} edges
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              <Link href="/graph" className="underline hover:text-foreground">← schema view</Link>
            </div>
            {focus && (
              <div className="rounded border border-warning/30 bg-warning/10 px-2 py-1 text-warning">
                Focused: <span className="font-mono">{focus.type}</span> · hops{" "}
                {[1, 2, 3].map((h) => (
                  <Link
                    key={h}
                    href={hrefFor({ hops: h })}
                    className={`px-0.5 ${h === hops ? "font-bold text-amber-200 underline" : "hover:underline"}`}
                  >
                    {h}
                  </Link>
                ))}
                {" · "}
                <Link href={`/${focus.type}/${focus.id}`} className="underline hover:text-amber-200">
                  open record →
                </Link>
                {" · "}
                <Link href={hrefFor({ focus: null })} className="underline hover:text-amber-200">
                  clear
                </Link>
              </div>
            )}
            <div className="max-h-60 space-y-0.5 overflow-auto">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Types</div>
              {allTypes.map((t) => (
                <label key={t.token} className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={!hidden.includes(t.token)} onChange={() => toggleType(t.token)} />
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorFor(t.kind) }} />
                  <span className="text-foreground">{t.token.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
            <div className="border-t border-border pt-1 text-[10px] text-muted-foreground">
              Click a node → explore its neighborhood. Hover → trace links.
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
