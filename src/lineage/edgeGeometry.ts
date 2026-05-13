/**
 * Edge geometry math: anchor computation, bezier sampling, and hit testing.
 *
 * All functions operate in *graph coordinates* (the same space React Flow
 * nodes live in). The canvas layer separately applies the viewport
 * transform when drawing.
 *
 * Keeping geometry in graph space means cached paths stay valid across
 * pan/zoom — only the final 2D-context transform changes.
 */

import type { EdgeGeometry, LayoutDirection } from "./types";

export interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Compute source/target anchor points based on layout direction. */
export function computeAnchors(
  source: NodeBox,
  target: NodeBox,
  direction: LayoutDirection
): { source: { x: number; y: number }; target: { x: number; y: number } } {
  if (direction === "TB") {
    return {
      source: { x: source.x + source.width / 2, y: source.y + source.height },
      target: { x: target.x + target.width / 2, y: target.y },
    };
  }
  // LR (default)
  return {
    source: { x: source.x + source.width, y: source.y + source.height / 2 },
    target: { x: target.x, y: target.y + target.height / 2 },
  };
}

/**
 * Sample a cubic bezier with control points offset along the flow axis.
 * Returns N evenly-spaced points; sample count is tuned for visual
 * smoothness without bloating the cache.
 */
export function sampleBezier(
  s: { x: number; y: number },
  t: { x: number; y: number },
  direction: LayoutDirection,
  samples = 24
): Array<{ x: number; y: number }> {
  // Control points: push them along the flow axis by ~40% of the gap.
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  let c1: { x: number; y: number };
  let c2: { x: number; y: number };
  if (direction === "TB") {
    const offset = Math.max(40, Math.abs(dy) * 0.4);
    c1 = { x: s.x, y: s.y + offset };
    c2 = { x: t.x, y: t.y - offset };
  } else {
    const offset = Math.max(40, Math.abs(dx) * 0.4);
    c1 = { x: s.x + offset, y: s.y };
    c2 = { x: t.x - offset, y: t.y };
  }

  const pts: Array<{ x: number; y: number }> = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const v = 1 - u;
    const b0 = v * v * v;
    const b1 = 3 * v * v * u;
    const b2 = 3 * v * u * u;
    const b3 = u * u * u;
    pts[i] = {
      x: b0 * s.x + b1 * c1.x + b2 * c2.x + b3 * t.x,
      y: b0 * s.y + b1 * c1.y + b2 * c2.y + b3 * t.y,
    };
  }
  return pts;
}

export function buildGeometry(
  id: string,
  source: NodeBox,
  target: NodeBox,
  direction: LayoutDirection
): EdgeGeometry {
  const anchors = computeAnchors(source, target, direction);
  const points = sampleBezier(anchors.source, anchors.target, direction);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    id,
    points,
    source: anchors.source,
    target: anchors.target,
    bbox: { minX, minY, maxX, maxY },
  };
}

/** Squared distance from point P to segment AB. */
function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * Hit-test a point (in graph coords) against a single edge's sampled path.
 * Tolerance is also in graph coords — the caller should scale it inversely
 * to the viewport zoom so the click target stays roughly constant on screen.
 */
export function hitTestEdge(
  geom: EdgeGeometry,
  px: number,
  py: number,
  tolerance: number
): boolean {
  // Cheap bbox reject first (expanded by tolerance).
  if (
    px < geom.bbox.minX - tolerance ||
    px > geom.bbox.maxX + tolerance ||
    py < geom.bbox.minY - tolerance ||
    py > geom.bbox.maxY + tolerance
  ) {
    return false;
  }
  const tolSq = tolerance * tolerance;
  for (let i = 0; i < geom.points.length - 1; i++) {
    const a = geom.points[i];
    const b = geom.points[i + 1];
    if (distSqToSegment(px, py, a.x, a.y, b.x, b.y) <= tolSq) {
      return true;
    }
  }
  return false;
}

/** Midpoint along the sampled curve — used to position selection buttons. */
export function midpoint(geom: EdgeGeometry): { x: number; y: number } {
  const i = Math.floor(geom.points.length / 2);
  return geom.points[i];
}

/** True if an edge's bbox intersects the visible graph-space rect. */
export function intersectsViewport(
  geom: EdgeGeometry,
  view: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return !(
    geom.bbox.maxX < view.minX ||
    geom.bbox.minX > view.maxX ||
    geom.bbox.maxY < view.minY ||
    geom.bbox.minY > view.maxY
  );
}
