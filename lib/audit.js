'use strict';

const { JSDOM } = require('jsdom');
const { fetchText, fetchStylesheet, decodeDataUrl } = require('./fetcher');
const { parseCss, specificity, baseSelector } = require('./css-tools');
const { runContrast } = require('./contrast');
const { runAltText } = require('./alt-text');
const { runKeyboard } = require('./keyboard');
const { runStructure } = require('./structure');

const MAX_ISSUES_PER_CATEGORY = 40;

const CHECK_LABELS = {
  'contrast': 'Text contrast meets WCAG AA (4.5:1, 3:1 for large text)',
  'img-alt': 'All images have an alt attribute',
  'img-alt-filename': 'No alt text is a file name',
  'img-alt-generic': 'Alt text is descriptive',
  'link-name': 'All links have an accessible name',
  'input-image-alt': 'Image buttons have alt text',
  'area-alt': 'Image-map areas have alt text',
  'svg-name': 'Inline SVGs are labeled or hidden from assistive tech',
  'role-img-label': 'Elements with role="img" have text alternatives',
  'generic-link-text': 'Link text is descriptive',
  'tabindex-positive': 'No positive tabindex values',
  'click-handler': 'Click handlers are keyboard accessible',
  'link-href': 'Links are focusable (have an href)',
  'focus-outline': 'Focus outlines are not removed',
  'skip-link': 'A skip link is available',
  'zoom': 'Page zoom is not restricted',
  'mouse-only': 'Hover behavior has keyboard equivalents',
  'aria-hidden-focusable': 'aria-hidden elements contain nothing focusable',
  'html-lang': 'Page language is declared (<html lang>)',
  'doc-title': 'Document has a <title>',
  'form-label': 'All form fields have labels',
  'heading-order': 'Heading hierarchy is logical',
  'empty-button': 'Buttons have accessible names',
  'duplicate-id': 'No duplicate element IDs',
  'iframe-title': 'iframes have titles',
};

const CATEGORIES = [
  { id: 'contrast', name: 'Color contrast', blurb: 'Text vs. background ratios against WCAG AA.' },
  { id: 'alt-text', name: 'Images & alt text', blurb: 'Missing or meaningless non-text content.' },
  { id: 'keyboard', name: 'Keyboard access', blurb: 'Tab order, focus visibility, keyboard operability.' },
  { id: 'structure', name: 'Structure & semantics', blurb: 'Language, labels, headings, names & roles.' },
];

const SEV_RANK = { critical: 0, warning: 1, info: 2 };

