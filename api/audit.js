'use strict';

// Vercel Serverless Function: POST /api/audit
// Reuses the exact same audit engine as the local Express server (server.js),
// so reports are identical wherever this is deployed. Vercel serves api/audit.js
// at /api/audit — the path public/app.js already posts to.

const { auditUrl } = require('../lib/audit');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let data = '';
    let overflow = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100_000) { overflow = true; req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) return resolve(null);
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST with a JSON body: { "url": "..." }' });
    return;
  }
  const body = await readBody(req);
  const raw = String((body && body.url) || '').trim();
  if (!raw) {
    res.status(400).json({ error: 'Paste a URL to audit.' });
    return;
  }
  try {
    const report = await auditUrl(raw);
    res.status(200).json(report);
  } catch (err) {
    const code = err && err.code;
    const status = code === 'BAD_URL' ? 400 : code === 'FETCH_FAILED' ? 502 : 500;
    const message =
      code === 'BAD_URL'
        ? err.message
        : code === 'FETCH_FAILED'
          ? `Could not load the page: ${err.message}`
          : 'Audit failed unexpectedly. Please try again.';
    res.status(status).json({ error: message });
  }
}

handler.maxDuration = 60; // audits finish in seconds; headroom for slow sites

module.exports = handler;
