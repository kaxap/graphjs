"""
Playwright assessment of the general-purpose `Graph` library, run against
the lineage demo (which uses Graph + custom renderNode + custom edgeStyle
+ custom toolbar button).

Runs Chromium and WebKit. Verifies:
  - Library exposes general API (no lineage assumptions)
  - Default rendering works for a plain {id,label} graph
  - Customization hooks (renderNode, edgeStyle, addToolbarButton) take effect
  - Selection, drag, pan, zoom, fit, direction toggle, expand callback
  - destroy() tears down cleanly

Run: python3 demo/assess.py [chromium|webkit ...]
"""

from __future__ import annotations
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, ConsoleMessage

ROOT = Path(__file__).resolve().parent
INDEX_URL = (ROOT / "index.html").as_uri()
OUT = ROOT / "screenshots"
OUT.mkdir(exist_ok=True)


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, bool, str]] = []

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.rows.append((name, ok, detail))
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' — ' + detail) if detail else ''}")

    def summary(self) -> int:
        passed = sum(1 for _, ok, _ in self.rows if ok)
        total = len(self.rows)
        print(f"\n{passed}/{total} checks passed")
        return 0 if passed == total else 1


def canvas_nonempty(page: Page) -> tuple[bool, float]:
    return page.evaluate(
        """() => {
            const c = document.querySelector('.gv__canvas');
            const ctx = c.getContext('2d');
            const w = Math.min(400, c.width), h = Math.min(400, c.height);
            const x = (c.width - w) / 2, y = (c.height - h) / 2;
            const data = ctx.getImageData(x, y, w, h).data;
            let painted = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) painted++;
            return [painted > 0, painted / (data.length / 4)];
        }"""
    )


