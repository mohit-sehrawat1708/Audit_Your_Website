'use strict';

/* AccessLens frontend — vanilla JS, no dependencies. */

const $ = (s, r = document) => r.querySelector(s);

const form = $('#audit-form');
const input = $('#url');
const scanBtn = $('#scan-btn');
const statusEl = $('#status');
const heroEl = $('#hero');
const resultsEl = $('#results');

let report = null;
let filters = { category: 'all', severity: 'all' };
let statusTimer = null;

const LOADING_MESSAGES = [
  'Fetching the page…',
  'Parsing the HTML…',
  'Downloading stylesheets…',
  'Measuring text contrast…',
  'Checking images and alt text…',
  'Testing keyboard access…',
  'Compiling your report…',
];

/* ------------------------------ helpers ------------------------------ */

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'string') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function svgIcon(path, size = 15) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

const ICON_CHECK = 'M4.5 12.5l4.8 4.8L19.5 7';
const ICON_FIX = 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1';

function setStatus(kind, message) {
  clearInterval(statusTimer);
  statusTimer = null;
  statusEl.textContent = '';
  if (!kind) return;
  if (kind === 'loading') {
    statusEl.className = 'status';
    const msg = h('div', { class: 'status-msg', id: 'status-msg' });
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
    statusEl.append(
      h('div', { class: 'status loading', 'aria-describedby': 'status-msg' },
        h('div', { class: 'spinner', 'aria-hidden': 'true' }),
        h('div', {}, msg, bar))
    );
    let i = 0;
    msg.textContent = LOADING_MESSAGES[0];
    statusTimer = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      msg.textContent = LOADING_MESSAGES[i];
    }, 1300);
  } else if (kind === 'error') {
    statusEl.className = 'status';
    statusEl.append(h('div', { class: 'status error', text: message }));
  }
}

function setLoading(on) {
  scanBtn.disabled = on;
  scanBtn.textContent = on ? 'Scanning…' : 'Scan page';
}

function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.hidden = false;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 250);
  }, 1800);
}

function shortenUrl(u) {
  try {
    const parsed = new URL(u);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const out = parsed.host + path;
    return out.length > 60 ? out.slice(0, 57) + '…' : out;
  } catch { return u; }
}

/* ------------------------------ audit flow ------------------------------ */

form.addEventListener('submit', (e) => {
  e.preventDefault();
  runAudit(input.value);
});

$('#chip-fixture').addEventListener('click', () => {
  const url = location.origin + '/fixtures/messy-page.html';
  input.value = url;
  runAudit(url);
});

document.querySelectorAll('.chip[data-url]').forEach((chip) => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.url;
    runAudit(chip.dataset.url);
  });
});

async function runAudit(raw) {
  const url = (raw || '').trim();
  if (!url) {
    setStatus('error', 'Paste a URL first.');
    input.focus();
    return;
  }
  setLoading(true);
  setStatus('loading');
  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Audit failed.');
    report = data;
    setStatus(null);
    renderReport(data);
  } catch (err) {
    setStatus('error', (err.message || 'Something went wrong.') + ' Check the URL and try again.');
  } finally {
    setLoading(false);
  }
}

/* ------------------------------ rendering ------------------------------ */

