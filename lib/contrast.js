'use strict';

/*
 * Contrast check (WCAG 1.4.3). Heuristic static analysis:
 * - finds elements that declare a text `color` (inline or via matched CSS rule)
 * - resolves an effective background by walking up the ancestor chain
 * - computes the WCAG contrast ratio and compares against 4.5:1 (or 3:1 for
 *   large text: >= 24px, or >= 18.66px bold)
 */

const {
  parseColor, extractAllColors, contrastRatio, composite, toHex,
  suggestAccessibleColor, parseLengthPx, parseDeclarations, cssPath,
} = require('./css-tools');

const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g;
const varNodeCache = new WeakMap();

/**
 * Resolve var() references using the cascade at `el`: custom properties are
 * looked up on the element itself, then up the ancestor chain, taking the
 * highest-specificity (then last-declared) matched rule at each node. This
 * keeps theme-scoped overrides (e.g. html.night { --link: ... }) from leaking
 * into the default rendering.
 */
function resolveAt(el, value, elementMap, depth = 0) {
  if (!value || typeof value !== 'string' || !value.includes('var(') || depth > 5) return value;
  return value.replace(VAR_RE, (m0, name, fallback) => {
    let resolved = lookupVar(el, name, elementMap);
    if (resolved == null) {
      return (fallback || '').trim() || 'var-unresolved';
    }
    if (resolved.includes('var(')) resolved = resolveAt(el, resolved, elementMap, depth + 1);
    return resolved;
  });
}

function lookupVar(el, name, elementMap) {
  let node = el;
  while (node && node.nodeType === 1) {
    // Custom properties inherit: walk up until some ancestor declares `name`,
    // taking the highest-specificity (then last-declared) match at that node.
    const declared = declaredAtNode(node, name, elementMap);
    if (declared !== undefined) return declared;
    node = node.parentElement;
  }
  return undefined;
}

function declaredAtNode(node, name, elementMap) {
  const lowerName = name.toLowerCase();
  let cache = varNodeCache.get(node);
  if (!cache) { cache = new Map(); varNodeCache.set(node, cache); }
  if (cache.has(name)) return cache.get(name) || undefined;

  let found;
  const styleAttr = node.getAttribute && node.getAttribute('style');
  if (styleAttr) {
    for (const [k, v] of Object.entries(parseDeclarations(styleAttr))) {
      if (k.toLowerCase() === lowerName) { found = v; break; }
    }
  }
  if (found === undefined) {
    let best = null;
    for (const r of elementMap.get(node) || []) {
      for (const [k, v] of Object.entries(r.decls)) {
        if (k.toLowerCase() !== lowerName) continue;
        if (!best || r.spec > best.spec || (r.spec === best.spec && r.order > best.order)) {
          best = { v, spec: r.spec, order: r.order };
        }
      }
    }
    if (best) found = best.v;
  }
  cache.set(name, found || null); // null = "declared nowhere on this node"
  return found;
}

function effectiveDecl(el, prop, elementMap) {
  const styleAttr = el.getAttribute && el.getAttribute('style');
  if (styleAttr) {
    const d = parseDeclarations(styleAttr);
    if (d[prop] !== undefined) return { value: d[prop], rule: null, inline: true };
  }
  const entries = elementMap.get(el) || [];
  let best = null;
  for (const r of entries) {
    const v = r.decls[prop];
    if (v === undefined) continue;
    if (!best || r.spec > best.spec || (r.spec === best.spec && r.order > best.order)) {
      best = { value: v, rule: r, inline: false, spec: r.spec, order: r.order };
    }
  }
  return best;
}

function isHidden(el, elementMap) {
  let node = el;
  while (node && node.nodeType === 1) {
    const d = effectiveDecl(node, 'display', elementMap);
    if (d && resolveAt(node, d.value, elementMap).trim() === 'none') return true;
    const v = effectiveDecl(node, 'visibility', elementMap);
    if (v && resolveAt(node, v.value, elementMap).trim() === 'hidden') return true;
    node = node.parentElement;
  }
  return false;
}

/** Candidates for the background behind `el`, nearest first. */
function backgroundCandidates(el, elementMap) {
  const candidates = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const bgc = effectiveDecl(node, 'background-color', elementMap);
    const bg = bgc ? null : effectiveDecl(node, 'background', elementMap);
    const raw = bgc ? resolveAt(node, bgc.value, elementMap) : bg ? resolveAt(node, bg.value, elementMap) : null;
    if (raw) {
      const isGradient = /gradient\(/i.test(raw);
      const colors = parseColor(raw) ? [parseColor(raw)] : isGradient ? extractAllColors(raw) : extractAllColors(raw);
      if (colors.length) {
        candidates.push(...colors.map((c) => ({ color: c, gradient: isGradient, node })));
        if (!isGradient && colors[0].a >= 1) break;
      }
    }
    node = node.parentElement;
  }
  return candidates;
}

