"""
Playwright assessment of the static lineage demo.

Runs against Chromium and WebKit (Safari engine). Drives the page through
the library's public API (window.__demo.graph) and uses real mouse events
for drag / pan.

Run:  python3 demo/assess.py [chromium|webkit ...]
"""

from __future__ import annotations
import sys
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
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}{(' — ' + detail) if detail else ''}")

    def summary(self) -> int:
        passed = sum(1 for _, ok, _ in self.rows if ok)
        total = len(self.rows)
        print(f"\n{passed}/{total} checks passed")
        return 0 if passed == total else 1


def canvas_nonempty(page: Page) -> tuple[bool, float]:
    return page.evaluate(
        """() => {
            const c = document.querySelector('.lg__canvas');
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

        def on_console(msg: ConsoleMessage) -> None:
            if msg.type in ("error", "warning"):
                console_errors.append(f"{msg.type}: {msg.text}")
        page.on("console", on_console)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        page.goto(INDEX_URL)
        page.wait_for_selector(".lg")
        page.wait_for_function("window.__demo && window.__demo.graph")
        page.wait_for_timeout(200)

        # --- Library presence & init -------------------------------------
        print("\nLibrary init:")
        report.add("LineageGraph constructor exposed", page.evaluate("typeof LineageGraph === 'function'"))
        version = page.evaluate("LineageGraph.VERSION")
        report.add("Library version set", bool(version), str(version))
        report.add("9 node cards rendered", page.locator(".lg-node").count() == 9)
        has_pixels, frac = canvas_nonempty(page)
        report.add("Canvas has painted edges", has_pixels, f"{frac:.1%} of sampled region painted")
        report.add("Toolbar rendered by library", page.locator(".lg-controls").is_visible())
        report.add("Legend rendered by library", page.locator(".lg-legend").is_visible())
        page.screenshot(path=str(out / "01-initial.png"))

        # --- Public API: getViewport / fitView ---------------------------
        print("\nPublic API:")
        vp = page.evaluate("window.__demo.graph.getViewport()")
        report.add("getViewport returns {x,y,zoom}", all(k in vp for k in ("x", "y", "zoom")), str(vp))
        page.evaluate("window.__demo.graph.zoomIn()")
        vp2 = page.evaluate("window.__demo.graph.getViewport()")
        report.add("zoomIn() increases zoom", vp2["zoom"] > vp["zoom"], f"{vp['zoom']:.3f} → {vp2['zoom']:.3f}")
        page.evaluate("window.__demo.graph.fitView()")
        page.wait_for_timeout(80)

        # --- Selection via API + DOM verification ------------------------
        print("\nSelection:")
        page.evaluate("window.__demo.graph.selectNode('table.mart.orders')")
        page.wait_for_timeout(60)
        sel_class = page.locator('[data-node-id="table.mart.orders"]').get_attribute("class") or ""
        report.add("selectNode applies is-selected class", "is-selected" in sel_class)
        # Click pane → clear.
        page.mouse.click(20, 300)
        page.wait_for_timeout(60)
        sel_class = page.locator('[data-node-id="table.mart.orders"]').get_attribute("class") or ""
        report.add("Pane click clears selection", "is-selected" not in sel_class)
        page.screenshot(path=str(out / "02-selected.png"))

        # --- Toolbar: direction toggle -----------------------------------
        print("\nToolbar direction:")
        page.locator('.lg-controls [data-action="dir-tb"]').click()
        page.wait_for_timeout(120)
        tb_active = "is-active" in (page.locator('.lg-controls [data-action="dir-tb"]').get_attribute("class") or "")
        report.add("TB button shows is-active", tb_active)
        # In TB layout, topic.orders.y < mart.y.
        y_topic = page.evaluate("window.__demo.graph.getNodePosition('topic.orders').y")
        y_mart = page.evaluate("window.__demo.graph.getNodePosition('table.mart.orders').y")
        report.add("TB layout: topic above mart in y", y_topic < y_mart, f"{y_topic} < {y_mart}")
        page.screenshot(path=str(out / "03-tb.png"))
        # Switch back.
        page.locator('.lg-controls [data-action="dir-lr"]').click()
        page.wait_for_timeout(120)

        # --- Column-lineage toggle ---------------------------------------
        print("\nColumn lineage:")
        before = page.evaluate("window.__demo.edges.filter(e => e.type === 'columnLineage').length")
        page.locator('.lg-controls [data-action="cols"]').click()
        page.wait_for_timeout(80)
        # The geometry map should now include column edges.
        col_geom = page.evaluate(
            "Object.values(window.__demo.graph._state.geometry).filter(g => g.edge.type === 'columnLineage').length"
        )
        report.add("Column-lineage geometry present when toggled on", col_geom == before, f"{col_geom} == {before}")
        page.screenshot(path=str(out / "04-columns.png"))
        page.locator('.lg-controls [data-action="cols"]').click()
        page.wait_for_timeout(80)

        # --- Node drag (real pointer events) -----------------------------
        print("\nNode drag:")
        page.locator('.lg-controls [data-action="fit"]').click()
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
        report.add("Drag moves node via library", moved, f"Δx={after['x'] - before['x']:.0f}, Δy={after['y'] - before['y']:.0f}")
        sel_class = page.locator('[data-node-id="table.mart.orders"]').get_attribute("class") or ""
        report.add("Drag does not trigger selection", "is-selected" not in sel_class)
        page.screenshot(path=str(out / "05-dragged.png"))

        # --- Expand callbacks via library --------------------------------
        print("\nExpand callbacks:")
        n_before = page.evaluate("window.__demo.graph.nodes.length")
        e_before = page.evaluate("window.__demo.graph.edges.length")
        page.locator('[data-node-id="table.raw.orders"] [data-expand="down"]').click()
        page.wait_for_timeout(120)
        n_after = page.evaluate("window.__demo.graph.nodes.length")
        e_after = page.evaluate("window.__demo.graph.edges.length")
        report.add("Downstream expand adds a node", n_after == n_before + 1, f"{n_before} → {n_after}")
        report.add("Downstream expand adds an edge", e_after == e_before + 1, f"{e_before} → {e_after}")
        last_edge = page.evaluate("window.__demo.graph.edges[window.__demo.graph.edges.length - 1]")
        report.add("Downstream edge source = raw_orders", last_edge["source"] == "table.raw.orders")

        page.locator('[data-node-id="topic.orders"] [data-expand="up"]').click()
        page.wait_for_timeout(120)
        last_edge = page.evaluate("window.__demo.graph.edges[window.__demo.graph.edges.length - 1]")
        report.add("Upstream edge target = orders.events", last_edge["target"] == "topic.orders")
        page.locator('.lg-controls [data-action="fit"]').click()
        page.wait_for_timeout(120)
        page.screenshot(path=str(out / "06-expanded.png"))

        # --- Pane drag (pan) ---------------------------------------------
        print("\nPan:")
        v0 = page.evaluate("window.__demo.graph.getViewport()")
        rect = page.evaluate("document.getElementById('graph').getBoundingClientRect().toJSON()")
        sx = rect["x"] + rect["width"] - 30
        sy = rect["y"] + 200
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx - 80, sy + 40, steps=10)
        page.mouse.up()
        page.wait_for_timeout(60)
        v1 = page.evaluate("window.__demo.graph.getViewport()")
        report.add("Pane drag pans viewport", v1["x"] != v0["x"] or v1["y"] != v0["y"], f"Δx={v1['x']-v0['x']:.0f}, Δy={v1['y']-v0['y']:.0f}")

        # --- destroy() cleans up DOM -------------------------------------
        print("\nLifecycle:")
        # Create a scratch container, mount a library instance, destroy it.
        cleaned = page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.style.width = '400px'; el.style.height = '300px';
                document.body.appendChild(el);
                const g = new LineageGraph(el, { nodes: [{id:'a', name:'a'}], edges: [] });
                const had = el.querySelector('.lg__canvas') != null;
                g.destroy();
                const after = el.children.length;
                el.remove();
                return { had, after };
            }"""
        )
        report.add("Library mounts a canvas into the container", cleaned["had"])
        report.add("destroy() removes all child DOM", cleaned["after"] == 0, f"children={cleaned['after']}")

        # --- Console clean -----------------------------------------------
        report.add("No console errors/warnings", len(console_errors) == 0, "; ".join(console_errors[:3]))

        browser.close()

    print(f"\nScreenshots in: {out}")
    return report.summary()


def main() -> int:
    engines = sys.argv[1:] or ["chromium", "webkit"]
    rc = 0
    for e in engines:
        rc |= run_suite(e)
    return rc


if __name__ == "__main__":
    sys.exit(main())
