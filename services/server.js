/**
 * Compuna Hub — API-server
 *
 * Multi-projekt Express-server med REST API + CRON-schemaläggare.
 * API-nyckelskydd på alla projekt-endpoints.
 * Kör: node server.js
 */

import express from 'express';
import { join } from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { getAllProjects } from './projects/index.js';
import systemRouter from './routes/system.js';
import { startScheduler } from './cron/scheduler.js';
import { startMonitor, stopMonitor } from './monitor/engine.js';
import { startMachineMonitor, stopMachineMonitor } from './monitor/machine-engine.js';
import { startVasttrafik, stopVasttrafik } from './vasttrafik/engine.js';
import { startMailWise, stopMailWise } from './mailwise/engine.js';
import pool from './db/connection.js';
import { validateApiKey, usageLogger } from './middleware/apikey.js';
import { rateLimiter } from './middleware/ratelimit.js';
import { requireAuth, login, logout, authStatus } from './middleware/dashauth.js';
import pwaRouter from './routes/pwa.js';
import avgRouter from './routes/avg.js';
import canaryRouter from './routes/monitor/canary.js';
import mailwiseOAuthRouter from './routes/mailwise/oauth.js';

const app = express();
const PORT = parseInt(process.env.API_PORT || '3000');

// --- Middleware ---

// verify-callback sparar rawBody för HMAC-signaturverifiering (bgcheck)
// Skippa body-parsing för sportanalys upload (multipart streaming till backend)
const jsonParser = express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); },
});
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/api/sportanalys/upload')) {
    return next();
  }
  jsonParser(req, res, next);
});

// CORS (inkluderar X-API-Key i tillåtna headers)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-API-Key, X-Timestamp, X-Signature');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Loggning (API-nycklar maskeras i URL)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const safeUrl = req.url.replace(/api_key=[^&]+/g, 'api_key=***');
    console.log(`  ${req.method} ${safeUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Användningsloggning (loggar autentiserade anrop till DB)
app.use(usageLogger);

// Admin-dashboard (statiska filer)
app.use(express.static(join(import.meta.dirname, 'public')));

// --- Öppna routes (inget API-nyckelskydd) ---

// API-root: lista alla projekt
const projects = getAllProjects();

app.get('/api', (req, res) => {
  res.json({
    name: 'Compuna Hub',
    version: '2.0.0',
    projects: Object.values(projects).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      api: `/api/${p.id}`,
    })),
  });
});

// Auth-endpoints (öppna — behövs för att logga in)
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/status', authStatus);

// Systemnivå (kräver inloggning)
app.use('/api/system', requireAuth, systemRouter);

// PWA Monitor-app (egen PIN-baserad auth)
app.use('/api/pwa', pwaRouter);

// Västtrafik PWA (öppen — ingen auth)
app.use('/api/avg', avgRouter);

// Canary/honeypot webhook (oppen — valideras med per-sajt token)
// Accepterar bade application/json och text/plain (clone-detect.js skickar text/plain for att undvika CORS preflight)
app.use('/webhooks/canary', express.json({ type: ['application/json', 'text/plain'] }), canaryRouter);

// MailWise OAuth2 callback (öppen — Google omdirigerar hit)
app.use('/api/mailwise/oauth', mailwiseOAuthRouter);

// --- Skyddade routes (kräver API-nyckel) ---

// API-nyckelvalidering + rate limiting för alla projekt-endpoints
app.use('/api/:projectId', validateApiKey, rateLimiter);

// Dynamisk route-mounting per projekt
for (const id of Object.keys(projects)) {
  const routerModule = await import(`./routes/${id}/index.js`);
  app.use(`/api/${id}`, routerModule.default);
  console.log(`  Route: /api/${id}`);
}

// 404 (bara för /api-anrop — allt annat → admin-dashboard eller PWA)
app.use((req, res) => {
  if (req.url.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint finns inte', path: req.url });
  }
  if (req.url.startsWith('/app')) {
    return res.sendFile(join(import.meta.dirname, 'public', 'app', 'index.html'));
  }
  if (req.url.startsWith('/avg')) {
    return res.sendFile(join(import.meta.dirname, 'public', 'avg', 'index.html'));
  }
  res.sendFile(join(import.meta.dirname, 'public', 'index.html'));
});

// Felhantering
app.use((err, req, res, _next) => {
  console.error('  API-fel:', err.message);
  res.status(500).json({ error: 'Internt serverfel' });
});

// --- Start ---

const server = app.listen(PORT, () => {
  console.log('==========================================');
  console.log('  Compuna Hub');
  console.log(`  API:   http://localhost:${PORT}/api`);
  console.log(`  Admin: http://localhost:${PORT}/`);
  console.log('==========================================\n');

  startScheduler();
  startMonitor();
  startMachineMonitor();
  startVasttrafik();
  startMailWise();
});

// --- Graceful shutdown ---

async function shutdown(signal) {
  console.log(`\n  [SHUTDOWN] ${signal} mottagen — stänger ned...`);

  // Stoppa motor-scheman
  stopMonitor();
  stopMachineMonitor();
  stopVasttrafik();
  stopMailWise();

  // Markera aktiva körningar som interrupted
  try {
    const [result] = await pool.execute(
      `UPDATE scrape_log SET status = 'failed', finished_at = NOW(),
       error_message = CONCAT(IFNULL(error_message, ''), '[interrupted — server shutdown]')
       WHERE status = 'running'`
    );
    if (result.affectedRows > 0) {
      console.log(`  [SHUTDOWN] ${result.affectedRows} aktiva körningar markerade som interrupted`);
    }
  } catch (err) {
    console.error('  [SHUTDOWN] Kunde inte uppdatera scrape_log:', err.message);
  }

  // Stäng HTTP-servern (slutar ta emot nya anslutningar)
  server.close(() => {
    console.log('  [SHUTDOWN] HTTP-server stängd');
  });

  // Stäng DB-pool
  try {
    await pool.end();
    console.log('  [SHUTDOWN] DB-pool stängd');
  } catch { /* ignore */ }

  console.log('  [SHUTDOWN] Klar');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
