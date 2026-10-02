'use strict';

const UA = 'Mozilla/5.0 (compatible; AccessLens/1.0; +website-accessibility-auditor)';

function fail(message) {
  const e = new Error(message);
  e.code = 'FETCH_FAILED';
  return e;
}

/**
 * Fetch a URL as text with a timeout and a size cap.
 * Returns { text, finalUrl, contentType }.
 */
function describeNetworkError(err) {
  const candidates = [err, err && err.cause, ...(err && err.errors ? err.errors : [])];
  for (const e of candidates) {
    if (!e || !e.code) continue;
    if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return 'the site could not be found — check the domain';
    if (e.code === 'ECONNREFUSED') return 'the connection was refused — is the site up?';
    if (e.code === 'EPROTO' || e.code === 'CERT_HAS_EXPIRED' || e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      return 'the site has a TLS/certificate problem';
    }
    if (e.code === 'ECONNRESET') return 'the connection was reset by the site';
  }
  return (err && err.message) || 'network error';
}

async function fetchText(url, { timeoutMs = 15000, maxBytes = 3 * 1024 * 1024 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,text/css,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw fail(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw fail(`content is too large (${(buf.byteLength / 1048576).toFixed(1)} MB)`);
    }
    const contentType = res.headers.get('content-type') || '';
    const m = /charset=([\w-]+)/i.exec(contentType);
    let text;
    try {
      text = new TextDecoder(m ? m[1] : 'utf-8', { fatal: false }).decode(buf);
    } catch {
      text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    return { text, finalUrl: res.url || url, contentType };
  } catch (err) {
    if (err.code === 'FETCH_FAILED') throw err;
    if (err.name === 'AbortError') throw fail('request timed out');
    throw fail(describeNetworkError(err));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStylesheet(url) {
  return fetchText(url, { timeoutMs: 8000, maxBytes: 1.5 * 1024 * 1024 });
}

function decodeDataUrl(href) {
  const comma = href.indexOf(',');
  if (comma === -1) return null;
  const meta = href.slice(5, comma);
  const data = href.slice(comma + 1);
  try {
    if (/base64/i.test(meta)) return Buffer.from(data, 'base64').toString('utf-8');
    return decodeURIComponent(data);
  } catch {
    return null;
  }
}

module.exports = { fetchText, fetchStylesheet, decodeDataUrl, UA };
