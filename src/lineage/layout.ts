/**
 * Graph layout via Dagre. Pure function — given nodes + edges + options,
 * return absolute x/y positions for each node.
 *
 * Keep this side-effect free so it can be memoized cheaply in
 * LineageGraph.tsx (its inputs are the only thing that drive layout).
 *
 * To swap in ELK, replace the body of `layoutLineage` — the input/output
 * contract is intentionally minimal.
 */

import dagre from "dagre";
import type {
  LayoutDirection,
  LayoutResult,
  LineageEdge,
  LineageNode,
} from "./types";

export interface LayoutOptions {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  /** Distance between ranks (columns in LR, rows in TB). */
  rankSeparation?: number;
  /** Distance between nodes within the same rank. */
  nodeSeparation?: number;
}

export const DEFAULT_NODE_WIDTH = 260;
export const DEFAULT_NODE_HEIGHT = 92;
export const DEFAULT_RANK_SEP = 120;
export const DEFAULT_NODE_SEP = 32;

export function layoutLineage(
  nodes: LineageNode[],
  edges: LineageEdge[],
  options: LayoutOptions = {}
): LayoutResult {
  const direction = options.direction ?? "LR";
  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const rankSep = options.rankSeparation ?? DEFAULT_RANK_SEP;
  const nodeSep = options.nodeSeparation ?? DEFAULT_NODE_SEP;

  const g = new dagre.graphlib.Graph({ multigraph: true, compound: false });
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSep,
    ranksep: rankSep,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: nodeWidth, height: nodeHeight });
  }

  // Dagre supports multigraph if we give edges unique names.
  for (const e of edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(e.source, e.target, {}, e.id);
  }

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  let maxX = 0;
  let maxY = 0;

  for (const n of nodes) {
    const node = g.node(n.id);
    if (!node) continue;
    // Dagre uses center coords; React Flow wants top-left.
    const x = node.x - nodeWidth / 2;
    const y = node.y - nodeHeight / 2;
    positions[n.id] = { x, y };
    if (x + nodeWidth > maxX) maxX = x + nodeWidth;
    if (y + nodeHeight > maxY) maxY = y + nodeHeight;
  }

  return { positions, width: maxX, height: maxY };
}
