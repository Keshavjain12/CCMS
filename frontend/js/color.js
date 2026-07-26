window.CCMS = window.CCMS || {};

CCMS.color = (function () {
  const AA = 4.5;
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

    function contrastText(bg) {
    const rgb = parse(bg);
    if (!rgb) return "#ffffff";
    return contrast(rgb, [255, 255, 255]) >= contrast(rgb, [17, 24, 39]) ? "#ffffff" : "#111827";
  }

    function readableOn(color, surface, target) {
    target = target || AA;
    const rgb = parse(color);
    const surfaceRgb = parse(surface);
    if (!rgb || !surfaceRgb) return color;
    if (contrast(rgb, surfaceRgb) >= target) return toHex(rgb);

    const towards = luminance(surfaceRgb) > 0.35 ? [0, 0, 0] : [255, 255, 255];
    for (let step = 0.05; step <= 1; step += 0.05) {
      const candidate = mix(rgb, towards, 1 - step);
      if (contrast(candidate, surfaceRgb) >= target) return toHex(candidate);
    }
    return toHex(towards);
  }

  return { parse, toHex, luminance, contrast, contrastText, readableOn, AA, AA_LARGE };
})();
