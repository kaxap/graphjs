/**
 * LineageGraph — top-level component.
 *
 * Composition:
 *   <ReactFlowProvider>
 *     <ReactFlow>
 *       <Background /> <Controls /> <MiniMap />
 *     </ReactFlow>
 *     <CanvasEdgeLayer />      ← canvas, behind nodes
 *     <EdgeInteractionOverlay /> ← invisible hit-test + selection buttons
 *     <LineageControls />
 *   </ReactFlowProvider>
 *
 * Canvas edge mode (`enableCanvasEdges`, default true):
 *   - We pass [] for edges and {} for edgeTypes to React Flow.
 *   - Edges are drawn by CanvasEdgeLayer.
 *   - Hit testing is performed by EdgeInteractionOverlay.
 *
 * When canvas mode is off we fall back to React Flow's native SVG edges,
 * which is fine for small graphs and easier to style with CSS.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls as RFControls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";

import { CanvasEdgeLayer } from "./CanvasEdgeLayer";
import { EdgeInteractionOverlay } from "./EdgeInteractionOverlay";
import { LineageControls } from "./LineageControls";
import { LineageNodeView, type LineageNodeData } from "./LineageNode";
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_SEP,
  DEFAULT_NODE_WIDTH,
  DEFAULT_RANK_SEP,
  layoutLineage,
} from "./layout";
import type {
  EdgeGeometry,
  LayoutDirection,
  LineageEdge,
  LineageGraphProps,
  LineageNode,
} from "./types";
import "./lineageGraph.css";

const EMPTY_EDGES: Edge[] = [];
const EMPTY_EDGE_TYPES: EdgeTypes = {};

// Memoized once at module scope so the reference is stable across renders.
const NODE_TYPES: NodeTypes = { lineage: LineageNodeView };

export function LineageGraph(props: LineageGraphProps) {
  return (
    <ReactFlowProvider>
      <LineageGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function LineageGraphInner({
  nodes,
  edges,
  loading,
  error,
  selectedNodeId,
  selectedEdgeId: controlledSelectedEdgeId,
  hoveredEdgeId: controlledHoveredEdgeId,
  highlightedNodeIds,
  highlightedEdgeIds,
  layoutDirection,
  enableMiniMap = true,
  enableCanvasEdges = true,
  enableColumnLineage = false,
  enableEditMode = false,
  nodeWidth = DEFAULT_NODE_WIDTH,
  nodeHeight = DEFAULT_NODE_HEIGHT,
  rankSeparation = DEFAULT_RANK_SEP,
  nodeSeparation = DEFAULT_NODE_SEP,
  onNodeClick,
  onEdgeClick,
  onEdgeHover,
  onExpandUpstream,
  onExpandDownstream,
  onConnect,
  onDropNode,
}: LineageGraphProps) {
  // ----- Local UI state for toolbar toggles ---------------------------------
  const [direction, setDirection] = useState<LayoutDirection>(layoutDirection ?? "LR");
  const [miniMapOn, setMiniMapOn] = useState<boolean>(enableMiniMap);
  const [columnLineageOn, setColumnLineageOn] = useState<boolean>(enableColumnLineage);
  const [editModeOn, setEditModeOn] = useState<boolean>(enableEditMode);

  // Keep state in sync if controlled prop changes.
  useEffect(() => {
    if (layoutDirection) setDirection(layoutDirection);
  }, [layoutDirection]);

  // Internal hover state (only updated when the hit-test result actually changes).
  const [internalHoveredEdgeId, setInternalHoveredEdgeId] = useState<string | undefined>(
    controlledHoveredEdgeId
  );
  const [internalSelectedEdgeId, setInternalSelectedEdgeId] = useState<string | undefined>(
    controlledSelectedEdgeId
  );
  const hoveredEdgeId = controlledHoveredEdgeId ?? internalHoveredEdgeId;
  const selectedEdgeId = controlledSelectedEdgeId ?? internalSelectedEdgeId;

  // ----- Filter edges by column-lineage toggle ------------------------------
  const visibleEdges = useMemo(() => {
    if (columnLineageOn) return edges;
    return edges.filter((e) => e.type !== "columnLineage");
  }, [edges, columnLineageOn]);

  // ----- Layout (pure, memoized on structural inputs only) ------------------
  const layout = useMemo(() => {
    return layoutLineage(nodes, visibleEdges, {
      direction,
      nodeWidth,
      nodeHeight,
      rankSeparation,
      nodeSeparation,
    });
  }, [nodes, visibleEdges, direction, nodeWidth, nodeHeight, rankSeparation, nodeSeparation]);

  // ----- Highlight / dimming sets ------------------------------------------
  const highlightedNodeSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds]
  );
  const anyHighlight = highlightedNodeSet.size > 0;

  // ----- Stable callbacks ---------------------------------------------------
  const handleExpandUpstream = useCallback(
    (n: LineageNode) => onExpandUpstream?.(n),
    [onExpandUpstream]
  );
  const handleExpandDownstream = useCallback(
    (n: LineageNode) => onExpandDownstream?.(n),
    [onExpandDownstream]
  );

  // ----- Convert lineage → React Flow nodes ---------------------------------
  const rfNodes: Node<LineageNodeData>[] = useMemo(() => {
    return nodes.map((n) => {
      const pos = layout.positions[n.id] ?? { x: 0, y: 0 };
      return {
        id: n.id,
        type: "lineage",
        position: pos,
        // RF default is 150 — set explicitly so canvas anchor math agrees.
        width: nodeWidth,
        height: nodeHeight,
        style: { width: nodeWidth, height: nodeHeight },
        selected: n.id === selectedNodeId,
        data: {
          node: n,
          direction,
          selected: n.id === selectedNodeId,
          highlighted: highlightedNodeSet.has(n.id),
          dimmed: anyHighlight && !highlightedNodeSet.has(n.id),
          onExpandUpstream: handleExpandUpstream,
          onExpandDownstream: handleExpandDownstream,
        },
      };
    });
  }, [
    nodes,
    layout,
    direction,
    nodeWidth,
    nodeHeight,
    selectedNodeId,
    highlightedNodeSet,
    anyHighlight,
    handleExpandUpstream,
    handleExpandDownstream,
  ]);

  // ----- Convert lineage edges → RF edges (SVG fallback path only) ----------
  const rfEdges: Edge[] = useMemo(() => {
    if (enableCanvasEdges) return EMPTY_EDGES;
    return visibleEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: "default",
      label: e.label,
      className: [
        "lg-rf-edge",
        e.type ? `lg-rf-edge--${e.type}` : "",
        e.id === selectedEdgeId ? "lg-rf-edge--selected" : "",
        e.id === hoveredEdgeId ? "lg-rf-edge--hover" : "",
        (highlightedEdgeIds ?? []).includes(e.id) ? "lg-rf-edge--accent" : "",
      ]
        .filter(Boolean)
        .join(" "),
    }));
  }, [
    enableCanvasEdges,
    visibleEdges,
    selectedEdgeId,
    hoveredEdgeId,
    highlightedEdgeIds,
  ]);

  // ----- Geometry cache shared between canvas + overlay ---------------------
  const geometryRef = useRef<Map<string, EdgeGeometry>>(new Map());

  // ----- Capture the React Flow pane DOM element for the overlay listeners --
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  const handleInit = useCallback((inst: ReactFlowInstance) => {
    rfInstanceRef.current = inst;
    // The pane is the .react-flow__pane child; it lives above the canvas.
    const pane = wrapperRef.current?.querySelector<HTMLElement>(".react-flow__pane");
    setPaneEl(pane ?? null);
    // Initial fit.
    requestAnimationFrame(() => inst.fitView({ padding: 0.2, duration: 0 }));
  }, []);

  // ----- React Flow event handlers ------------------------------------------
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, n: Node<LineageNodeData>) => {
      onNodeClick?.(n.data.node);
      // Clicking a node also clears edge selection.
      setInternalSelectedEdgeId(undefined);
    },
    [onNodeClick]
  );

  const handlePaneClick = useCallback(() => {
    setInternalSelectedEdgeId(undefined);
  }, []);

  const handleConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      onConnect?.({ source: c.source, target: c.target });
    },
    [onConnect]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!onDropNode || !rfInstanceRef.current) return;
      const raw = event.dataTransfer.getData("application/lineage-node");
      if (!raw) return;
      event.preventDefault();
      const partial = JSON.parse(raw) as Partial<LineageNode>;
      const bounds = wrapperRef.current!.getBoundingClientRect();
      const position = rfInstanceRef.current.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      onDropNode(partial, position);
    },
    [onDropNode]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // ----- Edge interaction wiring -------------------------------------------
  const handleEdgeHoverInternal = useCallback(
    (e: LineageEdge | null) => {
      setInternalHoveredEdgeId(e?.id);
      onEdgeHover?.(e);
    },
    [onEdgeHover]
  );

  const handleEdgeClickInternal = useCallback(
    (e: LineageEdge, ev?: MouseEvent) => {
      setInternalSelectedEdgeId(e.id);
      onEdgeClick?.(e, ev);
    },
    [onEdgeClick]
  );

  // ----- States: loading / error / empty ------------------------------------
  if (loading) {
    return (
      <div className="lg-root lg-state">
        <div className="lg-state__spinner" aria-label="Loading lineage" />
        <div className="lg-state__text">Loading lineage…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="lg-root lg-state lg-state--error">
        <div className="lg-state__text">Couldn't load lineage</div>
        <div className="lg-state__detail">{error}</div>
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <div className="lg-root lg-state">
        <div className="lg-state__text">No lineage to display</div>
        <div className="lg-state__detail">
          This entity has no upstream or downstream relationships yet.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="lg-root"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={enableCanvasEdges ? EMPTY_EDGE_TYPES : undefined}
        onInit={handleInit}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onConnect={handleConnect}
        nodesConnectable={editModeOn}
        nodesDraggable
        elementsSelectable
        selectNodesOnDrag={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.05}
        maxZoom={2.5}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background gap={20} size={1} color="var(--lg-grid)" />
        <RFControls position="bottom-right" showInteractive={false} />
        {miniMapOn && (
          <MiniMap
            className="lg-minimap"
            pannable
            zoomable
            nodeStrokeWidth={2}
            nodeColor={(n) =>
              (n.data as LineageNodeData)?.node?.status === "deleted"
                ? "#cbd5e1"
                : "#3b82f6"
            }
            maskColor="rgba(15, 23, 42, 0.06)"
          />
        )}
      </ReactFlow>

      {enableCanvasEdges && (
        <CanvasEdgeLayer
          edges={visibleEdges}
          direction={direction}
          nodeWidth={nodeWidth}
          nodeHeight={nodeHeight}
          selectedEdgeId={selectedEdgeId}
          hoveredEdgeId={hoveredEdgeId}
          highlightedEdgeIds={highlightedEdgeIds}
          geometryRef={geometryRef}
        />
      )}

      {enableCanvasEdges && (
        <EdgeInteractionOverlay
          paneElement={paneEl}
          edges={visibleEdges}
          geometryRef={geometryRef}
          selectedEdgeId={selectedEdgeId}
          enableColumnLineage={columnLineageOn}
          enableEditMode={editModeOn}
          onEdgeClick={handleEdgeClickInternal}
          onEdgeHover={handleEdgeHoverInternal}
        />
      )}

      <LineageControls
        direction={direction}
        onDirectionChange={setDirection}
        miniMapEnabled={miniMapOn}
        onToggleMiniMap={() => setMiniMapOn((v) => !v)}
        columnLineageEnabled={columnLineageOn}
        onToggleColumnLineage={() => setColumnLineageOn((v) => !v)}
        editModeEnabled={editModeOn}
        onToggleEditMode={() => setEditModeOn((v) => !v)}
      />
    </div>
  );
}

export default LineageGraph;

// Re-exports for consumers.
export * from "./types";
