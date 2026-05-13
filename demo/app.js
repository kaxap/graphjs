// Demo wiring — consumes the LineageGraph library from ../lib/.
// All graph behavior (layout, canvas edges, drag, pan/zoom, expand) lives
// in the library. This file only provides mock data and event handlers.

(function () {
  "use strict";

  var NODES = [
    { id: "topic.orders", entity: "topic", name: "orders.events", fqn: "kafka.orders.events", owner: "checkout", tier: "Tier-1", domain: "Commerce" },
    { id: "pipeline.ingest", entity: "pipeline", name: "ingest_orders", fqn: "airflow.ingest_orders", owner: "data-eng", domain: "Commerce" },
    { id: "db.raw", entity: "database", name: "raw", fqn: "warehouse.raw", owner: "data-platform" },
    { id: "table.raw.orders", entity: "table", name: "raw_orders", fqn: "warehouse.raw.orders", owner: "data-eng", tier: "Tier-2" },
    { id: "table.staging.orders", entity: "table", name: "stg_orders", fqn: "warehouse.staging.orders", owner: "analytics", tier: "Tier-2" },
    { id: "table.mart.orders", entity: "table", name: "fct_orders", fqn: "warehouse.mart.fct_orders", owner: "analytics", tier: "Tier-1", domain: "Commerce" },
    { id: "dashboard.revenue", entity: "dashboard", name: "Revenue Overview", fqn: "looker.revenue_overview", owner: "finance", tier: "Tier-1", domain: "Finance" },
    { id: "mlmodel.churn", entity: "mlmodel", name: "churn_predictor_v3", fqn: "mlflow.churn_predictor_v3", owner: "ml-platform", status: "deprecated" },
    { id: "table.legacy", entity: "table", name: "legacy_orders", fqn: "warehouse.archive.legacy_orders", status: "deleted" },
  ];

  var EDGES = [
    { id: "e1", source: "topic.orders", target: "pipeline.ingest" },
    { id: "e2", source: "pipeline.ingest", target: "table.raw.orders" },
    { id: "e3", source: "db.raw", target: "table.raw.orders" },
    { id: "e4", source: "table.raw.orders", target: "table.staging.orders" },
    { id: "e5", source: "table.staging.orders", target: "table.mart.orders" },
    { id: "e6", source: "table.mart.orders", target: "dashboard.revenue" },
    { id: "e7", source: "table.mart.orders", target: "mlmodel.churn" },
    { id: "e8", source: "table.legacy", target: "table.mart.orders", type: "deleted" },
    { id: "c1", source: "table.raw.orders", target: "table.staging.orders", type: "columnLineage" },
    { id: "c2", source: "table.staging.orders", target: "table.mart.orders", type: "columnLineage" },
  ];

  var siblingCounter = 0;
  function addSibling(node, dir) {
    siblingCounter += 1;
    var id = node.id + "." + dir + "." + siblingCounter;
    var suffix = dir === "up" ? "src" : "ext";
    graph.addNode({
      id: id,
      entity: "table",
      name: node.name + "__" + suffix + siblingCounter,
      fqn: (node.fqn || node.name) + "__" + suffix + siblingCounter,
      owner: node.owner,
      domain: node.domain,
    });
    if (dir === "up") graph.addEdge({ id: "e." + id + "->" + node.id, source: id, target: node.id });
    else graph.addEdge({ id: "e." + node.id + "->" + id, source: node.id, target: id });
  }

  var graph = new LineageGraph(document.getElementById("graph"), {
    nodes: NODES,
    edges: EDGES,
    direction: "LR",
    showColumnLineage: false,
    showToolbar: true,
    showLegend: true,
    legendItems: [
      { entity: "table", label: "Table" },
      { entity: "pipeline", label: "Pipeline" },
      { entity: "topic", label: "Topic" },
      { entity: "dashboard", label: "Dashboard" },
      { entity: "mlmodel", label: "ML Model" },
    ],
    onNodeClick: function (n) { console.log("node click", n.id); },
    onEdgeClick: function (e) { console.log("edge click", e.id); },
    onExpandUpstream: function (n) { addSibling(n, "up"); },
    onExpandDownstream: function (n) { addSibling(n, "down"); },
  });

  // Test hooks — let Playwright introspect the library's state.
  window.__demo = {
    graph: graph,
    get nodes() { return graph.nodes; },
    get edges() { return graph.edges; },
  };
})();
