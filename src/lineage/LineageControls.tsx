/**
 * Toolbar controls: layout direction, fit view, zoom, minimap toggle,
 * column-lineage toggle, edit-mode toggle.
 *
 * Pure presentational component; all state lives in LineageGraph.
 */

import React from "react";
import { useReactFlow } from "reactflow";
import type { LayoutDirection } from "./types";

export interface LineageControlsProps {
  direction: LayoutDirection;
  onDirectionChange: (d: LayoutDirection) => void;
  miniMapEnabled: boolean;
  onToggleMiniMap: () => void;
  columnLineageEnabled?: boolean;
  onToggleColumnLineage?: () => void;
  editModeEnabled?: boolean;
  onToggleEditMode?: () => void;
}

export function LineageControls({
  direction,
  onDirectionChange,
  miniMapEnabled,
  onToggleMiniMap,
  columnLineageEnabled,
  onToggleColumnLineage,
  editModeEnabled,
  onToggleEditMode,
}: LineageControlsProps) {
  const rf = useReactFlow();

  return (
    <div className="lg-controls" role="toolbar" aria-label="Lineage controls">
      <div className="lg-controls__group">
        <button
          type="button"
          className="lg-controls__btn"
          onClick={() => rf.zoomIn({ duration: 150 })}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="lg-controls__btn"
          onClick={() => rf.zoomOut({ duration: 150 })}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="lg-controls__btn"
          onClick={() => rf.fitView({ duration: 250, padding: 0.2 })}
          aria-label="Fit view"
          title="Fit view"
        >
          ⌂
        </button>
      </div>

      <div className="lg-controls__group">
        <button
          type="button"
          className={`lg-controls__btn ${direction === "LR" ? "is-active" : ""}`}
          onClick={() => onDirectionChange("LR")}
          aria-pressed={direction === "LR"}
          title="Left to right"
        >
          LR
        </button>
        <button
          type="button"
          className={`lg-controls__btn ${direction === "TB" ? "is-active" : ""}`}
          onClick={() => onDirectionChange("TB")}
          aria-pressed={direction === "TB"}
          title="Top to bottom"
        >
          TB
        </button>
      </div>

      <div className="lg-controls__group">
        <button
          type="button"
          className={`lg-controls__btn ${miniMapEnabled ? "is-active" : ""}`}
          onClick={onToggleMiniMap}
          aria-pressed={miniMapEnabled}
          title="Toggle minimap"
        >
          Map
        </button>
        {onToggleColumnLineage && (
          <button
            type="button"
            className={`lg-controls__btn ${columnLineageEnabled ? "is-active" : ""}`}
            onClick={onToggleColumnLineage}
            aria-pressed={!!columnLineageEnabled}
            title="Toggle column lineage"
          >
            Cols
          </button>
        )}
        {onToggleEditMode && (
          <button
            type="button"
            className={`lg-controls__btn ${editModeEnabled ? "is-active" : ""}`}
            onClick={onToggleEditMode}
            aria-pressed={!!editModeEnabled}
            title="Toggle edit mode"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}
