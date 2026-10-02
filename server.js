'use strict';

const path = require('path');
const express = require('express');
const { auditUrl } = require('./lib/audit');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/audit', async (req, res) => {
  const raw = String((req.body && req.body.url) || '').trim();
  if (!raw) return res.status(400).json({ error: 'Paste a URL to audit.' });
  try {
    const report = await auditUrl(raw);
    res.json(report);
  } catch (err) {
    const code = err && err.code;
    const status = code === 'BAD_URL' ? 400 : code === 'FETCH_FAILED' ? 502 : 500;
    const message =
      code === 'BAD_URL'
        ? err.message
        : code === 'FETCH_FAILED'
          ? `Could not load the page: ${err.message}`
          : 'Audit failed unexpectedly. Please try again.';
    console.error(`[audit] ${raw} -> ${err.message}`);
    res.status(status).json({ error: message });
  }
});

// Malformed JSON bodies and other middleware errors -> JSON, not an HTML stack trace
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.status ? 'Invalid request body.' : 'Server error.' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`AccessLens running at http://localhost:${PORT}`);
});
