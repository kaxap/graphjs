// Demo: build a lineage-style graph on top of the GENERAL-PURPOSE Graph
// library. The library itself knows nothing about lineage, entity types,
// tiers, owners, or column lineage — that's all done here in user-space
// via renderNode, edgeStyle, custom toolbar buttons, and CSS classes.

(function () {
  "use strict";

  // ---- Mock data ---------------------------------------------------------
  // Each node is an opaque object; the library only requires `id`. The
  // rest of the fields (entity, tier, domain, owner, status, fqn) are
  // domain-specific and consumed by our renderNode hook below.

  var NODES = [
    { id: "topic.orders",       entity: "topic",     name: "orders.events",         fqn: "kafka.orders.events",            owner: "checkout",     tier: "Tier-1", domain: "Commerce" },
    { id: "pipeline.ingest",    entity: "pipeline",  name: "ingest_orders",         fqn: "airflow.ingest_orders",          owner: "data-eng",                     domain: "Commerce" },
    { id: "db.raw",             entity: "database",  name: "raw",                   fqn: "warehouse.raw",                  owner: "data-platform" },
    { id: "table.raw.orders",   entity: "table",     name: "raw_orders",            fqn: "warehouse.raw.orders",           owner: "data-eng",     tier: "Tier-2" },
    { id: "table.staging.orders", entity: "table",   name: "stg_orders",            fqn: "warehouse.staging.orders",       owner: "analytics",    tier: "Tier-2" },
    { id: "table.mart.orders",  entity: "table",     name: "fct_orders",            fqn: "warehouse.mart.fct_orders",      owner: "analytics",    tier: "Tier-1", domain: "Commerce" },
    { id: "dashboard.revenue",  entity: "dashboard", name: "Revenue Overview",      fqn: "looker.revenue_overview",        owner: "finance",      tier: "Tier-1", domain: "Finance" },
    { id: "mlmodel.churn",      entity: "mlmodel",   name: "churn_predictor_v3",    fqn: "mlflow.churn_predictor_v3",      owner: "ml-platform",                  status: "deprecated" },
    { id: "table.legacy",       entity: "table",     name: "legacy_orders",         fqn: "warehouse.archive.legacy_orders",                                       status: "deleted" },
  ];

  var EDGES = [
    { id: "e1", source: "topic.orders",          target: "pipeline.ingest" },
    { id: "e2", source: "pipeline.ingest",       target: "table.raw.orders" },
    { id: "e3", source: "db.raw",                target: "table.raw.orders" },
    { id: "e4", source: "table.raw.orders",      target: "table.staging.orders" },
    { id: "e5", source: "table.staging.orders",  target: "table.mart.orders" },
    { id: "e6", source: "table.mart.orders",     target: "dashboard.revenue" },
    { id: "e7", source: "table.mart.orders",     target: "mlmodel.churn" },
    { id: "e8", source: "table.legacy",          target: "table.mart.orders", kind: "deleted" },
    // Column-lineage edges — filtered in/out by the custom toolbar button.
    { id: "c1", source: "table.raw.orders",      target: "table.staging.orders", kind: "columnLineage" },
    { id: "c2", source: "table.staging.orders",  target: "table.mart.orders",    kind: "columnLineage" },
  ];

  var ENTITY_GLYPH = {
    table: "▦", dashboard: "▤", pipeline: "⇢", topic: "≋",
    mlmodel: "◈", container: "▢", database: "◫", schema: "▥",
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- Customization: how each node card looks --------------------------
  function renderLineageNode(node, el) {
    var glyph = ENTITY_GLYPH[node.entity] || "●";
    var badges = "";
    if (node.tier)   badges += '<span class="badge badge--tier">' + escapeHtml(node.tier) + "</span>";
    if (node.domain) badges += '<span class="badge badge--domain">' + escapeHtml(node.domain) + "</span>";
    if (node.owner)  badges += '<span class="badge badge--owner">@' + escapeHtml(node.owner) + "</span>";
    if (node.status === "deleted")    badges += '<span class="badge badge--deleted">Deleted</span>';
    if (node.status === "deprecated") badges += '<span class="badge badge--deprecated">Deprecated</span>';

    el.classList.add("lineage-card");
    el.classList.add("lineage-card--" + (node.entity || "generic"));
    if (node.status) el.classList.add("is-" + node.status);

    el.innerHTML =
      '<div class="lineage-card__row">' +
        '<div class="lineage-card__icon">' + glyph + "</div>" +
        '<div class="lineage-card__main">' +
          '<div class="lineage-card__title">' + escapeHtml(node.name || node.id) + "</div>" +
          (node.fqn ? '<div class="lineage-card__subtitle">' + escapeHtml(node.fqn) + "</div>" : "") +
        "</div>" +
      "</div>" +
      (badges ? '<div class="lineage-card__badges">' + badges + "</div>" : "");
  }

  // ---- Customization: per-edge style based on `kind` --------------------
  function lineageEdgeStyle(edge /*, state */) {
    if (edge.kind === "columnLineage")
      return { stroke: "#a78bfa", width: 1.25, dash: [3, 3], arrow: true };
    if (edge.kind === "deleted")
      return { stroke: "#cbd5e1", width: 1.2, dash: [4, 4], arrow: false };
    if (edge.kind === "inactive")
      return { stroke: "#cbd5e1", width: 1.2, arrow: true };
    return { stroke: "#94a3b8", width: 1.5, arrow: true };
  }

  // ---- Per-instance state for the column-lineage toggle ----------------
  var showColumns = false;
  function visibleEdges() {
    return showColumns ? EDGES : EDGES.filter(function (e) { return e.kind !== "columnLineage"; });
  }

  var siblingCounter = 0;
  function addSibling(node, dir) {
    siblingCounter += 1;
    var id = node.id + "." + dir + "." + siblingCounter;
    var suffix = dir === "up" ? "src" : "ext";
    var newNode = {
      id: id, entity: "table",
      name: (node.name || node.id) + "__" + suffix + siblingCounter,
      fqn: (node.fqn || node.name) + "__" + suffix + siblingCounter,
      owner: node.owner, domain: node.domain,
    };
    NODES.push(newNode);
    if (dir === "up") EDGES.push({ id: "e." + id + "->" + node.id, source: id, target: node.id });
    else              EDGES.push({ id: "e." + node.id + "->" + id, source: node.id, target: id });
    graph.setData(NODES, visibleEdges());
  }

  // ---- Construct the library --------------------------------------------
  var graph = new Graph(document.getElementById("graph"), {
    nodes: NODES,
    edges: visibleEdges(),

    direction: "LR",
    nodeWidth: 240,
    nodeHeight: 86,

    renderNode: renderLineageNode,
    edgeStyle: lineageEdgeStyle,
    expandable: true,

    // Append a custom toolbar button alongside the library's defaults.
    toolbarButtons: null, // use defaults; we'll add Cols below

    onNodeClick: function (n) { console.log("node click", n.id); },
    onEdgeClick: function (e) { console.log("edge click", e.id); },
    onExpand: function (n, dir) { addSibling(n, dir); },
  });

  // Add a Cols toggle that the library knows nothing about.
  graph.addToolbarButton({
    id: "cols",
    label: "Cols",
    title: "Toggle column lineage",
    onClick: function (g) { showColumns = !showColumns; g.setEdges(visibleEdges()); },
    pressed: function () { return showColumns; },
  }, { newGroup: true });

  // Layout selector — switch between the default hierarchical layout
  // and ForceAtlas2 at runtime.
  graph.addToolbarButton({
    id: "lay-auto",
    label: "Hier",
    title: "Hierarchical (rank-based) layout",
    onClick: function (g) { g.setLayout("auto"); },
    pressed: function (g) { return g.getLayoutName() === "auto" || g.getLayoutName() === "hierarchical"; },
  }, { newGroup: true });
  graph.addToolbarButton({
    id: "lay-fa2",
    label: "FA2",
    title: "ForceAtlas2 force-directed layout",
    onClick: function (g) {
      g.setLayout({ name: "forceatlas2", iterations: 200, seed: 1, gravity: 1, scalingRatio: 12 });
    },
    pressed: function (g) { return g.getLayoutName() === "forceatlas2" || g.getLayoutName() === "fa2"; },
  });
  graph.addToolbarButton({
    id: "lay-fr",
    label: "FR",
    title: "Fruchterman–Reingold force-directed layout",
    onClick: function (g) {
      g.setLayout({ name: "fr", iterations: 200, seed: 1, gravity: 1.0, width: 700, height: 500 });
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "fr" || n === "fruchterman-reingold" || n === "fruchtermanReingold"; },
  });
  graph.addToolbarButton({
    id: "lay-yh",
    label: "YH",
    title: "Yifan Hu force-directed layout (adaptive step size)",
    onClick: function (g) {
      // YH equilibrium edge length ≈ 0.585·K. Pick K so that comfortably
      // exceeds the card width (240 px) — otherwise neighbors crowd each
      // other on dense parts of the graph.
      g.setLayout({ name: "yh", iterations: 300, seed: 1, gravity: 0.08, K: 500 });
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "yh" || n === "yifan-hu" || n === "yifanHu"; },
  });

  // Test hooks.
  window.__demo = {
    graph: graph,
    get nodes() { return graph.nodes; },
    get edges() { return graph.edges; },
    get showColumns() { return showColumns; },
  };
})();
