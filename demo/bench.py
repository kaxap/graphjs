"""
Microbenchmark: measure the actual canvas + JS work the library does per
frame, with the optimized implementation vs a re-built "naive" baseline
(no Path2D cache, per-frame inline path build, per-edge arrowhead fills).

Both implementations run on the same data in the same page, so the
comparison isolates the library code path.

Run: python3 demo/bench.py
"""

from __future__ import annotations
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
URL = (ROOT / "large.html").as_uri()


# Bench harness installed inside the page. Runs each implementation N times
# and returns mean ms per call.
HARNESS = r"""
async () => {
  const g = window.__demo.graph;

  // --- Build a NAIVE drawer that mimics the pre-cache implementation:
  //     for each visible edge: lineTo segments to ctx, arrow per edge.
  //     This is what the library used to do every frame.
  const ctx = g._ctx;
  const canvas = g._canvas;
  const dpr = window.devicePixelRatio || 1;

  function naiveDraw() {
    const v = g._state.viewport;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);
    // Single style group in stress test — go straight to one batched stroke.
    ctx.beginPath();
    const geom = g._state.geometry;
    const edges = g.edges;
    for (let i = 0; i < edges.length; i++) {
      const ge = geom[edges[i].id]; if (!ge) continue;
      const pts = ge.points;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
    }
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    // Per-edge arrowhead fills (the pre-batching approach).
    for (let i = 0; i < edges.length; i++) {
      const ge = geom[edges[i].id]; if (!ge) continue;
      const pts = ge.points;
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const size = 3, w = Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - size * Math.cos(ang - w), b.y - size * Math.sin(ang - w));
      ctx.lineTo(b.x - size * Math.cos(ang + w), b.y - size * Math.sin(ang + w));
      ctx.closePath();
      ctx.fillStyle = "#cbd5e1";
      ctx.fill();
    }
  }

  function bench(fn, n) {
    for (let i = 0; i < 5; i++) fn();        // warmup
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    return (performance.now() - t0) / n;
  }

  // Pan frame: just a redraw, geometry unchanged.
  const panOpt = bench(() => g._draw(), 50);
  const panNaive = bench(() => naiveDraw(), 50);

  // Drag frame: mutate one node's incident edges, then redraw.
  function dragStep() {
    g._rebuildGeometryForNode("n500");
    g._state.nodeDrag = { id: "n500" };
    g._draw();
    g._state.nodeDrag = null;
  }
  function dragStepNaive() {
    g._rebuildGeometryForNode("n500");
    naiveDraw();
  }
  const dragOpt = bench(dragStep, 50);
  const dragNaive = bench(dragStepNaive, 50);

  // ---- End-to-end drag pipeline measurement ------------------------------
  // Synthesize a full drag: pointerdown on a node, N pointermoves, pointerup.
  // We measure how long the WHOLE sequence takes — handlers + rAF work +
  // browser dispatch — by waiting until the last move's draw completes.
  // This is the metric that maps to "fps during drag" on real Safari.
  async function fullDrag(N) {
    const el = document.querySelector('[data-node-id="n500"]');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    function pe(type, x, y, id) {
      const ev = new PointerEvent(type, { bubbles: true, pointerId: id || 1, pointerType: "mouse", button: 0, clientX: x, clientY: y });
      el.dispatchEvent(ev);
    }
    const start = performance.now();
    pe("pointerdown", cx, cy);
    for (let i = 1; i <= N; i++) pe("pointermove", cx + i * 4, cy + i * 2);
    pe("pointerup", cx + N * 4, cy + N * 2);
    // Wait for any pending rAF to flush.
    await new Promise(rAF => requestAnimationFrame(() => requestAnimationFrame(rAF)));
    return performance.now() - start;
  }
  // Run several iterations so we get an average.
  let totalMs = 0;
  for (let i = 0; i < 5; i++) totalMs += await fullDrag(20);
  const e2eMs = totalMs / 5;
  const fps = 1000 / (e2eMs / 20); // 20 moves per run

  // Full relayout: direction toggle re-applies DOM positions + rebuilds geom.
  function relayoutCycle() {
    g.setDirection(g.getDirection() === "LR" ? "TB" : "LR");
  }
  // No "naive" for relayout — DOM diffing is the optimization. Measure absolute.
  const relayoutMs = bench(relayoutCycle, 6);

  return {
    panOpt, panNaive,
    dragOpt, dragNaive,
    relayoutMs,
    e2eMs, fps,
  };
}
"""


def run(engine: str) -> dict:
    with sync_playwright() as p:
        b = getattr(p, engine).launch(headless=True)
        ctx = b.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(URL)
        page.wait_for_function("window.__demo && window.__demo.graph")
        page.wait_for_timeout(500)
        result = page.evaluate(HARNESS)
        b.close()
        return result


def fmt(ms: float) -> str:
    return f"{ms:7.3f} ms"


def main() -> int:
    engines = sys.argv[1:] or ["chromium", "webkit"]
    print("\nMicrobenchmark — 1000 nodes / 3000 edges")
    print("Lower is better. Speedup = naive / optimized.\n")
    print(f"{'engine':10s}  {'metric':14s}  {'optimized':>10s}  {'naive':>10s}  {'speedup':>8s}")
    print("-" * 64)
    for e in engines:
        r = run(e)
        for metric, opt, naive in [
            ("pan/zoom",  r["panOpt"],  r["panNaive"]),
            ("drag step", r["dragOpt"], r["dragNaive"]),
        ]:
            sp = naive / opt if opt > 0 else 0
            print(f"{e:10s}  {metric:14s}  {fmt(opt)}  {fmt(naive)}  {sp:7.1f}x")
        print(f"{e:10s}  {'relayout':14s}  {fmt(r['relayoutMs'])}  {'—':>10s}  {'—':>8s}")
        # End-to-end drag: 20 synthesized pointermoves + rAF flush.
        print(f"{e:10s}  {'drag e2e (20)':14s}  {r['e2eMs']:7.1f} ms  fps={r['fps']:6.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
