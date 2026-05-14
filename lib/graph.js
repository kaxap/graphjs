/*!
 * graph.js — general-purpose interactive graph for static HTML pages.
 *
 * Renders an arbitrary directed graph with:
 *   - Auto layout (hierarchical, LR/TB) or user-supplied positions
 *   - Canvas-drawn edges for performance
 *   - Pan, zoom, fit-view
 *   - Node selection, drag, hover
 *   - Edge hover + click hit-testing
 *   - Optional expand (+) buttons on nodes
 *   - Configurable toolbar
 *
 * Nodes and edges are opaque data objects — only `id` (and `source`/`target`
 * for edges) is required. Everything else is up to the consumer; pass a
 * `renderNode` to control the card contents, and an `edgeStyle` to control
 * each edge's appearance.
 *
 * Usage:
 *   <link rel="stylesheet" href="graph.css">
 *   <script src="graph.js"></script>
 *   <script>
 *     const g = new Graph(document.getElementById('container'), {
 *       nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
 *       edges: [{ id: 'e1', source: 'a', target: 'b' }],
 *     });
 *   </script>
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.Graph = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- Defaults --------------------------------------------------

  var DEFAULT_TOOLBAR = [
    { id: "zoom-in",  label: "+", title: "Zoom in",  onClick: function (g) { g.zoomIn(); } },
    { id: "zoom-out", label: "−", title: "Zoom out", onClick: function (g) { g.zoomOut(); } },
    { id: "fit",      label: "⌂", title: "Fit view", onClick: function (g) { g.fitView(); } },
    { separator: true },
    { id: "dir-lr", label: "LR", title: "Left to right", onClick: function (g) { g.setDirection("LR"); }, pressed: function (g) { return g.getDirection() === "LR"; } },
    { id: "dir-tb", label: "TB", title: "Top to bottom", onClick: function (g) { g.setDirection("TB"); }, pressed: function (g) { return g.getDirection() === "TB"; } },
  ];

  var DEFAULTS = {
    nodes: [],
    edges: [],

    // Layout
    direction: "LR",          // "LR" | "TB"
    layout: "auto",           // "auto" or function(nodes, edges, opts) -> { positions, width, height }
    nodeWidth: 200,
    nodeHeight: 60,
    rankSeparation: 100,
    nodeSeparation: 28,

    // Rendering hooks
    renderNode: null,         // function(node, element) — fill the element
    edgeStyle: null,          // function(edge, state) — returns { stroke, width, dash, arrow }

    // Features
    showToolbar: true,
    toolbarButtons: null,     // null = DEFAULT_TOOLBAR
    expandable: false,        // bool | function(node) -> { up?: bool, down?: bool }
    draggable: true,
    selectable: true,

    // Viewport
    minZoom: 0.2,
    maxZoom: 2.5,
    fitPadding: 40,
    hitTolerancePx: 6,

    // Callbacks
    onNodeClick: null,
    onEdgeClick: null,
    onEdgeHover: null,
    onExpand: null,           // function(node, direction "up"|"down")
    onNodeDrag: null,         // function(node, { x, y })
    onNodeDragEnd: null,
    onPaneClick: null,
    onSelectionChange: null,  // function({ nodeId, edgeId })
  };

  // ---------- Layout: longest-path rank + simple barycenter ordering ----

  function hierarchicalLayout(nodes, edges, opts) {
    var dir = opts.direction;
    var NW = opts.nodeWidth, NH = opts.nodeHeight;
    var RS = opts.rankSeparation, NS = opts.nodeSeparation;

    var incoming = {}, outgoing = {};
    nodes.forEach(function (n) { incoming[n.id] = []; outgoing[n.id] = []; });
    edges.forEach(function (e) {
      if (incoming[e.target]) incoming[e.target].push(e.source);
      if (outgoing[e.source]) outgoing[e.source].push(e.target);
    });

    var rank = {};
    function rankOf(id, seen) {
      if (rank[id] != null) return rank[id];
      seen = seen || {};
      if (seen[id]) return 0;
      seen[id] = true;
      var ins = incoming[id] || [];
      var r = ins.length === 0
        ? 0
        : Math.max.apply(null, ins.map(function (s) { return rankOf(s, seen); })) + 1;
      rank[id] = r;
      return r;
    }
    nodes.forEach(function (n) { rankOf(n.id); });

    var ranks = {};
    nodes.forEach(function (n) { (ranks[rank[n.id]] = ranks[rank[n.id]] || []).push(n); });

    var positions = {};
    var maxX = 0, maxY = 0;
    Object.keys(ranks).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (r) {
        var bucket = ranks[r].slice();
        bucket.sort(function (a, b) {
          var an = (incoming[a.id] || []).concat(outgoing[a.id] || []);
          var bn = (incoming[b.id] || []).concat(outgoing[b.id] || []);
          var aa = an.length ? an.reduce(function (s, id) { return s + (rank[id] || 0); }, 0) / an.length : 0;
          var bb = bn.length ? bn.reduce(function (s, id) { return s + (rank[id] || 0); }, 0) / bn.length : 0;
          return aa - bb;
        });
        bucket.forEach(function (n, i) {
          var w = n.width || NW, h = n.height || NH;
          var x, y;
          if (dir === "LR") { x = 40 + r * (NW + RS); y = 40 + i * (NH + NS); }
          else              { x = 40 + i * (NW + NS); y = 40 + r * (NH + RS); }
          positions[n.id] = { x: x, y: y, w: w, h: h };
          if (x + w > maxX) maxX = x + w;
          if (y + h > maxY) maxY = y + h;
        });
      });

    return { positions: positions, width: maxX, height: maxY };
  }

  // ---------- Edge geometry ---------------------------------------------

  function anchors(s, t, dir) {
    if (dir === "TB") {
      return { a: { x: s.x + s.w / 2, y: s.y + s.h }, b: { x: t.x + t.w / 2, y: t.y } };
    }
    return { a: { x: s.x + s.w, y: s.y + s.h / 2 }, b: { x: t.x, y: t.y + t.h / 2 } };
  }
  // For "backward" edges (target sits behind source in the flow axis —
  // common when using static positions or in conflict-style graphs with
  // bidirectional relationships), anchor on the perpendicular side of
  // both nodes so the curve arcs cleanly OVER (LR) or BESIDE (TB) them
  // rather than looping through off-screen control points.
  function anchorsBackward(s, t, dir) {
    if (dir === "TB") {
      // Arc to the left side
      return { a: { x: s.x, y: s.y + s.h / 2 }, b: { x: t.x, y: t.y + t.h / 2 } };
    }
    // LR — top of both
    return { a: { x: s.x + s.w / 2, y: s.y }, b: { x: t.x + t.w / 2, y: t.y } };
  }
  function isBackward(s, t, dir) {
    if (dir === "TB") return (t.y + t.h / 2) < (s.y + s.h / 2) - 10;
    return (t.x + t.w / 2) < (s.x + s.w / 2) - 10;
  }
  function sampleBezier(a, b, dir, samples, backward) {
    // 16 samples produces a curve visually indistinguishable from 24 at any
    // reasonable zoom but cuts stroke geometry by 33% — meaningful on engines
    // (notably WebKit) where ctx.stroke time is dominated by segment count.
    samples = samples || 16;
    var dx = b.x - a.x, dy = b.y - a.y, c1, c2;
    if (backward) {
      // Arc routing: keep control points on the SAME side as the anchors
      // (top side for LR, left side for TB) and offset along the
      // perpendicular axis so the curve arcs cleanly above/beside the
      // nodes between source and target.
      if (dir === "TB") {
        var arcv = Math.max(80, (Math.abs(dy) + 80) * 0.35);
        c1 = { x: a.x - arcv, y: a.y }; c2 = { x: b.x - arcv, y: b.y };
      } else {
        var arch = Math.max(80, (Math.abs(dx) + 80) * 0.35);
        c1 = { x: a.x, y: a.y - arch }; c2 = { x: b.x, y: b.y - arch };
      }
    } else if (dir === "TB") {
      var off = Math.max(40, Math.abs(dy) * 0.4);
      c1 = { x: a.x, y: a.y + off }; c2 = { x: b.x, y: b.y - off };
    } else {
      var offh = Math.max(40, Math.abs(dx) * 0.4);
      c1 = { x: a.x + offh, y: a.y }; c2 = { x: b.x - offh, y: b.y };
    }
    var pts = new Array(samples + 1);
    for (var i = 0; i <= samples; i++) {
      var u = i / samples, v = 1 - u;
      var b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      pts[i] = {
        x: b0 * a.x + b1 * c1.x + b2 * c2.x + b3 * b.x,
        y: b0 * a.y + b1 * c1.y + b2 * c2.y + b3 * b.y,
      };
    }
    return pts;
  }
  function distSqSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    var t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var cx = ax + t * dx, cy = ay + t * dy;
    return (px - cx) * (px - cx) + (py - cy) * (py - cy);
  }

  // ---------- Helpers ---------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function defaultEdgeStyle(edge) {
    return { stroke: "#94a3b8", width: 1.5, arrow: true };
  }

  function applyEdgeState(base, state) {
    if (!state || state === "base") return base;
    var out = { stroke: base.stroke, width: base.width, dash: base.dash, arrow: base.arrow };
    if (state === "neighbor") { out.stroke = "#3b82f6"; out.width = Math.max(base.width, 2); }
    else if (state === "hover") { out.stroke = "#3b82f6"; out.width = Math.max(base.width, 2.25); }
    else if (state === "selected") { out.stroke = "#2563eb"; out.width = Math.max(base.width, 2.5); }
    return out;
  }

  // ---------- Graph class -----------------------------------------------

  function Graph(container, options) {
    if (!(this instanceof Graph)) return new Graph(container, options);
    if (!container) throw new Error("Graph: container element is required");

    var opts = {};
    for (var k in DEFAULTS) opts[k] = DEFAULTS[k];
    if (options) for (var k2 in options) opts[k2] = options[k2];

    this.options = opts;
    this.container = container;
    this.nodes = (opts.nodes || []).slice();
    this.edges = (opts.edges || []).slice();

    this._state = {
      dir: opts.direction,
      viewport: { x: 0, y: 0, k: 1 },
      positions: {},
      geometry: {},
      hoveredEdge: null,
      selectedNode: null,
      selectedEdge: null,
      paneDrag: null,
      nodeDrag: null,
      suppressNextClick: false,
      rafScheduled: false,
      destroyed: false,
      // Path2D cache. byStyle[styleKey] = { style, staticLines, staticArrows,
      // dynamicLines, dynamicArrows }. Static = edges NOT touching the
      // currently-dragged node; dynamic = the few edges that ARE.
      // During drag, only dynamic paths are rebuilt per mousemove —
      // turning O(E) work per frame into O(deg(node)) work.
      pathCache: { byStyle: null, dragId: null, staticValid: false },
      // Bitmap snapshot of the static layer used while a node is being
      // dragged. WebKit re-tessellates Path2D on every stroke, so even
      // a cached path costs ~2 ms/frame at 3000 edges. Blitting a cached
      // image is ~0.2 ms — that's where the WebKit drag speedup comes from.
      dragSnapshot: null,         // OffscreenCanvas / HTMLCanvasElement
      dragSnapshotVp: null,       // { x, y, k } at snapshot capture time
    };
    // Map of node id -> DOM element, used by _renderNodes to reuse DOM
    // across relayouts instead of recreating every card.
    this._domNodes = {};

    this._buildDom();
    this._wireEvents();

    this._relayout();
    this._renderNodes();
    this.fitView();
  }

  Graph.VERSION = "0.1.0";

  // ----- DOM scaffolding ------------------------------------------------

  Graph.prototype._buildDom = function () {
    var root = this.container;
    if (!root.classList.contains("gv")) root.classList.add("gv");

    this._canvas = document.createElement("canvas");
    this._canvas.className = "gv__canvas";
    this._nodesEl = document.createElement("div");
    this._nodesEl.className = "gv__nodes";

    root.appendChild(this._canvas);
    root.appendChild(this._nodesEl);

    if (this.options.showToolbar) {
      this._toolbar = this._buildToolbar();
      root.appendChild(this._toolbar);
    }

    this._ctx = this._canvas.getContext("2d");
  };

  Graph.prototype._buildToolbar = function () {
    var self = this;
    var spec = this.options.toolbarButtons || DEFAULT_TOOLBAR;
    var bar = document.createElement("div");
    bar.className = "gv-toolbar";
    bar.setAttribute("role", "toolbar");

    var group = null;
    function newGroup() {
      group = document.createElement("div");
      group.className = "gv-toolbar__group";
      bar.appendChild(group);
    }
    newGroup();

    spec.forEach(function (item) {
      if (item.separator) { newGroup(); return; }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "gv-toolbar__btn";
      b.textContent = item.label || "";
      if (item.title) b.title = item.title;
      if (item.id) b.setAttribute("data-id", item.id);
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (item.onClick) item.onClick(self);
        self._refreshToolbar();
      });
      group.appendChild(b);
      b._spec = item;
    });

    // Apply initial pressed states.
    setTimeout(function () { self._refreshToolbar(); }, 0);
    return bar;
  };

  Graph.prototype._refreshToolbar = function () {
    if (!this._toolbar) return;
    var btns = this._toolbar.querySelectorAll(".gv-toolbar__btn");
    var self = this;
    btns.forEach(function (b) {
      var spec = b._spec;
      if (!spec || !spec.pressed) return;
      var on = !!spec.pressed(self);
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  };

  /** Public: append a button to the toolbar after init. */
  Graph.prototype.addToolbarButton = function (spec, options) {
    if (!this._toolbar) return null;
    var group;
    if (options && options.newGroup) {
      group = document.createElement("div");
      group.className = "gv-toolbar__group";
      this._toolbar.appendChild(group);
    } else {
      group = this._toolbar.lastChild;
      if (!group) {
        group = document.createElement("div");
        group.className = "gv-toolbar__group";
        this._toolbar.appendChild(group);
      }
    }
    var self = this;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "gv-toolbar__btn";
    b.textContent = spec.label || "";
    if (spec.title) b.title = spec.title;
    if (spec.id) b.setAttribute("data-id", spec.id);
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (spec.onClick) spec.onClick(self);
      self._refreshToolbar();
    });
    b._spec = spec;
    group.appendChild(b);
    this._refreshToolbar();
    return b;
  };

  // ----- Layout / geometry ---------------------------------------------

  Graph.prototype._relayout = function () {
    var layoutFn = this.options.layout;
    var r;
    if (typeof layoutFn === "function") {
      r = layoutFn(this.nodes, this.edges, {
        direction: this._state.dir,
        nodeWidth: this.options.nodeWidth,
        nodeHeight: this.options.nodeHeight,
        rankSeparation: this.options.rankSeparation,
        nodeSeparation: this.options.nodeSeparation,
      });
    } else {
      // "auto" — use built-in hierarchical layout, but honor explicit
      // node.position overrides.
      r = hierarchicalLayout(this.nodes, this.edges, {
        direction: this._state.dir,
        nodeWidth: this.options.nodeWidth,
        nodeHeight: this.options.nodeHeight,
        rankSeparation: this.options.rankSeparation,
        nodeSeparation: this.options.nodeSeparation,
      });
      var NW = this.options.nodeWidth, NH = this.options.nodeHeight;
      for (var i = 0; i < this.nodes.length; i++) {
        var n = this.nodes[i];
        if (n.position && r.positions[n.id]) {
          r.positions[n.id] = {
            x: n.position.x, y: n.position.y,
            w: n.width || NW, h: n.height || NH,
          };
        }
      }
    }
    this._state.positions = r.positions;
    this._rebuildGeometry();
  };

  function buildEdgeGeometry(e, positions, dir) {
    var s = positions[e.source], t = positions[e.target];
    if (!s || !t) return null;
    var backward = isBackward(s, t, dir);
    var ab = backward ? anchorsBackward(s, t, dir) : anchors(s, t, dir);
    var pts = sampleBezier(ab.a, ab.b, dir, undefined, backward);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var j = 0; j < pts.length; j++) {
      var p = pts[j];
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return { id: e.id, points: pts, bbox: { minX: minX, minY: minY, maxX: maxX, maxY: maxY }, edge: e };
  }

  Graph.prototype._rebuildGeometry = function () {
    var positions = this._state.positions, dir = this._state.dir;
    var geom = {};
    for (var i = 0; i < this.edges.length; i++) {
      var g = buildEdgeGeometry(this.edges[i], positions, dir);
      if (g) geom[g.id] = g;
    }
    this._state.geometry = geom;
    this._invalidatePathCache();
  };

  // Incremental rebuild for one node's incident edges — used during drag.
  // Does NOT invalidate the static path cache; only the dynamic portion is
  // rebuilt in _draw, which is what makes drag cheap.
  Graph.prototype._rebuildGeometryForNode = function (nodeId) {
    var positions = this._state.positions, dir = this._state.dir;
    var geom = this._state.geometry;
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if (e.source !== nodeId && e.target !== nodeId) continue;
      var g = buildEdgeGeometry(e, positions, dir);
      if (g) geom[e.id] = g;
    }
  };

  Graph.prototype._invalidatePathCache = function () {
    this._state.pathCache.staticValid = false;
    // Any geometry change also invalidates the drag bitmap snapshot.
    this._releaseDragSnapshot();
  };

  Graph.prototype._releaseDragSnapshot = function () {
    var s = this._state.dragSnapshot;
    if (s && typeof s.close === "function") {
      try { s.close(); } catch (_) {}
    }
    this._state.dragSnapshot = null;
  };

  // ----- Node rendering -------------------------------------------------

  Graph.prototype._renderNodes = function () {
    var nodesEl = this._nodesEl;
    var existing = this._domNodes;
    var next = {};
    var selected = this._state.selectedNode;

    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      var p = this._state.positions[n.id];
      if (!p) continue;

      var el = existing[n.id];
      if (el) {
        // Reuse existing element — content has not changed (only position
        // / selection state can change across relayouts). For content
        // changes use updateNode(), which recreates that one element.
        if (n.className && el.className.indexOf(n.className) < 0) {
          el.className = "gv-node" + (n.className ? " " + n.className : "");
        }
      } else {
        el = document.createElement("div");
        el.className = "gv-node" + (n.className ? " " + n.className : "");
        el.tabIndex = 0;
        el.setAttribute("data-node-id", n.id);
        if (typeof this.options.renderNode === "function") {
          this.options.renderNode(n, el, this);
        } else {
          var body = document.createElement("div");
          body.className = "gv-node__body";
          body.innerHTML = '<div class="gv-node__label">' + escapeHtml(n.label != null ? n.label : n.id) + "</div>";
          el.appendChild(body);
        }
        var ex = this._isExpandable(n);
        if (ex.up) el.appendChild(this._buildExpandButton(n, "up"));
        if (ex.down) el.appendChild(this._buildExpandButton(n, "down"));
        this._wireNode(el, n);
        nodesEl.appendChild(el);
      }

      // Update style only when changed (avoids repaints in browsers that
      // dirty layout on equal-value writes).
      var lt = p.x + "px", tt = p.y + "px", lw = p.w + "px", lh = p.h + "px";
      if (el.style.left !== lt)  el.style.left  = lt;
      if (el.style.top !== tt)   el.style.top   = tt;
      if (el.style.width !== lw) el.style.width = lw;
      if (el.style.height !== lh) el.style.height = lh;
      var isSel = selected === n.id;
      if (isSel !== el.classList.contains("is-selected")) {
        el.classList.toggle("is-selected", isSel);
      }
      next[n.id] = el;
    }

    // Remove DOM for nodes no longer in the data.
    for (var id in existing) {
      if (!next[id]) existing[id].remove();
    }
    this._domNodes = next;
    this._applyTransform();
  };

  // Force re-render of a single node's contents (renderNode is re-run).
  Graph.prototype._invalidateNodeDom = function (id) {
    var el = this._domNodes[id];
    if (el) { el.remove(); delete this._domNodes[id]; }
  };

  Graph.prototype._isExpandable = function (node) {
    var e = this.options.expandable;
    if (typeof e === "function") {
      var v = e(node) || {};
      return { up: !!v.up, down: !!v.down };
    }
    if (e && typeof e === "object") return { up: !!e.up, down: !!e.down };
    if (e === true) return { up: true, down: true };
    return { up: false, down: false };
  };

  Graph.prototype._buildExpandButton = function (node, direction) {
    var self = this;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "gv-node__expand gv-node__expand--" + direction + " gv-node__expand--" + this._state.dir;
    b.setAttribute("data-expand", direction);
    b.setAttribute("aria-label",
      (direction === "up" ? "Expand upstream" : "Expand downstream") + " for " + (node.label || node.id));
    b.textContent = "+";
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (self.options.onExpand) self.options.onExpand(node, direction);
    });
    return b;
  };

  Graph.prototype._wireNode = function (el, node) {
    var self = this;

    el.addEventListener("click", function (ev) {
      if (ev.target.closest("button")) return;
      if (self._state.suppressNextClick) {
        self._state.suppressNextClick = false;
        ev.stopPropagation();
        return;
      }
      ev.stopPropagation();
      if (self.options.selectable) self.selectNode(node.id);
      if (self.options.onNodeClick) self.options.onNodeClick(node, ev);
    });

    if (!self.options.draggable) return;

    el.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest("button")) return;
      ev.stopPropagation();
      ev.preventDefault();
      try { el.setPointerCapture(ev.pointerId); } catch (_) {}
      var p = self._state.positions[node.id];
      self._state.nodeDrag = {
        id: node.id, pointerId: ev.pointerId, node: node, el: el,
        startX: ev.clientX, startY: ev.clientY,
        origX: p.x, origY: p.y, moved: false,
        // rAF-coalesced pointer position. The handler below only stashes;
        // the next animation frame (via _processPendingDrag) does the real
        // work. Trackpads on macOS can fire pointermove at 120+ Hz, so
        // coalescing to vsync is the difference between snappy and laggy
        // on Safari.
        pendingX: null, pendingY: null,
      };
      // Promote the dragged element to its own compositor layer. Without
      // this, Safari re-rasterizes the parent .gv__nodes layer (which has
      // 1000+ box-shadowed cards baked in) on every drag step.
      el.style.willChange = "transform";
      document.body.style.cursor = "grabbing";
      // Pre-build the static path cache and capture the snapshot NOW,
      // during the click hold — so the very first pointermove is already
      // on the fast path. The user feels a tiny click latency instead of
      // a jank on first move, which is the better tradeoff.
      var pc = self._state.pathCache;
      pc.dragId = node.id;
      pc.staticValid = false;
      self._buildStaticPathCache();
      self._captureDragSnapshot();
    });
    el.addEventListener("pointermove", function (ev) {
      var nd = self._state.nodeDrag;
      if (!nd || nd.pointerId !== ev.pointerId) return;
      if (!nd.moved && (Math.abs(ev.clientX - nd.startX) > 2 || Math.abs(ev.clientY - nd.startY) > 2)) {
        nd.moved = true;
      }
      nd.pendingX = ev.clientX;
      nd.pendingY = ev.clientY;
      self._scheduleDraw();
    });
    function finish(ev) {
      var nd = self._state.nodeDrag;
      if (!nd || nd.pointerId !== ev.pointerId) return;
      // Drain any final pending move before tearing down.
      self._processPendingDrag();
      if (nd.moved) self._state.suppressNextClick = true;
      try { el.releasePointerCapture(ev.pointerId); } catch (_) {}
      var p = self._state.positions[nd.id];
      // Bake the live translate back into left/top so the static cache
      // can include this node at its new position on the next render.
      el.style.transform = "";
      el.style.willChange = "";
      if (p) {
        el.style.left = p.x + "px";
        el.style.top = p.y + "px";
      }
      self._state.nodeDrag = null;
      self._releaseDragSnapshot();
      self._scheduleDraw();
      document.body.style.cursor = "";
      if (nd.moved && self.options.onNodeDragEnd && p) {
        self.options.onNodeDragEnd(node, { x: p.x, y: p.y });
      }
    }
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("dragstart", function (ev) { ev.preventDefault(); });
  };

  // ----- Canvas drawing -------------------------------------------------

  Graph.prototype._applyTransform = function () {
    var v = this._state.viewport;
    this._nodesEl.style.transform = "translate(" + v.x + "px, " + v.y + "px) scale(" + v.k + ")";
  };

  Graph.prototype._scheduleDraw = function () {
    if (this._state.rafScheduled || this._state.destroyed) return;
    var self = this;
    this._state.rafScheduled = true;
    requestAnimationFrame(function () {
      self._state.rafScheduled = false;
      if (!self._state.destroyed) self._draw();
    });
  };

  Graph.prototype._syncCanvasSize = function () {
    var rect = this.container.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var c = this._canvas;
    c.width = Math.max(1, Math.floor(rect.width * dpr));
    c.height = Math.max(1, Math.floor(rect.height * dpr));
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";
  };

  Graph.prototype._styleFor = function (edge, state) {
    var base = (this.options.edgeStyle ? this.options.edgeStyle(edge, "base") : null) || defaultEdgeStyle(edge);
    // Ensure required keys.
    if (base.width == null) base.width = 1.5;
    if (base.stroke == null) base.stroke = "#94a3b8";
    if (base.arrow == null) base.arrow = true;
    if (state === "base") return base;
    // If user provided edgeStyle and it wants to handle the state, prefer that.
    if (this.options.edgeStyle) {
      var custom = this.options.edgeStyle(edge, state);
      if (custom) return custom;
    }
    return applyEdgeState(base, state);
  };

  function intersectsView(bbox, view) {
    return !(bbox.maxX < view.minX || bbox.minX > view.maxX ||
             bbox.maxY < view.minY || bbox.minY > view.maxY);
  }

  // --- Path2D caching ---------------------------------------------------
  //
  // Building a 72k-point path with moveTo/lineTo is the hottest JS work in
  // _draw. We cache that work as Path2D objects keyed by style, so:
  //   - Pan/zoom doesn't rebuild paths at all (graph coords don't change).
  //   - Drag rebuilds only the small "dynamic" path for incident edges.
  //
  // Each cache entry has STATIC paths (edges not incident to a drag) and
  // DYNAMIC paths (edges incident to the currently-dragged node).

  function styleKey(st) {
    return st.stroke + "|" + st.width + "|" + (st.dash ? st.dash.join(",") : "-") + "|" + (st.arrow ? "a" : "n");
  }

  function appendLine(path, pts) {
    path.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  }

  function appendArrow(path, pts, width) {
    var to = pts[pts.length - 1];
    var from = pts[pts.length - 2];
    var ang = Math.atan2(to.y - from.y, to.x - from.x);
    var size = Math.max(6, width * 3);
    var w = Math.PI / 7;
    path.moveTo(to.x, to.y);
    path.lineTo(to.x - size * Math.cos(ang - w), to.y - size * Math.sin(ang - w));
    path.lineTo(to.x - size * Math.cos(ang + w), to.y - size * Math.sin(ang + w));
    path.closePath();
  }

  Graph.prototype._buildStaticPathCache = function () {
    var pc = this._state.pathCache;
    var byStyle = {};
    var geom = this._state.geometry;
    var dragId = pc.dragId;

    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      var g = geom[e.id];
      if (!g) continue;
      // Skip edges that will be over-drawn or are dynamic during drag.
      if (dragId && (e.source === dragId || e.target === dragId)) continue;

      var st = this._styleFor(e, "base");
      var key = styleKey(st);
      var entry = byStyle[key];
      if (!entry) {
        entry = byStyle[key] = {
          style: st,
          staticLines: new Path2D(),
          staticArrows: st.arrow ? new Path2D() : null,
          dynamicLines: null,
          dynamicArrows: null,
        };
      }
      appendLine(entry.staticLines, g.points);
      if (st.arrow) appendArrow(entry.staticArrows, g.points, st.width);
    }
    pc.byStyle = byStyle;
    pc.staticValid = true;
  };

  Graph.prototype._buildDynamicPathCache = function () {
    var pc = this._state.pathCache;
    var dragId = pc.dragId;
    if (!dragId || !pc.byStyle) return;

    // Reset dynamic paths for all known style groups.
    for (var key in pc.byStyle) {
      pc.byStyle[key].dynamicLines = new Path2D();
      pc.byStyle[key].dynamicArrows = pc.byStyle[key].style.arrow ? new Path2D() : null;
    }
    // Walk only incident edges. For deg(node) << E this is tiny.
    var geom = this._state.geometry;
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if (e.source !== dragId && e.target !== dragId) continue;
      var g = geom[e.id];
      if (!g) continue;
      var st = this._styleFor(e, "base");
      var key2 = styleKey(st);
      var entry = pc.byStyle[key2];
      if (!entry) {
        // New style introduced after static build — fall back to a group.
        entry = pc.byStyle[key2] = {
          style: st,
          staticLines: new Path2D(),
          staticArrows: st.arrow ? new Path2D() : null,
          dynamicLines: new Path2D(),
          dynamicArrows: st.arrow ? new Path2D() : null,
        };
      }
      appendLine(entry.dynamicLines, g.points);
      if (st.arrow) appendArrow(entry.dynamicArrows, g.points, st.width);
    }
  };

  // Apply the latest pending pointermove for the active drag, if any.
  // This is the only place that mutates node position / geometry / DOM
  // during drag — at most once per animation frame.
  Graph.prototype._processPendingDrag = function () {
    var nd = this._state.nodeDrag;
    if (!nd || nd.pendingX == null) return;
    var dx = (nd.pendingX - nd.startX) / this._state.viewport.k;
    var dy = (nd.pendingY - nd.startY) / this._state.viewport.k;
    var p = this._state.positions[nd.id];
    if (!p) { nd.pendingX = nd.pendingY = null; return; }
    p.x = nd.origX + dx;
    p.y = nd.origY + dy;
    // Use transform on the dragged element so the browser composites the
    // move instead of repainting the whole .gv__nodes layer. The element
    // already has a base left/top from layout — translate adds the delta
    // on top, scaled with the parent. Cleared at dragend.
    nd.el.style.transform = "translate(" + dx + "px, " + dy + "px)";
    this._rebuildGeometryForNode(nd.id);
    nd.pendingX = null;
    nd.pendingY = null;
    if (this.options.onNodeDrag) this.options.onNodeDrag(nd.node, { x: p.x, y: p.y });
  };

  Graph.prototype._draw = function () {
    // Drain coalesced pointermoves before drawing.
    this._processPendingDrag();

    var ctx = this._ctx;
    var c = this._canvas;
    var v = this._state.viewport;
    var dpr = window.devicePixelRatio || 1;
    var dragId = this._state.nodeDrag ? this._state.nodeDrag.id : null;

    // ---- Drag fast path: blit a cached snapshot of the static layer,
    // then stroke only the small dynamic path. Skips path tessellation
    // for the bulk of edges — critical for WebKit, where ctx.stroke()
    // on a Path2D doesn't cache tessellation between frames.
    var snap = this._state.dragSnapshot;
    if (dragId && snap) {
      var sv = this._state.dragSnapshotVp;
      if (sv.x === v.x && sv.y === v.y && sv.k === v.k &&
          snap.width === c.width && snap.height === c.height) {
        this._drawDragFrame(ctx, c, v, dpr, snap);
        return;
      }
      // Viewport or canvas size changed — fall through to full draw and
      // recapture the snapshot below.
      this._releaseDragSnapshot();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);

    var skipArrows = v.k < 0.35;

    // Sync cache to current drag state.
    var pc = this._state.pathCache;
    if (pc.dragId !== dragId) {
      pc.dragId = dragId;
      pc.staticValid = false; // partitioning changed
    }
    if (!pc.staticValid) this._buildStaticPathCache();
    if (dragId) this._buildDynamicPathCache();

    // Stroke each style group: static then dynamic.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (var key in pc.byStyle) {
      var entry = pc.byStyle[key];
      var st = entry.style;
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = st.width;
      ctx.setLineDash(st.dash || []);
      ctx.stroke(entry.staticLines);
      if (dragId && entry.dynamicLines) ctx.stroke(entry.dynamicLines);
    }
    // Arrowhead fills (skipped at low zoom).
    if (!skipArrows) {
      ctx.setLineDash([]);
      for (var key2 in pc.byStyle) {
        var entry2 = pc.byStyle[key2];
        if (!entry2.staticArrows) continue;
        ctx.fillStyle = entry2.style.stroke;
        ctx.fill(entry2.staticArrows);
        if (dragId && entry2.dynamicArrows) ctx.fill(entry2.dynamicArrows);
      }
    }

    // Overdraw: neighbors of selected node, hovered edge, selected edge.
    // The base pass already painted these in their normal style; we just
    // stroke over them with the highlight style.
    var geom = this._state.geometry;
    var hoverId = this._state.hoveredEdge, selId = this._state.selectedEdge;
    var neighbors = this._neighborEdgeSet();

    if (neighbors) {
      for (var k in neighbors) {
        var ng = geom[k];
        if (!ng || ng.id === hoverId || ng.id === selId) continue;
        strokeEdge(ctx, ng, this._styleFor(ng.edge, "neighbor"), skipArrows);
      }
    }
    if (hoverId && geom[hoverId]) strokeEdge(ctx, geom[hoverId], this._styleFor(geom[hoverId].edge, "hover"), false);
    if (selId && geom[selId]) strokeEdge(ctx, geom[selId], this._styleFor(geom[selId].edge, "selected"), false);

    // If we're in a drag and haven't snapshotted yet, capture the canvas
    // (minus the dynamic edges, which we just over-drew) as a bitmap that
    // subsequent drag frames will blit in lieu of re-stroking.
    if (dragId && !this._state.dragSnapshot) {
      this._captureDragSnapshot();
    }
  };

  Graph.prototype._captureDragSnapshot = function () {
    var src = this._canvas;
    // Prefer OffscreenCanvas → transferToImageBitmap. The resulting bitmap
    // is GPU-backed and `ctx.drawImage(bitmap)` is the fastest blit path
    // — particularly noticeable in Safari, where drawImage from another
    // HTMLCanvasElement can fall back to a CPU-side copy.
    var off;
    var useOffscreen = typeof OffscreenCanvas !== "undefined";
    if (useOffscreen) {
      try { off = new OffscreenCanvas(src.width, src.height); }
      catch (_) { useOffscreen = false; }
    }
    if (!off) {
      off = document.createElement("canvas");
      off.width = src.width;
      off.height = src.height;
    }
    var octx = off.getContext("2d");
    var v = this._state.viewport;
    var dpr = window.devicePixelRatio || 1;
    octx.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);

    // Render ONLY the static layer to the offscreen — never the dynamic
    // edges. Otherwise the snapshot would freeze old dynamic positions
    // and ghost behind the live ones.
    var pc = this._state.pathCache;
    var skipArrows = v.k < 0.35;
    octx.lineCap = "round";
    octx.lineJoin = "round";
    for (var key in pc.byStyle) {
      var entry = pc.byStyle[key];
      octx.strokeStyle = entry.style.stroke;
      octx.lineWidth = entry.style.width;
      octx.setLineDash(entry.style.dash || []);
      octx.stroke(entry.staticLines);
    }
    if (!skipArrows) {
      octx.setLineDash([]);
      for (var key2 in pc.byStyle) {
        var entry2 = pc.byStyle[key2];
        if (!entry2.staticArrows) continue;
        octx.fillStyle = entry2.style.stroke;
        octx.fill(entry2.staticArrows);
      }
    }
    // Overdraw the parts of selection / hover that aren't dynamic.
    // Selection state can't change mid-drag (pointer is captured) so
    // these are stable for the whole drag.
    var geom = this._state.geometry;
    var hoverId = this._state.hoveredEdge, selId = this._state.selectedEdge;
    var neighbors = this._neighborEdgeSet();
    var dragId = pc.dragId;
    function isDynamic(edge) {
      return dragId && (edge.source === dragId || edge.target === dragId);
    }
    if (neighbors) {
      for (var k in neighbors) {
        var ng = geom[k];
        if (!ng || ng.id === hoverId || ng.id === selId) continue;
        if (isDynamic(ng.edge)) continue;
        strokeEdge(octx, ng, this._styleFor(ng.edge, "neighbor"), skipArrows);
      }
    }
    if (hoverId && geom[hoverId] && !isDynamic(geom[hoverId].edge)) {
      strokeEdge(octx, geom[hoverId], this._styleFor(geom[hoverId].edge, "hover"), false);
    }
    if (selId && geom[selId] && !isDynamic(geom[selId].edge)) {
      strokeEdge(octx, geom[selId], this._styleFor(geom[selId].edge, "selected"), false);
    }

    // For an OffscreenCanvas, transfer to a GPU-friendly ImageBitmap.
    // The OffscreenCanvas itself becomes detached afterwards (which is
    // fine — we only need the bitmap for blitting).
    var snap = off;
    if (useOffscreen && typeof off.transferToImageBitmap === "function") {
      try { snap = off.transferToImageBitmap(); } catch (_) {}
    }
    this._state.dragSnapshot = snap;
    this._state.dragSnapshotVp = { x: v.x, y: v.y, k: v.k };
  };

  Graph.prototype._drawDragFrame = function (ctx, c, v, dpr, snap) {
    // 1) Blit the cached static layer in pixel space.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(snap, 0, 0);
    // 2) Switch to graph-space and stroke ONLY the dynamic edges.
    ctx.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);
    var skipArrows = v.k < 0.35;
    this._buildDynamicPathCache();
    var pc = this._state.pathCache;
    if (!pc.byStyle) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // If the dragged node is selected, dynamic edges are its "neighbor"
    // highlights — use the accent style. Otherwise keep base style.
    var asNeighbor = this._state.selectedNode === pc.dragId;
    for (var key in pc.byStyle) {
      var entry = pc.byStyle[key];
      if (!entry.dynamicLines) continue;
      var st = asNeighbor ? this._styleFor(entry.style /* dummy edge */, "neighbor") || entry.style : entry.style;
      // The dummy-edge call above is awkward — fall back to a thin recolor
      // when the user's edgeStyle didn't handle "neighbor" explicitly.
      var neighborStyle = asNeighbor
        ? { stroke: "#3b82f6", width: Math.max(entry.style.width, 2), dash: entry.style.dash, arrow: entry.style.arrow }
        : entry.style;
      ctx.strokeStyle = neighborStyle.stroke;
      ctx.lineWidth = neighborStyle.width;
      ctx.setLineDash(neighborStyle.dash || []);
      ctx.stroke(entry.dynamicLines);
    }
    if (!skipArrows) {
      ctx.setLineDash([]);
      for (var key2 in pc.byStyle) {
        var entry2 = pc.byStyle[key2];
        if (!entry2.dynamicArrows) continue;
        ctx.fillStyle = asNeighbor ? "#3b82f6" : entry2.style.stroke;
        ctx.fill(entry2.dynamicArrows);
      }
    }
  };

  Graph.prototype._neighborEdgeSet = function () {
    var sel = this._state.selectedNode;
    if (!sel) return null;
    var set = {};
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if (e.source === sel || e.target === sel) set[e.id] = true;
    }
    return Object.keys(set).length ? set : null;
  };

  function strokeEdge(ctx, geom, style, skipArrow) {
    var pts = geom.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    if (style.arrow && !skipArrow) drawArrow(ctx, pts[pts.length - 2], pts[pts.length - 1], style);
  }
  function drawArrow(ctx, from, to, style) {
    var a = Math.atan2(to.y - from.y, to.x - from.x);
    var size = Math.max(6, style.width * 3);
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(a - Math.PI / 7), to.y - size * Math.sin(a - Math.PI / 7));
    ctx.lineTo(to.x - size * Math.cos(a + Math.PI / 7), to.y - size * Math.sin(a + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = style.stroke;
    ctx.fill();
    ctx.restore();
  }

  // ----- Pane events ---------------------------------------------------

  Graph.prototype._wireEvents = function () {
    var self = this;
    var root = this.container;

    this._onPaneMouseDown = function (ev) {
      if (ev.target.closest(".gv-node") || ev.target.closest(".gv-toolbar")) return;
      self._state.paneDrag = { x: ev.clientX, y: ev.clientY, vx: self._state.viewport.x, vy: self._state.viewport.y };
    };
    this._onWinMouseUp = function () { self._state.paneDrag = null; };
    this._onWinMouseMove = function (ev) {
      if (self._state.nodeDrag) return;
      if (self._state.paneDrag) {
        var pd = self._state.paneDrag;
        self._state.viewport.x = pd.vx + (ev.clientX - pd.x);
        self._state.viewport.y = pd.vy + (ev.clientY - pd.y);
        self._applyTransform();
        self._scheduleDraw();
        return;
      }
      var rect = root.getBoundingClientRect();
      var v = self._state.viewport;
      var gx = (ev.clientX - rect.left - v.x) / v.k;
      var gy = (ev.clientY - rect.top - v.y) / v.k;
      var tol = self.options.hitTolerancePx / v.k;
      var hit = null;
      var geom = self._state.geometry;
      for (var id in geom) {
        var g = geom[id];
        if (gx < g.bbox.minX - tol || gx > g.bbox.maxX + tol) continue;
        if (gy < g.bbox.minY - tol || gy > g.bbox.maxY + tol) continue;
        var tolSq = tol * tol;
        for (var i = 0; i < g.points.length - 1; i++) {
          var a = g.points[i], b = g.points[i + 1];
          if (distSqSeg(gx, gy, a.x, a.y, b.x, b.y) <= tolSq) { hit = g.edge; break; }
        }
        if (hit) break;
      }
      var nextId = hit ? hit.id : null;
      if (nextId !== self._state.hoveredEdge) {
        self._state.hoveredEdge = nextId;
        root.style.cursor = hit ? "pointer" : "";
        self._scheduleDraw();
        if (self.options.onEdgeHover) self.options.onEdgeHover(hit);
      }
    };
    this._onWheel = function (ev) {
      ev.preventDefault();
      var rect = root.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var factor = Math.pow(1.0015, -ev.deltaY);
      var v = self._state.viewport;
      var nk = Math.min(self.options.maxZoom, Math.max(self.options.minZoom, v.k * factor));
      v.x = mx - (mx - v.x) * (nk / v.k);
      v.y = my - (my - v.y) * (nk / v.k);
      v.k = nk;
      self._applyTransform();
      self._scheduleDraw();
    };
    this._onPaneClick = function (ev) {
      if (ev.target.closest(".gv-node") || ev.target.closest(".gv-toolbar")) return;
      var hovered = self._state.hoveredEdge;
      if (hovered) {
        var e = findEdge(self.edges, hovered);
        if (e) {
          if (self.options.selectable) self.selectEdge(e.id);
          if (self.options.onEdgeClick) self.options.onEdgeClick(e, ev);
          return;
        }
      }
      if (self._state.selectedNode || self._state.selectedEdge) {
        self._state.selectedNode = null;
        self._state.selectedEdge = null;
        self._renderNodes();
        self._scheduleDraw();
        if (self.options.onSelectionChange) self.options.onSelectionChange({ nodeId: null, edgeId: null });
      }
      if (self.options.onPaneClick) self.options.onPaneClick(ev);
    };

    root.addEventListener("mousedown", this._onPaneMouseDown);
    root.addEventListener("click", this._onPaneClick);
    root.addEventListener("wheel", this._onWheel, { passive: false });
    window.addEventListener("mouseup", this._onWinMouseUp);
    window.addEventListener("mousemove", this._onWinMouseMove);

    this._ro = new ResizeObserver(function () {
      self._syncCanvasSize();
      self._releaseDragSnapshot(); // size changed → snapshot stale
      self._scheduleDraw();
    });
    this._ro.observe(root);
    this._syncCanvasSize();
  };

  function findEdge(edges, id) {
    for (var i = 0; i < edges.length; i++) if (edges[i].id === id) return edges[i];
    return null;
  }

  // ----- Public API -----------------------------------------------------

  Graph.prototype.getDirection = function () { return this._state.dir; };
  Graph.prototype.setDirection = function (dir) {
    if (dir !== "LR" && dir !== "TB") return;
    this._state.dir = dir;
    this._relayout();
    this._renderNodes();
    this._refreshToolbar();
    this.fitView();
  };
  Graph.prototype._clearDomCache = function () {
    for (var id in this._domNodes) this._domNodes[id].remove();
    this._domNodes = {};
  };
  Graph.prototype.setNodes = function (nodes) {
    this.nodes = (nodes || []).slice();
    this._clearDomCache();
    this._relayout(); this._renderNodes(); this._scheduleDraw();
  };
  Graph.prototype.setEdges = function (edges) {
    this.edges = (edges || []).slice();
    // Edges-only change: keep node DOM, but invalidate path cache (geom changes).
    this._relayout(); this._renderNodes(); this._scheduleDraw();
  };
  Graph.prototype.setData = function (nodes, edges) {
    this.nodes = (nodes || []).slice();
    this.edges = (edges || []).slice();
    this._clearDomCache();
    this._relayout(); this._renderNodes(); this._scheduleDraw();
  };
  Graph.prototype.addNode = function (n) { this.nodes.push(n); this._relayout(); this._renderNodes(); this._scheduleDraw(); };
  Graph.prototype.addEdge = function (e) { this.edges.push(e); this._relayout(); this._renderNodes(); this._scheduleDraw(); };
  Graph.prototype.removeNode = function (id) {
    this.nodes = this.nodes.filter(function (n) { return n.id !== id; });
    this.edges = this.edges.filter(function (e) { return e.source !== id && e.target !== id; });
    this._relayout(); this._renderNodes(); this._scheduleDraw();
  };
  Graph.prototype.removeEdge = function (id) {
    this.edges = this.edges.filter(function (e) { return e.id !== id; });
    this._relayout(); this._renderNodes(); this._scheduleDraw();
  };
  Graph.prototype.updateNode = function (id, patch) {
    for (var i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].id === id) {
        this.nodes[i] = Object.assign({}, this.nodes[i], patch);
        break;
      }
    }
    // Force the user's renderNode to run again for this node — DOM diff
    // reuses elements by id otherwise.
    this._invalidateNodeDom(id);
    this._relayout(); this._renderNodes(); this._scheduleDraw();
  };
  Graph.prototype.selectNode = function (id) {
    this._state.selectedNode = id || null;
    this._state.selectedEdge = null;
    this._renderNodes();
    this._scheduleDraw();
    if (this.options.onSelectionChange) this.options.onSelectionChange({ nodeId: id || null, edgeId: null });
  };
  Graph.prototype.selectEdge = function (id) {
    this._state.selectedEdge = id || null;
    this._state.selectedNode = null;
    this._renderNodes();
    this._scheduleDraw();
    if (this.options.onSelectionChange) this.options.onSelectionChange({ nodeId: null, edgeId: id || null });
  };
  Graph.prototype.getSelection = function () {
    return { nodeId: this._state.selectedNode, edgeId: this._state.selectedEdge };
  };
  Graph.prototype.zoomIn = function () {
    var v = this._state.viewport;
    v.k = Math.min(this.options.maxZoom, v.k * 1.2);
    this._applyTransform(); this._scheduleDraw();
  };
  Graph.prototype.zoomOut = function () {
    var v = this._state.viewport;
    v.k = Math.max(this.options.minZoom, v.k / 1.2);
    this._applyTransform(); this._scheduleDraw();
  };
  Graph.prototype.fitView = function () {
    var rect = this.container.getBoundingClientRect();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var positions = this._state.positions, any = false;
    for (var id in positions) {
      any = true;
      var p = positions[id];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + p.w > maxX) maxX = p.x + p.w;
      if (p.y + p.h > maxY) maxY = p.y + p.h;
    }
    if (!any) return;
    var pad = this.options.fitPadding;
    var w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2;
    var k = Math.min(rect.width / w, rect.height / h, 1.5);
    var v = this._state.viewport;
    v.k = k;
    v.x = (rect.width - (maxX - minX) * k) / 2 - minX * k;
    v.y = (rect.height - (maxY - minY) * k) / 2 - minY * k;
    this._applyTransform(); this._scheduleDraw();
  };
  Graph.prototype.getViewport = function () {
    var v = this._state.viewport;
    return { x: v.x, y: v.y, zoom: v.k };
  };
  Graph.prototype.setViewport = function (vp) {
    var v = this._state.viewport;
    if (typeof vp.x === "number") v.x = vp.x;
    if (typeof vp.y === "number") v.y = vp.y;
    if (typeof vp.zoom === "number") v.k = vp.zoom;
    this._applyTransform(); this._scheduleDraw();
  };
  Graph.prototype.getNodePosition = function (id) {
    var p = this._state.positions[id];
    return p ? { x: p.x, y: p.y } : null;
  };
  Graph.prototype.destroy = function () {
    this._state.destroyed = true;
    window.removeEventListener("mouseup", this._onWinMouseUp);
    window.removeEventListener("mousemove", this._onWinMouseMove);
    this.container.removeEventListener("mousedown", this._onPaneMouseDown);
    this.container.removeEventListener("click", this._onPaneClick);
    this.container.removeEventListener("wheel", this._onWheel);
    if (this._ro) this._ro.disconnect();
    this.container.innerHTML = "";
    this.container.classList.remove("gv");
    this._domNodes = {};
    this._state.pathCache = { byStyle: null, dragId: null, staticValid: false };
  };

  return Graph;
});
