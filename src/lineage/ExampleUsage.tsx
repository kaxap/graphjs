/**
 * ExampleUsage — a runnable demo with mock data covering all entity types,
 * tiers/domains/owners, deleted/deprecated states, and column lineage.
 *
 * Drop this anywhere in your app:
 *
 *   import { ExampleUsage } from "./lineage/ExampleUsage";
 *   <div style={{ width: "100vw", height: "100vh" }}><ExampleUsage /></div>
 */

import React, { useCallback, useMemo, useState } from "react";
import LineageGraph from "./LineageGraph";
import type { LineageEdge, LineageNode } from "./types";

const MOCK_NODES: LineageNode[] = [
  {
    id: "db.raw",
    type: "database",
    entityType: "database",
    name: "raw",
    fullyQualifiedName: "warehouse.raw",
    owner: "data-platform",
    tier: "Tier-3",
    domain: "Platform",
  },
  {
    id: "topic.orders",
    type: "topic",
    entityType: "topic",
    name: "orders.events",
    fullyQualifiedName: "kafka.orders.events",
    owner: "checkout",
    tier: "Tier-1",
    domain: "Commerce",
    hasUpstreamChildren: true,
  },
  {
    id: "table.raw.orders",
    type: "table",
    entityType: "table",
    name: "raw_orders",
    fullyQualifiedName: "warehouse.raw.orders",
    owner: "data-eng",
    tier: "Tier-2",
    domain: "Commerce",
    columns: [
      { name: "order_id", dataType: "STRING" },
      { name: "user_id", dataType: "STRING" },
      { name: "total", dataType: "DECIMAL" },
    ],
  },
  {
    id: "pipeline.ingest",
    type: "pipeline",
    entityType: "pipeline",
    name: "ingest_orders",
    fullyQualifiedName: "airflow.ingest_orders",
    owner: "data-eng",
    domain: "Commerce",
  },
  {
    id: "table.staging.orders",
    type: "table",
    entityType: "table",
    name: "stg_orders",
    fullyQualifiedName: "warehouse.staging.orders",
    owner: "analytics",
    tier: "Tier-2",
    domain: "Commerce",
    columns: [
      { name: "order_id", dataType: "STRING" },
      { name: "user_id", dataType: "STRING" },
      { name: "total_usd", dataType: "DECIMAL" },
    ],
  },
  {
    id: "table.mart.orders",
    type: "table",
    entityType: "table",
    name: "fct_orders",
    fullyQualifiedName: "warehouse.mart.fct_orders",
    owner: "analytics",
    tier: "Tier-1",
    domain: "Commerce",
    status: "active",
    hasDownstreamChildren: true,
    columns: [
      { name: "order_id", dataType: "STRING" },
      { name: "user_id", dataType: "STRING" },
      { name: "revenue_usd", dataType: "DECIMAL" },
    ],
  },
  {
    id: "dashboard.revenue",
    type: "dashboard",
    entityType: "dashboard",
    name: "Revenue Overview",
    fullyQualifiedName: "looker.revenue_overview",
    owner: "finance",
    tier: "Tier-1",
    domain: "Finance",
  },
  {
    id: "mlmodel.churn",
    type: "mlmodel",
    entityType: "mlmodel",
    name: "churn_predictor_v3",
    fullyQualifiedName: "mlflow.churn_predictor_v3",
    owner: "ml-platform",
    domain: "ML",
    status: "deprecated",
  },
  {
    id: "table.legacy",
    type: "table",
    entityType: "table",
    name: "legacy_orders",
    fullyQualifiedName: "warehouse.archive.legacy_orders",
    status: "deleted",
  },
];

const MOCK_EDGES: LineageEdge[] = [
  { id: "e1", source: "topic.orders", target: "pipeline.ingest" },
  { id: "e2", source: "pipeline.ingest", target: "table.raw.orders" },
  { id: "e3", source: "db.raw", target: "table.raw.orders" },
  { id: "e4", source: "table.raw.orders", target: "table.staging.orders" },
  { id: "e5", source: "table.staging.orders", target: "table.mart.orders" },
  { id: "e6", source: "table.mart.orders", target: "dashboard.revenue" },
  { id: "e7", source: "table.mart.orders", target: "mlmodel.churn" },
  { id: "e8", source: "table.legacy", target: "table.mart.orders", type: "deleted" },
  // Column-lineage examples (only visible when the column-lineage toggle is on).
  {
    id: "c1",
    source: "table.raw.orders",
    target: "table.staging.orders",
    type: "columnLineage",
    sourceHandle: "order_id",
    targetHandle: "order_id",
  },
  {
    id: "c2",
    source: "table.staging.orders",
    target: "table.mart.orders",
    type: "columnLineage",
    sourceHandle: "total_usd",
    targetHandle: "revenue_usd",
  },
];

export function ExampleUsage() {
  const [nodes, setNodes] = useState<LineageNode[]>(MOCK_NODES);
  const [edges, setEdges] = useState<LineageEdge[]>(MOCK_EDGES);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();

  const handleNodeClick = useCallback((n: LineageNode) => {
    setSelectedNodeId(n.id);
    // eslint-disable-next-line no-console
    console.log("clicked node", n);
  }, []);

  // Demo: highlight all neighbors of the selected node.
  const highlightedNodeIds = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const ids = new Set<string>([selectedNodeId]);
    for (const e of edges) {
      if (e.source === selectedNodeId) ids.add(e.target);
      if (e.target === selectedNodeId) ids.add(e.source);
    }
    return Array.from(ids);
  }, [selectedNodeId, edges]);

  // Demo: async expansion — pretend we fetched 2 more upstream nodes.
  const handleExpandUpstream = useCallback(async (n: LineageNode) => {
    // Simulate latency.
    await new Promise((r) => setTimeout(r, 250));
    const newNode: LineageNode = {
      id: `${n.id}.up.${Date.now()}`,
      type: "table",
      entityType: "table",
      name: `${n.name}__src`,
      fullyQualifiedName: `${n.fullyQualifiedName ?? n.name}__src`,
      domain: n.domain,
    };
    setNodes((prev) => [...prev, newNode]);
    setEdges((prev) => [
      ...prev,
      { id: `e.${newNode.id}->${n.id}`, source: newNode.id, target: n.id },
    ]);
  }, []);

  return (
    <LineageGraph
      nodes={nodes}
      edges={edges}
      selectedNodeId={selectedNodeId}
      highlightedNodeIds={highlightedNodeIds}
      layoutDirection="LR"
      enableMiniMap
      enableCanvasEdges
      enableColumnLineage={false}
      enableEditMode={false}
      onNodeClick={handleNodeClick}
      onEdgeClick={(e) => console.log("clicked edge", e)}
      onExpandUpstream={handleExpandUpstream}
      onExpandDownstream={(n) => console.log("expand downstream", n.id)}
      onConnect={({ source, target }) =>
        setEdges((prev) => [
          ...prev,
          { id: `e.manual.${source}->${target}.${Date.now()}`, source, target },
        ])
      }
      onDropNode={(partial, position) => {
        // eslint-disable-next-line no-console
        console.log("drop", partial, position);
      }}
    />
  );
}

export default ExampleUsage;
