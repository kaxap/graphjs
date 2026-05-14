// Tree of Life — a curated map of evolution.
//
// Inspired by Kurzgesagt's "Map of Evolution" poster: a hierarchical
// view from LUCA out to modern groups, with selected evolutionary
// milestone events attached to the clades where they originated.
//
// Phylogeny is simplified — many branches are merged or omitted to
// keep the layout readable. The path toward Homo is shown in full
// depth on purpose; other branches stop at the order / class level.

(function () {
  "use strict";

  // Each row: [ id, parentId, name, group, emoji, latin?, note? ]
  // Group keys map to .k-<group> CSS classes in the page.
  var CLADES = [
    // --- Root ---
    ["luca", null, "LUCA", "root", "○", "Last Universal Common Ancestor", "Origin of cellular life, ~3.8 billion years ago."],

    // --- Bacteria ---
    ["bacteria", "luca", "Bacteria", "bacteria", "🦠", "Bacteria", "One of three domains of life. Single-celled, no nucleus."],
    ["cyanobacteria", "bacteria", "Cyanobacteria", "bacteria", "🟢", "Cyanobacteria", "Invented oxygenic photosynthesis. Reshaped Earth's atmosphere."],
    ["proteobacteria", "bacteria", "Proteobacteria", "bacteria", "🦠", "Pseudomonadota", "Includes E. coli, the ancestor of mitochondria."],
    ["firmicutes", "bacteria", "Firmicutes", "bacteria", "🦠", "Bacillota", "Gram-positive bacteria; includes many gut microbiome species."],

    // --- Archaea ---
    ["archaea", "luca", "Archaea", "archaea", "🦠", "Archaea", "Extremophile-rich domain; closer to eukaryotes than to bacteria."],
    ["euryarchaeota", "archaea", "Euryarchaeota", "archaea", "🦠", "Euryarchaeota", "Methanogens and halophiles live here."],
    ["asgard", "archaea", "Asgard archaea", "archaea", "🦠", "Asgardarchaeota", "Believed to be the ancestor of eukaryotes."],

    // --- Eukarya ---
    ["eukarya", "asgard", "Eukarya", "root", "⚛", "Eukaryota", "Cells with a nucleus. Plants, animals, fungi, protists."],

    // --- Protists ---
    ["protists", "eukarya", "Protists", "protist", "🟡", "Protista (paraphyletic)", "Catch-all for eukaryotes that are neither plant, animal, nor fungus."],
    ["amoebozoa", "protists", "Amoebozoa", "protist", "🦠", "Amoebozoa", "Slime molds and amoebae."],
    ["alveolates", "protists", "Alveolates", "protist", "🦠", "Alveolata", "Ciliates and the parasites that cause malaria."],

    // --- Plants ---
    ["plantae", "eukarya", "Plants", "plant", "🌱", "Archaeplastida", "Multicellular photosynthetic eukaryotes."],
    ["algae", "plantae", "Green algae", "plant", "🌿", "Chlorophyta", "Aquatic ancestors of land plants."],
    ["bryophytes", "algae", "Mosses & liverworts", "plant", "🌿", "Bryophyta", "First land plants. No vascular system."],
    ["ferns", "bryophytes", "Ferns & horsetails", "plant", "🌿", "Pteridophyta", "First vascular plants. Dominated Carboniferous forests."],
    ["gymnosperms", "ferns", "Gymnosperms", "plant", "🌲", "Gymnospermae", "Conifers, cycads, ginkgo — seed plants without flowers."],
    ["angiosperms", "gymnosperms", "Flowering plants", "plant", "🌸", "Angiospermae", "Flowering plants. Now ~90% of land plant species."],

    // --- Fungi ---
    ["fungi", "eukarya", "Fungi", "fungi", "🍄", "Fungi", "Decomposers; closer to animals than to plants."],
    ["ascomycetes", "fungi", "Ascomycetes", "fungi", "🍄", "Ascomycota", "Sac fungi — yeasts, morels, most molds."],
    ["basidiomycetes", "fungi", "Basidiomycetes", "fungi", "🍄", "Basidiomycota", "Mushrooms, rusts, smuts."],

    // --- Animalia ---
    ["animalia", "eukarya", "Animals", "animal", "🐾", "Animalia", "Multicellular heterotrophs."],
    ["porifera", "animalia", "Sponges", "animal", "🧽", "Porifera", "Among the earliest animals. No true tissues."],
    ["cnidaria", "animalia", "Jellyfish & corals", "animal", "🪼", "Cnidaria", "Radial symmetry, stinging cells."],
    ["bilateria", "animalia", "Bilateria", "animal", "🪱", "Bilateria", "Bilateral symmetry, front/back, gut. Most animals."],

    // Protostomes
    ["protostomes", "bilateria", "Protostomes", "animal", "🐌", "Protostomia", "Mouth forms first during development."],
    ["mollusca", "protostomes", "Mollusks", "animal", "🐙", "Mollusca", "Snails, clams, octopuses."],
    ["annelida", "protostomes", "Segmented worms", "animal", "🪱", "Annelida", "Earthworms, leeches."],
    ["arthropoda", "protostomes", "Arthropods", "animal", "🦞", "Arthropoda", "Jointed legs + exoskeleton. The most species-rich phylum."],
    ["crustacea", "arthropoda", "Crustaceans", "animal", "🦀", "Crustacea", "Crabs, shrimp, copepods."],
    ["insecta", "arthropoda", "Insects", "animal", "🦋", "Insecta", "~1 million described species. Six legs, three body parts."],
    ["arachnida", "arthropoda", "Arachnids", "animal", "🕷️", "Arachnida", "Spiders, scorpions, mites. Eight legs."],

    // Deuterostomes
    ["deuterostomes", "bilateria", "Deuterostomes", "animal", "⭐", "Deuterostomia", "Anus forms first during development."],
    ["echinodermata", "deuterostomes", "Echinoderms", "animal", "⭐", "Echinodermata", "Sea stars, urchins. Five-fold symmetry as adults."],
    ["chordata", "deuterostomes", "Chordates", "vertebrate", "🐟", "Chordata", "Notochord, dorsal nerve cord. Includes all vertebrates."],
    ["vertebrata", "chordata", "Vertebrates", "vertebrate", "🐟", "Vertebrata", "Backbone-bearing chordates."],
    ["agnatha", "vertebrata", "Jawless fish", "vertebrate", "🐟", "Agnatha", "Lampreys, hagfish. Oldest surviving vertebrate lineage."],
    ["chondrichthyes", "vertebrata", "Cartilaginous fish", "vertebrate", "🦈", "Chondrichthyes", "Sharks, rays, chimaeras."],
    ["osteichthyes", "vertebrata", "Bony fish", "vertebrate", "🐟", "Osteichthyes", "Most fish you know. Includes ancestors of tetrapods."],
    ["tetrapoda", "osteichthyes", "Tetrapods", "vertebrate", "🐸", "Tetrapoda", "Four-limbed vertebrates. First to walk on land."],
    ["amphibia", "tetrapoda", "Amphibians", "vertebrate", "🐸", "Amphibia", "Frogs, salamanders. Still need water to reproduce."],
    ["amniota", "tetrapoda", "Amniotes", "vertebrate", "🐢", "Amniota", "Eggs with protective membrane. Conquered dry land."],

    // Sauropsida
    ["sauropsida", "amniota", "Reptiles + Birds", "vertebrate", "🦎", "Sauropsida", "All living reptile + bird lineages."],
    ["lepidosauria", "sauropsida", "Lizards & snakes", "vertebrate", "🦎", "Lepidosauria", "Squamates + tuatara."],
    ["testudines", "sauropsida", "Turtles", "vertebrate", "🐢", "Testudines", "Bone shell fused to ribs."],
    ["crocodylia", "sauropsida", "Crocodilians", "vertebrate", "🐊", "Crocodylia", "Closest living relatives of birds among reptiles."],
    ["aves", "sauropsida", "Birds", "vertebrate", "🦅", "Aves", "Surviving theropod dinosaurs."],

    // Mammals
    ["mammalia", "amniota", "Mammals", "mammal", "🐭", "Mammalia", "Hair + mammary glands + endothermy."],
    ["monotremata", "mammalia", "Monotremes", "mammal", "🦆", "Monotremata", "Egg-laying mammals: platypus, echidna."],
    ["marsupialia", "mammalia", "Marsupials", "mammal", "🦘", "Marsupialia", "Pouched mammals: kangaroos, opossums, koalas."],
    ["placentalia", "mammalia", "Placental mammals", "mammal", "🐘", "Placentalia", "Most mammals — long pregnancy, live birth."],

    // Placental orders
    ["afrotheria", "placentalia", "Afrotheria", "mammal", "🐘", "Afrotheria", "Elephants, manatees, hyraxes, aardvarks."],
    ["xenarthra", "placentalia", "Xenarthra", "mammal", "🦥", "Xenarthra", "Sloths, anteaters, armadillos."],
    ["laurasiatheria", "placentalia", "Laurasiatheria", "mammal", "🐺", "Laurasiatheria", "Carnivores, bats, ungulates, whales."],
    ["carnivora", "laurasiatheria", "Carnivores", "mammal", "🐺", "Carnivora", "Cats, dogs, bears, seals."],
    ["cetartiodactyla", "laurasiatheria", "Even-toed ungulates", "mammal", "🐄", "Cetartiodactyla", "Cows, deer, pigs — and whales (yes, really)."],
    ["chiroptera", "laurasiatheria", "Bats", "mammal", "🦇", "Chiroptera", "Only mammals with powered flight."],
    ["euarchontoglires", "placentalia", "Euarchontoglires", "mammal", "🐭", "Euarchontoglires", "Rodents, rabbits, tree shrews, primates."],
    ["rodentia", "euarchontoglires", "Rodents", "mammal", "🐭", "Rodentia", "Most numerous mammal order."],
    ["primates", "euarchontoglires", "Primates", "primate", "🐒", "Primates", "Forward eyes, grasping hands, big brain."],

    // Primate path to humans
    ["strepsirrhini", "primates", "Lemurs & lorises", "primate", "🦝", "Strepsirrhini", "Wet-nosed primates."],
    ["haplorhini", "primates", "Tarsiers & simians", "primate", "🐒", "Haplorhini", "Dry-nosed primates."],
    ["tarsiers", "haplorhini", "Tarsiers", "primate", "🐒", "Tarsiiformes", "Tiny nocturnal Asian primates."],
    ["simiiformes", "haplorhini", "Monkeys & apes", "primate", "🐒", "Simiiformes", "Anthropoid primates."],
    ["platyrrhini", "simiiformes", "New World monkeys", "primate", "🐒", "Platyrrhini", "Americas; many have prehensile tails."],
    ["catarrhini", "simiiformes", "Catarrhini", "primate", "🐒", "Catarrhini", "Old World monkeys + apes."],
    ["cercopithecoidea", "catarrhini", "Old World monkeys", "primate", "🐒", "Cercopithecoidea", "Macaques, baboons, colobus."],
    ["hominoidea", "catarrhini", "Apes", "primate", "🦍", "Hominoidea", "No tail, larger body, longer arms."],
    ["hylobatidae", "hominoidea", "Gibbons", "primate", "🐒", "Hylobatidae", "Lesser apes — small, agile, brachiating."],
    ["hominidae", "hominoidea", "Great apes", "primate", "🦍", "Hominidae", "Orangutans, gorillas, chimpanzees, humans."],
    ["pongo", "hominidae", "Orangutans", "primate", "🦧", "Pongo", "Asian great apes."],
    ["gorilla", "hominidae", "Gorillas", "primate", "🦍", "Gorilla", "Largest living primates."],
    ["pan", "hominidae", "Chimps & bonobos", "primate", "🐵", "Pan", "Closest living relatives of humans (~6 Ma divergence)."],
    ["homo", "hominidae", "Humans", "homo", "🧑", "Homo sapiens", "You are here. ~300,000 years old as a species."],
  ];

  // Selected evolutionary milestone events, attached to the clade where
  // they happened. Drawn as pill-shaped nodes with a dashed edge from
  // the host clade.
  var MILESTONES = [
    { id: "M_photo",      parent: "cyanobacteria", name: "Photosynthesis",       time: "~3.4 Ga", emoji: "☀️", note: "Cyanobacteria evolved oxygenic photosynthesis, eventually triggering the Great Oxidation Event ~2.4 Ga ago." },
    { id: "M_eukcell",    parent: "eukarya",       name: "Eukaryotic cell",      time: "~2.0 Ga", emoji: "⚛",  note: "Endosymbiosis: an archaeon engulfed a bacterium, producing mitochondria and the first eukaryotic cell." },
    { id: "M_multi",      parent: "animalia",      name: "Multicellularity",     time: "~800 Ma", emoji: "🫧", note: "Multicellular animals appear in the fossil record." },
    { id: "M_cambrian",   parent: "bilateria",     name: "Cambrian Explosion",   time: "~540 Ma", emoji: "💥", note: "Most modern animal phyla appear within ~25 million years." },
    { id: "M_landplants", parent: "bryophytes",    name: "Plants colonize land", time: "~470 Ma", emoji: "🌱", note: "Bryophyte ancestors crawl onto wet land surfaces." },
    { id: "M_landverts",  parent: "tetrapoda",     name: "Tetrapods on land",    time: "~370 Ma", emoji: "🦎", note: "Lobe-finned fish evolve limbs; tetrapods leave the water." },
    { id: "M_pt",         parent: "amniota",       name: "P–T extinction",       time: "~252 Ma", emoji: "☄️", note: "Largest mass extinction in Earth's history. Synapsids survive and diversify." },
    { id: "M_flowers",    parent: "angiosperms",   name: "Flowering plants",     time: "~140 Ma", emoji: "🌸", note: "Angiosperms appear and coevolve with insect pollinators." },
    { id: "M_kpg",        parent: "placentalia",   name: "K–Pg extinction",      time: "~66 Ma",  emoji: "☄️", note: "Asteroid wipes out non-avian dinosaurs. Mammals diversify into vacated niches." },
    { id: "M_homo",       parent: "homo",          name: "Behavioral modernity", time: "~70 ka",  emoji: "🎨", note: "Language, art, long-distance trade. Homo sapiens spreads worldwide." },
  ];

  // ----- Build node/edge arrays ----------------------------------------

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var BY_ID = {};
  var NODES = [];
  var EDGES = [];

  CLADES.forEach(function (row) {
    var n = {
      id: row[0],
      kind: "clade",
      name: row[2],
      group: row[3],
      emoji: row[4],
      latin: row[5] || "",
      note: row[6] || "",
      parent: row[1],
    };
    BY_ID[n.id] = n;
    NODES.push(n);
    if (n.parent) {
      EDGES.push({ id: "E_" + n.parent + "_" + n.id, source: n.parent, target: n.id, kind: "descent" });
    }
  });
  MILESTONES.forEach(function (m) {
    var n = { id: m.id, kind: "milestone", name: m.name, time: m.time, emoji: m.emoji, note: m.note, parent: m.parent };
    BY_ID[m.id] = n;
    NODES.push(n);
    EDGES.push({ id: "M_" + m.parent + "_" + m.id, source: m.parent, target: m.id, kind: "milestone" });
  });

  // ----- Renderers -----------------------------------------------------

  function renderNode(node, el) {
    if (node.kind === "milestone") {
      el.classList.add("milestone");
      el.innerHTML =
        '<span class="milestone__emoji">' + node.emoji + '</span>' +
        '<span class="milestone__name">' + escapeHtml(node.name) + '</span>' +
        '<span class="milestone__time">' + escapeHtml(node.time) + '</span>';
      return;
    }
    el.classList.add("clade", "k-" + (node.group || "root"));
    el.innerHTML =
      '<span class="clade__emoji">' + (node.emoji || "•") + '</span>' +
      '<span class="clade__body">' +
        '<div class="clade__name">' + escapeHtml(node.name) + '</div>' +
        (node.latin ? '<div class="clade__latin">' + escapeHtml(node.latin) + '</div>' : '') +
      '</span>';
  }

  // ----- Edge styling --------------------------------------------------
  //
  // Descent edges are color-coded by the descendant's kingdom so the
  // tree visually fans out into "rainbows" by lineage.

  var GROUP_COLOR = {
    root:      "#64748b",
    bacteria:  "#0284c7",
    archaea:   "#0891b2",
    protist:   "#ca8a04",
    plant:     "#16a34a",
    fungi:     "#a16207",
    animal:    "#dc2626",
    vertebrate:"#f97316",
    mammal:    "#ec4899",
    primate:   "#a855f7",
    homo:      "#fbbf24",
  };

  function edgeStyle(edge, state) {
    if (edge.kind === "milestone") {
      var base = { stroke: "#94a3b8", width: 1, dash: [4, 4], arrow: false };
      if (state === "neighbor") return { stroke: "#fbbf24", width: 1.5, dash: [4, 4], arrow: false };
      if (state === "hover")    return { stroke: "#f59e0b", width: 2,   dash: [4, 4], arrow: false };
      if (state === "selected") return { stroke: "#fbbf24", width: 2.5, dash: [4, 4], arrow: false };
      return base;
    }
    var t = BY_ID[edge.target];
    var c = GROUP_COLOR[t ? t.group : "root"] || "#94a3b8";
    if (state === "hover")    return { stroke: c, width: 3, arrow: true };
    if (state === "selected") return { stroke: c, width: 3.5, arrow: true };
    if (state === "neighbor") return { stroke: c, width: 2.4, arrow: true };
    return { stroke: c, width: 1.4, arrow: true };
  }

  // ----- Construct graph -----------------------------------------------

  var graph = new Graph(document.getElementById("graph"), {
    nodes: NODES,
    edges: EDGES,
    direction: "LR",
    nodeWidth: 170,
    nodeHeight: 44,
    rankSeparation: 90,
    nodeSeparation: 8,
    renderNode: renderNode,
    edgeStyle: edgeStyle,
    minZoom: 0.2,
    maxZoom: 2.5,
    hitTolerancePx: 6,
    onNodeClick: showInfo,
    onPaneClick: clearInfo,
  });

  // ----- Toolbar: jump to Homo -----------------------------------------

  graph.addToolbarButton({
    id: "to-homo",
    label: "→ Homo",
    title: "Center on humans and highlight ancestor chain",
    onClick: function (g) {
      var p = g.getNodePosition("homo");
      if (!p) return;
      var rect = document.getElementById("graph").getBoundingClientRect();
      var k = 1.0;
      g.setViewport({ zoom: k, x: rect.width / 2 - (p.x + 85) * k, y: rect.height / 2 - (p.y + 22) * k });
      g.selectNode("homo");
      showInfo(BY_ID.homo);
    },
  }, { newGroup: true });

  graph.addToolbarButton({
    id: "milestones",
    label: "✦ Milestones",
    title: "Highlight the milestone events",
    onClick: function () {
      // Just open the first milestone for now to demonstrate.
      var first = MILESTONES[0];
      graph.selectNode(first.id);
      showInfo(BY_ID[first.id]);
    },
  });

  // Layout selector
  graph.addToolbarButton({
    id: "lay-auto", label: "Hier",
    title: "Hierarchical (rank-based) — the default tree layout",
    onClick: function (g) { g.setLayout("auto"); },
    pressed: function (g) { var n = g.getLayoutName(); return n === "auto" || n === "hierarchical"; },
  }, { newGroup: true });
  graph.addToolbarButton({
    id: "lay-fa2", label: "FA2",
    title: "ForceAtlas2 — clusters fan out from LUCA",
    onClick: function (g) {
      // Tree has 84 nodes / 22 ranks: more iterations help untangle it.
      g.setLayout({ name: "forceatlas2", iterations: 250, seed: 3, gravity: 0.5, scalingRatio: 15 });
    },
    pressed: function (g) { var n = g.getLayoutName(); return n === "forceatlas2" || n === "fa2"; },
  });

  // ----- Info pane on click --------------------------------------------

  var info = document.getElementById("info");

  function ancestorChain(id) {
    var chain = [];
    var n = BY_ID[id];
    while (n && n.parent) {
      n = BY_ID[n.parent];
      if (!n) break;
      chain.push(n);
    }
    return chain;
  }

  function descendantsOf(id) {
    var out = [];
    EDGES.forEach(function (e) {
      if (e.source === id) {
        var d = BY_ID[e.target];
        if (d && d.kind === "clade") out.push(d);
      }
    });
    return out;
  }

  function siblingsOf(id) {
    var n = BY_ID[id];
    if (!n || !n.parent) return [];
    return EDGES
      .filter(function (e) { return e.source === n.parent && e.target !== id; })
      .map(function (e) { return BY_ID[e.target]; })
      .filter(function (s) { return s && s.kind === "clade"; });
  }

  function pill(text, color) {
    return '<span class="pill" style="border:1px solid ' + color + ';color:' + color + '">' +
           escapeHtml(text) + '</span>';
  }

  function showInfo(node) {
    if (node.kind === "milestone") {
      var host = BY_ID[node.parent];
      info.innerHTML =
        '<h2>' + node.emoji + ' ' + escapeHtml(node.name) + '</h2>' +
        '<p class="muted">Milestone · ' + escapeHtml(node.time) + ' ago</p>' +
        '<p>' + escapeHtml(node.note) + '</p>' +
        (host ? '<p class="muted">Anchored at clade: <strong>' + escapeHtml(host.name) + '</strong></p>' : '');
      return;
    }
    var chain = ancestorChain(node.id).slice(0, 6);
    var sibs = siblingsOf(node.id);
    var kids = descendantsOf(node.id);
    var c = GROUP_COLOR[node.group] || "#94a3b8";
    info.innerHTML =
      '<h2>' + (node.emoji || "") + ' ' + escapeHtml(node.name) + '</h2>' +
      (node.latin ? '<div class="latin">' + escapeHtml(node.latin) + '</div>' : '') +
      (node.note ? '<p>' + escapeHtml(node.note) + '</p>' : '') +
      (chain.length
        ? '<p class="muted">Ancestors (closest first):</p>' +
          '<p>' + chain.map(function (a) {
            return pill(a.name, GROUP_COLOR[a.group] || "#94a3b8");
          }).join(" ") + '</p>'
        : '') +
      (sibs.length
        ? '<p class="muted">Sibling lineages (share a parent):</p>' +
          '<p>' + sibs.map(function (s) {
            return pill(s.name, GROUP_COLOR[s.group] || "#94a3b8");
          }).join(" ") + '</p>'
        : '') +
      (kids.length
        ? '<p class="muted">Descendant branches (' + kids.length + '):</p>' +
          '<p>' + kids.map(function (k) {
            return pill(k.name, GROUP_COLOR[k.group] || "#94a3b8");
          }).join(" ") + '</p>'
        : '');
  }

  function clearInfo() {
    info.innerHTML =
      '<h2>Click a clade</h2>' +
      '<p class="muted">Click any clade to see its ancestor chain back ' +
      'to LUCA, sibling lineages, and descendants. The library\'s ' +
      'built-in neighbor-highlighting traces the closest evolutionary ' +
      'links.</p>';
  }

  // ----- Test hook -----------------------------------------------------
  window.__demo = {
    graph: graph,
    get nodes() { return graph.nodes; },
    get edges() { return graph.edges; },
  };
})();
