/**
 * Diagnostik-routes — Hälsokontroller för alla MailWise-tjänster
 *
 * Mönster: services/routes/sportanalys/index.js (diagnostics-endpoint)
 */

import { Router } from 'express';
import { createSocket } from 'dgram';
import { connect } from 'net';
import pool from '../../db/connection.js';
import { testOllamaConnection } from '../../mailwise/llm.js';
import { testConnection } from '../../mailwise/gmail.js';
import { encryptToken, decryptToken, clearKeyCache } from '../../mailwise/crypto.js';
import { getSettings } from '../../db/settings.js';

const router = Router();

/**
 * GET /api/mailwise/diagnostics — Kör alla diagnostiktester
 */
router.get('/', async (req, res) => {
  const results = [];

  // 1. Databastabeller
  results.push(await testDatabaseTables());

  // 2. Ollama TCP-anslutning
  results.push(await testOllamaTcp());

  // 3. Ollama API + modell
  results.push(await testOllamaApi());

  // 4. Kryptering roundtrip
  results.push(await testEncryption());

  // 5. Per-mailbox Gmail API
  const mailboxResults = await testAllMailboxes();
  results.push(...mailboxResults);

  // 6. Inställningar
  results.push(await testSettings());

  res.json({
    timestamp: new Date().toISOString(),
    tests: results,
    overall: results.every(r => r.ok) ? 'ok' : 'issues',
  });
});

/**
 * Test: Databastabeller finns
 */
async function testDatabaseTables() {
  try {
    const tables = ['mw_mailboxes', 'mw_messages', 'mw_threads', 'mw_labels',
                     'mw_jobs', 'mw_job_logs', 'mw_faqs', 'mw_categories',
                     'mw_draft_replies', 'mw_daily_metrics'];

    const missing = [];
    for (const table of tables) {
      try {
        await pool.execute(`SELECT 1 FROM ${table} LIMIT 0`);
      } catch {
        missing.push(table);
      }
    }

    return {
      name: 'Databastabeller',
      ok: missing.length === 0,
      message: missing.length === 0
        ? `Alla ${tables.length} tabeller finns`
        : `Saknas: ${missing.join(', ')}`,
    };
  } catch (err) {
    return { name: 'Databastabeller', ok: false, message: err.message };
  }
}

/**
 * Test: Ollama TCP-anslutning
 */
async function testOllamaTcp() {
  try {
    const settings = await getSettings('mailwise');
    const host = settings?.ollama_host || '10.10.10.104';
    const port = parseInt(settings?.ollama_port || '11434');

    return new Promise(resolve => {
      const socket = connect({ host, port, timeout: 5000 });

      socket.on('connect', () => {
        socket.destroy();
        resolve({
          name: 'Ollama TCP',
          ok: true,
          message: `Anslutning till ${host}:${port} OK`,
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          name: 'Ollama TCP',
          ok: false,
          message: `Timeout vid anslutning till ${host}:${port}`,
        });
      });

      socket.on('error', (err) => {
        resolve({
          name: 'Ollama TCP',
          ok: false,
          message: `Kunde inte ansluta till ${host}:${port}: ${err.message}`,
        });
      });
    });
  } catch (err) {
    return { name: 'Ollama TCP', ok: false, message: err.message };
  }
}

/**
 * Test: Ollama API + modell
 */
async function testOllamaApi() {
  try {
    const result = await testOllamaConnection();
    return {
      name: 'Ollama API + Modell',
      ok: result.ok && result.modelAvailable,
      message: result.message || result.error,
      details: result.ok ? {
        models: result.models,
        configuredModel: result.configuredModel,
      } : undefined,
    };
  } catch (err) {
    return { name: 'Ollama API + Modell', ok: false, message: err.message };
  }
}

/**
 * Test: Kryptering roundtrip
 */
async function testEncryption() {
  try {
    const testValue = 'mailwise-crypto-test-' + Date.now();
    const encrypted = await encryptToken(testValue);
    const decrypted = await decryptToken(encrypted);

    return {
      name: 'Kryptering (AES-256-GCM)',
      ok: decrypted === testValue,
      message: decrypted === testValue
        ? 'Encrypt → Decrypt roundtrip OK'
        : 'Krypteringsfel: dekrypterat värde matchar inte',
    };
  } catch (err) {
    return { name: 'Kryptering (AES-256-GCM)', ok: false, message: err.message };
  }
}

/**
 * Test: Alla brevlådors Gmail-anslutning
 */
async function testAllMailboxes() {
  try {
    const [mailboxes] = await pool.execute(
      'SELECT id, email, display_name, refresh_token IS NOT NULL as has_token FROM mw_mailboxes WHERE enabled = TRUE'
    );

    if (mailboxes.length === 0) {
      return [{ name: 'Gmail-brevlådor', ok: true, message: 'Inga aktiva brevlådor' }];
    }

    const results = [];
    for (const mb of mailboxes) {
      if (!mb.has_token) {
        results.push({
          name: `Gmail: ${mb.email || mb.display_name || `#${mb.id}`}`,
          ok: false,
          message: 'Ej ansluten — OAuth2-token saknas',
        });
        continue;
      }

      const test = await testConnection(mb.id);
      results.push({
        name: `Gmail: ${mb.email || mb.display_name || `#${mb.id}`}`,
        ok: test.ok,
        message: test.ok
          ? `OK (${test.messagesTotal} meddelanden, ${test.threadsTotal} trådar)`
          : test.error,
      });
    }

    return results;
  } catch (err) {
    return [{ name: 'Gmail-brevlådor', ok: false, message: err.message }];
  }
}

/**
 * Test: Inställningar
 */
async function testSettings() {
  try {
    const settings = await getSettings('mailwise');
    const issues = [];

    if (!settings?.ollama_host) issues.push('Ollama-host saknas');
    if (!settings?.ollama_model) issues.push('LLM-modell saknas');
    if (!settings?.redirect_uri) issues.push('OAuth2 Redirect URI saknas');

    return {
      name: 'Inställningar',
      ok: issues.length === 0,
      message: issues.length === 0 ? 'Alla inställningar konfigurerade' : issues.join(', '),
    };
  } catch (err) {
    return { name: 'Inställningar', ok: false, message: err.message };
  }
}

export default router;
