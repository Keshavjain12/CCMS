// ============================================================
// COLOUR  —  contrast maths for the per-role accent
// ============================================================
// roles.js gives each portal one accent hex. That single value was used for
// two incompatible jobs: as text on a surface, and as a fill carrying white
// text. Those pull in opposite directions — TS's #0ea5e9 scored 2.77:1 both
// as text on white AND under the white label of a primary button, failing
// WCAG AA twice over. Four of the nine portals failed.
//
// So the hex stays the brand, and the readable variants are derived from it:
//
//   --accent           the brand colour — fills, borders, bars
//   --accent-text      the accent, adjusted until it is readable as text on
//                      the current surface (darkened on light, lightened on dark)
//   --accent-contrast  black or white — whichever is readable ON the accent
//
// Derived rather than hand-picked so a new portal colour cannot quietly ship
// below AA, and so both themes are handled by the same rule.
// ============================================================
window.CCMS = window.CCMS || {};

CCMS.color = (function () {
  const AA = 4.5;   // WCAG AA, normal text
  const AA_LARGE = 3;

  function parse(hex) {
    let h = String(hex || "").trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  function toHex(rgb) {
    return "#" + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
  }

  // WCAG relative luminance.
  function luminance(rgb) {
    const [r, g, b] = rgb.map((c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const ra = typeof a === "string" ? parse(a) : a;
    const rb = typeof b === "string" ? parse(b) : b;
    if (!ra || !rb) return 1;
    const l = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
    return (l[0] + 0.05) / (l[1] + 0.05);
  }

  function mix(a, b, amountOfA) {
    return a.map((c, i) => c * amountOfA + b[i] * (1 - amountOfA));
  }

  /** Black or white — whichever is readable on top of `bg`. */
  function contrastText(bg) {
    const rgb = parse(bg);
    if (!rgb) return "#ffffff";
    return contrast(rgb, [255, 255, 255]) >= contrast(rgb, [17, 24, 39]) ? "#ffffff" : "#111827";
  }

  /**
   * Nudge `color` toward black or white — whichever direction the surface
   * demands — until it clears `target` against `surface`. Steps in small
   * increments and stops at the first passing value, so a portal keeps as
   * much of its own hue as accessibility allows rather than collapsing to
   * near-black. Falls back to the extreme if even that cannot reach target
   * (possible against a mid-grey surface).
   */
  function readableOn(color, surface, target) {
    target = target || AA;
    const rgb = parse(color);
    const surfaceRgb = parse(surface);
    if (!rgb || !surfaceRgb) return color;
    if (contrast(rgb, surfaceRgb) >= target) return toHex(rgb);

    // Dark surface → lift toward white. Light surface → deepen toward black.
    const towards = luminance(surfaceRgb) > 0.35 ? [0, 0, 0] : [255, 255, 255];
    for (let step = 0.05; step <= 1; step += 0.05) {
      const candidate = mix(rgb, towards, 1 - step);
      if (contrast(candidate, surfaceRgb) >= target) return toHex(candidate);
    }
    return toHex(towards);
  }

  return { parse, toHex, luminance, contrast, contrastText, readableOn, AA, AA_LARGE };
})();
