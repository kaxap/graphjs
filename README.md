# graph.js

> ⚠️ **Disclaimer — AI-generated code.** This entire library, demos,
> benchmarks, and README were produced by [Claude](https://claude.ai/)
> in a chat session with a human reviewer. The code has been exercised
> by a Playwright test suite on Chromium and WebKit, but it has not been
> audited line-by-line by a human, it has no production users, and the
> API may change. **Treat it as a starting point, not a finished product.**
> Read it, run the demos, copy what you need — don't drop it into
> production without your own review.

A general-purpose, dependency-free interactive graph component for static
HTML pages. Built around a `<canvas>` for edges and DOM elements for
nodes, with a small public API designed for embedding into any page.

![Lineage demo](demo/screenshots/chromium/01-initial.png)

*Screenshot: the lineage demo (`demo/index.html`) — a real-world use case
built on top of `graph.js` with a custom `renderNode` and `edgeStyle`.*

---

## Table of contents

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [Demos](#demos)
- [Public API](#public-api)
- [Customization recipes](#customization-recipes)
- [Performance characteristics](#performance-characteristics)
- [Browser support](#browser-support)
- [Project layout](#project-layout)
- [Running the tests](#running-the-tests)
- [Known limitations](#known-limitations)
- [License](#license)

---

## What you get

- **Two files**: `lib/graph.js` and `lib/graph.css`. No build step. No
  npm install. Drop them in next to your HTML and you have a graph.
- **Vanilla JS** — no React, no Vue, no Svelte. Plain UMD module that
  exports a `Graph` global (also works with CommonJS / AMD).
- **Canvas-rendered edges** for performance: even 3000 edges pan at
  60 fps because edges are drawn into a single `<canvas>` element
  rather than 3000 SVG paths in the DOM.
- **DOM-rendered nodes** so each card is a normal HTML element you can
  style with CSS, attach handlers to, and inspect with DevTools.
- **Auto layout** (hierarchical, LR or TB) out of the box, with hooks
  to swap in your own layout engine or static positions.
- **Built-in toolbar**, **expand buttons**, **minimap-style FPS readout**,
  **drag**, **pan**, **zoom**, **fit-view**, **selection**, **edge hover
  hit-testing**, and **destroy()** for clean teardown.
- **Customization hooks**: `renderNode`, `edgeStyle`, `addToolbarButton`,
  custom layout function, per-node `position`/`width`/`height`/`className`.

It is **not**:

- A force-directed layout. The built-in layout is hierarchical longest-
  path ranking. Bring your own algorithm via the `layout` option if you
  need something else.
- A full diagramming tool. There's no orthogonal routing, no port-based
  connections, no rich text inside nodes (use your own HTML).
- Production-tested. See the disclaimer at the top.

---

## Quick start

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="graph.css" />
  </head>
  <body>
    <div id="g" style="width: 100%; height: 600px;"></div>

    <script src="graph.js"></script>
    <script>
      new Graph(document.getElementById("g"), {
        nodes: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta"  },
          { id: "c", label: "Gamma" },
        ],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "b", target: "c" },
        ],
      });
    </script>
  </body>
</html>
```

That's the whole hello-world. You get auto-layout, pan, zoom, drag,
node selection, the toolbar, and the FPS-friendly canvas edge renderer.

---

## Demos

The repository ships with two runnable demos in [`demo/`](demo). Either
open the HTML files directly in your browser, or serve the folder:

```bash
cd demo
python3 -m http.server 8000
# open http://localhost:8000/
```

### 1. Lineage explorer — `demo/index.html`

A realistic use case modeled on data-lineage UIs (à la OpenMetadata).
Shows how to compose the library into something domain-specific.

![Lineage default layout](demo/screenshots/chromium/01-initial.png)

The lineage card design, entity icons, tier/domain/owner badges, and
deleted/deprecated states are entirely user-space — the library knows
nothing about them. They're produced by a `renderNode` callback in
[`demo/app.js`](demo/app.js):

```js
function renderLineageNode(node, el) {
  el.classList.add("lineage-card", "lineage-card--" + node.entity);
  el.innerHTML =
    '<div class="lineage-card__row">' +
      '<div class="lineage-card__icon">' + ENTITY_GLYPH[node.entity] + '</div>' +
      '<div class="lineage-card__title">' + node.name + '</div>' +
      // ...
    '</div>';
}

new Graph(container, { renderNode: renderLineageNode, /* ... */ });
```

#### Selection highlights neighbors

![Selected node with highlighted neighbors](demo/screenshots/chromium/03-selected.png)

When a node is selected, incident edges are stroked in the accent color
automatically — no extra code from the consumer. The dimming of other
nodes and the blue ring on the selected card come from CSS classes the
library applies (`is-selected`, `is-dimmed`, `is-highlighted`).

#### Top-to-bottom layout

Click the **TB** button or call `graph.setDirection("TB")`:

![TB layout](demo/screenshots/chromium/03-tb.png)

#### Column-lineage toggle (custom toolbar button)

The "Cols" button is **not** a library feature — it's added at runtime
by the consumer with `addToolbarButton`:

```js
graph.addToolbarButton({
  id: "cols", label: "Cols", title: "Toggle column lineage",
  onClick: (g) => { showColumns = !showColumns; g.setEdges(visibleEdges()); },
  pressed: () => showColumns,
}, { newGroup: true });
```

![Column lineage enabled](demo/screenshots/chromium/04-columns.png)

#### Drag

Pointer-event-based dragging works on touch, trackpad, and mouse. The
dragged card and its incident edges follow the cursor; everything else
stays put (and is composited via a cached bitmap snapshot — see the
[performance section](#performance-characteristics)).

![After dragging fct_orders](demo/screenshots/chromium/05-dragged.png)

#### Expand callbacks

The `+` buttons on the side of each card are opt-in via the `expandable`
option. When clicked, they fire `onExpand(node, "up" | "down")` and the
consumer decides what to do — typically fetch more nodes from a server
and add them with `graph.addNode` / `graph.addEdge`.

![After expanding upstream](demo/screenshots/chromium/05-expanded.png)

### 2. Kazakh tribes — `demo/tribes.html`

A bipartite graph showing how Kazakh tribes connect through paternal
Y-DNA haplogroups. Data is from the Wikipedia article
[*Y-DNA haplogroups in Kazakh tribes*](https://en.wikipedia.org/wiki/Y-DNA_haplogroups_in_Kazakh_tribes).

![Kazakh tribes ↔ haplogroups](demo/screenshots/chromium/tribes-01.png)

The same library, no new features needed — just different data and a
different `renderNode`. Tribes (left column) are color-coded by **zhuz**
(tribal union: Senior / Middle / Junior); haplogroups (right column) are
color-coded by haplogroup family (C, G, J, N, Q, R). Edge thickness
scales with frequency (∝ √percentage), and edge color matches the
haplogroup family so visually you can trace where each tribe's
dominant paternal lineage comes from.

Click a tribe or a haplogroup to see its detailed breakdown:

![Naiman selected — 77 % C2b1a2](demo/screenshots/chromium/tribes-02-naiman.png)

Selecting **Naiman** lights up the C2b1a2 ("C2-M48") link in heavy red:
77 % of Naiman males carry that lineage — strong evidence of a single
founding paternal ancestor. Compare to the more cosmopolitan **Uysun**
(50 % C2*, 14 % J2a1a, 12 % J1*, 11 % C2b1a2), whose paternal ancestry
draws from both the Steppe (C lineages) and the Near East / Caucasus
(J lineages).

The custom toolbar adds `All / ≥ 5 % / ≥ 10 % / ≥ 25 %` filters so you
can isolate the strongest associations. At the 25 % cutoff, the graph
becomes a clean picture of founder lineages:

![Threshold ≥ 25 %](demo/screenshots/chromium/tribes-04-th25.png)

You can see:
- **C2-M48 (C2b1a2)** dominates Naiman, Alimuly, Baiuly — supporting
  the traditional Alau-descendant claim for the Junior Zhuz.
- **G1** is the founder lineage of Argyn (67 %) — unusual for a Turkic
  group, hinting at a Caucasus / West-Asian origin.
- **C2-M407 (C2c1a1a1)** is essentially a Konyrat-only lineage (86 %).
- **N1a1a** points to Uralic / Siberian ancestry, concentrated in Uaq
  (64 %) and Zhalayir (22 %).
- **Q*** is the dominant Qangly haplogroup (48 %), characteristic of
  Inner-Asian / Siberian populations.

It's a good showcase for how the same library renders three completely
different kinds of graphs (process lineage, stress test, bipartite
genetic relationships) with only a `renderNode` and `edgeStyle` change.

### 3. Stress test — `demo/large.html`

The same library, now with **1000 nodes and 3000 edges** in a 10-layer
DAG, generated procedurally:

![1000-node stress test](demo/screenshots/chromium/stress-01-fit.png)

The colored vertical bars on the left of each card are layer indicators
(blue → purple). The FPS readout in the top-right corner stays at
vsync during pan, zoom, and drag. See `demo/large.js` for the procedural
generator (it uses a seeded PRNG so the graph is identical across
reloads).

Top-to-bottom view of the same graph:

![Stress test TB](demo/screenshots/chromium/stress-03-tb.png)

---

## Public API

### Constructor

```js
const graph = new Graph(container, options);
```

`container` is any HTML element. The library will populate it with the
graph canvas, node DOM, and toolbar. CSS sets `position: relative` on
the container so make sure it has a size (`width`, `height`).

`options` (all optional):

| Option | Type | Default | Description |
|---|---|---|---|
| `nodes` | `Array<Node>` | `[]` | Initial node data. See [Node shape](#node-shape). |
| `edges` | `Array<Edge>` | `[]` | Initial edges. See [Edge shape](#edge-shape). |
| `direction` | `"LR" \| "TB"` | `"LR"` | Initial layout axis. |
| `layout` | `"auto" \| Function` | `"auto"` | `"auto"` uses the built-in hierarchical layout. Pass a function to override — see [Custom layout](#custom-layout). |
| `nodeWidth` | `number` | `200` | Default card width in graph px. |
| `nodeHeight` | `number` | `60` | Default card height. |
| `rankSeparation` | `number` | `100` | Distance between layers. |
| `nodeSeparation` | `number` | `28` | Distance between nodes within a layer. |
| `renderNode` | `Function` | `null` | `(node, element, graph) => void`. Fill the outer `.gv-node` element however you like. If omitted, a default renderer shows `node.label`. |
| `edgeStyle` | `Function` | `null` | `(edge, state) => { stroke, width, dash?, arrow? }`. `state` is `"base" \| "neighbor" \| "hover" \| "selected"`. Return `null` from a state to use the default highlight behavior. |
| `showToolbar` | `boolean` | `true` | Show the floating toolbar. |
| `toolbarButtons` | `Array \| null` | `null` (defaults) | Replace the default toolbar entirely. See [Custom toolbar](#custom-toolbar). |
| `expandable` | `boolean \| object \| Function` | `false` | Show `+` buttons on each node. `true` = both sides, `{ up: true }` = only upstream, or `(node) => ({ up, down })` for per-node control. |
| `draggable` | `boolean` | `true` | Allow nodes to be dragged. |
| `selectable` | `boolean` | `true` | Single-click selects a node/edge. |
| `minZoom` | `number` | `0.2` | Zoom-out limit. |
| `maxZoom` | `number` | `2.5` | Zoom-in limit. |
| `fitPadding` | `number` | `40` | Padding (in graph px) used by `fitView()`. |
| `hitTolerancePx` | `number` | `6` | Edge hover/click pixel-tolerance (in screen pixels). |
| `onNodeClick` | `Function` | `null` | `(node, event) => void`. |
| `onEdgeClick` | `Function` | `null` | `(edge, event) => void`. |
| `onEdgeHover` | `Function` | `null` | `(edge \| null) => void`. Fires when the hovered edge changes; cheap to subscribe to. |
| `onExpand` | `Function` | `null` | `(node, direction) => void`. `direction` is `"up"` or `"down"`. |
| `onNodeDrag` | `Function` | `null` | `(node, { x, y }) => void`. Fires per animation frame during drag, not per pointer event. |
| `onNodeDragEnd` | `Function` | `null` | `(node, { x, y }) => void`. |
| `onPaneClick` | `Function` | `null` | `(event) => void`. Click on empty pane. |
| `onSelectionChange` | `Function` | `null` | `({ nodeId, edgeId }) => void`. |

### Node shape

```ts
interface Node {
  id: string;                  // required, must be unique
  label?: string;              // shown by default renderer
  className?: string;          // added to the .gv-node element
  position?: { x: number, y: number }; // override auto-layout for this node
  width?: number;              // override default node width
  height?: number;             // override default node height
  // …any other fields you put here are passed through to renderNode
  //   and to callbacks (onNodeClick, onExpand, etc.)
}
```

### Edge shape

```ts
interface Edge {
  id: string;                  // required, must be unique
  source: string;              // source node id
  target: string;              // target node id
  // …any other fields you put here are passed through to edgeStyle
  //   and to callbacks (onEdgeClick, onEdgeHover)
}
```

### Instance methods

| Method | Returns | Description |
|---|---|---|
| `setNodes(nodes)` | `void` | Replace the node array. |
| `setEdges(edges)` | `void` | Replace the edge array. |
| `setData(nodes, edges)` | `void` | Replace both atomically. |
| `addNode(node)` | `void` | Append one node and rerender. |
| `addEdge(edge)` | `void` | Append one edge and rerender. |
| `removeNode(id)` | `void` | Remove a node and all its incident edges. |
| `removeEdge(id)` | `void` | Remove one edge by id. |
| `updateNode(id, patch)` | `void` | Shallow-merge `patch` into the node; re-runs `renderNode` for that one card. |
| `setDirection("LR"\|"TB")` | `void` | Re-layout with a new axis. |
| `getDirection()` | `"LR"\|"TB"` | Current layout axis. |
| `selectNode(id \| null)` | `void` | Programmatic selection; fires `onSelectionChange`. |
| `selectEdge(id \| null)` | `void` | Same for edges. |
| `getSelection()` | `{nodeId, edgeId}` | Current selection. |
| `zoomIn()` / `zoomOut()` | `void` | Step zoom by 1.2×. |
| `fitView()` | `void` | Fit all nodes in the viewport with `fitPadding`. |
| `getViewport()` | `{x, y, zoom}` | Current pan/zoom. |
| `setViewport({x?, y?, zoom?})` | `void` | Set pan/zoom (partial OK). |
| `getNodePosition(id)` | `{x, y} \| null` | Current laid-out position for a node. |
| `addToolbarButton(spec, options?)` | `HTMLButtonElement` | Append a button to the toolbar after init. See [Custom toolbar](#custom-toolbar). |
| `destroy()` | `void` | Tear down all DOM and event listeners; the container is restored. |

---

## Customization recipes

### Custom `renderNode`

`renderNode` receives the outer `.gv-node` element — fill it however you
want. The library will append the `+` expand buttons after your code
runs, so don't worry about clobbering them with `innerHTML`.

```js
new Graph(container, {
  nodes: [{ id: "u1", name: "Alice", role: "admin", avatar: "/a.png" }],
  edges: [],
  renderNode: (node, el) => {
    el.classList.add("user-card");
    el.innerHTML = `
      <img class="user-card__avatar" src="${node.avatar}">
      <div class="user-card__name">${node.name}</div>
      <div class="user-card__role">${node.role}</div>
    `;
  },
});
```

Then style `.user-card` in your own CSS. The library only owns
`.gv-node`, `.gv-node__label`, `.gv-node__body`, and `.gv-node__expand`.

### Custom `edgeStyle`

Return a style object per edge. The library applies `"hover"`,
`"selected"`, and `"neighbor"` highlight states automatically; override
those states explicitly if you want a non-default look.

```js
new Graph(container, {
  edgeStyle: (edge, state) => {
    if (edge.kind === "deleted")
      return { stroke: "#cbd5e1", width: 1, dash: [4, 4], arrow: false };
    if (edge.kind === "async")
      return { stroke: "#a78bfa", width: 1.2, dash: [3, 3], arrow: true };
    // returning null/undefined falls back to the default base style
    //   (gray, width 1.5, arrow on)
    return null;
  },
});
```

The returned object can include:
- `stroke` (CSS color)
- `width` (px in graph coords)
- `dash` (array, e.g. `[4, 4]`)
- `arrow` (boolean)

### Custom toolbar

Either replace the toolbar wholesale via the `toolbarButtons` option, or
append to it at runtime with `addToolbarButton`.

```js
graph.addToolbarButton({
  id: "snap",
  label: "📸",
  title: "Export PNG",
  onClick: (g) => {
    const url = document.querySelector(".gv__canvas").toDataURL();
    const a = document.createElement("a");
    a.href = url; a.download = "graph.png"; a.click();
  },
  // Optional: pressed(g) -> boolean controls the .is-active visual state.
});
```

Button spec:

```ts
interface ToolbarButton {
  id?: string;        // becomes data-id on the <button>
  label: string;      // text content (or emoji / symbol)
  title?: string;     // tooltip
  onClick: (g) => void;
  pressed?: (g) => boolean;  // optional toggle state
  separator?: boolean;       // start a new visual group (no other fields)
}
```

### Custom layout

If you have a graph layout library you already like (Dagre, ELK,
graphology layouts, hand-tuned coordinates), pass it in:

```js
new Graph(container, {
  layout: (nodes, edges, opts) => {
    // opts: { direction, nodeWidth, nodeHeight, rankSeparation, nodeSeparation }
    const positions = {};
    for (const n of nodes) {
      positions[n.id] = { x: ..., y: ..., w: opts.nodeWidth, h: opts.nodeHeight };
    }
    return { positions, width: ..., height: ... };
  },
});
```

Or skip layout entirely by giving each node a `position`:

```js
new Graph(container, {
  nodes: [
    { id: "a", label: "A", position: { x: 100, y: 100 } },
    { id: "b", label: "B", position: { x: 300, y: 200 } },
  ],
  edges: [{ id: "e", source: "a", target: "b" }],
});
```

Static positions still go through the auto-layout pipeline, but
`position` overrides the result per node.

### Async/remote expansion

```js
new Graph(container, {
  expandable: true,
  onExpand: async (node, direction) => {
    const more = await fetch(`/api/lineage/${node.id}?dir=${direction}`).then(r => r.json());
    for (const n of more.nodes) graph.addNode(n);
    for (const e of more.edges) graph.addEdge(e);
  },
});
```

### Theming with CSS variables

All colors are exposed as CSS variables on `.gv`. Override on any
ancestor:

```css
.gv {
  --gv-bg: #0f172a;
  --gv-grid: #1e293b;
  --gv-surface: #1e293b;
  --gv-border: #334155;
  --gv-text: #e2e8f0;
  --gv-muted: #94a3b8;
  --gv-accent: #38bdf8;
  --gv-accent-soft: #075985;
  --gv-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3);
}
```

---

## Performance characteristics

This was a deliberate optimization target. The library is designed to
stay at 60 fps on graphs in the **low thousands of edges**.

### Architecture in one paragraph

Nodes are DOM elements (so you can put real HTML in them). Edges are
drawn into a `<canvas>` element behind the node layer — *not* as
individual SVG paths in the DOM. Hover/click on edges is implemented
by hit-testing pointer events against cached edge geometry, since
canvas pixels don't dispatch events.

### Optimizations layered in

1. **Canvas rendering of edges** instead of SVG/DOM. A single
   `ctx.stroke()` paints all edges with the same style.
2. **Batched paths by style** — edges with the same stroke color, width
   and dash are accumulated into a single `Path2D` and stroked once.
3. **`Path2D` cache** invalidated only on geometry change. Pan and zoom
   don't rebuild paths at all — they just stroke the cached `Path2D`
   with a new viewport transform.
4. **Static/dynamic split during drag** — at the start of a drag the
   ~6 edges incident to the dragged node are pulled out into a separate
   "dynamic" `Path2D`. The static `Path2D` (the other ~2994 edges) is
   built once and never re-built during drag.
5. **Bitmap snapshot of the static layer** — for engines that
   re-tessellate on every `ctx.stroke(Path2D)` (notably WebKit), we
   render the static layer once into an `OffscreenCanvas`, transfer it
   to an `ImageBitmap`, and `drawImage()` that bitmap every drag frame.
   That's a single GPU texture sample, not a path stroke.
6. **rAF-coalesced `pointermove`** — trackpads fire `pointermove` at
   100+ Hz. The handler just stashes the latest position; the actual
   work (position update, edge geometry rebuild) runs at vsync rate.
7. **`transform: translate(…)` + `will-change: transform`** on the
   dragged card — composited move, no layer repaint.
8. **DOM node diffing** — `_renderNodes` keeps a map of `id -> element`
   and reuses existing cards across relayouts. A direction toggle (LR ↔
   TB) on 1000 nodes is ~8 ms because it only updates `left/top` on
   existing elements instead of recreating them.
9. **16-sample bezier** instead of 24 — visually indistinguishable at
   any zoom but 33 % less stroke geometry.

### Measured numbers (1000 nodes, 3000 edges, headless)

```
engine      metric                  optimized      naive    speedup
-------------------------------------------------------------------
chromium    pan/zoom (one frame)     0.004 ms    1.328 ms    332x
chromium    drag step (one frame)    0.018 ms    1.070 ms     59x
chromium    drag end-to-end (20 mv)  35.1 ms     —          569 fps
webkit      pan/zoom (one frame)     1.760 ms    2.780 ms    1.6x
webkit      drag step (one frame)    0.020 ms    2.860 ms   143x
webkit      drag end-to-end (20 mv)  136.4 ms    —          147 fps
```

Run the bench yourself: `python3 demo/bench.py`.

The "drag end-to-end" measurement includes the full pipeline —
synthesized `pointerdown` + 20 `pointermove`s + `pointerup`, with a
double `requestAnimationFrame` flush before stopping the clock. It's
the closest synthetic approximation of a real human drag.

---

## Browser support

Tested in headless **Chromium** and headless **WebKit** via Playwright
(see [Running the tests](#running-the-tests)).

Used features:

- `PointerEvent` + `setPointerCapture` — Safari 13+, Chrome 55+, Firefox 59+.
- `ResizeObserver` — Safari 13.1+, Chrome 64+, Firefox 69+.
- `Path2D` — all modern browsers.
- `OffscreenCanvas` (with synchronous fallback to a hidden `<canvas>`) —
  Safari 16.4+, Chrome 69+, Firefox 105+.
- `transferToImageBitmap` (used opportunistically; falls back if absent).
- CSS `will-change` — all modern browsers.

No IE support. No transpilation. If you need to support older browsers,
run the file through Babel or transpile your own copy.

---

## Project layout

```
lib/                  Canonical library source.
  graph.js              Single-file UMD library (~1000 lines).
  graph.css             Scoped styles under .gv.
demo/                 Runnable demos. Library files are copied here
                      so the demo is self-contained (no `../lib/` path).
  index.html            Lineage explorer demo.
  app.js                Mock data + customization callbacks.
  styles.css            Page chrome + lineage-card theming.
  tribes.html           Bipartite demo: Kazakh tribes ↔ Y-DNA haplogroups.
  tribes.js             Data + bipartite renderNode/edgeStyle.
  large.html            1000-node stress demo.
  large.js              Procedural graph generator.
  graph.js, graph.css   Copies of lib/. Refresh with `cp lib/graph.* demo/`.
  assess.py             Playwright assessment / regression tests.
  bench.py              Microbenchmark vs naive implementation.
README.md             You are here.
```

The legacy [`src/lineage/`](src/lineage) folder contains a React +
React Flow version of an earlier prototype (different code path, not
used by the vanilla library — kept for reference).

---

## Running the tests

The Playwright suite verifies functional correctness on both Chromium
and WebKit and produces screenshot artifacts.

```bash
pip3 install playwright
python3 -m playwright install chromium webkit

# Full suite (lineage + stress, both engines):
python3 demo/assess.py

# Just one engine:
python3 demo/assess.py chromium
python3 demo/assess.py webkit

# Just the 1000-node stress tests:
python3 demo/assess.py --stress-only

# Microbenchmark (optimized vs naive):
python3 demo/bench.py
```

Screenshots end up in `demo/screenshots/<engine>/`.

A passing run looks like:

```
=========================  CHROMIUM  =========================
30/30 checks passed
=========================  CHROMIUM — STRESS  =========================
14/14 checks passed
=========================  WEBKIT  =========================
30/30 checks passed
=========================  WEBKIT — STRESS  =========================
14/14 checks passed
```

The tests exercise: library surface (no lineage-specific identifiers
leak from the library), default rendering, all customization hooks,
selection, drag (real mouse events through Playwright), expand
callbacks, pan, zoom, fit-view, direction toggle, column-lineage
toggle, `destroy()` cleanup, and per-node `position` overrides.

---

## Known limitations

- **Layout** is hierarchical longest-path only. No force-directed, no
  orthogonal routing, no compound nodes. Bring your own via `layout`.
- **Edge routing** is a cubic bezier between source/target anchors.
  Edges can overlap nodes if your layout puts a node directly between
  the endpoints.
- **Column lineage** in the demo is purely a CSS/data thing — the
  library has no native concept of port-level connections.
- **Edit mode / connect-to-create** is not implemented. The lineage
  demo doesn't include this; if you need it, the `onConnect` callback
  isn't wired up.
- **Touch gestures**: pinch-zoom is not implemented. Single-finger pan
  and drag work via PointerEvents.
- **Accessibility**: nodes are focusable and have `tabIndex={0}`, but
  there's no keyboard navigation between nodes and no screen-reader
  semantics beyond the labels you put in `renderNode`.
- **No undo/redo, no copy/paste, no clipboard.**

See the [disclaimer at the top](#graphjs) for the bigger picture.

---

## License

This code was generated by Claude. I (the human in the loop) have no
particular claim over it; treat it as MIT-licensed for any purpose,
without warranty.
