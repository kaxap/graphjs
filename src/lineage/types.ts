/**
 * Public type contracts for the LineageGraph component.
 *
 * These types are intentionally framework-agnostic — they describe the
 * lineage domain, not React Flow's internal node/edge shapes. The
 * LineageGraph component converts them to React Flow nodes internally.
 */

export type LineageEntityType =
  | "table"
  | "dashboard"
  | "pipeline"
  | "topic"
  | "mlmodel"
  | "container"
  | "database"
  | "schema"
  | "generic";

export type LineageNodeStatus = "active" | "deleted" | "deprecated";

export type LineageEdgeKind = "lineage" | "columnLineage" | "inactive" | "deleted";

export interface LineageNode {
  id: string;
  /** Free-form type tag — usually the same as `entityType`. */
  type: string;
  name: string;
  fullyQualifiedName?: string;
  /** Strongly typed entity kind used for icon + styling. */
  entityType?: LineageEntityType;
  owner?: string;
  tier?: string;
  domain?: string;
  status?: LineageNodeStatus;
  hasUpstreamChildren?: boolean;
  hasDownstreamChildren?: boolean;
  /** Optional column list for column-lineage support. */
  columns?: LineageColumn[];
  metadata?: Record<string, unknown>;
}

export interface LineageColumn {
  name: string;
  dataType?: string;
  fullyQualifiedName?: string;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  type?: LineageEdgeKind;
  label?: string;
  /** Optional column-level handles (used when type === "columnLineage"). */
  sourceHandle?: string;
  targetHandle?: string;
  metadata?: Record<string, unknown>;
}

export type LayoutDirection = "LR" | "TB";

export interface LineageGraphProps {
  nodes: LineageNode[];
  edges: LineageEdge[];

  loading?: boolean;
  error?: string | null;

  selectedNodeId?: string;
  selectedEdgeId?: string;
  hoveredEdgeId?: string;
  highlightedNodeIds?: string[];
  highlightedEdgeIds?: string[];

  layoutDirection?: LayoutDirection;
  enableMiniMap?: boolean;
  /** Render edges in a custom <canvas> instead of via React Flow's SVG. */
  enableCanvasEdges?: boolean;
  enableColumnLineage?: boolean;
  enableEditMode?: boolean;

  /** Node geometry — also fed to the layout engine. */
  nodeWidth?: number;
  nodeHeight?: number;
  rankSeparation?: number;
  nodeSeparation?: number;

  onNodeClick?: (node: LineageNode) => void;
  onEdgeClick?: (edge: LineageEdge, event?: MouseEvent) => void;
  onEdgeHover?: (edge: LineageEdge | null) => void;
  onExpandUpstream?: (node: LineageNode) => void;
  onExpandDownstream?: (node: LineageNode) => void;
  onConnect?: (params: { source: string; target: string }) => void;
  onDropNode?: (
    node: Partial<LineageNode>,
    position: { x: number; y: number }
  ) => void;
}

/** Layout output: absolute x/y for each node id. */
export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/** Rendered geometry for a single edge — cached and used for hit testing. */
export interface EdgeGeometry {
  id: string;
  /** Sampled points along the curve, in graph coordinates. */
  points: Array<{ x: number; y: number }>;
  /** Source/target anchor points in graph coordinates. */
  source: { x: number; y: number };
  target: { x: number; y: number };
  /** Axis-aligned bounding box in graph coordinates (for viewport culling). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}
