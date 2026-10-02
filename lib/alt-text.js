'use strict';

/*
 * Alt-text / non-text-content checks (WCAG 1.1.1, 2.4.4, 4.1.2).
 * Issues are aggregated: identical problems are reported once, with example
 * elements and a count.
 */

const { cssPath } = require('./css-tools');
const { snippetOf } = require('./contrast');

const FILENAME_ALT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|apng)\b/i;
const GENERIC_ALT = /^(image|photo|picture|graphic|spacer|img|icon|logo|banner|placeholder|dsc_?\d+|img_?\d+)$/i;

function labelledbyText(el, doc) {
  const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  if (!ids.length) return '';
  const texts = ids.map((id) => (doc.getElementById(id) || {}).textContent || '');
  return texts.join(' ').trim();
}

/** Best-effort accessible name for links and buttons. */
function accessibleNameOf(el, doc) {
  const aria = el.getAttribute('aria-label') || labelledbyText(el, doc) || el.getAttribute('title') || '';
  const text = el.textContent || '';
  const altBits = [...el.querySelectorAll('img[alt], input[type="image"][alt]')]
    .map((i) => i.getAttribute('alt') || '');
  const svgTitle = [...el.querySelectorAll('svg > title')].map((t) => t.textContent || '');
  return (aria + ' ' + text + ' ' + altBits.join(' ') + ' ' + svgTitle.join(' ')).trim();
}

function makeIssue({ id, severity, title, description, fix, fixCode, wcag, helpUrl, elements, selector }) {
  // NB: map with an arrow — passing cssPath directly would feed the array
  // index into its maxDepth parameter and truncate the paths.
  const paths = [...new Set(elements.map((el) => cssPath(el)))].slice(0, 3);
  const snippets = elements.slice(0, 3).map(snippetOf);
  return {
    id, severity, title, description, fix, fixCode, wcag, helpUrl,
    where: { selector: selector || null, paths, snippets, count: elements.length },
  };
}