function normalizeUrl(raw) {
  const bad = (m) => { const e = new Error(m); e.code = 'BAD_URL'; return e; };
  let s = String(raw || '').trim();
  if (!s) throw bad('Enter a URL.');
  if (s.startsWith('localhost:') || s.startsWith('localhost/') || s.startsWith('127.0.0.1')) s = 'http://' + s;
  else if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw bad(`"${raw}" is not a valid URL.`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('Only http and https URLs are supported.');
  return u.href;
}

/** Fetch every stylesheet <link>, expanding @import two levels deep. */
async function collectStylesheets(doc, baseUrl) {
  const cssTexts = [];
  doc.querySelectorAll('style').forEach((s) => {
    const t = s.textContent || '';
    if (t.trim()) cssTexts.push({ css: t, base: baseUrl });
  });

  const linkUrls = [...doc.querySelectorAll('link[href]')]
    .filter((l) => (l.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet'))
    .map((l) => {
      try { return new URL(l.getAttribute('href'), baseUrl).href; } catch { return null; }
    })
    .filter(Boolean)
    .slice(0, 12);

  const state = { imports: 0 };
  let sheetCount = 0;
  await Promise.all(linkUrls.map(async (u) => {
    try {
      if (/^data:/i.test(u)) {
        const css = decodeDataUrl(u);
        if (css) { cssTexts.push({ css, base: baseUrl }); sheetCount++; }
        return;
      }
      const res = await fetchStylesheet(u);
      const css = await expandImports(res.text, u, state, 0);
      if (css.trim()) { cssTexts.push({ css, base: u }); sheetCount++; }
    } catch { /* unreachable stylesheet -> skip */ }
  }));

  return { cssTexts, sheetCount };
}

async function expandImports(cssText, baseUrl, state, depth) {
  const imports = [];
  const css = cssText.replace(
    /@import\s+(?:url\(\s*['"]?([^'")]+?)['"]?\s*\)|['"]([^'"]+)['"])([^;]*);?/gi,
    (full, u1, u2, media) => {
      const url = u1 || u2;
      if (!url || state.imports >= 10) return '';
      try {
        imports.push({ url: new URL(url, baseUrl).href, media: (media || '').trim() });
        state.imports++;
        return '';
      } catch { return ''; }
    }
  );
  if (!imports.length || depth >= 2) return css;
  const fetched = await Promise.all(imports.map(async (imp) => {
    if (/^data:/i.test(imp.url)) {
      const css2 = decodeDataUrl(imp.url);
      return css2 || '';
    }
    try {
      const res = await fetchStylesheet(imp.url);
      return await expandImports(res.text, imp.url, state, depth + 1);
    } catch { return ''; }
  }));
  return fetched.join('\n') + '\n' + css;
}

/** Rules that only apply in a transient state (or to exempt elements) must not
 *  define the *resting* text/background color used for contrast. */
const TRANSIENT_STATE = /:(?:hover|active|visited|focus|focus-visible|focus-within|disabled|checked|target|placeholder-shown)\b/i;

/** Parse all CSS, decorate rules with a matchable base selector, spec and order. */
function buildRules(cssTexts) {
  const rules = [];
  let order = 0;
  for (const { css } of cssTexts) {
    let parsed;
    try { parsed = parseCss(css); } catch { parsed = []; }
    for (const r of parsed) {
      if (!r.selector || r.selector === '@import') continue;
      const base = baseSelector(r.selector);
      if (!base) continue;
      rules.push({
        selector: r.selector, base, decls: r.decls,
        spec: specificity(base), order: order++,
        transient: TRANSIENT_STATE.test(r.selector),
        media: r.media,
      });
    }
  }
  return rules;
}

/** Color rules that only apply in an alternate color scheme / forced mode must
 *  not be paired with the default rendering's backgrounds. */
const SCHEME_MEDIA = /prefers-color-scheme|forced-colors/i;

/** Only rules that matter for contrast (or that define custom properties)
 *  need element matching (perf). */
function buildElementMap(doc, rules) {
  const RELEVANT = new Set(['color', 'background', 'background-color', 'font-size', 'font-weight', 'display', 'visibility']);
  const map = new Map();
  for (const rule of rules) {
    if (rule.transient) continue;
    if (rule.media && SCHEME_MEDIA.test(rule.media)) continue;
    if (!Object.keys(rule.decls).some((k) => RELEVANT.has(k) || k.startsWith('--'))) continue;
    let els;
    try { els = doc.querySelectorAll(rule.base); } catch { continue; }
    for (const el of els) {
      let arr = map.get(el);
      if (!arr) { arr = []; map.set(el, arr); }
      arr.push(rule);
    }
  }
  return map;
}

const WEIGHTS = { critical: 8, warning: 3, info: 1 };
const CAPS = { critical: 48, warning: 30, info: 10 };

function computeScore(issues) {
  let penalty = 0;
  for (const sev of Object.keys(WEIGHTS)) {
    const sum = issues.filter((i) => i.severity === sev).length * WEIGHTS[sev];
    penalty += Math.min(CAPS[sev], sum);
  }
  return Math.max(0, 100 - penalty);
}

async function auditUrl(rawUrl) {
  const started = Date.now();
  const requestedUrl = normalizeUrl(rawUrl);

  const page = await fetchText(requestedUrl, { timeoutMs: 20000 });
  const looksHtml = /text\/html|application\/xhtml/i.test(page.contentType) ||
    /<html[\s>]|<!doctype html/i.test(page.text.slice(0, 4000));
  if (!looksHtml) {
    const e = new Error(`that URL does not return an HTML page (content-type: ${page.contentType || 'unknown'})`);
    e.code = 'FETCH_FAILED';
    throw e;
  }

  const dom = new JSDOM(page.text, { url: page.finalUrl });
  const doc = dom.window.document;
  const baseUrl = (doc.baseURI && /^https?:/.test(doc.baseURI)) ? doc.baseURI : page.finalUrl;

  const { cssTexts, sheetCount } = await collectStylesheets(doc, baseUrl);
  const rules = buildRules(cssTexts);
  const elementMap = buildElementMap(doc, rules);

  const applicable = new Set();
  const issues = [
    ...runContrast(doc, elementMap, applicable).map((i) => ({ ...i, category: 'contrast' })),
    ...runAltText(doc, applicable).map((i) => ({ ...i, category: 'alt-text' })),
    ...runKeyboard(doc, rules, applicable).map((i) => ({ ...i, category: 'keyboard' })),
    ...runStructure(doc, applicable).map((i) => ({ ...i, category: 'structure' })),
  ];
  issues.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.id.localeCompare(b.id));

  const summary = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };
  summary.total = summary.critical + summary.warning + summary.info;

  const categories = CATEGORIES.map((cat) => {
    const catIssues = issues.filter((i) => i.category === cat.id);
    const truncated = catIssues.length > MAX_ISSUES_PER_CATEGORY;
    return {
      id: cat.id,
      name: cat.name,
      blurb: cat.blurb,
      total: catIssues.length,
      truncated,
      issues: truncated ? catIssues.slice(0, MAX_ISSUES_PER_CATEGORY) : catIssues,
    };
  });

  const passed = Object.entries(CHECK_LABELS)
    .filter(([id]) => applicable.has(id) && !issues.some((i) => i.id === id))
    .map(([id, label]) => ({ id, label }));

  return {
    requestedUrl,
    url: page.finalUrl,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    score: computeScore(issues),
    summary,
    categories,
    passed,
    stats: {
      elements: doc.querySelectorAll('*').length,
      styleRules: rules.length,
      stylesheets: sheetCount,
    },
  };
}

module.exports = { auditUrl };
