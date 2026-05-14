// Kazakh tribes ↔ Y-DNA haplogroups bipartite graph.
//
// Data source: "Y-DNA haplogroups in Kazakh tribes" (Wikipedia). Each
// tribe's dominant paternal haplogroups (and their approximate
// percentages from sampled studies) are encoded as edges in the graph.
//
// Layout: the library's built-in LR hierarchical layout puts tribes at
// rank 0 and haplogroups at rank 1, producing a clean bipartite view.

(function () {
  "use strict";

  // ---- Source data -----------------------------------------------------
  // Sample sizes (n) come from the cited studies summarized on the
  // Wikipedia page. Percentages are dominant-lineage values; minor
  // haplogroups (<2%) are not included.

  var TRIBES = [
    { id: "T_Uysun",    name: "Uysun",    zhuz: "Senior", n: 248 },
    { id: "T_Zhalayir", name: "Zhalayir", zhuz: "Senior", n: 103 },
    { id: "T_Qangly",   name: "Qangly",   zhuz: "Senior", n:  27 },
    { id: "T_Argyn",    name: "Argyn",    zhuz: "Middle", n: 384 },
    { id: "T_Kerey",    name: "Kerey",    zhuz: "Middle", n: 102 },
    { id: "T_Konyrat",  name: "Konyrat",  zhuz: "Middle", n:  90 },
    { id: "T_Kipchak",  name: "Kipchak",  zhuz: "Middle", n: 133 },
    { id: "T_Naiman",   name: "Naiman",   zhuz: "Middle", n: 336 },
    { id: "T_Uaq",      name: "Uaq",      zhuz: "Middle", n:  45 },
    { id: "T_Alimuly",  name: "Alimuly",  zhuz: "Junior", n: 145 },
    { id: "T_Baiuly",   name: "Baiuly",   zhuz: "Junior", n: 130 },
  ];

  // Haplogroup labels and broad family classification (the leading letter).
  var HAPLOS = [
    { id: "H_C2*",       name: "C2*",       family: "C", note: "C2-M217 root (broad Eurasian Steppe)" },
    { id: "H_C2b1a2",    name: "C2b1a2",    family: "C", note: "C2-M48 / C2a1a2 (Mongolic / Naiman)" },
    { id: "H_C2c1a1a1",  name: "C2c1a1a1",  family: "C", note: "C2-M407 (Konyrat)" },
    { id: "H_G1",        name: "G1",        family: "G", note: "G-M285 (predominant in Argyn)" },
    { id: "H_J1",        name: "J1*",       family: "J", note: "J-M267 (Near-Eastern)" },
    { id: "H_J2",        name: "J2*",       family: "J", note: "J-M172 (Anatolia / Caucasus)" },
    { id: "H_J2a1a",     name: "J2a1a",     family: "J", note: "J2a downstream subclade" },
    { id: "H_N1a1a",     name: "N1a1a",     family: "N", note: "N-M178 (Uralic / Siberian)" },
    { id: "H_Q",         name: "Q*",        family: "Q", note: "Q-M242 (Siberian)" },
    { id: "H_R1a1a",     name: "R1a1a*",    family: "R", note: "R-M17 (Indo-European Steppe)" },
  ];

  // Edges: [source tribe, target haplogroup, percentage].
  var EDGES_DATA = [
    // Senior zhuz
    ["T_Uysun",    "H_C2*",      50],
    ["T_Uysun",    "H_C2b1a2",   11],
    ["T_Uysun",    "H_J1",       12],
    ["T_Uysun",    "H_J2a1a",    14.1],
    ["T_Zhalayir", "H_C2*",      38],
    ["T_Zhalayir", "H_C2b1a2",    2],
    ["T_Zhalayir", "H_N1a1a",    22],
    ["T_Qangly",   "H_C2*",       7],
    ["T_Qangly",   "H_Q",        48],
    ["T_Qangly",   "H_J2",        7],
    // Middle zhuz
    ["T_Argyn",    "H_G1",       67],
    ["T_Argyn",    "H_C2*",       3],
    ["T_Argyn",    "H_R1a1a",     6],
    ["T_Kerey",    "H_C2*",      66],
    ["T_Kerey",    "H_G1",        4],
    ["T_Konyrat",  "H_C2c1a1a1", 86],
    ["T_Konyrat",  "H_C2*",       2],
    ["T_Kipchak",  "H_C2*",       2],
    ["T_Kipchak",  "H_R1a1a",     8],
    ["T_Naiman",   "H_C2b1a2",   77],
    ["T_Naiman",   "H_C2*",      10],
    ["T_Naiman",   "H_J2",        2.2],
    ["T_Uaq",      "H_C2*",       2],
    ["T_Uaq",      "H_N1a1a",    64],
    // Junior zhuz
    ["T_Alimuly",  "H_C2b1a2",   77],
    ["T_Alimuly",  "H_C2*",       2],
    ["T_Baiuly",   "H_C2b1a2",   69],
    ["T_Baiuly",   "H_C2*",      13],
  ];

  var EDGES = EDGES_DATA.map(function (e, i) {
    return { id: "E" + i, source: e[0], target: e[1], pct: e[2] };
  });

  // ---- Renderers -------------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderNode(node, el) {
    if (node.kind === "tribe") {
      el.classList.add("tribe", "zhuz--" + node.zhuz.toLowerCase());
      el.innerHTML =
        '<div class="tribe__name">' + escapeHtml(node.name) + '</div>' +
        '<div class="tribe__meta">' +
          '<span class="zhuz">' + escapeHtml(node.zhuz) + '</span>' +
          ' zhuz · n = ' + node.n +
        '</div>';
    } else {
      el.classList.add("haplo", "fam-" + node.family);
      el.innerHTML =
        '<div class="haplo__name">' + escapeHtml(node.name) + '</div>' +
        '<div class="haplo__family">family ' + escapeHtml(node.family) + '</div>';
    }
  }

  // ---- Edge styling ----------------------------------------------------
  // Width = sqrt(pct) so a 64% edge isn't 32× as thick as a 2% one but
  // still clearly heavier. Color = haplogroup family (so when you trace
  // an edge backwards from a tribe, the dominant color tells you which
  // continental lineage that tribe descends from).

  var FAMILY_COLOR = {
    C: "#b91c1c",
    G: "#b45309",
    J: "#6d28d9",
    N: "#0369a1",
    Q: "#be185d",
    R: "#047857",
  };

  function edgeWidth(pct) {
    return 0.6 + Math.sqrt(Math.max(0, pct)) * 0.55; // 0.6 .. ~5.0 px
  }

  function edgeStyle(edge, state) {
    var haplo = HAPLO_BY_ID[edge.target];
    var fam = haplo ? haplo.family : "C";
    var baseColor = FAMILY_COLOR[fam] || "#94a3b8";
    var w = edgeWidth(edge.pct);
    if (state === "hover")    return { stroke: "#0f172a", width: w + 1, arrow: true };
    if (state === "selected") return { stroke: "#0f172a", width: w + 1.5, arrow: true };
    if (state === "neighbor") return { stroke: baseColor, width: w + 0.8, arrow: true };
    // Base: fade lighter as pct drops, so big-frequency edges dominate visually.
    var alpha = Math.max(0.18, Math.min(1, edge.pct / 60));
    return { stroke: hexToRgba(baseColor, alpha), width: w, arrow: true };
  }

  function hexToRgba(hex, a) {
    var h = hex.replace("#", "");
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
  }

  // ---- Build node list with `kind` discriminator ----------------------

  var HAPLO_BY_ID = {};
  HAPLOS.forEach(function (h) { HAPLO_BY_ID[h.id] = h; });
  var TRIBE_BY_ID = {};
  TRIBES.forEach(function (t) { TRIBE_BY_ID[t.id] = t; });

  var NODES = [].concat(
    TRIBES.map(function (t) { return Object.assign({ kind: "tribe", label: t.name }, t); }),
    HAPLOS.map(function (h) { return Object.assign({ kind: "haplo", label: h.name }, h); })
  );

  // ---- Threshold filter ------------------------------------------------

  var minPct = 0; // show all by default

  function visibleEdges() {
    return EDGES.filter(function (e) { return e.pct >= minPct; });
  }

  // ---- Construct the graph --------------------------------------------

  var graph = new Graph(document.getElementById("graph"), {
    nodes: NODES,
    edges: visibleEdges(),
    direction: "LR",
    nodeWidth: 180,
    nodeHeight: 56,
    rankSeparation: 280,   // generous gap so labels and edge weights breathe
    nodeSeparation: 12,
    renderNode: renderNode,
    edgeStyle: edgeStyle,
    hitTolerancePx: 8,
    onNodeClick: showNodeInfo,
    onEdgeClick: showEdgeInfo,
    onPaneClick: clearInfo,
  });

  // ---- Threshold toolbar buttons --------------------------------------

  function setThreshold(p) {
    minPct = p;
    graph.setEdges(visibleEdges());
    refreshToolbar();
  }
  function refreshToolbar() {
    // Library's _refreshToolbar runs after onClick but our buttons share
    // a single state variable; manually toggle is-active.
    document.querySelectorAll('.gv-toolbar [data-id^="th-"]').forEach(function (b) {
      b.classList.remove("is-active");
    });
    var id = "th-" + (minPct === 0 ? "all" : minPct);
    var btn = document.querySelector('.gv-toolbar [data-id="' + id + '"]');
    if (btn) btn.classList.add("is-active");
  }

  graph.addToolbarButton({ id: "th-all", label: "All",    title: "Show every edge",        onClick: function () { setThreshold(0); } }, { newGroup: true });
  graph.addToolbarButton({ id: "th-5",   label: "≥ 5 %",  title: "Hide edges below 5 %",   onClick: function () { setThreshold(5); } });
  graph.addToolbarButton({ id: "th-10",  label: "≥ 10 %", title: "Hide edges below 10 %",  onClick: function () { setThreshold(10); } });
  graph.addToolbarButton({ id: "th-25",  label: "≥ 25 %", title: "Hide edges below 25 %",  onClick: function () { setThreshold(25); } });
  refreshToolbar();

  // ---- Info pane on click ---------------------------------------------

  var info = document.getElementById("info");

  function showNodeInfo(node) {
    if (node.kind === "tribe") {
      // Find all haplogroups for this tribe, sorted by pct desc.
      var rows = EDGES
        .filter(function (e) { return e.source === node.id; })
        .sort(function (a, b) { return b.pct - a.pct; });
      info.innerHTML =
        '<h2>' + escapeHtml(node.name) + ' tribe</h2>' +
        '<p><span class="zhuz" style="color:' + zhuzColor(node.zhuz) + ';font-weight:600">' +
          escapeHtml(node.zhuz) + '</span> zhuz · sample n = ' + node.n + '</p>' +
        '<p class="muted">Dominant paternal haplogroups:</p>' +
        '<div class="badges">' +
          rows.map(function (e) {
            var h = HAPLO_BY_ID[e.target];
            return '<span class="badge" style="border-color:' + FAMILY_COLOR[h.family] + '">' +
                   escapeHtml(h.name) + ' &nbsp;' + e.pct + ' %</span>';
          }).join('') +
        '</div>';
    } else {
      // Haplogroup: list tribes that carry it, sorted by pct.
      var rows2 = EDGES
        .filter(function (e) { return e.target === node.id; })
        .sort(function (a, b) { return b.pct - a.pct; });
      info.innerHTML =
        '<h2>Haplogroup <span style="font-family:ui-monospace,monospace">' +
          escapeHtml(node.name) + '</span></h2>' +
        '<p class="muted">' + escapeHtml(node.note || "") + '</p>' +
        '<p class="muted">Carriers among Kazakh tribes:</p>' +
        '<div class="badges">' +
          rows2.map(function (e) {
            var t = TRIBE_BY_ID[e.source];
            return '<span class="badge" style="border-color:' + zhuzColor(t.zhuz) + '">' +
                   escapeHtml(t.name) + ' &nbsp;' + e.pct + ' %</span>';
          }).join('') +
        '</div>';
    }
  }

  function showEdgeInfo(edge) {
    var t = TRIBE_BY_ID[edge.source];
    var h = HAPLO_BY_ID[edge.target];
    info.innerHTML =
      '<h2>' + escapeHtml(t.name) + ' → ' + escapeHtml(h.name) + '</h2>' +
      '<p><strong>' + edge.pct + ' %</strong> of sampled ' +
        escapeHtml(t.name) + ' males carry <span style="font-family:ui-monospace,monospace">' +
        escapeHtml(h.name) + '</span>.</p>' +
      '<p class="muted">' + escapeHtml(h.note || "") + '</p>';
  }

  function clearInfo() {
    info.innerHTML =
      '<h2>Click a node</h2>' +
      '<p class="muted">Click a tribe to see which haplogroups dominate ' +
        'its paternal lineage. Click a haplogroup to see which tribes ' +
        'carry it most.</p>';
  }

  function zhuzColor(z) {
    return z === "Senior" ? "#2563eb"
         : z === "Middle" ? "#047857"
         : "#b45309";
  }

  // Expose for the test/probe harness.
  window.__demo = {
    graph: graph,
    get nodes() { return graph.nodes; },
    get edges() { return graph.edges; },
    setThreshold: setThreshold,
  };
})();
