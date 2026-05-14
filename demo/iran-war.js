// Iran–Israel–US June 2025 conflict relationships.
//
// The relationship graph is inherently cyclic (Israel↔Iran, US↔Iran,
// US↔Israel) so the library's hierarchical layout can't lay it out
// cleanly — we supply explicit `position` for each node and let the
// library route the bezier edges (forward edges curve normally; backward
// edges arc over the row, courtesy of the lib's backward-edge routing).

(function () {
  "use strict";

  // ----- Actors ----------------------------------------------------------
  //
  // Three logical columns:
  //   LEFT (Iran + Iran-aligned non-state actors)
  //   CENTER (Iran's direct neighbors / mediators / international body)
  //   RIGHT (Israel + United States)
  //
  // y positions hand-tuned to keep typical forward edges (left → right)
  // mostly horizontal, and to leave headroom for backward arcs.

  var ACTORS = [
    // --- LEFT: Iran and its support network -----------------------------
    { id: "Iran",          name: "Iran",                     role: "Belligerent (target of strikes)", kind: "belligerent", side: "iran",   position: { x:   60, y: 280 } },
    { id: "Houthis",       name: "Houthis (Ansar Allah)",    role: "Iran-aligned, Yemen",            kind: "proxy",                       position: { x:   60, y:  80 } },
    { id: "Hezbollah",     name: "Hezbollah",                role: "Iran-aligned, Lebanon",          kind: "proxy",                       position: { x:   60, y: 180 } },
    { id: "Hamas",         name: "Hamas",                    role: "Palestinian armed groups",       kind: "proxy",                       position: { x:   60, y: 380 } },
    { id: "IraqiMilitias", name: "Iran-backed Iraqi/Syrian militias", role: "Iran-aligned, regional", kind: "proxy",                      position: { x:   60, y: 480 } },

    // --- CENTER: mediators and observers --------------------------------
    { id: "UN_IAEA",       name: "UN / IAEA",                role: "International body",             kind: "international",               position: { x:  500, y:  60 } },
    { id: "Qatar",         name: "Qatar",                    role: "Mediator + host of US base",     kind: "diplomat",                   position: { x:  500, y: 170 } },
    { id: "Oman",          name: "Oman",                     role: "Mediator (nuclear talks)",       kind: "diplomat",                   position: { x:  500, y: 270 } },
    { id: "SaudiArabia",   name: "Saudi Arabia",             role: "Regional Gulf actor",            kind: "diplomat",                   position: { x:  500, y: 370 } },
    { id: "UAE",           name: "UAE",                      role: "Regional Gulf actor",            kind: "diplomat",                   position: { x:  500, y: 470 } },
    { id: "UK",            name: "United Kingdom",           role: "Called for de-escalation",       kind: "restrained",                 position: { x:  500, y: 570 } },

    // --- RIGHT: Israel and the United States ----------------------------
    { id: "Israel",        name: "Israel",                   role: "Belligerent (initiator of strikes)", kind: "belligerent", side: "allied", position: { x:  940, y: 220 } },
    { id: "UnitedStates",  name: "United States",            role: "Belligerent (strikes on Iran nuclear sites)", kind: "belligerent", side: "allied", position: { x:  940, y: 380 } },
  ];

  // ----- Relationships ---------------------------------------------------
  //
  // Each edge has a `category` field that controls its styling. The
  // categories are colour-coded in the legend pane.
  //
  // Categories: "war", "proxy_attack", "alliance", "support",
  //             "mediation", "host", "restraint".

  var EDGES = [
    // --- Direct war edges -------------------------------------------------
    { source: "Israel",       target: "Iran",         category: "war",
      label: "Air & missile strikes on nuclear / military / energy sites",
      detail: "Israel initiated waves of strikes against Iranian nuclear infrastructure and other strategic targets." },
    { source: "Iran",         target: "Israel",       category: "war",
      label: "Missile & drone retaliation",
      detail: "Iran fired ballistic missiles and drones at Israeli territory in retaliation." },
    { source: "UnitedStates", target: "Iran",         category: "war",
      label: "Strikes on Fordow, Natanz, Isfahan",
      detail: "U.S. military struck three Iranian nuclear-enrichment facilities." },
    { source: "Iran",         target: "UnitedStates", category: "war",
      label: "Missile salvo at U.S. base in Qatar",
      detail: "Iran fired missiles at Al Udeid Air Base in Qatar, the largest U.S. installation in the region." },

    // --- Alliance --------------------------------------------------------
    { source: "UnitedStates", target: "Israel",       category: "alliance",
      label: "Military support / collective self-defense",
      detail: "U.S. has provided military assistance, missile-defense, and political backing to Israel throughout." },

    // --- Iran's support network -----------------------------------------
    { source: "Iran",         target: "Houthis",       category: "support", label: "Aligned / support network" },
    { source: "Iran",         target: "Hezbollah",     category: "support", label: "Aligned / support network" },
    { source: "Iran",         target: "IraqiMilitias", category: "support", label: "Aligned / support network" },
    { source: "Iran",         target: "Hamas",         category: "support", label: "Aligned / support network" },

    // --- Proxy attacks on Israel / US -----------------------------------
    { source: "Houthis",       target: "Israel",       category: "proxy_attack",
      label: "Missile strikes, reportedly coordinated with Iran" },
    { source: "IraqiMilitias", target: "UnitedStates", category: "proxy_attack",
      label: "Attacks on U.S. forces in region" },
    { source: "IraqiMilitias", target: "Israel",       category: "proxy_attack",
      label: "Regional pressure / attacks" },
    { source: "Hezbollah",     target: "Israel",       category: "proxy_attack",
      label: "Rocket fire / Lebanon front in broader conflict" },
    { source: "Hamas",         target: "Israel",       category: "proxy_attack",
      label: "Gaza front in the broader conflict" },

    // --- Restraint / non-participation -----------------------------------
    { source: "Hezbollah",    target: "Iran",   category: "restraint",
      label: "Political alignment, but no June 2025 counteraction",
      detail: "Despite alignment with Iran, Hezbollah largely refrained from opening a new front during this escalation." },
    { source: "UK",           target: "Iran",   category: "restraint",
      label: "Not involved in Israel/U.S. strikes" },
    { source: "UK",           target: "Israel", category: "restraint",
      label: "Called for de-escalation" },

    // --- Mediation -------------------------------------------------------
    { source: "Qatar",        target: "Iran",   category: "mediation", label: "Mediated ceasefire acceptance" },
    { source: "Qatar",        target: "UnitedStates", category: "mediation", label: "Ceasefire channel + hosts U.S. Al Udeid base", detail: "Qatar both mediated talks and hosts the U.S. base that was targeted." },
    { source: "Oman",         target: "Iran",   category: "mediation", label: "Nuclear-talks / mediation channel" },
    { source: "Oman",         target: "UnitedStates", category: "mediation", label: "Indirect talks channel" },
    { source: "SaudiArabia",  target: "UnitedStates", category: "mediation", label: "Pressed for ceasefire / de-escalation" },
    { source: "SaudiArabia",  target: "Iran",   category: "mediation", label: "Regional diplomacy / de-escalation" },
    { source: "UN_IAEA",      target: "Iran",   category: "mediation", label: "Nuclear monitoring / safeguards dispute" },
    { source: "UN_IAEA",      target: "Israel", category: "mediation", label: "Criticized attacks on nuclear facilities" },

    // --- Hosting / affected state ----------------------------------------
    { source: "Iran",         target: "Qatar",  category: "host",
      label: "Missile struck U.S. base located in Qatar",
      detail: "Iran's strike on Al Udeid affected Qatari territory even though Iran-Qatar relations are not hostile." },
    { source: "UAE",          target: "Iran",   category: "host",
      label: "Regional Gulf actor, affected by escalation" },
  ];

  // ----- Renderers -------------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderNode(node, el) {
    el.classList.add("actor", "kind-" + node.kind);
    if (node.side) el.classList.add("side-" + node.side);
    el.innerHTML =
      '<div class="actor__name">' + escapeHtml(node.name) + '</div>' +
      '<div class="actor__role">' + escapeHtml(node.role || "") + '</div>';
  }

  // ----- Edge styling ----------------------------------------------------

  var CATEGORY_STYLE = {
    war:          { stroke: "#dc2626", width: 2.6, arrow: true },
    proxy_attack: { stroke: "#dc2626", width: 1.6, arrow: true, dash: [6, 4] },
    alliance:     { stroke: "#1d4ed8", width: 2.2, arrow: true },
    support:      { stroke: "#ea580c", width: 1.6, arrow: true },
    mediation:    { stroke: "#059669", width: 1.4, arrow: true, dash: [2, 3] },
    host:         { stroke: "#64748b", width: 1.2, arrow: true },
    restraint:    { stroke: "#94a3b8", width: 1.1, arrow: false, dash: [3, 4] },
  };

  function edgeStyle(edge, state) {
    var base = CATEGORY_STYLE[edge.category] || { stroke: "#94a3b8", width: 1.5, arrow: true };
    if (state === "hover")
      return { stroke: "#0f172a", width: base.width + 1, dash: base.dash, arrow: base.arrow };
    if (state === "selected")
      return { stroke: "#0f172a", width: base.width + 1.5, dash: base.dash, arrow: base.arrow };
    if (state === "neighbor")
      return { stroke: base.stroke, width: base.width + 0.8, dash: base.dash, arrow: base.arrow };
    return base;
  }

  // ----- Build graph -----------------------------------------------------

  var ACTOR_BY_ID = {};
  ACTORS.forEach(function (a) { ACTOR_BY_ID[a.id] = a; });

  var NODES = ACTORS.map(function (a) {
    return Object.assign({ label: a.name }, a);
  });

  var EDGES_WITH_IDS = EDGES.map(function (e, i) {
    return Object.assign({ id: "E" + i }, e);
  });

  var graph = new Graph(document.getElementById("graph"), {
    nodes: NODES,
    edges: EDGES_WITH_IDS,
    direction: "LR",
    nodeWidth: 190,
    nodeHeight: 60,
    renderNode: renderNode,
    edgeStyle: edgeStyle,
    hitTolerancePx: 8,
    minZoom: 0.4,
    maxZoom: 2.5,
    onNodeClick: showActorInfo,
    onEdgeClick: showEdgeInfo,
    onPaneClick: clearInfo,
  });

  // ----- Toolbar: per-category filter -----------------------------------

  var hidden = {}; // category -> true if hidden

  function visibleEdges() {
    return EDGES_WITH_IDS.filter(function (e) { return !hidden[e.category]; });
  }

  function toggleCategory(cat, btnId) {
    hidden[cat] = !hidden[cat];
    graph.setEdges(visibleEdges());
    var b = document.querySelector('.gv-toolbar [data-id="' + btnId + '"]');
    if (b) b.classList.toggle("is-active", !hidden[cat]);
  }

  var FILTER_BUTTONS = [
    { cat: "war",          id: "f-war",       label: "War" },
    { cat: "proxy_attack", id: "f-proxy",     label: "Proxy" },
    { cat: "alliance",     id: "f-alliance",  label: "Alliance" },
    { cat: "support",      id: "f-support",   label: "Support" },
    { cat: "mediation",    id: "f-mediation", label: "Mediation" },
    { cat: "host",         id: "f-host",      label: "Host" },
    { cat: "restraint",    id: "f-restraint", label: "Restraint" },
  ];
  FILTER_BUTTONS.forEach(function (b, i) {
    graph.addToolbarButton({
      id: b.id, label: b.label,
      title: "Toggle " + b.label.toLowerCase() + " edges",
      onClick: function () { toggleCategory(b.cat, b.id); },
      pressed: function () { return !hidden[b.cat]; },
    }, i === 0 ? { newGroup: true } : undefined);
  });

  // ----- Layout selector ------------------------------------------------
  // Default = hand-tuned three-column layout (each actor has
  // node.position set). FA2 strips those overrides so actors are placed
  // by their connectivity instead of by role.
  function nodesWithPositions() {
    return ACTORS.map(function (a) { return Object.assign({ label: a.name }, a); });
  }
  function nodesWithoutPositions() {
    return ACTORS.map(function (a) {
      var c = Object.assign({ label: a.name }, a);
      delete c.position;
      return c;
    });
  }
  graph.addToolbarButton({
    id: "lay-roles", label: "Roles",
    title: "Default: actors grouped by role (Iran's network / mediators / Israel-US)",
    onClick: function (g) { g.setNodes(nodesWithPositions()); g.setLayout("auto"); },
    pressed: function (g) { var n = g.getLayoutName(); return n === "auto" || n === "hierarchical"; },
  }, { newGroup: true });
  graph.addToolbarButton({
    id: "lay-fa2", label: "FA2",
    title: "ForceAtlas2 — clusters by connectivity",
    onClick: function (g) {
      g.setNodes(nodesWithoutPositions());
      g.setLayout({ name: "forceatlas2", iterations: 250, seed: 9, gravity: 1, scalingRatio: 18 });
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "forceatlas2" || n === "fa2"; },
  });

  // ----- Info pane -------------------------------------------------------

  var info = document.getElementById("info");
  var CATEGORY_LABEL = {
    war: "Direct strikes / war",
    proxy_attack: "Proxy attack",
    alliance: "Alliance / support",
    support: "Iran support network",
    mediation: "Mediation / diplomacy",
    host: "Hosting / affected",
    restraint: "Restraint / non-participation",
  };

  function showActorInfo(node) {
    var outgoing = EDGES_WITH_IDS.filter(function (e) { return e.source === node.id; });
    var incoming = EDGES_WITH_IDS.filter(function (e) { return e.target === node.id; });
    info.innerHTML =
      '<h2>' + escapeHtml(node.name) + '</h2>' +
      '<p class="muted">' + escapeHtml(node.role || "") + '</p>' +
      (outgoing.length
        ? '<p><strong>Actions toward others (' + outgoing.length + ')</strong></p>' +
          '<ul style="margin:4px 0 8px 18px; padding:0; line-height:1.4">' +
          outgoing.map(function (e) {
            var t = ACTOR_BY_ID[e.target];
            return '<li><span class="pill" style="background:' + CATEGORY_STYLE[e.category].stroke + '20;color:' + CATEGORY_STYLE[e.category].stroke + '">' +
                   escapeHtml(CATEGORY_LABEL[e.category]) + '</span> → <strong>' + escapeHtml(t.name) + '</strong><br><span class="muted">' + escapeHtml(e.label) + '</span></li>';
          }).join("") + '</ul>'
        : '') +
      (incoming.length
        ? '<p><strong>Inbound (' + incoming.length + ')</strong></p>' +
          '<ul style="margin:4px 0; padding:0 0 0 18px; line-height:1.4">' +
          incoming.map(function (e) {
            var s = ACTOR_BY_ID[e.source];
            return '<li><strong>' + escapeHtml(s.name) + '</strong> → <span class="pill" style="background:' + CATEGORY_STYLE[e.category].stroke + '20;color:' + CATEGORY_STYLE[e.category].stroke + '">' +
                   escapeHtml(CATEGORY_LABEL[e.category]) + '</span><br><span class="muted">' + escapeHtml(e.label) + '</span></li>';
          }).join("") + '</ul>'
        : '');
  }

  function showEdgeInfo(edge) {
    var s = ACTOR_BY_ID[edge.source], t = ACTOR_BY_ID[edge.target];
    var st = CATEGORY_STYLE[edge.category];
    info.innerHTML =
      '<h2>' + escapeHtml(s.name) + ' → ' + escapeHtml(t.name) + '</h2>' +
      '<p><span class="pill" style="background:' + st.stroke + '20;color:' + st.stroke + '">' +
        escapeHtml(CATEGORY_LABEL[edge.category]) + '</span></p>' +
      '<p>' + escapeHtml(edge.label) + '</p>' +
      (edge.detail ? '<p class="muted">' + escapeHtml(edge.detail) + '</p>' : '');
  }

  function clearInfo() {
    info.innerHTML =
      '<h2>Click an actor or edge</h2>' +
      '<p class="muted">Click any actor to see its connections. ' +
      'Click an edge to read what it represents.</p>' +
      '<p class="muted">Use the toolbar buttons to toggle edge ' +
      'categories on and off.</p>';
  }

  // Expose for tests / probe.
  window.__demo = {
    graph: graph,
    get nodes() { return graph.nodes; },
    get edges() { return graph.edges; },
    toggleCategory: toggleCategory,
  };
})();
