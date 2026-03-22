import { useEffect, useRef } from "react";

/** Target speed: ~25% of original 0.45px/frame (75% slower). Applied via accumulator so sub-pixel steps still scroll. */
var SCROLL_STEP = 0.1125;

/**
 * Continuous smooth scroll when content overflows (vertical or horizontal).
 * Respects prefers-reduced-motion.
 */
export default function TVAutoScroll(p) {
  var ref = useRef(null);
  var axis = p.axis === "horizontal" ? "horizontal" : "vertical";

  useEffect(
    function () {
      var el = ref.current;
      if (!el) return;
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;

      var raf = 0;
      var cancelled = false;
      /** Fractional remainder — browsers often use integer scrollTop/Left; tiny adds can round to 0. */
      var acc = 0;

      function tick() {
        if (cancelled || !el) return;
        if (axis === "vertical") {
          if (el.scrollHeight <= el.clientHeight + 2) {
            raf = requestAnimationFrame(tick);
            return;
          }
          acc += SCROLL_STEP;
          if (acc >= 1) {
            var dy = Math.floor(acc);
            acc -= dy;
            el.scrollTop += dy;
          }
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
            el.scrollTop = 0;
            acc = 0;
          }
        } else {
          if (el.scrollWidth <= el.clientWidth + 2) {
            raf = requestAnimationFrame(tick);
            return;
          }
          acc += SCROLL_STEP;
          if (acc >= 1) {
            var dx = Math.floor(acc);
            acc -= dx;
            el.scrollLeft += dx;
          }
          if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) {
            el.scrollLeft = 0;
            acc = 0;
          }
        }
        raf = requestAnimationFrame(tick);
      }

      raf = requestAnimationFrame(tick);
      return function () {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    },
    [axis, p.resetKey]
  );

  return (
    <div
      ref={ref}
      className={
        (p.className || "") +
        " [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      }
    >
      {p.children}
    </div>
  );
}