function renderReport(r) {
  heroEl.hidden = true;
  resultsEl.hidden = false;
  filters = { category: 'all', severity: 'all' };

  $('#audited-url').textContent = shortenUrl(r.url);
  $('#audited-url').title = r.url;
  $('#audit-stats').textContent =
    `${r.stats.elements.toLocaleString()} elements · ${r.stats.styleRules} CSS rules · ${r.stats.stylesheets} stylesheets · ${(r.durationMs / 1000).toFixed(1)}s`;

  renderRing(r.score);
  renderSummary(r);
  renderFilters(r);
  renderIssues(r);
  renderPassed(r);

  resultsEl.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderRing(score) {
  const ring = $('#ring');
  const value = $('#ring-value');
  ring.classList.remove('mid', 'bad');
  if (score < 50) ring.classList.add('bad');
  else if (score < 90) ring.classList.add('mid');
  ring.setAttribute('aria-label', `Accessibility score ${score} out of 100`);

  value.style.strokeDashoffset = 100;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    value.style.strokeDashoffset = 100 - score;
  }));

  const num = $('#score-num');
  const start = performance.now();
  const dur = 800;
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    num.textContent = Math.round(score * eased);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderSummary(r) {
  const wrap = $('#summary');
  wrap.textContent = '';
  const mk = (sev, label, n) =>
    h('button', {
      class: 'count-chip' + (filters.severity === sev ? ' active' : ''),
      type: 'button', 'data-sev': sev,
      'aria-pressed': filters.severity === sev ? 'true' : 'false',
      onclick: () => {
        filters.severity = filters.severity === sev ? 'all' : sev;
        renderSummary(report); renderIssues(report);
      },
    }, h('span', { class: 'dot', 'aria-hidden': 'true' }), `${n} ${label}`);
  wrap.append(
    mk('all', 'issues', r.summary.total),
    mk('critical', 'critical', r.summary.critical),
    mk('warning', 'warnings', r.summary.warning),
    mk('info', 'info', r.summary.info)
  );
}

function renderFilters(r) {
  const wrap = $('#filters');
  wrap.textContent = '';
  for (const cat of [{ id: 'all', name: 'All categories' }, ...r.categories]) {
    const n = cat.id === 'all' ? r.summary.total : cat.total;
    const active = filters.category === cat.id;
    wrap.append(h('button', {
      class: 'pill', type: 'button', 'data-cat': cat.id,
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => { filters.category = cat.id; renderFilters(report); renderIssues(report); },
    }, cat.name, h('span', { class: 'n' }, `(${n})`)));
  }
}

function renderIssues(r) {
  const wrap = $('#issues');
  wrap.textContent = '';
  let shown = 0;

  const cats = r.categories.filter((c) => filters.category === 'all' || c.id === filters.category);
  for (const cat of cats) {
    const issues = cat.issues.filter((i) => filters.severity === 'all' || i.severity === filters.severity);
    if (filters.category === 'all' && issues.length === 0) continue;
    shown += issues.length;

    const section = h('section', { class: 'category' },
      h('div', { class: 'category-head' },
        h('h2', { text: cat.name }),
        h('span', { class: 'cat-count', text: String(issues.length) }),
        h('span', { class: 'blurb', text: cat.blurb })
      )
    );
    if (cat.truncated && cat.issues.length > 0) {
      section.append(h('p', { class: 'truncated-note', text: `Showing the first ${cat.issues.length} of ${cat.total} issues in this category.` }));
    }
    issues.forEach((issue, i) => section.append(issueCard(issue, i)));
    wrap.append(section);
  }

  if (!shown) {
    wrap.append(h('p', { class: 'empty', text: 'No issues match the current filters. Try widening the severity or category.' }));
  }
}

const SEV_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info' };

