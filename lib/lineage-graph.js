/*!
 * lineage-graph.js — vanilla-JS lineage graph for static HTML pages.
 *
 * Usage (CDN-style / plain <script>):
 *   <link rel="stylesheet" href="lineage-graph.css" />
 *   <script src="lineage-graph.js"></script>
 *   <script>
 *     const g = new LineageGraph(document.getElementById('container'), {
 *       nodes: [...], edges: [...],
 *       onNodeClick: (n) => console.log(n),
 *     });
 *   </script>
 *
 * Also works as a CommonJS / AMD module.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    root.LineageGraph = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- Defaults --------------------------------------------------

  var DEFAULT_ENTITY_GLYPH = {
    table: "▦", dashboard: "▤", pipeline: "⇢", topic: "≋",
    mlmodel: "◈", container: "▢", database: "◫", schema: "▥",
    generic: "●",
  };

  var DEFAULTS = {
    nodes: [],
    edges: [],
    direction: "LR",          // "LR" | "TB"
    nodeWidth: 240,
    nodeHeight: 86,
    rankSeparation: 110,
    nodeSeparation: 28,
    showColumnLineage: false,
    showToolbar: true,
    showLegend: false,
    legendItems: null,        // null = auto from entityIcons
    entityIcons: DEFAULT_ENTITY_GLYPH,
    hitTolerancePx: 6,
    minZoom: 0.2,
    maxZoom: 2.5,
    fitPadding: 40,
    // Callbacks
    onNodeClick: null,
    onEdgeClick: null,
    onEdgeHover: null,
    onExpandUpstream: null,
    onExpandDownstream: null,
    onNodeDrag: null,         // (node, position) — fired on every drag move
    onNodeDragEnd: null,      // (node, position) — fired once at drag release
  };

  // ---------- Layout: longest-path rank, simple within-rank ordering ----

  function layout(nodes, edges, opts) {
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
      if (seen[id]) return 0; // cycle guard
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
    nodes.forEach(function (n) {
      var r = rank[n.id];
      (ranks[r] = ranks[r] || []).push(n);
    });

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
          var x, y;
          if (dir === "LR") { x = 40 + r * (NW + RS); y = 40 + i * (NH + NS); }
          else              { x = 40 + i * (NW + NS); y = 40 + r * (NH + RS); }
          positions[n.id] = { x: x, y: y, w: NW, h: NH };
          if (x + NW > maxX) maxX = x + NW;
          if (y + NH > maxY) maxY = y + NH;
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

  // ---------- Tiny DOM helpers -----------------------------------------

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "class") el.className = attrs[k];
        else if (k === "html") el.innerHTML = attrs[k];
        else if (k.indexOf("data-") === 0 || k === "tabindex" || k === "aria-label" || k === "role" || k === "aria-pressed") el.setAttribute(k, attrs[k]);
        else el[k] = attrs[k];
      }
    }
    if (children) children.forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- LineageGraph class ---------------------------------------

  function LineageGraph(container, options) {
    if (!(this instanceof LineageGraph)) return new LineageGraph(container, options);
    if (!container) throw new Error("LineageGraph: container element is required");

    var opts = {};
    for (var k in DEFAULTS) opts[k] = DEFAULTS[k];
    if (options) for (var k2 in options) opts[k2] = options[k2];

    this.options = opts;
    this.container = container;
    this.nodes = (opts.nodes || []).slice();
    this.edges = (opts.edges || []).slice();

    this._state = {
      dir: opts.direction,
      showColumns: opts.showColumnLineage,
      viewport: { x: 0, y: 0, k: 1 },
      positions: {},
      geometry: {}, // id -> { id, points, bbox, edge }
      hoveredEdge: null,
      selectedNode: null,
      selectedEdge: null,
      // drag state
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

  LineageGraph.VERSION = "0.1.0";

  // ----- DOM scaffolding ------------------------------------------------

  LineageGraph.prototype._buildDom = function () {
    var root = this.container;
    if (!root.classList.contains("lg")) root.classList.add("lg");

    this._canvas = h("canvas", { class: "lg__canvas" });
    this._nodesEl = h("div", { class: "lg__nodes" });

    root.appendChild(this._canvas);
    root.appendChild(this._nodesEl);

    if (this.options.showToolbar) {
      this._toolbar = this._buildToolbar();
      root.appendChild(this._toolbar);
    }
    if (this.options.showLegend) {
      this._legend = this._buildLegend();
      root.appendChild(this._legend);
    }

    this._ctx = this._canvas.getContext("2d");
  };

  LineageGraph.prototype._buildToolbar = function () {
    var self = this;
    function btn(label, action, attrs) {
      var b = h("button", Object.assign({ type: "button", "data-action": action }, attrs || {}));
      b.textContent = label;
      return b;
    }
    var zoomGroup = h("div", { class: "lg-controls__group" }, [
      btn("+", "zoom-in", { "aria-label": "Zoom in" }),
      btn("−", "zoom-out", { "aria-label": "Zoom out" }),
      btn("⌂", "fit", { "aria-label": "Fit view" }),
    ]);
    var dirLr = btn("LR", "dir-lr", { "aria-pressed": String(this._state.dir === "LR") });
    var dirTb = btn("TB", "dir-tb", { "aria-pressed": String(this._state.dir === "TB") });
    if (this._state.dir === "LR") dirLr.classList.add("is-active");
    else dirTb.classList.add("is-active");
    var dirGroup = h("div", { class: "lg-controls__group" }, [dirLr, dirTb]);

    var cols = btn("Cols", "cols", { "aria-pressed": String(!!this._state.showColumns) });
    if (this._state.showColumns) cols.classList.add("is-active");
    var colsGroup = h("div", { class: "lg-controls__group" }, [cols]);

    var bar = h("div", { class: "lg-controls", role: "toolbar", "aria-label": "Lineage controls" },
      [zoomGroup, dirGroup, colsGroup]);

    bar.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("button[data-action]");
      if (!b) return;
      ev.stopPropagation();
      var a = b.getAttribute("data-action");
      if (a === "zoom-in") self.zoomIn();
      else if (a === "zoom-out") self.zoomOut();
      else if (a === "fit") self.fitView();
      else if (a === "dir-lr") self.setDirection("LR");
      else if (a === "dir-tb") self.setDirection("TB");
      else if (a === "cols") self.setColumnLineage(!self._state.showColumns);
    });
    return bar;
  };

  LineageGraph.prototype._buildLegend = function () {
    var items = this.options.legendItems;
    if (!items) {
      items = Object.keys(this.options.entityIcons).map(function (k) { return { entity: k, label: k }; });
    }
    var children = items.map(function (item) {
      var d = h("div");
      var dot = h("span", { class: "lg-legend__dot lg-legend__dot--" + item.entity });
      var lbl = document.createTextNode(item.label);
      d.appendChild(dot);
      d.appendChild(lbl);
      return d;
    });
    return h("div", { class: "lg-legend", "aria-label": "Legend" }, children);
  };

  // ----- Layout / geometry ---------------------------------------------

  LineageGraph.prototype._visibleEdges = function () {
    if (this._state.showColumns) return this.edges;
    return this.edges.filter(function (e) { return e.type !== "columnLineage"; });
  };

  LineageGraph.prototype._relayout = function () {
    var r = layout(this.nodes, this._visibleEdges(), {
      direction: this._state.dir,
      nodeWidth: this.options.nodeWidth,
      nodeHeight: this.options.nodeHeight,
      rankSeparation: this.options.rankSeparation,
      nodeSeparation: this.options.nodeSeparation,
    });
    this._state.positions = r.positions;
    this._rebuildGeometry();
  };

  LineageGraph.prototype._rebuildGeometry = function () {
    var positions = this._state.positions, dir = this._state.dir;
    var geom = {};
    var edges = this._visibleEdges();
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
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

  LineageGraph.prototype._renderNodes = function () {
    var self = this;
    var nodesEl = this._nodesEl;
    nodesEl.innerHTML = "";

    var glyphMap = this.options.entityIcons || {};

    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      var p = this._state.positions[n.id];
      if (!p) continue;

      var el = document.createElement("div");
      el.className = "lg-node lg-node--" + (n.entity || n.entityType || "generic");
      if (n.status === "deleted") el.classList.add("is-deleted");
      if (n.status === "deprecated") el.classList.add("is-deprecated");
      if (this._state.selectedNode === n.id) el.classList.add("is-selected");
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      el.style.width = p.w + "px";
      el.style.height = p.h + "px";
      el.tabIndex = 0;
      el.setAttribute("data-node-id", n.id);

      var glyph = glyphMap[n.entity || n.entityType || "generic"] || glyphMap.generic || "●";
      var badges = "";
      if (n.tier) badges += '<span class="lg-badge lg-badge--tier">' + escapeHtml(n.tier) + "</span>";
      if (n.domain) badges += '<span class="lg-badge lg-badge--domain">' + escapeHtml(n.domain) + "</span>";
      if (n.owner) badges += '<span class="lg-badge lg-badge--owner">@' + escapeHtml(n.owner) + "</span>";
      if (n.status === "deleted") badges += '<span class="lg-badge lg-badge--deleted">Deleted</span>';
      if (n.status === "deprecated") badges += '<span class="lg-badge lg-badge--deprecated">Deprecated</span>';

      el.innerHTML =
        '<button class="lg-node__expand lg-node__expand--up" aria-label="Expand upstream" data-expand="up">+</button>' +
        '<button class="lg-node__expand lg-node__expand--down" aria-label="Expand downstream" data-expand="down">+</button>' +
        '<div class="lg-node__row">' +
          '<div class="lg-node__icon">' + glyph + "</div>" +
          '<div class="lg-node__body">' +
            '<div class="lg-node__title">' + escapeHtml(n.name) + "</div>" +
            (n.fullyQualifiedName || n.fqn
              ? '<div class="lg-node__subtitle">' + escapeHtml(n.fullyQualifiedName || n.fqn) + "</div>"
              : "") +
          "</div>" +
        "</div>" +
        (badges ? '<div class="lg-node__badges">' + badges + "</div>" : "");

      this._wireNode(el, n);
      nodesEl.appendChild(el);
    }
    this._applyTransform();
  };

  LineageGraph.prototype._wireNode = function (el, node) {
    var self = this;

    el.addEventListener("click", function (ev) {
      if (ev.target.closest("button")) return;
      if (self._state.suppressNextClick) {
        self._state.suppressNextClick = false;
        ev.stopPropagation();
        return;
      }
      ev.stopPropagation();
      self.selectNode(node.id);
      if (self.options.onNodeClick) self.options.onNodeClick(node, ev);
    });

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

    el.querySelectorAll("[data-expand]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var dir = btn.getAttribute("data-expand");
        if (dir === "up" && self.options.onExpandUpstream) self.options.onExpandUpstream(node);
        else if (dir === "down" && self.options.onExpandDownstream) self.options.onExpandDownstream(node);
      });
    });
  };

  // ----- Canvas drawing -------------------------------------------------

  LineageGraph.prototype._applyTransform = function () {
    var v = this._state.viewport;
    this._nodesEl.style.transform = "translate(" + v.x + "px, " + v.y + "px) scale(" + v.k + ")";
  };

  LineageGraph.prototype._scheduleDraw = function () {
    if (this._state.rafScheduled || this._state.destroyed) return;
    var self = this;
    this._state.rafScheduled = true;
    requestAnimationFrame(function () {
      self._state.rafScheduled = false;
      if (!self._state.destroyed) self._draw();
    });
  };

  LineageGraph.prototype._syncCanvasSize = function () {
    var rect = this.container.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var c = this._canvas;
    c.width = Math.max(1, Math.floor(rect.width * dpr));
    c.height = Math.max(1, Math.floor(rect.height * dpr));
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";
  };

  LineageGraph.prototype._draw = function () {
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
      strokeEdge(ctx, g, baseStyle(g.edge));
    }
    // Accent (neighbors of selected node)
    if (neighbors) {
      for (var k in neighbors) {
        var ng = geom[k];
        if (ng && ng.id !== hoverId && ng.id !== selId) strokeEdge(ctx, ng, accentStyle(ng.edge));
      }
    }
    // Hover
    if (hoverId && geom[hoverId]) strokeEdge(ctx, geom[hoverId], hoverStyle());
    // Selected edge on top
    if (selId && geom[selId]) strokeEdge(ctx, geom[selId], selectedStyle());
  };

  LineageGraph.prototype._neighborEdgeSet = function () {
    var sel = this._state.selectedNode;
    if (!sel) return null;
    var set = {};
    var edges = this._visibleEdges();
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (e.source === sel || e.target === sel) set[e.id] = true;
    }
    return Object.keys(set).length ? set : null;
  };

  function baseStyle(e) {
    if (e.type === "deleted") return { stroke: "#cbd5e1", w: 1.2, dash: [4, 4], arrow: false };
    if (e.type === "columnLineage") return { stroke: "#a78bfa", w: 1.25, dash: [3, 3], arrow: true };
    if (e.type === "inactive") return { stroke: "#cbd5e1", w: 1.2, arrow: true };
    return { stroke: "#94a3b8", w: 1.5, arrow: true };
  }
  function accentStyle(e) {
    if (e.type === "columnLineage") return { stroke: "#8b5cf6", w: 2, arrow: true };
    return { stroke: "#3b82f6", w: 2, arrow: true };
  }
  function hoverStyle() { return { stroke: "#3b82f6", w: 2.25, arrow: true }; }
  function selectedStyle() { return { stroke: "#2563eb", w: 2.5, arrow: true }; }

  function strokeEdge(ctx, geom, style) {
    var pts = geom.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    if (style.arrow) drawArrow(ctx, pts[pts.length - 2], pts[pts.length - 1], style);
  }
  function drawArrow(ctx, from, to, style) {
    var a = Math.atan2(to.y - from.y, to.x - from.x);
    var size = Math.max(6, style.w * 3);
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

  // ----- Pane / hover / pan / zoom --------------------------------------

  LineageGraph.prototype._wireEvents = function () {
    var self = this;
    var root = this.container;

    this._onPaneMouseDown = function (ev) {
      if (ev.target.closest(".lg-node") || ev.target.closest(".lg-controls") || ev.target.closest(".lg-legend")) return;
      self._state.paneDrag = { x: ev.clientX, y: ev.clientY, vx: self._state.viewport.x, vy: self._state.viewport.y };
    };
    this._onWinMouseUp = function () { self._state.paneDrag = null; };
    this._onWinMouseMove = function (ev) {
      if (self._state.nodeDrag) return; // pointer handlers drive node drag
      if (self._state.paneDrag) {
        var pd = self._state.paneDrag;
        self._state.viewport.x = pd.vx + (ev.clientX - pd.x);
        self._state.viewport.y = pd.vy + (ev.clientY - pd.y);
        self._applyTransform();
        self._scheduleDraw();
        return;
      }
      // Edge hover hit-test.
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
      if (ev.target.closest(".lg-node") || ev.target.closest(".lg-controls") || ev.target.closest(".lg-legend")) return;
      // Try edge click first.
      var hovered = self._state.hoveredEdge;
      if (hovered) {
        var e = findEdge(self.edges, hovered);
        if (e) {
          self._state.selectedEdge = e.id;
          self._state.selectedNode = null;
          self._renderNodes();
          self._scheduleDraw();
          if (self.options.onEdgeClick) self.options.onEdgeClick(e, ev);
          return;
        }
      }
      // Otherwise clear selection.
      if (self._state.selectedNode || self._state.selectedEdge) {
        self._state.selectedNode = null;
        self._state.selectedEdge = null;
        self._renderNodes();
        self._scheduleDraw();
      }
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

  LineageGraph.prototype.setNodes = function (nodes) {
    this.nodes = (nodes || []).slice();
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.setEdges = function (edges) {
    this.edges = (edges || []).slice();
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.setData = function (nodes, edges) {
    this.nodes = (nodes || []).slice();
    this.edges = (edges || []).slice();
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.addNode = function (node) {
    this.nodes.push(node);
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.addEdge = function (edge) {
    this.edges.push(edge);
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.removeNode = function (id) {
    this.nodes = this.nodes.filter(function (n) { return n.id !== id; });
    this.edges = this.edges.filter(function (e) { return e.source !== id && e.target !== id; });
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.removeEdge = function (id) {
    this.edges = this.edges.filter(function (e) { return e.id !== id; });
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.setDirection = function (dir) {
    if (dir !== "LR" && dir !== "TB") return;
    this._state.dir = dir;
    if (this._toolbar) {
      var lr = this._toolbar.querySelector('[data-action="dir-lr"]');
      var tb = this._toolbar.querySelector('[data-action="dir-tb"]');
      lr.classList.toggle("is-active", dir === "LR");
      tb.classList.toggle("is-active", dir === "TB");
      lr.setAttribute("aria-pressed", String(dir === "LR"));
      tb.setAttribute("aria-pressed", String(dir === "TB"));
    }
    this._relayout();
    this._renderNodes();
    this.fitView();
  };
  LineageGraph.prototype.setColumnLineage = function (on) {
    this._state.showColumns = !!on;
    if (this._toolbar) {
      var b = this._toolbar.querySelector('[data-action="cols"]');
      b.classList.toggle("is-active", !!on);
      b.setAttribute("aria-pressed", String(!!on));
    }
    this._relayout();
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.selectNode = function (id) {
    this._state.selectedNode = id || null;
    this._state.selectedEdge = null;
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.selectEdge = function (id) {
    this._state.selectedEdge = id || null;
    this._state.selectedNode = null;
    this._renderNodes();
    this._scheduleDraw();
  };
  LineageGraph.prototype.zoomIn = function () {
    var v = this._state.viewport;
    v.k = Math.min(this.options.maxZoom, v.k * 1.2);
    this._applyTransform();
    this._scheduleDraw();
  };
  LineageGraph.prototype.zoomOut = function () {
    var v = this._state.viewport;
    v.k = Math.max(this.options.minZoom, v.k / 1.2);
    this._applyTransform();
    this._scheduleDraw();
  };
  LineageGraph.prototype.fitView = function () {
    var rect = this.container.getBoundingClientRect();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var positions = this._state.positions, any = false;
    for (var id in positions) {
      any = true;
      var p = positions[id];
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x + p.w > maxX) maxX = p.x + p.w; if (p.y + p.h > maxY) maxY = p.y + p.h;
    }
    if (!any) return;
    var pad = this.options.fitPadding;
    var w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2;
    var k = Math.min(rect.width / w, rect.height / h, 1.5);
    var v = this._state.viewport;
    v.k = k;
    v.x = (rect.width - (maxX - minX) * k) / 2 - minX * k;
    v.y = (rect.height - (maxY - minY) * k) / 2 - minY * k;
    this._applyTransform();
    this._scheduleDraw();
  };
  LineageGraph.prototype.getViewport = function () {
    var v = this._state.viewport;
    return { x: v.x, y: v.y, zoom: v.k };
  };
  LineageGraph.prototype.setViewport = function (vp) {
    var v = this._state.viewport;
    if (typeof vp.x === "number") v.x = vp.x;
    if (typeof vp.y === "number") v.y = vp.y;
    if (typeof vp.zoom === "number") v.k = vp.zoom;
    this._applyTransform();
    this._scheduleDraw();
  };
  LineageGraph.prototype.getNodePosition = function (id) {
    var p = this._state.positions[id];
    return p ? { x: p.x, y: p.y } : null;
  };
  LineageGraph.prototype.destroy = function () {
    this._state.destroyed = true;
    window.removeEventListener("mouseup", this._onWinMouseUp);
    window.removeEventListener("mousemove", this._onWinMouseMove);
    this.container.removeEventListener("mousedown", this._onPaneMouseDown);
    this.container.removeEventListener("click", this._onPaneClick);
    this.container.removeEventListener("wheel", this._onWheel);
    if (this._ro) this._ro.disconnect();
    this.container.innerHTML = "";
    this.container.classList.remove("lg");
  };

  return LineageGraph;
});
