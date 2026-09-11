"use client";

import { useEffect, useRef } from "react";

/**
 * The reverse chain, drawn and animated on a 2D canvas.
 *
 * This is deliberately NOT an abstract particle field. It is the product's own
 * mental model — stock flowing out to pharmacies, expiring, and coming back
 * through the distributor and manufacturer to a destruction facility — so the
 * first thing a visitor sees explains the thing rather than decorating it.
 *
 * Canvas 2D rather than a WebGL library: the whole effect is four nodes and some
 * dots on two paths. Three.js would add roughly 170 KB gzipped, which is twice
 * this entire application's shared JS budget, to draw something a hundred lines
 * of arithmetic already draws.
 *
 * Three things keep it honest about performance:
 *   - it stops entirely when scrolled off screen (IntersectionObserver)
 *   - it stops when the tab is hidden (visibilitychange)
 *   - it never starts under prefers-reduced-motion, which gets a static frame
 */

type Node = { x: number; y: number; label: string; short: string };

// Positions are fractions of the canvas box, so the layout is resolution and
// aspect independent and needs no breakpoints.
const NODES: Node[] = [
  { x: 0.12, y: 0.2, label: "Manufacturer", short: "MFG" },
  { x: 0.42, y: 0.14, label: "Distributor", short: "DIST" },
  { x: 0.76, y: 0.26, label: "Pharmacy", short: "RET" },
  { x: 0.5, y: 0.78, label: "Destruction", short: "FAC" },
];

/**
 * How far the return leg is pushed off the forward one, as a fraction of the
 * canvas height.
 *
 * Without this the two legs share the same geometry between RET, DIST and MFG,
 * so the return path draws underneath the forward path and is simply invisible —
 * which makes the legend claim a second flow the picture never shows.
 */
const RETURN_OFFSET = 0.13;

/** Forward leg: stock reaching the shelf. Return leg: what comes back. */
const FORWARD = [0, 1, 2];
const REVERSE = [2, 1, 0, 3];

interface Dot {
  leg: "forward" | "reverse";
  t: number; // 0..1 along the whole leg
  speed: number;
}

export function ChainCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;

    const dots: Dot[] = [];
    for (let i = 0; i < 7; i++) {
      dots.push({ leg: "forward", t: i / 7, speed: 0.00042 + (i % 3) * 0.00006 });
    }
    for (let i = 0; i < 6; i++) {
      dots.push({ leg: "reverse", t: i / 6, speed: 0.00034 + (i % 3) * 0.00005 });
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      // Cap the device pixel ratio at 2: beyond that the extra pixels cost real
      // fill rate on phones and nobody can see the difference.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const px = (n: Node) => ({ x: n.x * width, y: n.y * height });

    /** A node's position, pushed down when it is on the return leg. */
    const node = (i: number, offset: number) => {
      const p = px(NODES[i]);
      return { x: p.x, y: p.y + offset * height };
    };

    /** Position along a multi-segment path at 0..1. */
    function along(path: number[], t: number, offset: number) {
      const segs = path.length - 1;
      const scaled = Math.min(t, 0.9999) * segs;
      const i = Math.floor(scaled);
      const local = scaled - i;
      const a = node(path[i], offset);
      const b = node(path[i + 1], offset);
      return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
    }

    function drawPath(
      path: number[],
      dash: number[],
      colour: string,
      lineWidth: number,
      offset: number,
    ) {
      ctx!.beginPath();
      const start = node(path[0], offset);
      ctx!.moveTo(start.x, start.y);
      for (let i = 1; i < path.length; i++) {
        const p = node(path[i], offset);
        ctx!.lineTo(p.x, p.y);
      }
      ctx!.setLineDash(dash);
      ctx!.strokeStyle = colour;
      ctx!.lineWidth = lineWidth;
      ctx!.lineJoin = "round";
      ctx!.lineCap = "round";
      ctx!.stroke();
      ctx!.setLineDash([]);
    }

    function frame() {
      ctx!.clearRect(0, 0, width, height);

      // Legs. The return leg is dashed — it is the one that leaks, and a dashed
      // line reads as "not guaranteed" without needing a caption.
      drawPath(FORWARD, [], "rgba(28,100,85,0.22)", 1.5, 0);
      drawPath(REVERSE, [5, 7], "rgba(180,85,42,0.38)", 1.5, RETURN_OFFSET);

      // Units in transit.
      for (const d of dots) {
        if (!reduced) d.t = (d.t + d.speed * 16) % 1;
        const forward = d.leg === "forward";
        const p = along(forward ? FORWARD : REVERSE, d.t, forward ? 0 : RETURN_OFFSET);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx!.fillStyle = forward ? "rgba(28,100,85,0.75)" : "rgba(180,85,42,0.75)";
        ctx!.fill();
      }

      // Nodes last, so a dot passing under one is occluded rather than drawn on
      // top of the label.
      for (let i = 0; i < NODES.length; i++) {
        const n = NODES[i];
        // The facility only ever sits on the return leg, so it is drawn there.
        const p = node(i, i === 3 ? RETURN_OFFSET : 0);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 20, 0, Math.PI * 2);
        ctx!.fillStyle = "#FFFFFF";
        ctx!.fill();
        ctx!.strokeStyle = "rgba(14,78,66,0.28)";
        ctx!.lineWidth = 1.25;
        ctx!.stroke();

        ctx!.fillStyle = "#0E4E42";
        ctx!.font =
          '600 10px var(--font-sans), ui-sans-serif, system-ui, -apple-system, sans-serif';
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(n.short, p.x, p.y);

        // A label with a path running through it is unreadable, and the paths
        // move. Rather than tuning the geometry until they happen not to
        // collide, knock the background out behind the text so it stays legible
        // whatever the layout does.
        ctx!.font =
          '400 11px var(--font-sans), ui-sans-serif, system-ui, -apple-system, sans-serif';
        const labelY = p.y + 33;
        const w = ctx!.measureText(n.label).width;
        ctx!.fillStyle = "rgba(255,255,255,0.88)";
        ctx!.beginPath();
        ctx!.roundRect(p.x - w / 2 - 5, labelY - 8, w + 10, 16, 8);
        ctx!.fill();

        ctx!.fillStyle = "rgba(57,65,75,0.8)";
        ctx!.fillText(n.label, p.x, labelY);
      }

      if (running && !reduced) raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    resize();
    frame(); // paint one frame immediately, including under reduced motion

    const ro = new ResizeObserver(() => {
      resize();
      frame();
    });
    ro.observe(canvas);

    // Off screen means no work at all, not merely less.
    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0.01 },
    );
    io.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // Decorative: the same information is in the "How it works" section as
      // text, so a screen reader announcing a canvas here would add nothing.
      aria-hidden="true"
      role="presentation"
    />
  );
}
