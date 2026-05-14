// Kazakh tribes — paternal haplogroup multigraph.
//
//   Tribes  = nodes
//   Haplogroups = edges
//
// If two tribes both carry haplogroup H (above a minimum threshold), an
// edge of "type H" connects them. Two tribes can be linked by multiple
// parallel edges if they share multiple haplogroups — each edge is a
// distinct haplogroup connection, drawn in that haplogroup's color.
// Edge weight = min(A.pct[H], B.pct[H]).

(function () {
  "use strict";

  // ---- Source data -----------------------------------------------------
  //
  // Y-haplogroup frequencies per tribe (%), values >= 2 only. Source:
  // "Y-DNA haplogroups in Kazakh tribes" (Wikipedia) — primary table.
  // Minor haplogroups (<2%) are omitted so they don't dominate edge
  // counts. Sample sizes (n) come from the cited primary studies.
  var TRIBES = [
    { id: "Uysun",    name: "Uysun",    zhuz: "Senior", n: 248,
      haplo: { "C2*": 50, "C2b1a2": 11, "G1": 3,  "J1*": 12, "J2*": 8,  "N1a1a": 4,  "R1a1a*": 4 } },
    { id: "Zhalayir", name: "Zhalayir", zhuz: "Senior", n: 103,
      haplo: { "C2*": 38, "C2b1a2": 2,  "J2*": 3,  "N1a1a": 22, "Q*": 6, "R1a1a*": 8 } },
    { id: "Qangly",   name: "Qangly",   zhuz: "Senior", n:  27,
      haplo: { "C2*": 7,  "G1": 7,  "J1*": 4,  "J2*": 7,  "J2a1a": 7,  "Q*": 48, "R1a1a*": 4 } },
    { id: "Argyn",    name: "Argyn",    zhuz: "Middle", n: 384,
      haplo: { "C2*": 3,  "C2b1a2": 5, "G1": 67, "J1*": 2,  "J2*": 3,  "N1a1a": 2,  "Q*": 2,  "R1a1a*": 6 } },
    { id: "Kerey",    name: "Kerey",    zhuz: "Middle", n: 102,
      haplo: { "C2*": 66, "C2b1a2": 9, "G1": 4,  "J1*": 4,  "J2*": 2,  "Q*": 3,  "R1a1a*": 7 } },
    { id: "Konyrat",  name: "Konyrat",  zhuz: "Middle", n:  90,
      haplo: { "C2*": 2,  "C2c1a1a1": 86, "N1a1a": 3,  "R1a1a*": 4 } },
    { id: "Kipchak",  name: "Kipchak",  zhuz: "Middle", n: 133,
      haplo: { "C2*": 2,  "C2b1a2": 2, "G1": 5,  "J2*": 22, "R1a1a*": 8 } },
    { id: "Naiman",   name: "Naiman",   zhuz: "Middle", n: 336,
      haplo: { "C2*": 10, "C2b1a2": 27, "N1a1a": 2,  "R1a1a*": 2 } },
    { id: "Uaq",      name: "Uaq",      zhuz: "Middle", n:  45,
      haplo: { "C2*": 2,  "C2b1a2": 7, "C2c1a1a1": 4, "G1": 4,  "J1*": 4,  "N1a1a": 64, "R1a1a*": 2 } },
    { id: "Alimuly",  name: "Alimuly",  zhuz: "Junior", n: 145,
      haplo: { "C2*": 2,  "C2b1a2": 77, "Q*": 6,  "R1a1a*": 3 } },
    { id: "Baiuly",   name: "Baiuly",   zhuz: "Junior", n: 130,
      haplo: { "C2*": 13, "C2b1a2": 69, "J1*": 2,  "J2*": 2,  "N1a1a": 3,  "Q*": 2,  "R1a1a*": 3 } },
  ];

  // Three columns by zhuz. Library's "vertical sibling" routing keeps
  // same-column edges clean.
  var COL_X = { Senior: 80, Middle: 580, Junior: 1080 };
  var COL_Y = {
    Senior: [130, 290, 450],
    Middle: [40, 170, 300, 430, 560, 690],
    Junior: [220, 380],
  };
  var slot = { Senior: 0, Middle: 0, Junior: 0 };
  TRIBES.forEach(function (t) {
    t.position = { x: COL_X[t.zhuz], y: COL_Y[t.zhuz][slot[t.zhuz]++] };
  });

  // ---- Color map: evolution-demo palette by haplogroup ----------------
  // C2b1a2 ("C-M48") gets homo gold because it's the founder lineage
  // story — three tribes across two zhuzes carry it at high frequency.
  var HAPLO_COLOR = {
    "C2*":       "#dc2626",   // animal red — broad Eurasian Steppe
    "C2b1a2":    "#fbbf24",   // homo gold  — C-M48 founder lineage
    "C2c1a1a1":  "#f43f5e",   // rose       — C-M407, Konyrat-only
    "G1":        "#f97316",   // vertebrate orange — Caucasus / W. Asia
    "J1*":       "#a855f7",   // primate purple — Near East
    "J2*":       "#a855f7",
    "J2a1a":     "#a855f7",
    "N1a1a":     "#0284c7",   // bacteria blue — N. Eurasian / Uralic
    "Q*":        "#ec4899",   // mammal pink — Inner Asian
    "R1a1a*":    "#16a34a",   // plant green — Indo-European
  };
  function haploColor(h) { return HAPLO_COLOR[h] || "#94a3b8"; }

  // ---- Build the multigraph -------------------------------------------
  // One edge per (tribe-pair, shared haplogroup). Each edge has a SINGLE
  // haplogroup identity, so it can be drawn in the haplogroup's color.

  // Collect every (haplogroup, [tribes carrying it]) entry.
  var HAPLOS = {};   // haplogroup id -> list of { tribe, pct }
  TRIBES.forEach(function (t) {
    for (var h in t.haplo) {
      (HAPLOS[h] = HAPLOS[h] || []).push({ tribe: t, pct: t.haplo[h] });
    }
  });

  // Generate all (pair, haplogroup) edges. Filter by min(A, B) >= threshold
  // so we keep meaningful connections and avoid 55 weak C2* lines.
  // Default 10 % — tunable from the toolbar.
  var DEFAULT_MIN = 10;

  function buildEdges(minMin) {
    var edges = [];
    for (var h in HAPLOS) {
      var carriers = HAPLOS[h];
      for (var i = 0; i < carriers.length; i++) {
        for (var j = i + 1; j < carriers.length; j++) {
          var a = carriers[i], b = carriers[j];
          var mn = Math.min(a.pct, b.pct);
          if (mn < minMin) continue;
          edges.push({
            id: "E_" + a.tribe.id + "_" + b.tribe.id + "_" + h,
            source: a.tribe.id,
            target: b.tribe.id,
            haplogroup: h,
            pctA: a.pct,
            pctB: b.pct,
            weight: mn,
          });
        }
      }
    }
    return assignCurveOffsets(edges);
  }

  // Group parallel edges (same source/target pair) and assign each one
  // a perpendicular curve offset so they fan out instead of overlapping.
  // Offsets centered on 0: a single edge stays straight, two edges go to
  // ±k, three go to {-k, 0, +k}, etc.
  function assignCurveOffsets(edges) {
    var byPair = {};
    edges.forEach(function (e) {
      var key = e.source < e.target
        ? e.source + "|" + e.target
        : e.target + "|" + e.source;
      (byPair[key] = byPair[key] || []).push(e);
    });
    var SPACING = 40;
    Object.values(byPair).forEach(function (group) {
      // Stable order: by haplogroup name, so layout is reproducible.
      group.sort(function (a, b) { return a.haplogroup < b.haplogroup ? -1 : 1; });
      var n = group.length;
      group.forEach(function (e, i) {
        e.curveOffset = (i - (n - 1) / 2) * SPACING;
      });
    });
    return edges;
  }

  // ---- Renderers ------------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderNode(node, el) {
    el.classList.add("tribe", "zhuz--" + node.zhuz.toLowerCase());
    el.innerHTML =
      '<div class="tribe__name">' + escapeHtml(node.name) + '</div>' +
      '<div class="tribe__meta">' +
        '<span class="zhuz">' + escapeHtml(node.zhuz) + '</span>' +
        ' · n = ' + node.n +
      '</div>';
  }

  // Edge weight scales width modestly; the founder edges (~77) read
  // clearly heavier than the broad-Steppe ones (~10-50) without dwarfing.
  function edgeWidth(w) {
    return 1.2 + Math.sqrt(Math.max(0, w)) * 0.55;
  }

  function edgeStyle(edge, state) {
    var c = haploColor(edge.haplogroup);
    var w = edgeWidth(edge.weight);
    if (state === "hover")    return { stroke: "#f1f5f9", width: w + 1.0, arrow: false };
    if (state === "selected") return { stroke: "#f1f5f9", width: w + 1.5, arrow: false };
    if (state === "neighbor") return { stroke: c, width: w + 0.6, arrow: false };
    var alpha = Math.max(0.45, Math.min(1, edge.weight / 50));
    return { stroke: hexToRgba(c, alpha), width: w, arrow: false };
  }

  function hexToRgba(hex, a) {
    var h = hex.replace("#", "");
    return "rgba(" + parseInt(h.substring(0, 2), 16) + "," +
                     parseInt(h.substring(2, 4), 16) + "," +
                     parseInt(h.substring(4, 6), 16) + "," + a.toFixed(2) + ")";
  }

  // ---- Construct the graph -------------------------------------------

  var TRIBE_BY_ID = {};
  TRIBES.forEach(function (t) { TRIBE_BY_ID[t.id] = t; });

  var EDGES = buildEdges(DEFAULT_MIN);

  var graph = new Graph(document.getElementById("graph"), {
    nodes: TRIBES.map(function (t) { return Object.assign({ label: t.name }, t); }),
    edges: EDGES,
    direction: "LR",
    nodeWidth: 200,
    nodeHeight: 56,
    renderNode: renderNode,
    edgeStyle: edgeStyle,
    hitTolerancePx: 8,
    onNodeClick: showTribeInfo,
    onEdgeClick: showEdgeInfo,
    onPaneClick: clearInfo,
  });

  // ---- Toolbar --------------------------------------------------------
  // Two filter dimensions: minimum overlap (threshold) and per-haplogroup
  // visibility toggle. Together they let you isolate "show me only the
  // C-M48 connections at high frequency" etc.

  var minOverlap = DEFAULT_MIN;
  var hiddenHaplos = {};

  function refresh() {
    var all = buildEdges(minOverlap);
    var filtered = all.filter(function (e) { return !hiddenHaplos[e.haplogroup]; });
    graph.setEdges(filtered);
    refreshButtons();
  }
  function refreshButtons() {
    document.querySelectorAll('.gv-toolbar [data-id^="th-"]').forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-id") === ("th-" + (minOverlap === 5 ? "all" : minOverlap)));
    });
    document.querySelectorAll('.gv-toolbar [data-id^="h-"]').forEach(function (b) {
      var h = b.getAttribute("data-haplo");
      b.classList.toggle("is-active", !hiddenHaplos[h]);
    });
  }

  // Threshold controls
  graph.addToolbarButton({ id: "th-all", label: "All",   title: "Min overlap ≥ 5 %",  onClick: function () { minOverlap = 5;  refresh(); } }, { newGroup: true });
  graph.addToolbarButton({ id: "th-10",  label: "≥ 10",  title: "Min overlap ≥ 10 %", onClick: function () { minOverlap = 10; refresh(); } });
  graph.addToolbarButton({ id: "th-25",  label: "≥ 25",  title: "Min overlap ≥ 25 %", onClick: function () { minOverlap = 25; refresh(); } });
  graph.addToolbarButton({ id: "th-50",  label: "≥ 50",  title: "Min overlap ≥ 50 %", onClick: function () { minOverlap = 50; refresh(); } });

  // Per-haplogroup toggle (one button per haplogroup that contributes
  // edges at the default threshold).
  var SHOWN_HAPLOS = [];
  Object.keys(HAPLOS).forEach(function (h) {
    // Only include haplogroups that connect at least one pair at the
    // default threshold.
    var any = buildEdges(DEFAULT_MIN).some(function (e) { return e.haplogroup === h; });
    if (any) SHOWN_HAPLOS.push(h);
  });
  SHOWN_HAPLOS.forEach(function (h, i) {
    graph.addToolbarButton({
      id: "h-" + h.replace(/[^a-zA-Z0-9]/g, ""),
      label: h,
      title: "Toggle " + h + " edges",
      onClick: function () {
        hiddenHaplos[h] = !hiddenHaplos[h];
        refresh();
      },
    }, i === 0 ? { newGroup: true } : undefined);
    // Color the button label.
    setTimeout(function () {
      var b = document.querySelector('.gv-toolbar [data-id="h-' + h.replace(/[^a-zA-Z0-9]/g, "") + '"]');
      if (b) {
        b.setAttribute("data-haplo", h);
        b.style.borderBottom = "2px solid " + haploColor(h);
      }
    }, 0);
  });
  refreshButtons();

  // ---- Layout selector -------------------------------------------------
  // Default = static zhuz columns (each tribe has node.position set).
  // Switching to FA2 requires stripping node.position so the algorithm
  // can place tribes freely. Switching back restores the original
  // hand-tuned columns.

  function nodesWithPositions() {
    return TRIBES.map(function (t) { return Object.assign({ label: t.name }, t); });
  }
  function nodesWithoutPositions() {
    return TRIBES.map(function (t) {
      var copy = Object.assign({ label: t.name }, t);
      delete copy.position;
      return copy;
    });
  }

  graph.addToolbarButton({
    id: "lay-zhuz", label: "Zhuz",
    title: "Default: three columns by zhuz (Senior / Middle / Junior)",
    onClick: function (g) {
      g.setNodes(nodesWithPositions());
      g.setLayout("auto");
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "auto" || n === "hierarchical"; },
  }, { newGroup: true });
  graph.addToolbarButton({
    id: "lay-fa2", label: "FA2",
    title: "ForceAtlas2 — clusters emerge from haplogroup similarity",
    onClick: function (g) {
      g.setNodes(nodesWithoutPositions());
      g.setLayout({
        name: "forceatlas2",
        iterations: 300, seed: 5, gravity: 1, scalingRatio: 20,
        preventOverlap: true,
      });
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "forceatlas2" || n === "fa2"; },
  });

  // ---- Info pane ------------------------------------------------------

  var info = document.getElementById("info");

  function haploPill(h) {
    return '<span class="haplo" style="border-color:' + haploColor(h) + ';color:' + haploColor(h) + '">' +
           escapeHtml(h) + '</span>';
  }

  function showTribeInfo(node) {
    // The tribe's own haplogroup composition.
    var ownRows = Object.keys(node.haplo)
      .sort(function (a, b) { return node.haplo[b] - node.haplo[a]; })
      .map(function (h) {
        return '<div style="display:flex;justify-content:space-between;padding:3px 0">' +
               haploPill(h) +
               '<span class="muted" style="font-variant-numeric:tabular-nums">' + node.haplo[h] + ' %</span>' +
               '</div>';
      }).join("");

    // Every haplogroup-edge incident to this tribe, in current graph.
    var visible = graph.edges.filter(function (e) {
      return e.source === node.id || e.target === node.id;
    });
    visible.sort(function (a, b) { return b.weight - a.weight; });

    var edgeRows = visible.map(function (e) {
      var other = e.source === node.id ? TRIBE_BY_ID[e.target] : TRIBE_BY_ID[e.source];
      var thisPct = e.source === node.id ? e.pctA : e.pctB;
      var otherPct = e.source === node.id ? e.pctB : e.pctA;
      return '<div class="neighbor-row">' +
        '<div>' +
          haploPill(e.haplogroup) +
          ' <span class="neighbor-name">' + escapeHtml(other.name) + '</span>' +
          '<span class="muted" style="font-size:10px"> · ' + escapeHtml(other.zhuz) + '</span>' +
        '</div>' +
        '<div class="muted" style="font-variant-numeric:tabular-nums;font-size:11px">' +
          thisPct + ' / ' + otherPct + ' → <strong style="color:#f1f5f9">' + e.weight.toFixed(0) + '</strong>' +
        '</div>' +
      '</div>';
    }).join("");

    info.innerHTML =
      '<h2>' + escapeHtml(node.name) + '</h2>' +
      '<p class="muted"><span class="zhuz">' + escapeHtml(node.zhuz) + '</span> zhuz · sample n = ' + node.n + '</p>' +
      '<p class="muted">Haplogroups in this tribe:</p>' + ownRows +
      (edgeRows
        ? '<p class="muted" style="margin-top:10px">Haplogroup edges (' + visible.length + '):</p>' + edgeRows
        : '<p class="muted">No haplogroup edges above the current threshold.</p>');
  }

  function showEdgeInfo(edge) {
    var a = TRIBE_BY_ID[edge.source], b = TRIBE_BY_ID[edge.target];
    info.innerHTML =
      '<h2>' + haploPill(edge.haplogroup) + ' edge</h2>' +
      '<p>Connects <strong>' + escapeHtml(a.name) + '</strong> &nbsp;~&nbsp; <strong>' + escapeHtml(b.name) + '</strong></p>' +
      '<p>' + escapeHtml(a.name) + ' carries ' + edge.haplogroup + ' at <strong style="color:#f1f5f9">' + edge.pctA + ' %</strong></p>' +
      '<p>' + escapeHtml(b.name) + ' carries ' + edge.haplogroup + ' at <strong style="color:#f1f5f9">' + edge.pctB + ' %</strong></p>' +
      '<p class="muted">Edge weight = min(' + edge.pctA + ', ' + edge.pctB + ') = <strong style="color:#f1f5f9">' + edge.weight.toFixed(0) + '</strong></p>' +
      '<p class="muted" style="margin-top:10px">An edge of type <strong>' + escapeHtml(edge.haplogroup) + '</strong> exists between any two tribes that both carry this haplogroup above the current threshold.</p>';
  }

  function clearInfo() {
    info.innerHTML =
      '<h2>Tribes = nodes, haplogroups = edges</h2>' +
      '<p class="muted">Two tribes are connected by an edge for every ' +
      'paternal haplogroup they both carry above the threshold. Edge ' +
      'color identifies the haplogroup; edge weight is the joint ' +
      'frequency <code>min(A %, B %)</code>.</p>' +
      '<p class="muted">Click a tribe to see all its haplogroup-edges. ' +
      'Click an edge to see the per-pair breakdown.</p>';
  }

  // Test hook.
  window.__demo = {
    graph: graph,
    get nodes() { return graph.nodes; },
    get edges() { return graph.edges; },
    buildEdges: buildEdges,
  };
})();