def run_suite(engine: str) -> int:
    print(f"\n=========================  {engine.upper()}  =========================")
    report = Report()
    console_errors: list[str] = []
    out = OUT / engine
    out.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = getattr(p, engine).launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        page.goto(INDEX_URL)
        page.wait_for_selector(".gv")
        page.wait_for_function("window.__demo && window.__demo.graph")
        page.wait_for_timeout(200)

        # --- Library is general-purpose ----------------------------------
        print("\nLibrary surface:")
        report.add("Graph constructor exposed globally", page.evaluate("typeof Graph === 'function'"))
        report.add("Version present", bool(page.evaluate("Graph.VERSION")), str(page.evaluate("Graph.VERSION")))
        # No lineage-specific names should leak from the library.
        leaked = page.evaluate("typeof LineageGraph !== 'undefined' || /lineage/i.test(Graph.toString().slice(0, 500))")
        report.add("No 'LineageGraph' / 'lineage' identifiers in library", not leaked)

        # --- Default rendering works for a plain {id,label} graph --------
        print("\nDefault rendering (no customization):")
        plain = page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.style.width = '500px'; el.style.height = '300px';
                document.body.appendChild(el);
                const g = new Graph(el, {
                    nodes: [{id:'a', label:'Alpha'}, {id:'b', label:'Beta'}, {id:'c', label:'Gamma'}],
                    edges: [{id:'e1', source:'a', target:'b'}, {id:'e2', source:'b', target:'c'}],
                });
                const labels = Array.from(el.querySelectorAll('.gv-node__label')).map(x => x.textContent);
                const result = { labels, hasCanvas: !!el.querySelector('.gv__canvas') };
                g.destroy();
                el.remove();
                return result;
            }"""
        )
        report.add("Default renderer shows .gv-node__label", plain["labels"] == ["Alpha", "Beta", "Gamma"], str(plain["labels"]))
        report.add("Library mounts a canvas", plain["hasCanvas"])

        # --- Custom renderNode in the lineage demo -----------------------
        print("\nCustom renderNode hook:")
        # The demo's renderLineageNode adds .lineage-card class and a .lineage-card__title.
        report.add("renderNode applies custom class .lineage-card", page.locator(".gv-node.lineage-card").count() == 9)
        report.add("renderNode produces .lineage-card__title", page.locator(".lineage-card__title").count() == 9)
        # Default .gv-node__label should NOT appear (custom render replaced it).
        report.add("Default label markup is replaced", page.locator(".gv-node .gv-node__label").count() == 0)

        # --- Custom edgeStyle hook ---------------------------------------
        print("\nCustom edgeStyle hook:")
        has_pixels, frac = canvas_nonempty(page)
        report.add("Canvas has painted edges (custom styles)", has_pixels, f"{frac:.1%}")
        page.screenshot(path=str(out / "01-initial.png"))

        # --- Custom toolbar button via addToolbarButton ------------------
        print("\nCustom toolbar button:")
        report.add("addToolbarButton added the Cols button",
                   page.locator('.gv-toolbar [data-id="cols"]').count() == 1)
        page.locator('.gv-toolbar [data-id="cols"]').click()
        page.wait_for_timeout(100)
        report.add("Cols button toggles user-state", page.evaluate("window.__demo.showColumns") is True)
        # Edges count in the library should have grown.
        col_count = page.evaluate("window.__demo.graph.edges.filter(e => e.kind === 'columnLineage').length")
        report.add("Library now holds column-lineage edges", col_count == 2, f"count={col_count}")
        # Toggle off.
        page.locator('.gv-toolbar [data-id="cols"]').click()
        page.wait_for_timeout(60)
        col_after = page.evaluate("window.__demo.graph.edges.filter(e => e.kind === 'columnLineage').length")
        report.add("Toggle off removes column edges from library", col_after == 0)

        # --- Built-in toolbar buttons (zoom / fit / direction) -----------
        print("\nBuilt-in toolbar:")
        v0 = page.evaluate("window.__demo.graph.getViewport()")
        page.locator('.gv-toolbar [data-id="zoom-in"]').click()
        page.wait_for_timeout(40)
        v1 = page.evaluate("window.__demo.graph.getViewport()")
        report.add("zoom-in button increases zoom", v1["zoom"] > v0["zoom"], f"{v0['zoom']:.3f} → {v1['zoom']:.3f}")
        page.locator('.gv-toolbar [data-id="fit"]').click()
        page.wait_for_timeout(80)
        # Direction toggle.
        page.locator('.gv-toolbar [data-id="dir-tb"]').click()
        page.wait_for_timeout(120)
        report.add("dir-tb button switches direction", page.evaluate("window.__demo.graph.getDirection()") == "TB")
        tb_pressed = page.locator('.gv-toolbar [data-id="dir-tb"]').get_attribute("aria-pressed")
        report.add("dir-tb shows aria-pressed=true", tb_pressed == "true")
        page.screenshot(path=str(out / "02-tb.png"))
        page.locator('.gv-toolbar [data-id="dir-lr"]').click()
        page.wait_for_timeout(120)

        # --- Selection (library API) -------------------------------------
        print("\nSelection:")
        page.evaluate("window.__demo.graph.selectNode('table.mart.orders')")
        page.wait_for_timeout(50)
        report.add("selectNode() sets is-selected",
                   "is-selected" in (page.locator('[data-node-id="table.mart.orders"]').get_attribute("class") or ""))
        sel = page.evaluate("window.__demo.graph.getSelection()")
        report.add("getSelection returns selected node", sel.get("nodeId") == "table.mart.orders", str(sel))
        page.screenshot(path=str(out / "03-selected.png"))
        page.mouse.click(20, 300)
        page.wait_for_timeout(60)
        sel = page.evaluate("window.__demo.graph.getSelection()")
        report.add("Pane click clears selection", sel.get("nodeId") is None)

        # --- Node drag (pointer events) ----------------------------------
        print("\nNode drag:")
        page.locator('.gv-toolbar [data-id="fit"]').click()
        page.wait_for_timeout(120)
        before = page.evaluate("window.__demo.graph.getNodePosition('table.mart.orders')")
        box = page.locator('[data-node-id="table.mart.orders"]').bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 120, cy + 60, steps=8)
        page.mouse.up()
        page.wait_for_timeout(80)
        after = page.evaluate("window.__demo.graph.getNodePosition('table.mart.orders')")
        moved = abs(after["x"] - before["x"]) > 5 or abs(after["y"] - before["y"]) > 5
        report.add("Drag moves node", moved, f"Δx={after['x']-before['x']:.0f}, Δy={after['y']-before['y']:.0f}")
        sel_cls = page.locator('[data-node-id="table.mart.orders"]').get_attribute("class") or ""
        report.add("Drag does not trigger selection", "is-selected" not in sel_cls)
        page.screenshot(path=str(out / "04-dragged.png"))

        # --- Expand callback (general API, not lineage-specific) ---------
        print("\nExpand callback:")
        n0 = page.evaluate("window.__demo.graph.nodes.length")
        page.locator('[data-node-id="table.raw.orders"] [data-expand="down"]').click()
        page.wait_for_timeout(120)
        n1 = page.evaluate("window.__demo.graph.nodes.length")
        report.add("onExpand 'down' grows the graph", n1 == n0 + 1, f"{n0} → {n1}")
        last = page.evaluate("window.__demo.graph.edges[window.__demo.graph.edges.length - 1]")
        report.add("New edge source = clicked node", last["source"] == "table.raw.orders")
        page.locator('[data-node-id="topic.orders"] [data-expand="up"]').click()
        page.wait_for_timeout(120)
        last = page.evaluate("window.__demo.graph.edges[window.__demo.graph.edges.length - 1]")
        report.add("'up' edge target = clicked node", last["target"] == "topic.orders")
        page.locator('.gv-toolbar [data-id="fit"]').click()
        page.wait_for_timeout(120)
        page.screenshot(path=str(out / "05-expanded.png"))

        # --- Pan ---------------------------------------------------------
        print("\nPan:")
        v0 = page.evaluate("window.__demo.graph.getViewport()")
        rect = page.evaluate("document.getElementById('graph').getBoundingClientRect().toJSON()")
        sx, sy = rect["x"] + rect["width"] - 30, rect["y"] + 200
        page.mouse.move(sx, sy); page.mouse.down()
        page.mouse.move(sx - 80, sy + 40, steps=10)
        page.mouse.up()
        page.wait_for_timeout(60)
        v1 = page.evaluate("window.__demo.graph.getViewport()")
        report.add("Pane drag pans viewport", v1["x"] != v0["x"] or v1["y"] != v0["y"], f"Δx={v1['x']-v0['x']:.0f}, Δy={v1['y']-v0['y']:.0f}")

        # --- Per-node position override (general feature) ----------------
        print("\nStatic positions:")
        static = page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.style.width = '400px'; el.style.height = '300px';
                document.body.appendChild(el);
                const g = new Graph(el, {
                    nodes: [
                      { id: 'a', label: 'A', position: { x: 50, y: 50 } },
                      { id: 'b', label: 'B', position: { x: 200, y: 150 } },
                    ],
                    edges: [{ id: 'e', source: 'a', target: 'b' }],
                });
                const pa = g.getNodePosition('a');
                const pb = g.getNodePosition('b');
                g.destroy();
                el.remove();
                return { pa, pb };
            }"""
        )
        report.add("node.position overrides auto layout (A)", static["pa"]["x"] == 50 and static["pa"]["y"] == 50, str(static["pa"]))
        report.add("node.position overrides auto layout (B)", static["pb"]["x"] == 200 and static["pb"]["y"] == 150, str(static["pb"]))

        # --- ForceAtlas2 layout ------------------------------------------
        # Tests the new built-in named layout. Validates: API surface,
        # determinism with a seed, clustering behavior (connected nodes
        # end up closer than disconnected), and standalone usage via the
        # exported Graph.layouts registry.
        print("\nForceAtlas2 layout:")
        report.add(
            "Graph.layouts.forceatlas2 exposed",
            page.evaluate("typeof Graph.layouts.forceatlas2 === 'function'"),
        )

        # API: `layout: "forceatlas2"` via constructor.
        fa2_api = page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.style.width = '600px'; el.style.height = '400px';
                document.body.appendChild(el);
                const g = new Graph(el, {
                    nodes: [{id:'a'},{id:'b'},{id:'c'},{id:'d'}],
                    edges: [{id:'e1',source:'a',target:'b'},
                            {id:'e2',source:'b',target:'c'},
                            {id:'e3',source:'a',target:'c'}],
                    layout: "forceatlas2",
                    layoutOptions: { iterations: 100, seed: 42 },
                });
                const pa = g.getNodePosition('a');
                const pb = g.getNodePosition('b');
                const pc = g.getNodePosition('c');
                const pd = g.getNodePosition('d');
                g.destroy();
                el.remove();
                return { pa, pb, pc, pd };
            }"""
        )
        report.add(
            "constructor accepts layout: \"forceatlas2\"",
            all(fa2_api[k] is not None for k in ("pa", "pb", "pc", "pd")),
        )

        # Clustering: nodes in the triangle should be mutually closer
        # than to the isolated node 'd'.
        def dist(p, q): return ((p["x"] - q["x"]) ** 2 + (p["y"] - q["y"]) ** 2) ** 0.5
        pa, pb, pc, pd = fa2_api["pa"], fa2_api["pb"], fa2_api["pc"], fa2_api["pd"]
        triangle_max = max(dist(pa, pb), dist(pb, pc), dist(pa, pc))
        to_isolated_min = min(dist(pa, pd), dist(pb, pd), dist(pc, pd))
        report.add(
            "FA2 places triangle members closer than the isolated node",
            triangle_max < to_isolated_min,
            f"triangle_max={triangle_max:.1f} < to_isolated_min={to_isolated_min:.1f}",
        )

        # Determinism with a seed: two runs of the same input must agree.
        det = page.evaluate(
            """() => {
                const nodes = [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}];
                const edges = [{id:'1',source:'a',target:'b'},
                               {id:'2',source:'c',target:'d'},
                               {id:'3',source:'d',target:'e'}];
                const opts = { iterations: 80, seed: 7, nodeWidth: 100, nodeHeight: 40 };
                const r1 = Graph.layouts.forceatlas2(nodes, edges, opts);
                const r2 = Graph.layouts.forceatlas2(nodes, edges, opts);
                // Compare position of every node.
                let maxDelta = 0;
                for (const id in r1.positions) {
                    const a = r1.positions[id], b = r2.positions[id];
                    maxDelta = Math.max(maxDelta, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
                }
                return { maxDelta };
            }"""
        )
        report.add(
            "FA2 is deterministic with the same seed",
            det["maxDelta"] < 1e-6,
            f"maxDelta={det['maxDelta']:.2e}",
        )

        # Two-cluster test: a barbell (two triangles + one bridge edge)
        # should produce two visible clusters in space.
        barbell = page.evaluate(
            """() => {
                const nodes = [
                  {id:'a1'},{id:'a2'},{id:'a3'},  // cluster A
                  {id:'b1'},{id:'b2'},{id:'b3'},  // cluster B
                ];
                const edges = [
                  // Triangle A
                  {id:'e1',source:'a1',target:'a2'},
                  {id:'e2',source:'a2',target:'a3'},
                  {id:'e3',source:'a1',target:'a3'},
                  // Triangle B
                  {id:'e4',source:'b1',target:'b2'},
                  {id:'e5',source:'b2',target:'b3'},
                  {id:'e6',source:'b1',target:'b3'},
                  // Bridge
                  {id:'e7',source:'a1',target:'b1'},
                ];
                const r = Graph.layouts.forceatlas2(nodes, edges, {
                    iterations: 200, seed: 1, nodeWidth: 80, nodeHeight: 30,
                });
                return r.positions;
            }"""
        )
        # Within-cluster mean distance vs cross-cluster mean distance.
        def dpos(a, b): return ((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5
        clA = [barbell["a1"], barbell["a2"], barbell["a3"]]
        clB = [barbell["b1"], barbell["b2"], barbell["b3"]]
        within = sum(dpos(clA[i], clA[j]) for i in range(3) for j in range(i + 1, 3))
        within += sum(dpos(clB[i], clB[j]) for i in range(3) for j in range(i + 1, 3))
        within /= 6
        across = sum(dpos(a, b) for a in clA for b in clB) / 9
        report.add(
            "FA2 separates two clusters connected by one bridge",
            across > within * 1.4,
            f"across={across:.1f} vs within={within:.1f} (ratio {across / max(within, 1e-9):.2f})",
        )

        # No-edge graph: should still produce valid positions, no crash.
        empty = page.evaluate(
            """() => {
                try {
                    const r = Graph.layouts.forceatlas2(
                        [{id:'a'},{id:'b'},{id:'c'}],
                        [],
                        { iterations: 30, seed: 1 }
                    );
                    return { ok: true, count: Object.keys(r.positions).length };
                } catch (e) { return { ok: false, error: String(e) }; }
            }"""
        )
        report.add("FA2 handles a graph with zero edges", empty["ok"] and empty["count"] == 3,
                   str(empty))

        # Object form: layout: { name: "forceatlas2", iterations: ... }.
        object_form = page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.style.width = '400px'; el.style.height = '300px';
                document.body.appendChild(el);
                const g = new Graph(el, {
                    nodes: [{id:'a'},{id:'b'}],
                    edges: [{id:'e',source:'a',target:'b'}],
                    layout: { name: "forceatlas2", iterations: 20, seed: 5, gravity: 5 },
                });
                const ok = g.getNodePosition('a') != null && g.getNodePosition('b') != null;
                g.destroy(); el.remove();
                return ok;
            }"""
        )
        report.add("constructor accepts layout: { name: ... } object form", object_form)

        # Per-node `position` overrides are honored even with FA2.
        override = page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.style.width = '400px'; el.style.height = '300px';
                document.body.appendChild(el);
                const g = new Graph(el, {
                    nodes: [
                      { id: 'pinned', position: { x: 999, y: 555 } },
                      { id: 'free' },
                    ],
                    edges: [{ id: 'e', source: 'pinned', target: 'free' }],
                    layout: "forceatlas2",
                    layoutOptions: { iterations: 20, seed: 3 },
                });
                const p = g.getNodePosition('pinned');
                g.destroy(); el.remove();
                return p;
            }"""
        )
        report.add(
            "node.position pins a node even under FA2 layout",
            override["x"] == 999 and override["y"] == 555,
            str(override),
        )

        # --- Lifecycle ---------------------------------------------------
        print("\nLifecycle:")
        cleaned = page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.style.width = '300px'; el.style.height = '200px';
                document.body.appendChild(el);
                const g = new Graph(el, { nodes: [{id:'a'}], edges: [] });
                const had = el.querySelector('.gv__canvas') != null;
                g.destroy();
                const after = el.children.length;
                el.remove();
                return { had, after };
            }"""
        )
        report.add("Mounts canvas in container", cleaned["had"])
        report.add("destroy() removes all child DOM", cleaned["after"] == 0, f"children={cleaned['after']}")

        # --- Console clean -----------------------------------------------
        report.add("No console errors/warnings", len(console_errors) == 0, "; ".join(console_errors[:3]))

        browser.close()

    print(f"\nScreenshots in: {out}")
    return report.summary()


