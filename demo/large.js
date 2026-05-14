// Stress demo: 1000 nodes, 3000 edges, layered DAG.
//
// Generated procedurally so changing the constants below scales it up
// or down. Uses the general-purpose Graph library — same code path as
// the lineage demo, just different data and a smaller renderNode.

(function () {
  "use strict";

  var NODE_COUNT = 1000;
  var EDGE_COUNT = 3000;
  var LAYERS = 10; // 100 nodes per layer

  // Deterministic PRNG so the graph is reproducible across reloads.
  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) | 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(42);
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

  var LAYER_COLORS = [
    "#2563eb", "#0ea5e9", "#06b6d4", "#10b981", "#84cc16",
    "#eab308", "#f97316", "#ef4444", "#ec4899", "#8b5cf6",
  ];

  function generate() {
    var nodes = new Array(NODE_COUNT);
    var perLayer = Math.floor(NODE_COUNT / LAYERS);
    var byLayer = [];
    for (var L = 0; L < LAYERS; L++) byLayer.push([]);

    for (var i = 0; i < NODE_COUNT; i++) {
      var layer = Math.min(LAYERS - 1, Math.floor(i / perLayer));
      var id = "n" + i;
      nodes[i] = {
        id: id,
        label: id,
        layer: layer,
        color: LAYER_COLORS[layer],
      };
      byLayer[layer].push(id);
    }

    var edges = [];
    var used = new Set();

    function addEdge(src, tgt) {
      if (src === tgt) return false;
      var key = src + "->" + tgt;
      if (used.has(key)) return false;
      used.add(key);
      edges.push({ id: "e" + edges.length, source: src, target: tgt });
      return true;
    }

    // 1) Forward edges from each layer to the next (~3 per node on avg).
    for (var L2 = 0; L2 < LAYERS - 1; L2++) {
      var src = byLayer[L2], tgt = byLayer[L2 + 1];
      for (var j = 0; j < src.length; j++) {
        var fanout = 2 + Math.floor(rand() * 3); // 2..4
        for (var f = 0; f < fanout && edges.length < EDGE_COUNT; f++) {
          addEdge(src[j], tgt[Math.floor(rand() * tgt.length)]);
        }
        if (edges.length >= EDGE_COUNT) break;
      }
      if (edges.length >= EDGE_COUNT) break;
    }
    // 2) Some skip-layer edges (forward only, to keep DAG).
    var attempts = 0;
    while (edges.length < EDGE_COUNT && attempts < EDGE_COUNT * 5) {
      attempts++;
      var sl = Math.floor(rand() * (LAYERS - 1));
      var tl = sl + 1 + Math.floor(rand() * (LAYERS - sl - 1));
      var s = pick(byLayer[sl]), t = pick(byLayer[tl]);
      addEdge(s, t);
    }

    return { nodes: nodes, edges: edges };
  }

  // --- Generate + construct -------------------------------------------------
  var t0 = performance.now();
  var data = generate();
  var genMs = performance.now() - t0;

  document.getElementById("stat-nodes").textContent = data.nodes.length.toLocaleString();
  document.getElementById("stat-edges").textContent = data.edges.length.toLocaleString();

  var t1 = performance.now();
  var graph = new Graph(document.getElementById("graph"), {
    nodes: data.nodes,
    edges: data.edges,

    direction: "LR",
    nodeWidth: 80,
    nodeHeight: 26,
    rankSeparation: 90,
    nodeSeparation: 8,

    // Light-weight renderer — every byte counts at this scale.
    renderNode: function (node, el) {
      el.classList.add("mini");
      el.innerHTML =
        '<div class="mini__bar" style="background:' + node.color + '"></div>' +
        '<div class="mini__label">' + node.label + "</div>";
    },

    // Edge styling stays cheap — single gray base color, no fancy state branches.
    edgeStyle: function (edge) {
      return { stroke: "#cbd5e1", width: 1, arrow: true };
    },

    minZoom: 0.05,
    maxZoom: 2,
    fitPadding: 60,
  });
  var buildMs = performance.now() - t1;
  document.getElementById("stat-build").textContent = (genMs + buildMs).toFixed(0);

  // ---- Layout selector ---------------------------------------------------
  // FA2 on 1000 nodes is O(N²) per iteration; default to fewer iterations
  // so the switch isn't punishingly slow. The layered DAG starting point
  // helps FA2 converge with less work.
  graph.addToolbarButton({
    id: "lay-auto", label: "Hier",
    title: "Hierarchical layered layout (default)",
    onClick: function (g) { g.setLayout("auto"); },
    pressed: function (g) { var n = g.getLayoutName(); return n === "auto" || n === "hierarchical"; },
  }, { newGroup: true });
  graph.addToolbarButton({
    id: "lay-fa2", label: "FA2",
    title: "ForceAtlas2 — slower at 1000 nodes; reduce iterations if needed",
    onClick: function (g) {
      var t0 = performance.now();
      g.setLayout({ name: "forceatlas2", iterations: 60, seed: 1, gravity: 1, scalingRatio: 8 });
      console.log("FA2 layout (1000 nodes / 3000 edges):", (performance.now() - t0).toFixed(0), "ms");
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "forceatlas2" || n === "fa2"; },
  });
  graph.addToolbarButton({
    id: "lay-fr", label: "FR",
    title: "Fruchterman–Reingold — slower at 1000 nodes",
    onClick: function (g) {
      var t0 = performance.now();
      g.setLayout({ name: "fr", iterations: 60, seed: 1, gravity: 0.3, width: 6000, height: 6000 });
      console.log("FR layout (1000 nodes / 3000 edges):", (performance.now() - t0).toFixed(0), "ms");
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "fr" || n === "fruchterman-reingold" || n === "fruchtermanReingold"; },
  });

  // --- FPS meter (idle when nothing is moving) ------------------------------
  var fpsEl = document.getElementById("stat-fps");
  var frames = 0;
  var lastTick = performance.now();
  function tick(now) {
    frames++;
    if (now - lastTick >= 500) {
      var fps = (frames * 1000) / (now - lastTick);
      fpsEl.textContent = fps.toFixed(0);
      fpsEl.classList.remove("is-good", "is-mid", "is-bad");
      fpsEl.classList.add(fps >= 50 ? "is-good" : fps >= 25 ? "is-mid" : "is-bad");
      frames = 0;
      lastTick = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Expose for Playwright assessment.
  window.__demo = {
    graph: graph,
    get nodes() { return graph.nodes; },
    get edges() { return graph.edges; },
    timing: { genMs: genMs, buildMs: buildMs },
  };
})();
