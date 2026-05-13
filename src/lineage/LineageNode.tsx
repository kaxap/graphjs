/**
 * Custom React Flow node renderer.
 *
 * Memoized — React Flow re-renders nodes when *any* of its internal node
 * state changes, so we keep this component cheap and only re-render when
 * data identity changes.
 */

import React, { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { LayoutDirection, LineageEntityType, LineageNode } from "./types";

export interface LineageNodeData {
  node: LineageNode;
  direction: LayoutDirection;
  selected?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  onExpandUpstream?: (node: LineageNode) => void;
  onExpandDownstream?: (node: LineageNode) => void;
}

const ENTITY_GLYPH: Record<LineageEntityType, string> = {
  table: "▦",
  dashboard: "▤",
  pipeline: "⇢",
  topic: "≋",
  mlmodel: "◈",
  container: "▢",
  database: "◫",
  schema: "▥",
  generic: "●",
};

function entityGlyph(t?: LineageEntityType): string {
  return ENTITY_GLYPH[t ?? "generic"] ?? "●";
}

function LineageNodeImpl({ data, selected }: NodeProps<LineageNodeData>) {
  const {
    node,
    direction,
    highlighted,
    dimmed,
    onExpandUpstream,
    onExpandDownstream,
  } = data;
  const isSelected = !!selected || !!data.selected;
  const isDeleted = node.status === "deleted";
  const isDeprecated = node.status === "deprecated";

  const handleUpstream = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onExpandUpstream?.(node);
    },
    [onExpandUpstream, node]
  );
  const handleDownstream = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onExpandDownstream?.(node);
    },
    [onExpandDownstream, node]
  );

  const sourcePos = direction === "TB" ? Position.Bottom : Position.Right;
  const targetPos = direction === "TB" ? Position.Top : Position.Left;

  const classes = [
    "lg-node",
    `lg-node--${node.entityType ?? "generic"}`,
    isSelected ? "lg-node--selected" : "",
    highlighted ? "lg-node--highlighted" : "",
    dimmed ? "lg-node--dimmed" : "",
    isDeleted ? "lg-node--deleted" : "",
    isDeprecated ? "lg-node--deprecated" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} tabIndex={0} aria-label={`Entity ${node.name}`}>
      {/* Hidden React Flow handles — present even in canvas-edge mode so
          edit-mode connect interactions still work. */}
      <Handle type="target" position={targetPos} className="lg-node__handle" />
      <Handle type="source" position={sourcePos} className="lg-node__handle" />

      {node.hasUpstreamChildren && (
        <button
          type="button"
          className={`lg-node__expand lg-node__expand--upstream lg-node__expand--${direction}`}
          onClick={handleUpstream}
          aria-label={`Expand upstream lineage for ${node.name}`}
        >
          +
        </button>
      )}
      {node.hasDownstreamChildren && (
        <button
          type="button"
          className={`lg-node__expand lg-node__expand--downstream lg-node__expand--${direction}`}
          onClick={handleDownstream}
          aria-label={`Expand downstream lineage for ${node.name}`}
        >
          +
        </button>
      )}

      <div className="lg-node__row">
        <div
          className="lg-node__icon"
          aria-hidden="true"
          title={node.entityType ?? "entity"}
        >
          {entityGlyph(node.entityType)}
        </div>
        <div className="lg-node__body">
          <div className="lg-node__title" title={node.name}>
            {node.name}
          </div>
          {node.fullyQualifiedName && (
            <div className="lg-node__subtitle" title={node.fullyQualifiedName}>
              {node.fullyQualifiedName}
            </div>
          )}
        </div>
      </div>

      {(node.owner || node.tier || node.domain || node.status) && (
        <div className="lg-node__badges">
          {node.tier && <span className="lg-badge lg-badge--tier">{node.tier}</span>}
          {node.domain && (
            <span className="lg-badge lg-badge--domain">{node.domain}</span>
          )}
          {node.owner && (
            <span className="lg-badge lg-badge--owner">@{node.owner}</span>
          )}
          {isDeleted && (
            <span className="lg-badge lg-badge--deleted">Deleted</span>
          )}
          {isDeprecated && (
            <span className="lg-badge lg-badge--deprecated">Deprecated</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Custom equality: re-render only when data identity or selection flips.
 * React Flow passes a fresh `data` object on each store update, so we
 * compare the relevant fields directly.
 */
function areEqual(
  prev: NodeProps<LineageNodeData>,
  next: NodeProps<LineageNodeData>
): boolean {
  if (prev.selected !== next.selected) return false;
  const a = prev.data;
  const b = next.data;
  return (
    a.node === b.node &&
    a.direction === b.direction &&
    a.selected === b.selected &&
    a.highlighted === b.highlighted &&
    a.dimmed === b.dimmed &&
    a.onExpandUpstream === b.onExpandUpstream &&
    a.onExpandDownstream === b.onExpandDownstream
  );
}

export const LineageNodeView = memo(LineageNodeImpl, areEqual);
LineageNodeView.displayName = "LineageNodeView";
