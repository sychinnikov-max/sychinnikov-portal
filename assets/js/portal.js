// Sychinnikov Portal — shared scripts (reveal + nav active)

(function () {
  // ── REVEAL on scroll (fallback for browsers without animation-timeline)
  function initReveal() {
    if (CSS.supports && CSS.supports("animation-timeline", "view()")) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );
    document.querySelectorAll(".reveal").forEach((n) => observer.observe(n));
  }

  // ── NAV active link
  function initNavActive() {
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    document.querySelectorAll(".nav a[data-nav]").forEach((a) => {
      const href = (a.getAttribute("href") || "").replace(/\/$/, "") || "/";
      if (href === path || (href !== "/" && path.startsWith(href))) {
        a.classList.add("is-active");
      }
    });
  }

  // ── Magnetic CTA effect (desktop only)
  function initMagnetic() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const MAX = 6, REACH = 80;
    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      let raf = 0, cx = 0, cy = 0, tx = 0, ty = 0;
      const tick = () => {
        cx += (tx - cx) * 0.18;
        cy += (ty - cy) * 0.18;
        el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
        if (Math.abs(cx - tx) > 0.05 || Math.abs(cy - ty) > 0.05) raf = requestAnimationFrame(tick);
        else raf = 0;
      };
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy);
        const reach = Math.max(r.width, r.height) / 2 + REACH;
        if (dist < reach) {
          const s = 1 - Math.min(dist / reach, 1);
          tx = (dx / reach) * MAX * s * 2;
          ty = (dy / reach) * MAX * s * 2;
        } else { tx = 0; ty = 0; }
        if (!raf) raf = requestAnimationFrame(tick);
      });
      el.addEventListener("mouseleave", () => {
        tx = 0; ty = 0;
        if (!raf) raf = requestAnimationFrame(tick);
      });
    });
  }

  function start() {
    initReveal();
    initNavActive();
    initMagnetic();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
