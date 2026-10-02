'use strict';

/*
 * Minimal CSS tooling: rule parsing (including @media / @supports blocks),
 * selector helpers, CSS color parsing, WCAG contrast math, and a lightness
 * search that suggests an accessible replacement color.
 */

const NAMED_COLORS = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], silver: [192, 192, 192],
  gray: [128, 128, 128], grey: [128, 128, 128], maroon: [128, 0, 0], navy: [0, 0, 128],
  olive: [128, 128, 0], lime: [0, 255, 0], teal: [0, 128, 128], aqua: [0, 255, 255],
  cyan: [0, 255, 255], fuchsia: [255, 0, 255], magenta: [255, 0, 255], yellow: [255, 255, 0],
  green: [0, 128, 0], blue: [0, 0, 255], orange: [255, 165, 0], gold: [255, 215, 0],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169], dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  gainsboro: [220, 220, 220], whitesmoke: [245, 245, 245], slategray: [112, 128, 144],
  slategrey: [112, 128, 144], lightslategray: [119, 136, 153], lightslategrey: [119, 136, 153],
  darkslategray: [47, 79, 79], darkslategrey: [47, 79, 79], ghostwhite: [248, 248, 255],
  aliceblue: [240, 248, 255], lavender: [230, 230, 250], seashell: [255, 245, 238],
  beige: [245, 245, 220], ivory: [255, 255, 240], floralwhite: [255, 250, 240],
  honeydew: [240, 255, 240], mintcream: [245, 255, 250], azure: [240, 255, 255],
  lightblue: [173, 216, 230], lightcyan: [224, 255, 255], steelblue: [70, 130, 180],
  cornflowerblue: [100, 149, 237], royalblue: [65, 105, 225], dodgerblue: [30, 144, 255],
  deepskyblue: [0, 191, 255], skyblue: [135, 206, 235], lightskyblue: [135, 206, 250],
  midnightblue: [25, 25, 112], darkblue: [0, 0, 139], mediumblue: [0, 0, 205],
  powderblue: [176, 224, 230], cadetblue: [95, 158, 160], turquoise: [64, 224, 208],
  lightseagreen: [32, 178, 170], darkcyan: [0, 139, 139], paleturquoise: [175, 238, 238],
  tomato: [255, 99, 71], coral: [255, 127, 80], salmon: [250, 128, 114],
  lightsalmon: [255, 160, 122], darksalmon: [233, 150, 122], lightcoral: [240, 128, 128],
  crimson: [220, 20, 60], firebrick: [178, 34, 34], darkred: [139, 0, 0],
  indianred: [205, 92, 92], brown: [165, 42, 42], sienna: [160, 82, 45],
  chocolate: [210, 105, 30], peru: [205, 133, 63], tan: [210, 180, 140],
  wheat: [245, 222, 179], burlywood: [222, 184, 135], sandybrown: [244, 164, 96],
  goldenrod: [218, 165, 32], darkgoldenrod: [184, 134, 11], darkorange: [255, 140, 0],
  orangered: [255, 69, 0], hotpink: [255, 105, 180], pink: [255, 192, 203],
  lightpink: [255, 182, 193], deeppink: [255, 20, 147], palevioletred: [219, 112, 147],
  darkkhaki: [189, 183, 107], khaki: [240, 230, 140], olive: [128, 128, 0],
  yellowgreen: [154, 205, 50], darkolivegreen: [85, 107, 47], darkseagreen: [143, 188, 143],
  seagreen: [46, 139, 87], mediumseagreen: [60, 179, 113], lightgreen: [144, 238, 144],
  palegreen: [152, 251, 152], darkgreen: [0, 100, 0], forestgreen: [34, 139, 34],
  springgreen: [0, 255, 127], aquamarine: [127, 255, 212], mediumspringgreen: [0, 250, 154],
  mediumaquamarine: [102, 205, 170], lightsteelblue: [176, 196, 222],
  mediumpurple: [147, 112, 219], purple: [128, 0, 128], indigo: [75, 0, 130],
  violet: [238, 130, 238], plum: [221, 160, 221], orchid: [218, 112, 214],
  thistle: [216, 191, 216], lavenderblush: [255, 240, 245], rebeccapurple: [102, 51, 153],
  blueviolet: [138, 43, 226], darkviolet: [148, 0, 211], darkorchid: [153, 50, 204],
  darkmagenta: [139, 0, 139], mediumorchid: [186, 85, 211], mediumslateblue: [123, 104, 238],
  slateblue: [106, 90, 205], papayawhip: [255, 239, 213], moccasin: [255, 228, 181],
  peachpuff: [255, 218, 185], navajowhite: [255, 222, 173], linen: [250, 240, 230],
  antiquewhite: [250, 235, 215], bisque: [255, 228, 196], blanchedalmond: [255, 235, 205],
  cornsilk: [255, 248, 220], darksalmon: [233, 150, 122], oldlace: [253, 245, 230],
  mistyrose: [255, 228, 225], rosybrown: [188, 143, 143], snow: [255, 250, 250],
};

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function parseDeclarations(body) {
  const decls = {};
  let depth = 0;
  let inStr = null;
  let cur = '';
  const parts = [];
  for (const ch of body) {
    if (inStr) {
      cur += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const part of parts) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).replace(/!\s*important/gi, '').trim();
    if (prop && val) decls[prop] = val;
  }
  return decls;
}

