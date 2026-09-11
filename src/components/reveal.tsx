"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Reveals an element once it scrolls into view.
 *
 * IntersectionObserver rather than a scroll handler: a scroll listener fires on
 * every frame of every scroll for the life of the page, and the work it does is
 * a layout read — the exact shape of a jank bug. The observer fires once per
 * element and then disconnects.
 *
 * The transition itself lives in globals.css so it runs on the compositor. This
 * only toggles a class.
 *
 * Returned as a hook rather than only a wrapper component so semantic elements
 * keep their tags: a card in a list stays an `<li>` instead of being buried in a
 * presentational `<div>`.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(delay = 0) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Older browsers, and anything rendering without a DOM, simply show.
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      // Fires slightly before the element reaches the fold, so the motion has
      // finished by the time it is properly in view.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return {
    ref,
    className: cn("reveal", shown && "is-visible"),
    style: delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined,
  };
}

/** The common case: a plain wrapper that fades and rises into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  /** Stagger, in ms. Keep a grid's total under ~400ms or it feels sluggish. */
  delay?: number;
  className?: string;
}) {
  const r = useReveal<HTMLDivElement>(delay);
  return (
    <div ref={r.ref} className={cn(r.className, className)} style={r.style}>
      {children}
    </div>
  );
}
