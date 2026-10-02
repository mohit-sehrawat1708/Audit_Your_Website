'use strict';

/*
 * Structure & semantics checks (WCAG 1.3.1, 2.4.2, 3.1.1, 3.3.2, 4.1.2).
 */

const { makeIssue, accessibleNameOf } = require('./alt-text');

const LABELABLE_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'month',
  'week', 'time', 'datetime-local', 'checkbox', 'radio', 'file', 'range', 'color',
]);

function runStructure(doc, applicable) {
  const issues = [];

  /* --- html lang --- */
  applicable.add('html-lang');
  const htmlEl = doc.documentElement;
  if (!htmlEl || !(htmlEl.getAttribute('lang') || '').trim()) {
    issues.push(makeIssue({
      id: 'html-lang', severity: 'warning',
      title: 'Page language is not declared',
      description: `Without <html lang="...">, screen readers pick a default pronunciation that may be wrong, and translation tools misfire.`,
      fix: `Set the document language on the root element.`,
      fixCode: `<html lang="en">`,
      wcag: '3.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html',
      elements: [htmlEl || doc.createElement('html')],
    }));
  }

  /* --- document title --- */
  applicable.add('doc-title');
  const title = doc.querySelector('title');
  if (!title || !(title.textContent || '').trim()) {
    issues.push(makeIssue({
      id: 'doc-title', severity: 'warning',
      title: 'Document has no <title>',
      description: `The page title is the first thing screen-reader users hear and the label of the browser tab/window. An empty or missing title disorients everyone with many tabs open.`,
      fix: `Add a concise, unique title that names the page and the site.`,
      fixCode: `<title>Checkout — Acme Store</title>`,
      wcag: '2.4.2',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html',
      elements: [title || doc.head || doc.documentElement],
    }));
  }

  /* --- form labels --- */
  const candidates = [...doc.querySelectorAll('input, textarea, select')].filter((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return !el.closest('[aria-hidden="true"]');
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return LABELABLE_TYPES.has(type) && !el.closest('[aria-hidden="true"]');
  });
  if (candidates.length) applicable.add('form-label');
  const labelFor = new Set([...doc.querySelectorAll('label[for]')].map((l) => l.getAttribute('for')));
  const unlabeled = candidates.filter((el) => {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
    if (el.closest('label')) return false;
    const id = el.getAttribute('id');
    if (id && labelFor.has(id)) return false;
    if (el.getAttribute('title')) return false; // weak but allowed
    return true;
  });
  if (unlabeled.length) {
    issues.push(makeIssue({
      id: 'form-label', severity: 'warning',
      title: 'Form field has no associated label',
      description:
        `This input has no <label>, aria-label, or aria-labelledby. Screen readers announce it as an unnamed edit field, and the clickable label area is missing for everyone.` +
        (unlabeled.length > 1 ? ` ${unlabeled.length} fields are affected.` : ''),
      fix: `Associate a label with the field: give the input an id and use <label for="...">, or wrap the input inside a <label>.`,
      fixCode: `<label for="email">Email address</label>\n<input id="email" type="email" name="email">`,
      wcag: '3.3.2',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
      elements: unlabeled,
    }));
  }

  /* --- heading order --- */
  applicable.add('heading-order');
  const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((h) => (h.textContent || '').trim() && !h.closest('[aria-hidden="true"]'));
  if (!headings.length) {
    issues.push(makeIssue({
      id: 'heading-order', severity: 'info',
      title: 'Page has no headings',
      description: `Without h1–h6 headings, screen-reader users cannot navigate the page by structure — their primary way of moving around long pages.`,
      fix: `Add a single h1 for the page topic, and use h2/h3 for sections in order.`,
      wcag: '1.3.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
      elements: [doc.body || doc.documentElement],
    }));
  } else {
    const h1s = headings.filter((h) => h.tagName === 'H1');
    if (h1s.length === 0) {
      issues.push(makeIssue({
        id: 'heading-order', severity: 'info',
        title: 'Page has no h1 heading',
        description: `The page never declares its main topic with an h1. Screen-reader users listing headings get no clear "you are here" anchor.`,
        fix: `Use exactly one h1 for the page title, then nest sections under h2/h3.`,
        wcag: '1.3.1',
        helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
        elements: [headings[0]],
      }));
    } else if (h1s.length > 1) {
      issues.push(makeIssue({
        id: 'heading-order', severity: 'info',
        title: `Page has ${h1s.length} h1 headings`,
        description: `Multiple h1s make the outline ambiguous. Most pages should have exactly one h1.`,
        fix: `Demote secondary h1s to h2 (or restructure the page).`,
        wcag: '1.3.1',
        helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
        elements: h1s.slice(1),
      }));
    }
    const skips = [];
    let prev = 1;
    for (const h of headings) {
      const lvl = Number(h.tagName[1]);
      if (lvl > prev + 1) skips.push({ from: prev, to: lvl, el: h });
      prev = lvl;
    }
    if (skips.length) {
      const s = skips[0];
      issues.push(makeIssue({
        id: 'heading-order', severity: 'info',
        title: `Heading levels skip from h${s.from} to h${s.to}`,
        description:
          `A jump in heading levels (h${s.from} straight to h${s.to}) makes the document outline look like content is missing. Screen-reader users navigating by heading may assume they skipped a section.` +
          (skips.length > 1 ? ` ${skips.length} such jumps found.` : ''),
        fix: `Use the next level down in sequence; style the visual size with CSS, not the heading level.`,
        wcag: '1.3.1',
        helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
        elements: skips.map((k) => k.el),
      }));
    }
  }

  /* --- empty buttons --- */
  const buttons = [...doc.querySelectorAll('button, [role="button"]')];
  if (doc.querySelectorAll('button').length) applicable.add('empty-button');
  const emptyButtons = buttons.filter((b) => !accessibleNameOf(b, doc));
  if (emptyButtons.length) {
    issues.push(makeIssue({
      id: 'empty-button', severity: 'critical',
      title: 'Button has no accessible name',
      description: `This button contains no text (icon-only?) and no aria-label. Screen readers announce it as just "button".`,
      fix: `Add visible text, or an aria-label describing the action.`,
      fixCode: `<button aria-label="Close dialog">✕</button>`,
      wcag: '4.1.2',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      elements: emptyButtons,
    }));
  }

  /* --- duplicate ids --- */
  const idEls = [...doc.querySelectorAll('[id]')];
  if (idEls.length) applicable.add('duplicate-id');
  const byId = new Map();
  for (const el of idEls) {
    const id = el.getAttribute('id');
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(el);
  }
  const dupes = [...byId.entries()].filter(([, els]) => els.length > 1);
  if (dupes.length) {
    const dupEls = dupes.flatMap(([, els]) => els).slice(0, 6);
    issues.push(makeIssue({
      id: 'duplicate-id', severity: 'warning',
      title: `Duplicate element IDs (${dupes.map(([id]) => '#' + id).slice(0, 4).join(', ')}${dupes.length > 4 ? ', …' : ''})`,
      description: `IDs must be unique: label[for], aria-labelledby, and fragment links all break when an id appears twice — labels point at the wrong element.`,
      fix: `Make every id unique and update references (label for, aria-labelledby, href="#...") to match.`,
      wcag: '4.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/parsing.html',
      elements: dupEls,
    }));
  }

  /* --- iframe titles --- */
  const iframes = [...doc.querySelectorAll('iframe, frame')];
  if (iframes.length) applicable.add('iframe-title');
  const untitled = iframes.filter((f) => !(f.getAttribute('title') || '').trim() && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby'));
  if (untitled.length) {
    issues.push(makeIssue({
      id: 'iframe-title', severity: 'warning',
      title: 'iframe has no title',
      description: `Screen readers announce iframes by their title ("frame, checkout form"). Without one, users hear "frame" and must guess.`,
      fix: `Add a title that describes the embedded content.`,
      fixCode: `<iframe src="https://maps.example.com" title="Map of our store location"></iframe>`,
      wcag: '4.1.2',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      elements: untitled,
    }));
  }

  return issues;
}

module.exports = { runStructure };
