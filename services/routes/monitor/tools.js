/**
 * Monitor Tools — POST /api/monitor/tools/*
 *
 * Verktyg för manuell exekvering: kör check, testa SSH, generera nyckel etc.
 */

import { Router } from 'express';
import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { promises as dns } from 'dns';
import pool from '../../db/connection.js';

const router = Router();

// Check-moduler (lazy-importade)
const checkModules = {};

async function getCheckRunner(type) {
  if (checkModules[type]) return checkModules[type];

  const runners = {
    http: () => import('../../monitor/checks/http.js').then(m => m.runHttpCheck),
    ssl: () => import('../../monitor/checks/ssl.js').then(m => m.runSslCheck),
    health: () => import('../../monitor/checks/health.js').then(m => m.runHealthCheck),
    dns: () => import('../../monitor/checks/dns.js').then(m => m.runDnsCheck),
    integrity: () => import('../../monitor/checks/integrity.js').then(m => m.runIntegrityCheck),
    deep: () => import('../../monitor/checks/playwright.js').then(m => m.runDeepCheck),
    headers: () => import('../../monitor/checks/headers.js').then(m => m.runHeadersCheck),
    content: () => import('../../monitor/checks/content.js').then(m => m.runContentCheck),
  };

  if (!runners[type]) return null;
  checkModules[type] = await runners[type]();
  return checkModules[type];
}

/**
 * Hämta sajt från DB (gemensam helper)
 */
async function getSite(siteId) {
  const [sites] = await pool.execute('SELECT * FROM mon_sites WHERE id = ?', [siteId]);
  return sites.length > 0 ? sites[0] : null;
}

// ==================== 1. Kör check nu ====================