function extractImportUrl(prelude) {
  const m1 = /url\(\s*['"]?([^'")]+?)['"]?\s*\)/i.exec(prelude);
  if (m1) return m1[1];
  const m2 = /['"]([^'"]+)['"]/.exec(prelude);
  return m2 ? m2[1] : null;
}

/**
 * Parse CSS text into a flat list of rules: { selector, decls, media, importUrl }.
 * Handles @media/@supports/@layer nesting; other at-rule bodies are skipped.
 */
function parseCss(cssText, mediaContext = null) {
  const out = [];
  const text = stripComments(cssText);
  const n = text.length;
  let i = 0;

  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;

    // Read prelude up to '{' or ';'
    let inStr = null;
    const start = i;
    while (i < n) {
      const ch = text[i];
      if (inStr) { if (ch === inStr) inStr = null; i++; continue; }
      if (ch === '"' || ch === "'") { inStr = ch; i++; continue; }
      if (ch === ';' && start === i) { i++; break; } // stray semicolon
      if (ch === ';') break;
      if (ch === '{') break;
      i++;
    }
    const prelude = text.slice(start, i).trim();
    if (i >= n || text[i] !== '{') {
      // Statement at-rule, e.g. @import or @charset
      if (/^@import\b/i.test(prelude)) {
        out.push({ selector: '@import', decls: {}, media: mediaContext, importUrl: extractImportUrl(prelude) });
      }
      continue;
    }

    // Find the matching close brace
    let depth = 1;
    i++;
    const bodyStart = i;
    inStr = null;
    while (i < n && depth > 0) {
      const ch = text[i];
      if (inStr) { if (ch === inStr) inStr = null; }
      else if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    const body = text.slice(bodyStart, Math.max(bodyStart, i - 1));

    if (prelude.startsWith('@')) {
      const at = (prelude.slice(1).split(/[\s({]/)[0] || '').toLowerCase();
      if (at === 'media' || at === 'supports' || at === 'layer') {
        if (at === 'media' && /\bprint\b/i.test(prelude) && !/\bscreen\b|\ball\b/i.test(prelude)) {
          // Skip print-only blocks
        } else {
          out.push(...parseCss(body, at === 'media' ? prelude.slice(at.length + 1).trim() : mediaContext));
        }
      }
      // @font-face, @keyframes, @property, @page ... -> skip
    } else if (prelude) {
      out.push({ selector: prelude, decls: parseDeclarations(body), media: mediaContext });
    }
  }
  return out;
}

/** Rough specificity: ids*100 + classes/attrs/pseudos*10 + element types. */
function specificity(sel) {
  const s = sel.replace(/\[[^\]]*\]/g, '[0]');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[0\]|::?[a-zA-Z][\w-]*(\([^)]*\))?/g) || []).length;
  const rest = s.replace(/[#.][\w-]+|\[0\]|::?[a-zA-Z][\w-]*(\([^)]*\))?/g, ' ');
  const els = (rest.match(/\b[a-zA-Z][\w-]*\b/g) || []).length;
  return ids * 100 + classes * 10 + els;
}

/**
 * Strip state pseudo-classes/elements so a selector can be matched with
 * querySelectorAll. `a:hover, a:focus` -> `a, a`.
 */
function baseSelector(sel) {
  let s = sel
    .replace(/::?(?:before|after|first-line|first-letter|placeholder|selection|marker|backdrop)\b/gi, '')
    .replace(/:(?:hover|focus|focus-visible|focus-within|active|visited|link|target|checked|disabled|enabled|default|indeterminate|valid|invalid|user-valid|user-invalid|required|optional|read-only|read-write|placeholder-shown|autofill)(?:\([^\)]*\))?/gi, '')
    .trim();
  return s || sel.trim();
}

/* ------------------------------ color math ------------------------------ */

