/**
 * Sportanalys Routes — Proxy till extern backend
 *
 * Alla anrop vidarebefordras till cmp-web01 (10.10.10.100) via WireGuard.
 * X-API-KEY läggs till automatiskt. Uploads använder pipe() för ren streaming.
 * express.json() bypas:as i server.js för /api/sportanalys/upload.
 */

import { Router } from 'express';
import http from 'http';
import net from 'net';
import { getProject } from '../../projects/index.js';

const router = Router();
const config = getProject('sportanalys');
const API_KEY = process.env.SA_API_KEY || 'cmp-api-2026-backatorp';
const BACKEND_HOST = '10.10.10.100';
const BACKEND_PORT = 80;
const TIMEOUT = config.backend?.timeout || 600_000;

/**
 * Bygg headers för proxy-request.
 * Kopierar content-type (inkl. boundary), content-length etc.
 */
function buildProxyHeaders(req) {
  const headers = {};
  for (const key of ['content-type', 'content-length', 'accept', 'user-agent', 'transfer-encoding']) {
    if (req.headers[key]) headers[key] = req.headers[key];
  }
  headers['X-API-KEY'] = API_KEY;
  headers['host'] = BACKEND_HOST;
  return headers;
}

/**
 * Proxy en request till backend-API:et.
 * Använder pipe() för att streama request body direkt till backend.
 */
function proxyToBackend(req, res) {
  const backendPath = '/api' + req.url;
  console.log(`  [sportanalys] ${req.method} ${backendPath}`);

  const options = {
    hostname: BACKEND_HOST,
    port: BACKEND_PORT,
    path: backendPath,
    method: req.method,
    headers: buildProxyHeaders(req),
    timeout: TIMEOUT,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Vid fel — logga och vidarebefordra
    if (proxyRes.statusCode >= 400) {
      let errorBody = '';
      proxyRes.on('data', c => { errorBody += c.toString(); });
      proxyRes.on('end', () => {
        console.error(`  [sportanalys] Backend-fel ${proxyRes.statusCode}: ${errorBody.slice(0, 300)}`);
        if (!res.headersSent) {
          res.status(proxyRes.statusCode).json({
            error: `Backend svarade ${proxyRes.statusCode}`,
            details: errorBody.slice(0, 1000),
          });
        }
      });
      return;
    }

    // Kopiera response-headers och streama svar
    const resHeaders = {};
    for (const [key, val] of Object.entries(proxyRes.headers)) {
      if (!['connection', 'keep-alive', 'transfer-encoding'].includes(key)) {
        resHeaders[key] = val;
      }
    }
    res.writeHead(proxyRes.statusCode, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    console.error('  [sportanalys] Timeout mot backend');
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Backend-timeout (max 10 min)' });
    }
  });

  proxyReq.on('error', (err) => {
    console.error('  [sportanalys] Proxy-fel:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Backend ej nåbar', details: err.message });
    }
  });

  req.pipe(proxyReq);
  req.on('error', (err) => {
    console.error('  [sportanalys] Request-stream fel:', err.message);
    proxyReq.destroy();
  });
}

// ── Stats (för hub-kortet och detaljvyn) ──
router.get('/stats', async (req, res) => {
  try {
    const backendRes = await fetch(`http://${BACKEND_HOST}/api/jobs`, {
      headers: { 'X-API-KEY': API_KEY },
      signal: AbortSignal.timeout(10_000),
    });

    if (!backendRes.ok) throw new Error(`HTTP ${backendRes.status}`);
    const { jobs } = await backendRes.json();

    const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
    for (const j of jobs) {
      if (counts[j.status] !== undefined) counts[j.status]++;
    }

    res.json({
      data: {
        totalt: jobs.length,
        vantande: counts.pending,
        bearbetar: counts.processing,
        klara: counts.done,
        misslyckade: counts.failed,
        senaste_jobb: jobs.length > 0 ? jobs[jobs.length - 1].status : null,
      },
    });
  } catch (err) {
    res.json({
      data: {
        totalt: 0,
        vantande: 0,
        bearbetar: 0,
        klara: 0,
        misslyckade: 0,
        backend_status: 'offline',
        error: err.message,
      },
    });
  }
});

// ── Diagnostik (kör flera tester) ──
router.get('/diagnostics', async (req, res) => {
  try {
    const results = [];

    // Test 1: TCP-anslutning till backend
    const tcpStart = Date.now();
    try {
      await new Promise((resolve, reject) => {
        const sock = net.createConnection({ host: BACKEND_HOST, port: BACKEND_PORT, timeout: 5000 });
        sock.on('connect', () => { sock.destroy(); resolve(); });
        sock.on('timeout', () => { sock.destroy(); reject(new Error('Timeout 5s')); });
        sock.on('error', reject);
      });
      results.push({ test: 'TCP-anslutning (10.10.10.100:80)', ok: true, ms: Date.now() - tcpStart });
    } catch (err) {
      results.push({ test: 'TCP-anslutning (10.10.10.100:80)', ok: false, ms: Date.now() - tcpStart, error: err.message });
    }

    // Test 2: Health endpoint
    const healthStart = Date.now();
    try {
      const r = await fetch(`http://${BACKEND_HOST}/api/health`, {
        headers: { 'X-API-KEY': API_KEY },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await r.json();
      results.push({ test: 'GET /api/health', ok: r.ok, ms: Date.now() - healthStart, status: r.status, data: body });
    } catch (err) {
      results.push({ test: 'GET /api/health', ok: false, ms: Date.now() - healthStart, error: err.message });
    }

    // Test 3: Jobs endpoint
    const jobsStart = Date.now();
    try {
      const r = await fetch(`http://${BACKEND_HOST}/api/jobs`, {
        headers: { 'X-API-KEY': API_KEY },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await r.json();
      const count = body.jobs?.length ?? 0;
      results.push({ test: 'GET /api/jobs', ok: r.ok, ms: Date.now() - jobsStart, status: r.status, jobCount: count });
    } catch (err) {
      results.push({ test: 'GET /api/jobs', ok: false, ms: Date.now() - jobsStart, error: err.message });
    }

    const allOk = results.every(r => r.ok);
    res.json({ ok: allOk, tests: results, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('  [sportanalys] Diagnostik-fel:', err);
    res.status(500).json({ ok: false, tests: [], error: err.message, timestamp: new Date().toISOString() });
  }
});

// ── Health check ──
router.get('/health', (req, res) => proxyToBackend(req, res));

// ── Jobs ──
router.get('/jobs', (req, res) => proxyToBackend(req, res));
router.get('/jobs/:id/status', (req, res) => proxyToBackend(req, res));
router.get('/jobs/:id/result', (req, res) => proxyToBackend(req, res));
router.get('/jobs/:id/video', (req, res) => proxyToBackend(req, res));
router.get('/jobs/:id/tracking', (req, res) => proxyToBackend(req, res));
router.get('/jobs/:id/stats', (req, res) => proxyToBackend(req, res));
router.get('/jobs/:id/players', (req, res) => proxyToBackend(req, res));

// ── Annotations ──
router.get('/annotations/:id', (req, res) => proxyToBackend(req, res));
router.post('/annotations/:id', (req, res) => proxyToBackend(req, res));
router.put('/annotations/:id', (req, res) => proxyToBackend(req, res));

// ── Upload (streaming via pipe — hanterar 5 GB) ──
router.post('/upload', (req, res) => proxyToBackend(req, res));

export default router;