function effectiveBackground(el, elementMap) {
  const chain = backgroundCandidates(el, elementMap);
  if (!chain.length) return { r: 255, g: 255, b: 255, a: 1 }; // assume white page
  let acc = chain[0].color;
  for (let i = 1; i < chain.length && acc.a < 1; i++) acc = composite(acc, chain[i].color);
  if (acc.a < 1) acc = composite(acc, { r: 255, g: 255, b: 255, a: 1 });
  return acc;
}

function effectiveFontSize(el, elementMap) {
  let node = el;
  while (node && node.nodeType === 1) {
    const d = effectiveDecl(node, 'font-size', elementMap);
    if (d) {
      const px = parseLengthPx(resolveAt(node, d.value, elementMap));
      if (px) return px;
    }
    node = node.parentElement;
  }
  return 16;
}

function isBold(el, elementMap) {
  const tag = el.tagName.toLowerCase();
  if (/^(h1|h2|h3|h4|h5|h6|b|strong|th)$/.test(tag)) return true;
  let node = el;
  while (node && node.nodeType === 1) {
    const d = effectiveDecl(node, 'font-weight', elementMap);
    if (d) {
      const v = resolveAt(node, d.value, elementMap).trim();
      if (v === 'bold' || v === 'bolder') return true;
      const n = parseInt(v, 10);
      if (!Number.isNaN(n) && n >= 600) return true;
      return false; // nearest explicit weight wins
    }
    node = node.parentElement;
  }
  return false;
}

function hasDirectText(el) {
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
}

function runContrast(doc, elementMap, applicable) {
  const issues = [];
  if (!doc.body) return issues;
  const all = [...doc.body.querySelectorAll('*')];
  const groups = new Map();

  for (const el of all) {
    const colorEff = effectiveDecl(el, 'color', elementMap);
    if (!colorEff) continue;
    const fgRaw = parseColor(resolveAt(el, colorEff.value, elementMap));
    if (!fgRaw) continue;
    if (!hasDirectText(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (isHidden(el, elementMap)) continue;

    applicable.add('contrast');
    const bg = effectiveBackground(el, elementMap);
    const fgSolid = fgRaw.a >= 1 ? fgRaw : composite(fgRaw, bg);

    const fs = effectiveFontSize(el, elementMap);
    const bold = isBold(el, elementMap);
    const large = fs >= 24 || (bold && fs >= 18.66);
    const needed = large ? 3 : 4.5;

    const ratio = contrastRatio(fgSolid, bg);
    if (ratio + 0.01 >= needed) continue;

    const fgHex = toHex(fgSolid);
    const bgHex = toHex(bg);
    const displaySel = colorEff.inline ? null : (colorEff.rule ? colorEff.rule.selector : null);
    const key = `${displaySel || 'inline'}|${fgHex}|${bgHex}|${needed}`;
    const g = groups.get(key) || {
      count: 0, el, colorEff, displaySel, fgHex, bgHex, ratio, needed, large,
    };
    g.count++;
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const critical = g.ratio < (g.needed === 4.5 ? 3 : 2.25);
    const suggestion = suggestAccessibleColor(parseColor(g.fgHex), parseColor(g.bgHex), g.needed);
    const wherePaths = [cssPath(g.el)];
    const snippets = [snippetOf(g.el)];

    issues.push({
      id: 'contrast',
      severity: critical ? 'critical' : 'warning',
      title: `Low text contrast: ${g.fgHex} on ${g.bgHex} (${g.ratio.toFixed(2)}:1, needs ${g.needed}:1)`,
      description:
        `WCAG AA requires a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text ` +
        `(at least 24px, or 18.66px bold). This text measures ${g.ratio.toFixed(2)}:1, which is below the threshold.` +
        (g.count > 1 ? ` The same problem was found on ${g.count} elements.` : ''),
      fix: suggestion
        ? `${suggestion.lighten ? 'Lighten' : 'Darken'} the text color to about ${suggestion.hex} — that reaches ${suggestion.ratio.toFixed(2)}:1 against ${g.bgHex}. Alternatively, change the background or use a heavier/larger font if that pushes the text into the "large text" bucket.`
        : `Change the text or background color until the contrast ratio reaches ${g.needed}:1.`,
      fixCode: suggestion ? `color: ${suggestion.hex};` : null,
      suggested: suggestion ? suggestion.hex : null,
      suggestedOn: g.bgHex,
      wcag: '1.4.3',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
      where: { selector: g.displaySel || (g.colorEff.inline ? 'inline style' : null), paths: wherePaths, snippets, count: g.count },
    });
  }

  return issues;
}

function snippetOf(el) {
  let html = el.outerHTML || '';
  if (html.length > 160) html = html.slice(0, 160).replace(/\s+$/, '') + '…';
  return html;
}

module.exports = { runContrast, snippetOf };