function issueCard(issue, i) {
  const card = h('article', {
    class: `issue-card sev-${issue.severity}`,
    style: `animation-delay:${Math.min(i * 45, 320)}ms`,
  });

  const top = h('div', { class: 'issue-top' },
    h('span', { class: `sev-badge sev-${issue.severity}`, text: SEV_LABEL[issue.severity] }),
    h('h3', { class: 'issue-title', text: issue.title })
  );
  if (issue.helpUrl) {
    top.append(h('a', {
      class: 'wcag-link', href: issue.helpUrl, target: '_blank', rel: 'noopener',
      text: 'WCAG ' + (issue.wcag || '') + ' ↗', title: 'Read the WCAG success criterion',
    }));
  }
  card.append(top);

  if (issue.description) card.append(h('p', { class: 'issue-desc', text: issue.description }));

  const where = h('div', { class: 'where' });
  if (issue.where.selector) where.append(h('span', { class: 'lbl', text: 'CSS' }), h('code', { text: issue.where.selector }));
  if (issue.where.paths && issue.where.paths.length) {
    where.append(h('span', { class: 'lbl', text: 'Where' }));
    for (const p of issue.where.paths) where.append(h('code', { text: p }));
  }
  if (issue.where.count > 1) where.append(h('span', { class: 'count-badge', text: '× ' + issue.where.count + ' elements' }));
  if (where.childNodes.length) card.append(where);

  for (const s of issue.where.snippets || []) {
    card.append(h('div', { class: 'snippet' }, h('code', { text: s })));
  }

  if (issue.fix) {
    const fixBody = h('div', { class: 'fix-body' }, h('b', { text: 'How to fix' }));
    const fixText = h('div', { text: issue.fix });
    fixBody.append(fixText);
    if (issue.suggested) {
      fixText.append(h('span', { class: 'swatch-row' },
        h('span', { class: 'swatch', style: `background:${issue.suggested}`, title: issue.suggested, 'aria-hidden': 'true' }),
        h('code', { text: issue.suggested })
      ));
    }
    if (issue.fixCode) fixBody.append(h('pre', {}, h('code', { text: issue.fixCode })));
    card.append(h('div', { class: 'fix' },
      h('span', { class: 'fix-icon' }, svgIcon(ICON_FIX)),
      fixBody
    ));
  }
  return card;
}

function renderPassed(r) {
  const panel = $('#passed');
  $('#passed-toggle').setAttribute('aria-expanded', 'false');
  $('#passed-list').hidden = true;
  if (!r.passed.length) { panel.hidden = true; return; }
  panel.hidden = false;
  $('#passed-count').textContent = r.passed.length;
  const list = $('#passed-list');
  list.textContent = '';
  for (const p of r.passed) {
    list.append(h('li', {}, svgIcon(ICON_CHECK, 14), h('span', { text: p.label })));
  }
}

$('#passed-toggle').addEventListener('click', () => {
  const btn = $('#passed-toggle');
  const list = $('#passed-list');
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  list.hidden = open;
});

/* ------------------------------ export actions ------------------------------ */

$('#new-btn').addEventListener('click', () => {
  resultsEl.hidden = true;
  heroEl.hidden = false;
  input.focus();
  window.scrollTo({ top: 0, behavior: 'auto' });
});

$('#json-btn').addEventListener('click', () => {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'accesslens-report.json' });
  document.body.append(a);
  a.click();
  a.remove();
  showToast('JSON downloaded');
});

$('#copy-btn').addEventListener('click', async () => {
  if (!report) return;
  const md = buildMarkdown(report);
  try {
    await navigator.clipboard.writeText(md);
    showToast('Report copied as Markdown');
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = md;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Report copied as Markdown');
  }
});

function buildMarkdown(r) {
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const L = [];
  L.push(`# Accessibility report — ${r.url}`, '');
  L.push(`Generated ${new Date(r.generatedAt).toLocaleString()} · Score **${r.score}/100** · ${r.summary.critical} critical, ${r.summary.warning} warnings, ${r.summary.info} info`, '');
  for (const c of r.categories) {
    if (!c.issues.length) continue;
    L.push(`## ${c.name} (${c.total})`, '');
    for (const i of c.issues) {
      L.push(`### [${cap(i.severity)}] ${i.title}`);
      if (i.description) L.push('', i.description);
      L.push('', `- Where: ${i.where.selector ? '`' + i.where.selector + '`' : '(element)'}` +
        (i.where.count > 1 ? ` — ${i.where.count} elements` : ''));
      for (const p of i.where.paths || []) L.push(`  - \`${p}\``);
      for (const s of i.where.snippets || []) L.push(`  - \`${s}\``);
      if (i.fix) L.push(`- Fix: ${i.fix}`);
      if (i.fixCode) L.push(`  \`\`\`\n  ${i.fixCode}\n  \`\`\``);
      if (i.wcag) L.push(`- WCAG ${i.wcag}: ${i.helpUrl || ''}`);
      L.push('');
    }
  }
  if (r.passed.length) {
    L.push('## Passed checks', '');
    for (const p of r.passed) L.push(`- ${p.label}`);
    L.push('');
  }
  return L.join('\n');
}
