/**
 * Settings — GET/PUT /api/system/settings
 *
 * Centraliserad inställningshantering för SMTP, HelloSMS, Firebase.
 * Lösenord maskas i GET-svar och skippas vid PUT om oförändrade.
 */

import { Router } from 'express';
import { createHash } from 'crypto';
import pool from '../db/connection.js';
import { invalidateSettingsCache, getSettings } from '../db/settings.js';

const router = Router();

// Kategorietiketter för UI-gruppering
const CATEGORY_LABELS = {
  smtp: 'E-post (SMTP)',
  hellosms: 'SMS (HelloSMS)',
  firebase: 'Firebase Push',
  pwa: 'Monitorapp (PWA)',
  vasttrafik: 'Västtrafik (Avgångar)',
  mailwise: 'MailWise (E-post + AI)',
};

// GET /api/system/settings — Alla inställningar grupperade per kategori
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT category, setting_key, setting_value, value_type, label, description, sort_order FROM hub_settings ORDER BY category, sort_order'
    );

    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.category]) {
        grouped[row.category] = {
          label: CATEGORY_LABELS[row.category] || row.category,
          settings: [],
        };
      }
      grouped[row.category].settings.push({
        key: row.setting_key,
        value: row.value_type === 'password' && row.setting_value ? '****' : row.setting_value,
        value_type: row.value_type,
        label: row.label,
        description: row.description,
      });
    }

    res.json({ data: grouped });
  } catch (err) {
    console.error('  [SETTINGS] Fel vid hämtning:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta inställningar' });
  }
});

// GET /api/system/settings/:category — En kategori
router.get('/:category', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_key, setting_value, value_type, label, description FROM hub_settings WHERE category = ? ORDER BY sort_order',
      [req.params.category]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `Kategori "${req.params.category}" finns inte` });
    }

    const settings = rows.map(row => ({
      key: row.setting_key,
      value: row.value_type === 'password' && row.setting_value ? '****' : row.setting_value,
      value_type: row.value_type,
      label: row.label,
      description: row.description,
    }));

    res.json({
      data: {
        label: CATEGORY_LABELS[req.params.category] || req.params.category,
        settings,
      },
    });
  } catch (err) {
    console.error('  [SETTINGS] Fel vid hämtning:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta inställningar' });
  }
});

// PUT /api/system/settings/:category — Uppdatera inställningar för en kategori
router.put('/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const updates = req.body;

    // Validera att kategorin finns
    const [existing] = await pool.execute(
      'SELECT setting_key, value_type FROM hub_settings WHERE category = ?',
      [category]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: `Kategori "${category}" finns inte` });
    }

    const validKeys = new Set(existing.map(r => r.setting_key));
    const keyTypes = Object.fromEntries(existing.map(r => [r.setting_key, r.value_type]));

    // Hasha PIN-kod innan sparning
    if (category === 'pwa' && updates.pin_hash && updates.pin_hash !== '****') {
      updates.pin_hash = createHash('sha256').update(String(updates.pin_hash)).digest('hex');
    }

    let updated = 0;
    for (const [key, value] of Object.entries(updates)) {
      if (!validKeys.has(key)) continue;
      // Skippa lösenord som är oförändrade (maskade)
      if (keyTypes[key] === 'password' && value === '****') continue;

      await pool.execute(
        'UPDATE hub_settings SET setting_value = ? WHERE category = ? AND setting_key = ?',
        [value === null ? null : String(value), category, key]
      );
      updated++;
    }

    // Invalidera backend-cache
    invalidateSettingsCache(category);

    res.json({ ok: true, message: `${updated} inställningar uppdaterade`, category });
  } catch (err) {
    console.error('  [SETTINGS] Fel vid uppdatering:', err.message);
    res.status(500).json({ error: 'Kunde inte uppdatera inställningar' });
  }
});

// POST /api/system/settings/test/smtp — Skicka test-mail
router.post('/test/smtp', async (req, res) => {
  try {
    const smtp = await getSettings('smtp');

    if (smtp.enabled !== 'true') {
      return res.status(400).json({ error: 'SMTP är inte aktiverat' });
    }
    if (!smtp.host) {
      return res.status(400).json({ error: 'SMTP-server är inte konfigurerad' });
    }
    if (!smtp.recipients) {
      return res.status(400).json({ error: 'Inga mottagare konfigurerade' });
    }

    const { createTransport } = await import('nodemailer');

    const transport = createTransport({
      host: smtp.host,
      port: parseInt(smtp.port || '587'),
      secure: false,
      auth: {
        user: smtp.user,
        pass: smtp.password,
      },
    });

    await transport.sendMail({
      from: smtp.from_address || 'monitor@compuna.se',
      to: smtp.recipients,
      subject: '[TEST] Compuna Hub — SMTP-test',
      text: 'Detta är ett testmail från Compuna Hub.\n\nOm du kan läsa detta fungerar SMTP-konfigurationen.\n\n— Compuna Hub',
    });

    res.json({ ok: true, message: `Test-mail skickat till ${smtp.recipients}` });
  } catch (err) {
    console.error('  [SETTINGS] SMTP-test fel:', err.message);
    res.status(500).json({ error: `SMTP-test misslyckades: ${err.message}` });
  }
});

// POST /api/system/settings/test/hellosms — Skicka test-SMS
router.post('/test/hellosms', async (req, res) => {
  try {
    const sms = await getSettings('hellosms');

    if (sms.enabled !== 'true') {
      return res.status(400).json({ error: 'HelloSMS är inte aktiverat' });
    }
    if (!sms.api_key) {
      return res.status(400).json({ error: 'API-nyckel saknas' });
    }
    if (!sms.recipient) {
      return res.status(400).json({ error: 'Mottagarnummer saknas' });
    }

    const smsRes = await fetch('https://api.hellosms.se/v1/sms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sms.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: sms.recipient,
        from: sms.sender_name || 'Compuna',
        message: 'Testmeddelande från Compuna Hub. SMS-konfigurationen fungerar!',
      }),
    });

    if (!smsRes.ok) {
      const errData = await smsRes.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${smsRes.status}`);
    }

    res.json({ ok: true, message: `Test-SMS skickat till ${sms.recipient}` });
  } catch (err) {
    console.error('  [SETTINGS] SMS-test fel:', err.message);
    res.status(500).json({ error: `SMS-test misslyckades: ${err.message}` });
  }
});

export default router;