function runAltText(doc, applicable) {
  const issues = [];

  /* --- images missing alt --- */
  const missing = [];
  const filenameAlt = [];
  const genericAlt = [];
  const imgs = [...doc.querySelectorAll('img')];
  if (imgs.length) applicable.add('img-alt');
  for (const img of imgs) {
    if (!img.hasAttribute('alt')) { missing.push(img); continue; }
    const alt = (img.getAttribute('alt') || '').trim();
    if (!alt) continue; // empty alt = decorative, valid (link-name check covers links)
    const srcName = (img.getAttribute('src') || '').split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '');
    if (FILENAME_ALT.test(alt) || (srcName.length > 2 && alt.toLowerCase() === srcName.toLowerCase())) filenameAlt.push(img);
    else if (GENERIC_ALT.test(alt)) genericAlt.push(img);
  }
  if (missing.length) {
    issues.push(makeIssue({
      id: 'img-alt', severity: 'critical',
      title: 'Image is missing an alt attribute',
      description:
        `Screen readers announce nothing for this image, or fall back to reading the file name. ` +
        `Every <img> needs an alt attribute.` +
        (missing.length > 1 ? ` ${missing.length} images are affected.` : ''),
      fix: `Add alt text that conveys the information or function of the image. If the image is purely decorative, add an empty alt (alt="") so it is skipped.`,
      fixCode: `<img src="chart.png" alt="Bar chart of 2024 revenue by quarter">`,
      wcag: '1.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      elements: missing,
    }));
  }
  if (filenameAlt.length) {
    issues.push(makeIssue({
      id: 'img-alt-filename', severity: 'warning',
      title: 'Image alt text looks like a file name',
      description: `The alt attribute contains a file name (e.g. "chart.png"), which screen-reader users hear as noise and which conveys no meaning.`,
      fix: `Replace it with a short human description of what the image shows or does.`,
      fixCode: `alt="Sales dashboard"  instead of  alt="dashboard.png"`,
      wcag: '1.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      elements: filenameAlt,
    }));
  }
  if (genericAlt.length) {
    issues.push(makeIssue({
      id: 'img-alt-generic', severity: 'info',
      title: 'Image alt text is not descriptive',
      description: `The alt attribute is a generic word like "image", "icon" or "logo", which rarely tells users what the image actually communicates.`,
      fix: `Describe the image's content or purpose ("Search", "Acme logo — back to home page"). If it is decorative, use alt="".`,
      wcag: '1.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      elements: genericAlt,
    }));
  }

  /* --- links with no accessible name --- */
  const links = [...doc.querySelectorAll('a[href]')];
  if (links.length) applicable.add('link-name');
  const unnamedLinks = links.filter((a) => !accessibleNameOf(a, doc));
  if (unnamedLinks.length) {
    issues.push(makeIssue({
      id: 'link-name', severity: 'critical',
      title: 'Link has no accessible name',
      description:
        `This link contains only an image with an empty/missing alt (or no text at all), so screen readers announce it as just "link" with no destination.` +
        (unnamedLinks.length > 1 ? ` ${unnamedLinks.length} links are affected.` : ''),
      fix: `Give the image meaningful alt text describing the link destination, or add aria-label to the link.`,
      fixCode: `<a href="/reports"><img src="report-icon.png" alt="View reports"></a>`,
      wcag: '2.4.4',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
      elements: unnamedLinks,
    }));
  }

  /* --- image buttons and image-map areas --- */
  const imgButtons = [...doc.querySelectorAll('input[type="image"]')].filter((i) => !(i.getAttribute('alt') || '').trim());
  if (doc.querySelectorAll('input[type="image"]').length) applicable.add('input-image-alt');
  if (imgButtons.length) {
    issues.push(makeIssue({
      id: 'input-image-alt', severity: 'critical',
      title: 'Image button is missing alt text',
      description: `An <input type="image"> without alt gives keyboard and screen-reader users no way to know what the button does.`,
      fix: `Add alt text naming the action.`,
      fixCode: `<input type="image" src="search.png" alt="Search">`,
      wcag: '1.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      elements: imgButtons,
    }));
  }
  const areas = [...doc.querySelectorAll('area')].filter((a) => !(a.getAttribute('alt') || '').trim());
  if (doc.querySelectorAll('area').length) applicable.add('area-alt');
  if (areas.length) {
    issues.push(makeIssue({
      id: 'area-alt', severity: 'critical',
      title: 'Image-map area is missing alt text',
      description: `Each <area> of an image map needs alt text naming its destination.`,
      fix: `Add descriptive alt text to every <area>.`,
      wcag: '1.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      elements: areas,
    }));
  }

  /* --- unlabeled inline SVG --- */
  const svgs = [...doc.querySelectorAll('svg')];
  if (svgs.length) applicable.add('svg-name');
  const unnamedSvgs = svgs.filter((svg) => {
    if (svg.closest('[aria-hidden="true"]')) return false;
    if (svg.closest('a, button, [role="button"], label, [aria-label], [aria-labelledby]')) return false;
    if (svg.getAttribute('aria-label') || svg.getAttribute('aria-labelledby')) return false;
    if (svg.querySelector('title')) return false;
    return true;
  });
  if (unnamedSvgs.length) {
    issues.push(makeIssue({
      id: 'svg-name', severity: 'warning',
      title: 'Inline SVG is neither labeled nor hidden',
      description:
        `This SVG has no <title>, aria-label, or aria-hidden="false"-style labeling. Depending on the browser, screen readers may announce it as an unnamed group or skip it unpredictably.` +
        (unnamedSvgs.length > 1 ? ` ${unnamedSvgs.length} SVGs are affected.` : ''),
      fix: `If the SVG is meaningful, give it role="img" and a <title> or aria-label. If it is decorative, add aria-hidden="true" and focusable="false".`,
      fixCode: `<svg role="img" aria-label="Downloads: 1,204">…</svg>`,
      wcag: '1.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      elements: unnamedSvgs,
    }));
  }

  /* --- role="img" without label --- */
  const roleImgs = [...doc.querySelectorAll('[role="img"]')].filter((el) => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'));
  if (doc.querySelectorAll('[role="img"]').length) applicable.add('role-img-label');
  if (roleImgs.length) {
    issues.push(makeIssue({
      id: 'role-img-label', severity: 'warning',
      title: 'Element with role="img" has no text alternative',
      description: `Declaring role="img" removes the element's children from the accessibility tree, so it needs an aria-label or aria-labelledby.`,
      fix: `Add aria-label describing the image, or point to existing text with aria-labelledby.`,
      wcag: '1.1.1',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      elements: roleImgs,
    }));
  }

  /* --- generic link text --- */
  if (links.length) applicable.add('generic-link-text');
  const GENERIC_TEXT = new Set(['click here', 'here', 'click', 'read more', 'learn more', 'more', 'details', 'this link', 'this page', 'link', 'continue', 'go', 'download', 'view']);
  const genericLinks = links.filter((a) => GENERIC_TEXT.has((a.textContent || '').trim().toLowerCase()));
  if (genericLinks.length) {
    issues.push(makeIssue({
      id: 'generic-link-text', severity: 'info',
      title: 'Link text is not descriptive',
      description: `Generic link text like "click here" or "read more" gives screen-reader users who browse by a links list no context about the destination.`,
      fix: `Make the link text describe its destination: "Read the 2024 annual report" instead of "Read more".`,
      wcag: '2.4.4',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
      elements: genericLinks,
    }));
  }

  return issues;
}

module.exports = { runAltText, accessibleNameOf, makeIssue };
