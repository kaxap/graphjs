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
  function sampleBezier(a, b, dir, samples) {
    samples = samples || 24;
    var dx = b.x - a.x, dy = b.y - a.y, c1, c2;
    if (dir === "TB") {
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
    };

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

  Graph.prototype._rebuildGeometry = function () {
    var positions = this._state.positions, dir = this._state.dir;
    var geom = {};
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      var s = positions[e.source], t = positions[e.target];
      if (!s || !t) continue;
      var ab = anchors(s, t, dir);
      var pts = sampleBezier(ab.a, ab.b, dir);
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j];
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      geom[e.id] = { id: e.id, points: pts, bbox: { minX: minX, minY: minY, maxX: maxX, maxY: maxY }, edge: e };
    }
    this._state.geometry = geom;
  };

  // ----- Node rendering -------------------------------------------------

  Graph.prototype._renderNodes = function () {
    var nodesEl = this._nodesEl;
    nodesEl.innerHTML = "";

    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      var p = this._state.positions[n.id];
      if (!p) continue;

      var el = document.createElement("div");
      el.className = "gv-node";
      if (n.className) el.className += " " + n.className;
      if (this._state.selectedNode === n.id) el.classList.add("is-selected");
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      el.style.width = p.w + "px";
      el.style.height = p.h + "px";
      el.tabIndex = 0;
      el.setAttribute("data-node-id", n.id);

      // renderNode receives the OUTER .gv-node element — users can add
      // their own classes, build their own internal structure, and the
      // library's expand buttons get appended afterwards.
      if (typeof this.options.renderNode === "function") {
        this.options.renderNode(n, el, this);
      } else {
        var body = document.createElement("div");
        body.className = "gv-node__body";
        body.innerHTML = '<div class="gv-node__label">' + escapeHtml(n.label != null ? n.label : n.id) + "</div>";
        el.appendChild(body);
      }

      // Optional expand buttons.
      var ex = this._isExpandable(n);
      if (ex.up) el.appendChild(this._buildExpandButton(n, "up"));
      if (ex.down) el.appendChild(this._buildExpandButton(n, "down"));

      this._wireNode(el, n);
      nodesEl.appendChild(el);
    }
    this._applyTransform();
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
        id: node.id, pointerId: ev.pointerId,
        startX: ev.clientX, startY: ev.clientY,
        origX: p.x, origY: p.y, moved: false,
      };
      document.body.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", function (ev) {
      var nd = self._state.nodeDrag;
      if (!nd || nd.pointerId !== ev.pointerId) return;
      var dx = (ev.clientX - nd.startX) / self._state.viewport.k;
      var dy = (ev.clientY - nd.startY) / self._state.viewport.k;
      if (Math.abs(ev.clientX - nd.startX) > 2 || Math.abs(ev.clientY - nd.startY) > 2) nd.moved = true;
      var p = self._state.positions[nd.id];
      if (!p) return;
      p.x = nd.origX + dx;
      p.y = nd.origY + dy;
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      self._rebuildGeometry();
      self._scheduleDraw();
      if (self.options.onNodeDrag) self.options.onNodeDrag(node, { x: p.x, y: p.y });
    });
    function finish(ev) {
      var nd = self._state.nodeDrag;
      if (!nd || nd.pointerId !== ev.pointerId) return;
      if (nd.moved) self._state.suppressNextClick = true;
      try { el.releasePointerCapture(ev.pointerId); } catch (_) {}
      self._state.nodeDrag = null;
      document.body.style.cursor = "";
      if (nd.moved && self.options.onNodeDragEnd) {
        var p = self._state.positions[nd.id];
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

  Graph.prototype._draw = function () {
    var ctx = this._ctx;
    var c = this._canvas;
    var v = this._state.viewport;
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);

    var geom = this._state.geometry;
    var neighbors = this._neighborEdgeSet();

    var hoverId = this._state.hoveredEdge, selId = this._state.selectedEdge;
    var ids = Object.keys(geom);

    // Base
    for (var i = 0; i < ids.length; i++) {
      var g = geom[ids[i]];
      if (g.id === hoverId || g.id === selId) continue;
      if (neighbors && neighbors[g.id]) continue;
      strokeEdge(ctx, g, this._styleFor(g.edge, "base"));
    }
    // Neighbors of selected node
    if (neighbors) {
      for (var k in neighbors) {
        var ng = geom[k];
        if (ng && ng.id !== hoverId && ng.id !== selId) {
          strokeEdge(ctx, ng, this._styleFor(ng.edge, "neighbor"));
        }
      }
    }
    if (hoverId && geom[hoverId]) strokeEdge(ctx, geom[hoverId], this._styleFor(geom[hoverId].edge, "hover"));
    if (selId && geom[selId]) strokeEdge(ctx, geom[selId], this._styleFor(geom[selId].edge, "selected"));
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

  function strokeEdge(ctx, geom, style) {
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
    if (style.arrow) drawArrow(ctx, pts[pts.length - 2], pts[pts.length - 1], style);
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

    this._ro = new ResizeObserver(function () { self._syncCanvasSize(); self._scheduleDraw(); });
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
  Graph.prototype.setNodes = function (nodes) { this.nodes = (nodes || []).slice(); this._relayout(); this._renderNodes(); this._scheduleDraw(); };
  Graph.prototype.setEdges = function (edges) { this.edges = (edges || []).slice(); this._relayout(); this._renderNodes(); this._scheduleDraw(); };
  Graph.prototype.setData = function (nodes, edges) {
    this.nodes = (nodes || []).slice();
    this.edges = (edges || []).slice();
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
  };

  return Graph;
});
