/**
 * Edge interaction overlay for canvas-rendered edges.
 *
 * Canvas pixels don't fire pointer events, so we install listeners on the
 * React Flow pane and hit-test against the geometry cache populated by
 * CanvasEdgeLayer.
 *
 * Important: this component does NOT re-render on mousemove. It calls the
 * `onEdgeHover` callback only when the hovered edge id actually changes —
 * the parent decides whether/how to update React state.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { useReactFlow, useViewport } from "reactflow";
import { hitTestEdge, midpoint } from "./edgeGeometry";
import type { EdgeGeometry, LineageEdge } from "./types";

export interface EdgeInteractionOverlayProps {
  paneElement: HTMLElement | null;
  edges: LineageEdge[];
  geometryRef: React.MutableRefObject<Map<string, EdgeGeometry>>;
  selectedEdgeId?: string;
  enableColumnLineage?: boolean;
  enableEditMode?: boolean;
  onEdgeClick?: (edge: LineageEdge, event?: MouseEvent) => void;
  onEdgeHover?: (edge: LineageEdge | null) => void;
  /** Optional handler for the action button (e.g. "view pipeline"). */
  onEdgeAction?: (edge: LineageEdge) => void;
  /** Optional handler for removing a column-lineage edge in edit mode. */
  onEdgeRemove?: (edge: LineageEdge) => void;
  /** Hit-test tolerance in *screen* pixels. */
  hitTolerancePx?: number;
}

export function EdgeInteractionOverlay({
  paneElement,
  edges,
  geometryRef,
  selectedEdgeId,
  enableColumnLineage,
  enableEditMode,
  onEdgeClick,
  onEdgeHover,
  onEdgeAction,
  onEdgeRemove,
  hitTolerancePx = 6,
}: EdgeInteractionOverlayProps) {
  const rf = useReactFlow();
  const viewport = useViewport();

  // Latest props captured in a ref so the pane listeners stay stable.
  const stateRef = useRef({
    edges,
    hoveredId: undefined as string | undefined,
    onEdgeClick,
    onEdgeHover,
    hitTolerancePx,
  });
  stateRef.current.edges = edges;
  stateRef.current.onEdgeClick = onEdgeClick;
  stateRef.current.onEdgeHover = onEdgeHover;
  stateRef.current.hitTolerancePx = hitTolerancePx;

  useEffect(() => {
    if (!paneElement) return;

    function hitAt(clientX: number, clientY: number): LineageEdge | null {
      const pane = paneElement!;
      const rect = pane.getBoundingClientRect();
      // Convert client → graph coords via React Flow's projection.
      const graph = rf.project({
        x: clientX - rect.left,
        y: clientY - rect.top,
      });
      // Tolerance in screen px → graph units.
      const tolerance = stateRef.current.hitTolerancePx / rf.getZoom();
      for (const edge of stateRef.current.edges) {
        const geom = stateRef.current.edges && geometryRef.current.get(edge.id);
        if (!geom) continue;
        if (hitTestEdge(geom, graph.x, graph.y, tolerance)) return edge;
      }
      return null;
    }

    function handleMove(ev: MouseEvent) {
      const hit = hitAt(ev.clientX, ev.clientY);
      const nextId = hit?.id;
      if (nextId !== stateRef.current.hoveredId) {
        stateRef.current.hoveredId = nextId;
        stateRef.current.onEdgeHover?.(hit);
        // Cursor affordance.
        paneElement!.style.cursor = hit ? "pointer" : "";
      }
    }

    function handleLeave() {
      if (stateRef.current.hoveredId !== undefined) {
        stateRef.current.hoveredId = undefined;
        stateRef.current.onEdgeHover?.(null);
        paneElement!.style.cursor = "";
      }
    }

    function handleClick(ev: MouseEvent) {
      const hit = hitAt(ev.clientX, ev.clientY);
      if (hit) {
        ev.stopPropagation();
        stateRef.current.onEdgeClick?.(hit, ev);
      }
    }

    paneElement.addEventListener("mousemove", handleMove);
    paneElement.addEventListener("mouseleave", handleLeave);
    paneElement.addEventListener("click", handleClick);
    return () => {
      paneElement.removeEventListener("mousemove", handleMove);
      paneElement.removeEventListener("mouseleave", handleLeave);
      paneElement.removeEventListener("click", handleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneElement]);

  // Compute selected-edge button position in screen coords.
  const selectedButton = useMemo(() => {
    if (!selectedEdgeId) return null;
    const edge = edges.find((e) => e.id === selectedEdgeId);
    if (!edge) return null;
    const geom = geometryRef.current.get(selectedEdgeId);
    if (!geom) return null;

    const mid = midpoint(geom);
    const screen = {
      x: mid.x * viewport.zoom + viewport.x,
      y: mid.y * viewport.zoom + viewport.y,
    };
    return { edge, screen };
  }, [selectedEdgeId, edges, viewport.x, viewport.y, viewport.zoom, geometryRef]);

  return (
    <div className="lg-edge-overlay" aria-hidden={!selectedButton}>
      {selectedButton && (
        <>
          {selectedButton.edge.type === "columnLineage" && enableEditMode ? (
            <button
              type="button"
              className="lg-edge-overlay__btn lg-edge-overlay__btn--remove"
              style={{
                transform: `translate(${selectedButton.screen.x}px, ${selectedButton.screen.y}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onEdgeRemove?.(selectedButton.edge);
              }}
              aria-label="Remove column lineage edge"
            >
              ×
            </button>
          ) : selectedButton.edge.type !== "columnLineage" ? (
            <button
              type="button"
              className="lg-edge-overlay__btn lg-edge-overlay__btn--action"
              style={{
                transform: `translate(${selectedButton.screen.x}px, ${selectedButton.screen.y}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onEdgeAction?.(selectedButton.edge);
              }}
              aria-label="Edge actions"
            >
              ⋯
            </button>
          ) : null}
        </>
      )}
      {/* enableColumnLineage referenced to silence unused-var warning while
          keeping the prop in the public API for future affordances. */}
      {enableColumnLineage === undefined ? null : null}
    </div>
  );
}