router.post('/run-check/:siteId/:type', async (req, res) => {
  try {
    const { siteId, type } = req.params;
    const VALID_TYPES = ['http', 'ssl', 'health', 'dns', 'integrity', 'deep', 'headers', 'content'];

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Ogiltig check-typ: ${type}` });
    }

    const site = await getSite(siteId);
    if (!site) return res.status(404).json({ error: 'Sajt ej funnen' });

    const runner = await getCheckRunner(type);
    if (!runner) return res.status(500).json({ error: `Check-modul kunde inte laddas: ${type}` });

    // Deep checks kan ta 30-60s (steg-baserat) — kör asynkront för att undvika proxy-timeout
    if (type === 'deep') {
      console.log(`  [TOOLS] Deep check startad för ${siteId} (asynkron)`);
      (async () => {
        try {
          const result = await runner(site);
          if (result) {
            await pool.execute(
              `INSERT INTO mon_checks (site_id, check_type, status, response_ms, status_code, message, details)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [result.siteId, result.type, result.status, result.responseMs || null,
               result.statusCode || null, result.message || null,
               result.details ? JSON.stringify(result.details) : null]
            );
            console.log(`  [TOOLS] Deep check klar: ${siteId} — ${result.status} (${result.responseMs}ms)`);
          }
        } catch (err) {
          console.error(`  [TOOLS] Deep check fel (${siteId}): ${err.message}`);
        }
      })();

      return res.json({
        data: { type: 'deep', status: 'running', siteId, message: 'Deep check startad — resultatet sparas automatiskt' },
        message: 'Deep check körs i bakgrunden',
      });
    }

    const result = await runner(site);

    // Spara till DB (samma mönster som engine.js saveCheck)
    if (result) {
      await pool.execute(
        `INSERT INTO mon_checks (site_id, check_type, status, response_ms, status_code, message, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          result.siteId,
          result.type,
          result.status,
          result.responseMs || null,
          result.statusCode || null,
          result.message || null,
          result.details ? JSON.stringify(result.details) : null,
        ]
      );
    }

    res.json({ data: result, message: `${type}-check utförd` });
  } catch (err) {
    console.error('  [TOOLS] Run-check fel:', err.message);
    res.status(500).json({ error: `Check misslyckades: ${err.message}` });
  }
});

// ==================== 2. Testa SSH ====================

router.post('/test-ssh/:siteId', async (req, res) => {
  try {
    const site = await getSite(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Sajt ej funnen' });

    if (!site.ssh_host) {
      return res.status(400).json({ error: 'SSH-host ej konfigurerat för denna sajt' });
    }

    // DB-värden först, env-fallback
    const sshUser = site.ssh_user || process.env[site.ssh_user_env];
    const sshKeyPath = site.ssh_key_path || process.env[site.ssh_key_env];
    const sshPassword = site.ssh_password || (site.ssh_password_env ? process.env[site.ssh_password_env] : null);

    if (!sshUser) {
      return res.status(400).json({ error: 'SSH-användarnamn saknas — fyll i under Sajtinställningar' });
    }

    // Försök läsa SSH-nyckel (om konfigurerad)
    let privateKey = null;
    if (sshKeyPath) {
      try {
        privateKey = readFileSync(sshKeyPath, 'utf8');
      } catch {
        // Nyckel kunde inte läsas — faller igenom till lösenord
      }
    }

    if (!privateKey && !sshPassword) {
      return res.status(400).json({ error: 'SSH-credentials saknas — varken nyckel eller lösenord konfigurerat' });
    }

    const { Client } = await import('ssh2');
    const start = Date.now();
    const authMethod = privateKey ? 'key' : 'password';

    const result = await new Promise((resolve, reject) => {
      const conn = new Client();
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('Timeout (15s)'));
      }, 15000);

      conn.on('ready', () => {
        const ms = Date.now() - start;
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            return resolve({ ok: true, ms, sftp: false, authMethod, message: `SSH OK men SFTP misslyckades: ${err.message}` });
          }

          const webroot = site.webroot || '.';
          sftp.readdir(webroot, (err, list) => {
            clearTimeout(timeout);
            conn.end();

            if (err) {
              return resolve({
                ok: true, ms, sftp: true, authMethod,
                files: [], fileCount: 0,
                message: `SSH+SFTP OK, men kunde inte lista ${webroot}: ${err.message}`,
              });
            }

            const files = list.map(f => ({
              name: f.filename,
              size: f.attrs.size,
              type: f.attrs.isDirectory() ? 'dir' : 'file',
            })).sort((a, b) => a.name.localeCompare(b.name));

            resolve({
              ok: true, ms, sftp: true, authMethod,
              files: files.slice(0, 50),
              fileCount: files.length,
              message: `SSH+SFTP OK (${authMethod}) — ${files.length} filer i ${webroot}`,
            });
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      const connectOpts = {
        host: site.ssh_host,
        port: site.ssh_port || 22,
        username: sshUser,
        readyTimeout: 15000,
      };
      if (privateKey) {
        connectOpts.privateKey = privateKey;
      } else {
        connectOpts.password = sshPassword;
      }
      conn.connect(connectOpts);
    });

    res.json({ data: result });
  } catch (err) {
    console.error('  [TOOLS] SSH-test fel:', err.message);
    res.json({
      data: { ok: false, message: `SSH-anslutning misslyckades: ${err.message}` },
    });
  }
});

// ==================== 3. Nollställ baseline ====================

router.post('/reset-baseline/:siteId', async (req, res) => {
  try {
    const site = await getSite(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Sajt ej funnen' });

    if (!site.ssh_host || !site.check_integrity) {
      return res.status(400).json({
        error: 'Sajten saknar SSH-konfiguration eller integrity-check är avslaget',
      });
    }

    const { updateBaselines } = await import('../../monitor/checks/integrity.js');
    const results = await updateBaselines(site);

    res.json({
      data: results,
      meta: { count: results.length, siteId: req.params.siteId },
      message: 'Baselines uppdaterade',
    });
  } catch (err) {
    console.error('  [TOOLS] Baseline-fel:', err.message);
    res.status(500).json({ error: `Baseline-uppdatering misslyckades: ${err.message}` });
  }
});

// ==================== 4. SSH-nyckelgenerator ====================

router.post('/generate-ssh-key', async (req, res) => {
  try {
    const name = (req.body.name || 'mon_compuna').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return res.status(400).json({ error: 'Ogiltigt nyckelnamn' });

    const sshDir = join(homedir(), '.ssh');
    const keyPath = join(sshDir, name);
    const pubPath = `${keyPath}.pub`;

    // Skapa .ssh-mappen om den saknas
    if (!existsSync(sshDir)) {
      mkdirSync(sshDir, { mode: 0o700, recursive: true });
    }

    let alreadyExisted = false;

    if (existsSync(keyPath)) {
      alreadyExisted = true;
    } else {
      // Generera ED25519-nyckelpar
      execSync(
        `ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "monitor@compuna"`,
        { stdio: 'pipe' }
      );
    }

    // Läs publik nyckel
    const publicKey = readFileSync(pubPath, 'utf8').trim();

    res.json({
      data: {
        publicKey,
        privatePath: keyPath,
        alreadyExisted,
        message: alreadyExisted
          ? `Nyckel "${name}" finns redan — visar befintlig publik nyckel`
          : `Nyckel "${name}" genererad`,
      },
    });
  } catch (err) {
    console.error('  [TOOLS] SSH-keygen fel:', err.message);
    res.status(500).json({ error: `Kunde inte generera SSH-nyckel: ${err.message}` });
  }
});

// ==================== 5. Testa SMTP ====================

router.post('/test-smtp', async (req, res) => {
  try {
    const { getSettings } = await import('../../db/settings.js');
    const smtp = await getSettings('smtp');

    if (!smtp.host) {
      return res.status(400).json({ error: 'SMTP ej konfigurerat — fyll i under Inställningar' });
    }

    const recipient = smtp.recipients || smtp.from_address;
    if (!recipient) {
      return res.status(400).json({ error: 'Ingen mottagare konfigurerad (recipients eller from_address)' });
    }

    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: smtp.host,
      port: parseInt(smtp.port) || 587,
      secure: parseInt(smtp.port) === 465,
      auth: {
        user: smtp.user,
        pass: smtp.password,
      },
    });

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
    await transport.sendMail({
      from: smtp.from_address || smtp.user,
      to: recipient,
      subject: `[Compuna Hub] Testmail — ${now}`,
      text: `Detta är ett testmail från Compuna Hub.\nSkickat: ${now}`,
      html: `<p>Detta är ett <strong>testmail</strong> från Compuna Hub.</p><p>Skickat: ${now}</p>`,
    });

    res.json({
      data: { ok: true, recipient, message: `Testmail skickat till ${recipient}` },
    });
  } catch (err) {
    console.error('  [TOOLS] SMTP-test fel:', err.message);
    res.json({
      data: { ok: false, message: `SMTP-test misslyckades: ${err.message}` },
    });
  }
});

// ==================== 6. DNS-lookup ====================

router.post('/dns-lookup/:siteId', async (req, res) => {
  try {
    const site = await getSite(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Sajt ej funnen' });

    const url = new URL(site.url);
    const hostname = url.hostname;

    const results = {};

    // A-poster (IPv4)
    try { results.A = await dns.resolve4(hostname); } catch { results.A = []; }

    // AAAA-poster (IPv6)
    try { results.AAAA = await dns.resolve6(hostname); } catch { results.AAAA = []; }

    // MX-poster
    try { results.MX = await dns.resolveMx(hostname); } catch { results.MX = []; }

    // NS-poster
    try {
      // NS finns ofta bara på huvuddomänen
      const parts = hostname.split('.');
      const domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
      results.NS = await dns.resolveNs(domain);
    } catch { results.NS = []; }

    // TXT-poster
    try {
      const txt = await dns.resolveTxt(hostname);
      results.TXT = txt.map(r => r.join(''));
    } catch { results.TXT = []; }

    // CNAME
    try { results.CNAME = await dns.resolveCname(hostname); } catch { results.CNAME = []; }

    res.json({
      data: { hostname, records: results },
      message: `DNS-poster för ${hostname}`,
    });
  } catch (err) {
    console.error('  [TOOLS] DNS-lookup fel:', err.message);
    res.status(500).json({ error: `DNS-lookup misslyckades: ${err.message}` });
  }
});

// ==================== 7. Acceptera DNS-baseline ====================

router.post('/accept-dns-baseline/:siteId', async (req, res) => {
  try {
    const site = await getSite(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Sajt ej funnen' });

    const { acceptDnsBaseline } = await import('../../monitor/checks/dns.js');
    const result = await acceptDnsBaseline(req.params.siteId);

    res.json({ data: result, message: 'DNS-baseline uppdaterad' });
  } catch (err) {
    console.error('  [TOOLS] DNS-baseline fel:', err.message);
    res.status(500).json({ error: `DNS-baseline misslyckades: ${err.message}` });
  }
});

// ==================== 8. Acceptera content-baseline ====================

router.post('/accept-content-baseline/:siteId', async (req, res) => {
  try {
    const site = await getSite(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Sajt ej funnen' });

    const { acceptContentBaseline } = await import('../../monitor/checks/content.js');
    const result = await acceptContentBaseline(req.params.siteId);

    res.json({ data: result, message: 'Content-baseline uppdaterad' });
  } catch (err) {
    console.error('  [TOOLS] Content-baseline fel:', err.message);
    res.status(500).json({ error: `Content-baseline misslyckades: ${err.message}` });
  }
});

// ==================== 9. Lista SSH-nycklar ====================

router.get('/ssh-keys', (req, res) => {
  try {
    const sshDir = join(homedir(), '.ssh');
    if (!existsSync(sshDir)) {
      return res.json({ data: [] });
    }

    const files = readdirSync(sshDir);
    const keys = [];

    for (const file of files) {
      // Hitta privata nycklar som har en matchande .pub-fil
      if (file.endsWith('.pub') || file.startsWith('.') || file === 'known_hosts' || file === 'authorized_keys' || file === 'config') continue;

      const pubFile = `${file}.pub`;
      if (!files.includes(pubFile)) continue;

      const fullPath = join(sshDir, file);
      const pubPath = join(sshDir, pubFile);

      try {
        const publicKey = readFileSync(pubPath, 'utf8').trim();
        keys.push({ name: file, path: fullPath, publicKey });
      } catch {
        // Kunde inte läsa — hoppa över
      }
    }

    res.json({ data: keys });
  } catch (err) {
    console.error('  [TOOLS] SSH-keys list fel:', err.message);
    res.status(500).json({ error: `Kunde inte lista SSH-nycklar: ${err.message}` });
  }
});

// ==================== 8. Bläddra filer via SFTP ====================

router.post('/browse-files/:siteId', async (req, res) => {
  try {
    const site = await getSite(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Sajt ej funnen' });

    if (!site.ssh_host) {
      return res.status(400).json({ error: 'SSH-host ej konfigurerat' });
    }

    const sshUser = site.ssh_user || process.env[site.ssh_user_env];
    const sshKeyPath = site.ssh_key_path || process.env[site.ssh_key_env];
    const sshPassword = site.ssh_password || (site.ssh_password_env ? process.env[site.ssh_password_env] : null);

    if (!sshUser) {
      return res.status(400).json({ error: 'SSH-användarnamn saknas' });
    }

    // Försök läsa SSH-nyckel (om konfigurerad)
    let privateKey = null;
    if (sshKeyPath) {
      try {
        privateKey = readFileSync(sshKeyPath, 'utf8');
      } catch {
        // Nyckel kunde inte läsas — faller igenom till lösenord
      }
    }

    if (!privateKey && !sshPassword) {
      return res.status(400).json({ error: 'SSH-credentials saknas — varken nyckel eller lösenord konfigurerat' });
    }

    const browsePath = req.body.path || site.webroot || '.';

    const { Client } = await import('ssh2');

    const result = await new Promise((resolve, reject) => {
      const conn = new Client();
      const timeout = setTimeout(() => { conn.end(); reject(new Error('Timeout (15s)')); }, 15000);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { clearTimeout(timeout); conn.end(); return reject(err); }

          sftp.readdir(browsePath, (err, list) => {
            clearTimeout(timeout);
            conn.end();

            if (err) return reject(new Error(`Kunde inte lista ${browsePath}: ${err.message}`));

            const files = list
              .filter(f => !f.filename.startsWith('.'))
              .map(f => ({
                name: f.filename,
                path: browsePath === '.' ? f.filename : `${browsePath}/${f.filename}`,
                type: f.attrs.isDirectory() ? 'dir' : 'file',
                size: f.attrs.size,
              }))
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });

            resolve({ path: browsePath, files });
          });
        });
      });

      conn.on('error', (err) => { clearTimeout(timeout); reject(err); });

      const connectOpts = {
        host: site.ssh_host,
        port: site.ssh_port || 22,
        username: sshUser,
        readyTimeout: 15000,
      };
      if (privateKey) {
        connectOpts.privateKey = privateKey;
      } else {
        connectOpts.password = sshPassword;
      }
      conn.connect(connectOpts);
    });

    res.json({ data: result });
  } catch (err) {
    console.error('  [TOOLS] Browse-files fel:', err.message);
    res.status(500).json({ error: `Filbläddring misslyckades: ${err.message}` });
  }
});

// --- Canary Token Management ---

/**
 * POST /api/monitor/tools/generate-canary-token/:siteId
 * Genererar och sparar en unik canary token for en sajt
 */
router.post('/generate-canary-token/:siteId', async (req, res) => {
  try {
    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');

    const [result] = await pool.execute(
      'UPDATE mon_sites SET canary_token = ? WHERE id = ?',
      [token, req.params.siteId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Sajt hittades inte' });
    }

    res.json({
      token,
      webhookUrl: `${process.env.DASHBOARD_URL || req.protocol + '://' + req.get('host')}/webhooks/canary`,
      canarytokensMemo: `compuna:${token}`,
    });
  } catch (err) {
    console.error('  [TOOLS] Generera canary token fel:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
