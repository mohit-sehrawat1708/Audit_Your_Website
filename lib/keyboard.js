'use strict';

/*
 * Keyboard-accessibility checks (WCAG 2.1.1, 2.4.3, 2.4.7, 2.4.1, 1.4.4).
 * Static heuristics — a real browser session is needed for focus-trap testing.
 */

const { makeIssue } = require('./alt-text');

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'label', 'option', 'html', 'body', 'area']);
const INTERACTIVE_ROLES = /button|link|checkbox|radio|menuitem|tab\b|option|switch|slider|spinbutton|textbox|combobox/;

function runKeyboard(doc, rules, applicable) {
  const issues = [];

  /* --- positive tabindex breaks natural tab order --- */
  const tabbables = [...doc.querySelectorAll('[tabindex]')];
  if (tabbables.length) applicable.add('tabindex-positive');
  const positive = tabbables.filter((el) => {
    const t = parseInt(el.getAttribute('tabindex'), 10);
    return !Number.isNaN(t) && t > 0;
  });
  if (positive.length) {
    issues.push(makeIssue({
      id: 'tabindex-positive', severity: 'warning',
      title: `Positive tabindex overrides natural tab order`,
      description:
        `Elements with tabindex="N" (N > 0) jump to the front of the tab order and shadow the page's natural flow. As more positive values pile up, tab order becomes impossible to predict.` +
        (positive.length > 1 ? ` ${positive.length} elements are affected.` : ''),
      fix: `Remove the positive tabindex. Use tabindex="0" to make a non-interactive element focusable, or tabindex="-1" for programmatic focus only.`,
      fixCode: `tabindex="0"  <!-- keep natural order -->`,
      wcag: '2.4.3',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
      elements: positive,
    }));
  }

  /* --- click handlers without keyboard support --- */
  const onclicks = [...doc.querySelectorAll('[onclick]')];
  if (onclicks.length) applicable.add('click-handler');
  const notAccessible = onclicks.filter((el) => {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return false;
    const role = el.getAttribute('role') || '';
    if (role && INTERACTIVE_ROLES.test(role)) return false;
    if (el.hasAttribute('tabindex')) return false;
    if (['onkeydown', 'onkeyup', 'onkeypress'].some((a) => el.hasAttribute(a))) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return true;
  });
  if (notAccessible.length) {
    issues.push(makeIssue({
      id: 'click-handler', severity: 'critical',
      title: 'Clickable element is not keyboard accessible',
      description:
        `This element handles clicks (onclick) but is not a native interactive element and has no tabindex, role, or keyboard event handler. Keyboard-only users cannot operate it at all.` +
        (notAccessible.length > 1 ? ` ${notAccessible.length} elements are affected.` : ''),
      fix: `Best: use a real <button> or <a>. If you must keep the custom element, add role="button", tabindex="0", and an Enter/Space keydown handler.`,
      fixCode: `<div role="button" tabindex="0" onclick="save()">Save</div>\n<!-- plus: onkeydown -> if (Enter || Space) save() -->`,
      wcag: '2.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
      elements: notAccessible,
    }));
  }

  /* --- anchors without href --- */
  const anchors = [...doc.querySelectorAll('a')];
  const noHref = anchors.filter((a) => !a.hasAttribute('href') && (a.textContent || '').trim() && !a.closest('[aria-hidden="true"]'));
  if (anchors.length) applicable.add('link-href');
  if (noHref.length) {
    issues.push(makeIssue({
      id: 'link-href', severity: 'warning',
      title: 'Link has no href and is not focusable',
      description: `An <a> without href is not in the tab order and is not announced as a link. It is usually a button in disguise or a half-built link.`,
      fix: `Add the destination href, or use a <button> if it triggers an action instead of navigation.`,
      wcag: '2.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
      elements: noHref,
    }));
  }
  const jsLinks = anchors.filter((a) => /^javascript:/i.test(a.getAttribute('href') || ''));
  if (jsLinks.length) {
    issues.push(makeIssue({
      id: 'link-javascript', severity: 'info',
      title: 'Link uses a javascript: URL',
      description: `href="javascript:..." links cannot be opened in new tabs, break middle-click, and are usually buttons pretending to be links.`,
      fix: `Use a <button> for actions, or a real href that works without JavaScript.`,
      wcag: '2.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
      elements: jsLinks,
    }));
  }

  /* --- focus outline removed without a replacement --- */
  const focusRules = rules.filter((r) => /:focus/i.test(r.selector));
  if (focusRules.length) applicable.add('focus-outline');
  const offenders = new Set();
  let hasVisibleFocusStyle = false;
  for (const r of focusRules) {
    const outline = (r.decls['outline'] || '').trim().toLowerCase();
    const outlineWidth = (r.decls['outline-width'] || '').trim().toLowerCase();
    const boxShadow = (r.decls['box-shadow'] || '').trim().toLowerCase();
    if (/^(none|0|0px|0\.0px)$/.test(outline) || /^(0|0px|0\.0px)$/.test(outlineWidth)) {
      offenders.add(r.selector);
    } else if (outline && !/^none/.test(outline)) {
      hasVisibleFocusStyle = true;
    }
    if (boxShadow && boxShadow !== 'none') hasVisibleFocusStyle = true;
  }
  if (offenders.size && !hasVisibleFocusStyle) {
    issues.push(makeIssue({
      id: 'focus-outline', severity: 'warning',
      title: 'Focus outline removed with no replacement',
      description:
        `CSS removes the focus outline (outline: none/0) on focus, and no other focus style (outline or box-shadow) replaces it. Keyboard users are left with no idea where they are on the page.`,
      fix: `Never remove the outline without replacing it: restyle :focus-visible with a high-contrast outline or ring.`,
      fixCode: `a:focus { outline: none; }\na:focus-visible { outline: 3px solid #1f6feb; outline-offset: 2px; }`,
      wcag: '2.4.7',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html',
      elements: [...doc.querySelectorAll('body')],
      selector: [...offenders].slice(0, 4).join(', '),
    }));
  }

  /* --- skip link --- */
  applicable.add('skip-link');
  const inPage = [...doc.querySelectorAll('a[href^="#"]')];
  const hasSkip = inPage.some((a) => {
    const text = (a.textContent || '').trim().toLowerCase();
    const targetId = (a.getAttribute('href') || '').slice(1);
    const target = targetId && doc.getElementById(targetId);
    if (/skip|jump to/.test(text)) return true;
    return !!(target && /^(main|content|maincontent|primary)/i.test(target.id));
  });
  if (!hasSkip) {
    issues.push(makeIssue({
      id: 'skip-link', severity: 'info',
      title: 'No skip link found',
      description: `Keyboard users have to tab through the entire header and navigation before reaching the page content. A visually-hidden "Skip to main content" link fixes that.`,
      fix: `Add a skip link as the first focusable element, pointing at the main landmark.`,
      fixCode: `<a class="skip-link" href="#main">Skip to main content</a>`,
      wcag: '2.4.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html',
      elements: [(doc.body || doc.documentElement)],
    }));
  }

  /* --- viewport blocks zoom --- */
  applicable.add('zoom');
  const metas = [...doc.querySelectorAll('meta')].filter((m) => (m.getAttribute('name') || '').toLowerCase() === 'viewport');
  for (const meta of metas) {
    const content = meta.getAttribute('content') || '';
    const maxScale = /maximum-scale\s*=\s*([\d.]+)/i.exec(content);
    const blocked = /user-scalable\s*=\s*no/i.test(content) || (maxScale && parseFloat(maxScale[1]) < 1.5);
    if (blocked) {
      issues.push(makeIssue({
        id: 'zoom', severity: 'warning',
        title: 'Page zoom is disabled in the viewport meta tag',
        description: `user-scalable=no or a tight maximum-scale stops users from zooming the page — essential for low-vision users, and a WCAG failure.`,
        fix: `Remove user-scalable=no and maximum-scale (or set maximum-scale to 2 or higher).`,
        fixCode: `<meta name="viewport" content="width=device-width, initial-scale=1">`,
        wcag: '1.4.4',
        helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html',
        elements: [meta],
      }));
      break;
    }
  }

  /* --- mouse-only handlers --- */
  const mouseOnly = [...doc.querySelectorAll('[onmouseover], [onmouseout]')].filter((el) => {
    if (el.hasAttribute('onfocus') || el.hasAttribute('onblur') || el.hasAttribute('onfocusin')) return false;
    if (el.hasAttribute('tabindex')) return false;
    return !el.closest('[aria-hidden="true"]');
  });
  if (mouseOnly.length) {
    issues.push(makeIssue({
      id: 'mouse-only', severity: 'info',
      title: 'Mouse-only event handler (hover) with no keyboard equivalent',
      description: `Content or behavior triggered by onmouseover/onmouseout has no focus/blur counterpart here, so keyboard users may never see it (e.g. hover-only menus and tooltips).`,
      fix: `Pair hover behavior with focus equivalents, and make the trigger focusable.`,
      fixCode: `onmouseover="open()" onfocus="open()" onmouseout="close()" onblur="close()"`,
      wcag: '2.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
      elements: mouseOnly,
    }));
  }

  /* --- aria-hidden over focusable content --- */
  const hiddens = [...doc.querySelectorAll('[aria-hidden="true"]')];
  if (hiddens.length) applicable.add('aria-hidden-focusable');
  const focusableHidden = [];
  for (const hidden of hiddens) {
    const f = hidden.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex], iframe');
    if (f.length) focusableHidden.push(hidden);
  }
  if (focusableHidden.length) {
    issues.push(makeIssue({
      id: 'aria-hidden-focusable', severity: 'warning',
      title: 'aria-hidden="true" element still contains focusable content',
      description: `This subtree is hidden from screen readers but its links/inputs can still receive keyboard focus — focus disappears "into nothing" for sighted keyboard users.`,
      fix: `Add tabindex="-1" to the focusable descendants, or remove aria-hidden if the content should be available.`,
      wcag: '4.1.2',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      elements: focusableHidden,
    }));
  }

  return issues;
}

module.exports = { runKeyboard };
