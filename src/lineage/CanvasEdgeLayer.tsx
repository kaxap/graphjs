/**
 * Canvas-based edge renderer.
 *
 * Why canvas? React Flow's default SVG/DOM edges are fine for ~100 edges,
 * but lineage graphs commonly have thousands. Each SVG path is a DOM node
 * that React Flow re-renders on viewport changes, which kills perf.
 *
 * Strategy:
 *   1. Compute edge geometry (sampled bezier points) in graph coordinates
 *      ONCE per (nodes, edges, direction) change. Cache it on a ref.
 *   2. On every viewport/size/state change, redraw the canvas by applying
 *      the viewport's translate+zoom to the 2D context.
 *   3. Schedule redraws via rAF — coalesces bursts of viewport updates
 *      from React Flow during pan/zoom.
 *   4. Respect devicePixelRatio so lines stay crisp on retina displays.
 *   5. Cull edges whose bbox is outside the visible graph rect.
 *   6. Hover/select state changes a *style*, not the geometry — they only
 *      trigger a redraw, not a recompute.
 *
 * The cached geometry is also consumed by EdgeInteractionOverlay for hit
 * testing — exposed via the `geometryRef` prop.
 */

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useViewport, useStore, type ReactFlowState } from "reactflow";
import {
  buildGeometry,
  intersectsViewport,
  type NodeBox,
} from "./edgeGeometry";
import type { EdgeGeometry, LayoutDirection, LineageEdge } from "./types";

export interface CanvasEdgeLayerProps {
  edges: LineageEdge[];
  direction: LayoutDirection;
  nodeWidth: number;
  nodeHeight: number;
  selectedEdgeId?: string;
  hoveredEdgeId?: string;
  highlightedEdgeIds?: string[];
  /** Externally-shared cache. Populated here, read by the overlay. */
  geometryRef: React.MutableRefObject<Map<string, EdgeGeometry>>;
}

const nodeSelector = (s: ReactFlowState) => s.nodeInternals;

export function CanvasEdgeLayer({
  edges,
  direction,
  nodeWidth,
  nodeHeight,
  selectedEdgeId,
  hoveredEdgeId,
  highlightedEdgeIds,
  geometryRef,
}: CanvasEdgeLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const viewport = useViewport();
  // Subscribe to React Flow's node store so we pick up live drag positions.
  const nodeInternals = useStore(nodeSelector);

  const highlightSet = useMemo(
    () => new Set(highlightedEdgeIds ?? []),
    [highlightedEdgeIds]
  );

  // --- Geometry cache: rebuild only when topology / layout changes. ---
  // The cache is keyed by edge id and stored on a shared ref so the
  // interaction overlay can hit-test against the same data.
  useLayoutEffect(() => {
    const cache = geometryRef.current;
    cache.clear();

    const boxes = new Map<string, NodeBox>();
    nodeInternals.forEach((n) => {
      boxes.set(n.id, {
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? nodeWidth,
        height: n.height ?? nodeHeight,
      });
    });

    for (const e of edges) {
      const s = boxes.get(e.source);
      const t = boxes.get(e.target);
      if (!s || !t) continue;
      cache.set(e.id, buildGeometry(e.id, s, t, direction));
    }
    scheduleDraw();
    // We intentionally depend on nodeInternals identity — React Flow swaps
    // it on every node update (including drag), which is exactly when we
    // want to recompute geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, direction, nodeWidth, nodeHeight, nodeInternals]);

  // --- Redraw on viewport / state changes (no geometry recompute). ---
  useEffect(() => {
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.x, viewport.y, viewport.zoom, selectedEdgeId, hoveredEdgeId, highlightSet]);

  // --- ResizeObserver: keep canvas pixel size in sync with container. ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { width, height };
        syncCanvasSize();
        scheduleDraw();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Cleanup on unmount. ---
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      geometryRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncCanvasSize() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.floor(width * dpr));
    const ph = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function scheduleDraw() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = sizeRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply DPR + viewport (graph → screen) in one transform.
    // Screen-space pixel = (graph * zoom + tx) * dpr.
    ctx.setTransform(
      viewport.zoom * dpr,
      0,
      0,
      viewport.zoom * dpr,
      viewport.x * dpr,
      viewport.y * dpr
    );

    // Compute the visible rect in graph coordinates for culling.
    const view = {
      minX: -viewport.x / viewport.zoom,
      minY: -viewport.y / viewport.zoom,
      maxX: (-viewport.x + width) / viewport.zoom,
      maxY: (-viewport.y + height) / viewport.zoom,
    };

    // At very low zoom we drop arrowheads / use thinner strokes.
    const lowZoom = viewport.zoom < 0.4;

    // Draw passes: base → highlighted → hovered → selected, so important
    // edges paint on top without per-edge z-sorting.
    const base: EdgeGeometry[] = [];
    const accent: EdgeGeometry[] = [];
    let hovered: { geom: EdgeGeometry; edge: LineageEdge } | null = null;
    let selected: { geom: EdgeGeometry; edge: LineageEdge } | null = null;

    for (const e of edges) {
      const geom = geometryRef.current.get(e.id);
      if (!geom) continue;
      if (!intersectsViewport(geom, view)) continue;

      if (e.id === selectedEdgeId) selected = { geom, edge: e };
      else if (e.id === hoveredEdgeId) hovered = { geom, edge: e };
      else if (highlightSet.has(e.id)) accent.push(geom);
      else base.push(geom);
    }

    for (const g of base) strokeEdge(ctx, g, edgeStyleFor(findEdge(edges, g.id), "base"), lowZoom);
    for (const g of accent)
      strokeEdge(ctx, g, edgeStyleFor(findEdge(edges, g.id), "accent"), lowZoom);
    if (hovered) strokeEdge(ctx, hovered.geom, edgeStyleFor(hovered.edge, "hover"), lowZoom);
    if (selected)
      strokeEdge(ctx, selected.geom, edgeStyleFor(selected.edge, "selected"), lowZoom);
  }

  return (
    <div ref={containerRef} className="lg-canvas-edges" aria-hidden="true">
      <canvas ref={canvasRef} className="lg-canvas-edges__canvas" />
    </div>
  );
}