def run_stress(engine: str) -> int:
    """Load demo/large.html — 1000 nodes / 3000 edges — and verify the
    library handles it. Reports timings and exercises drag/pan."""
    print(f"\n=========================  {engine.upper()} — STRESS  =========================")
    report = Report()
    console_errors: list[str] = []
    out = OUT / engine
    out.mkdir(exist_ok=True)
    LARGE_URL = (ROOT / "large.html").as_uri()

    with sync_playwright() as p:
        browser = getattr(p, engine).launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        t0 = time.perf_counter()
        page.goto(LARGE_URL)
        page.wait_for_function("window.__demo && window.__demo.graph", timeout=15000)
        load_ms = (time.perf_counter() - t0) * 1000
        page.wait_for_timeout(400)  # let FPS meter settle, initial draw complete

        # --- Scale checks -------------------------------------------------
        print("\nScale:")
        n_count = page.evaluate("window.__demo.graph.nodes.length")
        e_count = page.evaluate("window.__demo.graph.edges.length")
        report.add("1000 nodes loaded", n_count == 1000, f"got {n_count}")
        report.add("3000 edges loaded", e_count == 3000, f"got {e_count}")
        dom_nodes = page.locator(".gv-node").count()
        report.add("1000 DOM node cards rendered", dom_nodes == 1000, f"got {dom_nodes}")

        # --- Build time ---------------------------------------------------
        timing = page.evaluate("window.__demo.timing")
        report.add("Page load < 5000 ms", load_ms < 5000, f"{load_ms:.0f} ms")
        report.add("Graph construction < 2000 ms", timing["buildMs"] < 2000, f"build={timing['buildMs']:.0f} ms")

        # --- Canvas painted -----------------------------------------------
        has_pixels, frac = canvas_nonempty(page)
        report.add("Canvas has painted edges", has_pixels, f"{frac:.1%} of sampled region painted")
        page.screenshot(path=str(out / "stress-01-fit.png"))

        # --- Canvas-side perf: measure inside the page, bypassing IPC. -----
        # We invoke _draw repeatedly (simulating pan), simulate a drag-step
        # (rebuild geom for one node + draw), and full relayout (TB/LR).
        # These numbers reflect actual user-perceived performance, not
        # Playwright's per-event overhead.
        print("\nCanvas work (in-page timing):")
        bench = page.evaluate("""() => {
            const g = window.__demo.graph;
            function avg(fn, n) {
              // warmup
              for (let i = 0; i < 3; i++) fn();
              const t0 = performance.now();
              for (let i = 0; i < n; i++) fn();
              return (performance.now() - t0) / n;
            }
            const panMs = avg(() => g._draw(), 50);
            const dragMs = avg(() => {
              g._rebuildGeometryForNode('n500');
              // Force state.nodeDrag during the bench so _draw uses dynamic path.
              g._state.nodeDrag = { id: 'n500' };
              g._draw();
              g._state.nodeDrag = null;
            }, 30);
            return { panMs, dragMs };
        }""")
        report.add("Pan/zoom redraw < 5 ms", bench["panMs"] < 5, f"{bench['panMs']:.2f} ms/frame")
        report.add("Drag-step redraw < 10 ms", bench["dragMs"] < 10, f"{bench['dragMs']:.2f} ms/frame")

        # --- High-level drag (kept; uses real mouse events but treats Playwright
        # overhead as part of the budget). Tolerates slower CI.
        before = page.evaluate("window.__demo.graph.getNodePosition('n500')")
        box = page.locator('[data-node-id="n500"]').bounding_box()
        if box:
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            page.mouse.move(cx, cy); page.mouse.down()
            drag_t0 = time.perf_counter()
            for k in range(1, 21):
                page.mouse.move(cx + k * 6, cy + k * 3)
            drag_ms = (time.perf_counter() - drag_t0) * 1000
            page.mouse.up()
            page.wait_for_timeout(50)
            after = page.evaluate("window.__demo.graph.getNodePosition('n500')")
            moved = abs(after["x"] - before["x"]) > 20
            report.add("20-step drag completes", moved, f"Δx={after['x']-before['x']:.0f}px in {drag_ms:.0f} ms (includes Playwright IPC)")

        # --- Pan + zoom still responsive ----------------------------------
        print("\nViewport:")
        page.locator('.gv-toolbar [data-id="zoom-in"]').click()
        page.locator('.gv-toolbar [data-id="zoom-in"]').click()
        page.wait_for_timeout(80)
        page.locator('.gv-toolbar [data-id="fit"]').click()
        page.wait_for_timeout(150)
        v = page.evaluate("window.__demo.graph.getViewport()")
        report.add("Fit reduces zoom to fit large graph", v["zoom"] < 0.5, f"zoom={v['zoom']:.3f}")
        page.screenshot(path=str(out / "stress-02-zoomed.png"))

        # --- FPS sample ---------------------------------------------------
        # Read the visible FPS indicator; it's updated every 500ms.
        page.wait_for_timeout(700)
        fps_text = page.locator("#stat-fps").text_content()
        try:
            fps = float(fps_text)
        except (TypeError, ValueError):
            fps = -1
        report.add("Idle FPS measured", fps >= 0, f"fps={fps_text}")
        report.add("Idle FPS >= 30", fps >= 30, f"fps={fps}")

        # --- TB direction with 1000 nodes (perf-sensitive relayout) -------
        print("\nDirection toggle perf:")
        t_dir0 = time.perf_counter()
        page.locator('.gv-toolbar [data-id="dir-tb"]').click()
        page.wait_for_timeout(120)
        dir_ms = (time.perf_counter() - t_dir0) * 1000
        report.add("TB relayout completes", page.evaluate("window.__demo.graph.getDirection()") == "TB",
                   f"{dir_ms:.0f} ms total")
        page.screenshot(path=str(out / "stress-03-tb.png"))

        # --- Console -------------------------------------------------------
        report.add("No console errors/warnings", len(console_errors) == 0, "; ".join(console_errors[:3]))

        browser.close()

    print(f"\nScreenshots in: {out}")
    return report.summary()


def main() -> int:
    args = sys.argv[1:]
    stress_only = "--stress-only" in args
    args = [a for a in args if a != "--stress-only"]
    engines = args or ["chromium", "webkit"]
    rc = 0
    for e in engines:
        if not stress_only:
            rc |= run_suite(e)
        rc |= run_stress(e)
    return rc


if __name__ == "__main__":
    sys.exit(main())
