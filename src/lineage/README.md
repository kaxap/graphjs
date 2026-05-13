# LineageGraph

A reusable, OpenMetadata-style lineage graph for React. Renders nodes via
React Flow (pan/zoom/drag/select/minimap) and edges via a custom `<canvas>`
layer for large-graph performance.

```tsx
import { LineageGraph } from "./lineage";

<LineageGraph nodes={nodes} edges={edges} layoutDirection="LR" enableCanvasEdges />
```

See `ExampleUsage.tsx` for a runnable demo.

## Files

| File                       | Role                                             |
| -------------------------- | ------------------------------------------------ |
| `types.ts`                 | Public types (`LineageNode`, `LineageEdge`, …)   |
| `layout.ts`                | Dagre-based auto-layout                          |
| `edgeGeometry.ts`          | Anchor/bezier math + edge hit testing            |
| `LineageGraph.tsx`         | Top-level component                              |
| `LineageNode.tsx`          | Memoized custom React Flow node                  |
| `CanvasEdgeLayer.tsx`      | Canvas-based edge renderer                       |
| `EdgeInteractionOverlay.tsx` | Hit-tests pane events against cached edge paths |
| `LineageControls.tsx`      | Toolbar: zoom/fit/direction/minimap/columns/edit |
| `lineageGraph.css`         | Themable styles (CSS variables)                  |
| `ExampleUsage.tsx`         | Mock data + runnable demo                        |

## Adding a custom node type

1. Add a new value to `LineageEntityType` in `types.ts`.
2. Add a glyph entry in `ENTITY_GLYPH` (`LineageNode.tsx`).
3. Add a `.lg-node--yourtype .lg-node__icon` rule in `lineageGraph.css`.

For a structurally different node (e.g. with inline column rows), register
an additional React Flow node type:

```ts
const NODE_TYPES = { lineage: LineageNodeView, columnar: ColumnarNodeView };
```

…and set `node.type` on the corresponding `LineageNode`s. The component
falls back to the `lineage` type otherwise.

## Adding a custom edge style

Edge styles live in `edgeStyleFor()` (`CanvasEdgeLayer.tsx`). Add a new
branch keyed on `edge.type` (extending `LineageEdgeKind` first), or
branch on `edge.metadata` for ad-hoc styling. Each style declares
`{ stroke, width, dash?, arrow }` — the canvas renderer handles the rest.

For the React Flow SVG fallback path (`enableCanvasEdges={false}`),
selectors are `.lg-rf-edge--<kind>` in `lineageGraph.css`.

## Loading lineage remotely

The component is fully controlled: lift `nodes` and `edges` into your
own store and update them when the user expands a node.

```tsx
const handleExpandUpstream = async (n: LineageNode) => {
  const { nodes: more, edges: moreEdges } = await api.upstream(n.id);
  setNodes(prev => mergeById(prev, more));
  setEdges(prev => mergeById(prev, moreEdges));
};
```

Set `hasUpstreamChildren` / `hasDownstreamChildren` on the leaves to
surface the `+` expand buttons. Use the `loading` / `error` props to
render the matching state while a fetch is in flight (the example
toggles them in `ExampleUsage`).

## Enabling/disabling column lineage

Column lineage is fully modular:

- Pass `enableColumnLineage` to set the initial toggle state.
- Edges with `type: "columnLineage"` are filtered out of layout and
  rendering when the toolbar toggle is off.
- In edit mode, selecting a column-lineage edge surfaces an `×` button
  in the overlay so users can remove it.

If you do not need column lineage at all, simply omit those edges — the
toggle stays inert.

## How canvas edge hit testing works

1. `CanvasEdgeLayer` computes sampled bezier points for each edge in
   *graph coordinates* and stores them in a shared `Map` keyed by edge id.
2. `EdgeInteractionOverlay` attaches `mousemove` / `mouseleave` / `click`
   listeners to the `.react-flow__pane` element (the canvas itself has
   `pointer-events: none`).
3. On each event, the pointer is projected from client coords to graph
   coords via React Flow's `useReactFlow().project(...)`.
4. We loop edges, do a cheap bbox reject, then point-to-segment distance
   testing against the sampled path. Tolerance is `hitTolerancePx / zoom`
   so the click target stays roughly constant on screen.
5. State updates only happen when the hovered edge id actually *changes*
   — `mousemove` does not trigger a React render otherwise.

## Performance notes

- `nodeTypes` and `EMPTY_EDGE_TYPES` are module-level constants — passing
  fresh objects to `<ReactFlow>` is the most common cause of node
  thrashing.
- `LineageNodeView` has a custom equality function; node props only break
  the memo when the underlying `LineageNode` reference changes.
- Layout is memoized on (`nodes`, `visibleEdges`, layout options). Pan
  and zoom do not recompute layout or geometry.
- Edge geometry rebuilds only when topology / direction / node size
  changes (including drags — React Flow's `nodeInternals` store).
- During pan/zoom only the canvas redraws; React Flow nodes update via
  their own transform.
- Edges outside the visible graph rect are culled in `draw()`.
- Arrowheads are dropped at low zoom (`zoom < 0.4`).

## Accessibility

- Each node is `tabIndex={0}` with an `aria-label` and a visible focus
  ring (`.lg-node:focus-visible`).
- Expand buttons have descriptive `aria-label`s.
- Toolbar buttons expose `aria-pressed` for toggle states.
- Selected and highlighted states are distinguishable from hover both by
  color and by border weight.