// --- styling helpers ---

type EdgeRenderState = "base" | "accent" | "hover" | "selected";

interface EdgeStyle {
  stroke: string;
  width: number;
  dash?: number[];
  arrow: boolean;
}

function findEdge(edges: LineageEdge[], id: string): LineageEdge {
  // O(n) but only called for ≤ visible edges; fine in practice.
  return edges.find((e) => e.id === id)!;
}

function edgeStyleFor(edge: LineageEdge, state: EdgeRenderState): EdgeStyle {
  const kind = edge.type ?? "lineage";

  if (kind === "deleted") {
    return { stroke: "#cbd5e1", width: 1.2, dash: [4, 4], arrow: false };
  }
  if (kind === "inactive") {
    return { stroke: "#cbd5e1", width: 1.2, arrow: true };
  }

  const isColumn = kind === "columnLineage";

  switch (state) {
    case "selected":
      return { stroke: "#2563eb", width: 2.5, arrow: true };
    case "hover":
      return { stroke: "#3b82f6", width: 2.25, arrow: true };
    case "accent":
      return {
        stroke: isColumn ? "#8b5cf6" : "#3b82f6",
        width: 2,
        arrow: true,
      };
    case "base":
    default:
      return {
        stroke: isColumn ? "#a78bfa" : "#94a3b8",
        width: isColumn ? 1.25 : 1.5,
        dash: isColumn ? [3, 3] : undefined,
        arrow: true,
      };
  }
}

function strokeEdge(
  ctx: CanvasRenderingContext2D,
  geom: EdgeGeometry,
  style: EdgeStyle,
  lowZoom: boolean
) {
  ctx.beginPath();
  const pts = geom.points;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (style.dash) ctx.setLineDash(style.dash);
  else ctx.setLineDash([]);
  ctx.stroke();

  if (style.arrow && !lowZoom) {
    drawArrowhead(ctx, pts[pts.length - 2], pts[pts.length - 1], style);
  }
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  style: EdgeStyle
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = Math.max(6, style.width * 3);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - size * Math.cos(angle - Math.PI / 7),
    to.y - size * Math.sin(angle - Math.PI / 7)
  );
  ctx.lineTo(
    to.x - size * Math.cos(angle + Math.PI / 7),
    to.y - size * Math.sin(angle + Math.PI / 7)
  );
  ctx.closePath();
  ctx.fillStyle = style.stroke;
  ctx.fill();
  ctx.restore();
}