function parseColor(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'currentcolor' || s === 'inherit' ||
      s === 'initial' || s === 'unset' || s === 'revert' || s === 'none') return null;
  if (s.startsWith('var(') || s.startsWith('color(') || s.startsWith('light-dark(')) return null;

  if (s[0] === '#') {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16),
        a: hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  if (/^rgba?\(/.test(s)) {
    return parseRgbInner(s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')));
  }
  if (/^hsla?\(/.test(s)) {
    const parts = splitColorArgs(s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')));
    if (parts.ch.length < 3) return null;
    const h = ((parseFloat(parts.ch[0]) % 360) + 360) % 360;
    const sat = clamp(parseFloat(parts.ch[1]) / 100, 0, 1);
    const l = clamp(parseFloat(parts.ch[2]) / 100, 0, 1);
    if ([h, sat, l].some(Number.isNaN)) return null;
    const rgb = hslToRgb({ h, s: sat, l });
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: parts.a };
  }

  if (NAMED_COLORS[s]) {
    const [r, g, b] = NAMED_COLORS[s];
    return { r, g, b, a: 1 };
  }
  return null;
}

function splitColorArgs(inner) {
  let a = 1;
  let body = inner;
  const slash = splitTopLevel(inner, '/');
  if (slash.length === 2) {
    body = slash[0];
    const t = slash[1].trim();
    if (t.endsWith('%')) a = clamp(parseFloat(t) / 100, 0, 1);
    else a = clamp(parseFloat(t), 0, 1);
    if (Number.isNaN(a)) a = 1;
  }
  const ch = (body.includes(',') ? body.split(',') : body.split(/\s+/))
    .map((x) => x.trim()).filter(Boolean);
  return { ch, a };
}

function parseRgbInner(inner) {
  const { ch, a } = splitColorArgs(inner);
  if (ch.length < 3) return null;
  const vals = ch.slice(0, 3).map((t) => {
    if (t.endsWith('%')) return Math.round(clamp(parseFloat(t) || 0, 0, 100) * 2.55);
    return Math.round(clamp(parseFloat(t) || 0, 0, 255));
  });
  if (vals.some((v) => Number.isNaN(v))) return null;
  return { r: vals[0], g: vals[1], b: vals[2], a };
}

/** Split on top-level occurrences of `sep`, ignoring separators inside parens/strings. */
function splitTopLevel(str, sep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function channelLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function composite(fg, bg) {
  const a = fg.a == null ? 1 : fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function toHex({ r, g, b }) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Find the closest color (same hue/saturation, adjusted lightness) that
 * reaches the required contrast ratio against bg. Tries darkening and
 * lightening, preferring the smallest change.
 */
function suggestAccessibleColor(fg, bg, needed) {
  if (!fg || !bg) return null;
  const hsl = rgbToHsl(fg);
  const base = Math.round(clamp(hsl.l, 0, 1) * 100);
  for (let d = 0; d <= 100; d++) {
    for (const dir of [-1, 1]) {
      const l = clamp((base + dir * d) / 100, 0, 1);
      const cand = hslToRgb({ h: hsl.h, s: hsl.s, l });
      if (contrastRatio(cand, bg) >= needed) {
        return {
          hex: toHex(cand),
          lighten: dir === 1 && d !== 0,
          ratio: contrastRatio(cand, bg),
        };
      }
    }
  }
  return null;
}

/** Extract every parseable color token from a value (for gradients/shorthands). */
function extractAllColors(value) {
  if (!value) return [];
  const found = [];
  const seen = new Set();
  const push = (c) => {
    if (!c) return;
    const key = toHex(c) + ':' + Math.round(c.a * 100);
    if (!seen.has(key)) { seen.add(key); found.push(c); }
  };
  const re = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|hsla?\([^()]*\))/g;
  let m;
  while ((m = re.exec(value))) push(parseColor(m[1]));
  for (const name of Object.keys(NAMED_COLORS)) {
    if (new RegExp('\\b' + name + '\\b', 'i').test(value)) push(parseColor(name));
  }
  return found;
}

/** Parse a CSS length into px (assumes 16px root font-size). */
function parseLengthPx(v) {
  if (!v) return null;
  const m = /^\s*([+\d.]+)\s*(px|pt|pc|em|rem|%)?\s*$/i.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  switch ((m[2] || 'px').toLowerCase()) {
    case 'px': return n;
    case 'pt': return n * 96 / 72;
    case 'pc': return n * 16;
    case 'em':
    case 'rem': return n * 16;
    case '%': return n / 100 * 16;
    default: return n;
  }
}

/** Build a CSS path like `main > div.card:nth-of-type(2) > p`. */
function cssPath(el, maxDepth = 5) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'body') {
    if (parts.length >= maxDepth) { parts.unshift('...'); break; }
    if (node.id) { parts.unshift('#' + node.id); break; }
    let sel = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === node.tagName);
      if (same.length > 1) sel += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(sel);
    node = node.parentElement;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

module.exports = {
  parseCss, parseDeclarations, specificity, baseSelector,
  parseColor, extractAllColors, contrastRatio, composite, toHex,
  rgbToHsl, hslToRgb, suggestAccessibleColor, parseLengthPx, cssPath,
};
