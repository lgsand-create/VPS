/**
 * Alerter — pluggbar larm-dispatch
 *
 * Kanaler:
 *   console — alltid aktiv
 *   email   — nodemailer (lazy-import, kräver npm i nodemailer)
 *   sms     — HelloSMS API
 *
 * Rate limit: max N larm per sajt/timme.
 * Alla larm loggas i mon_alerts.
 */

import pool from '../db/connection.js';
import { getProject } from '../projects/index.js';
import { getSettings } from '../db/settings.js';

// Rate limit tracker: { 'siteId': { count, resetAt } }
const rateLimits = new Map();

/**
 * Kontrollera rate limit — returnerar true om larmet ska blockas
 */
function isRateLimited(siteId) {
  const config = getProject('monitor').alerting;
  const maxPerHour = config.maxAlertsPerHourPerSite || 10;

  const now = Date.now();
  let entry = rateLimits.get(siteId);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 3600000 };
    rateLimits.set(siteId, entry);
  }

  entry.count++;
  return entry.count > maxPerHour;
}

// --- Larm-kanaler ---

const channels = {
  console: {
    async send(type, incident, result) {
      const prefix = type === 'recovery' ? 'ÅTERHÄMTNING' : 'LARM';
      const severity = incident.severity ? ` [${incident.severity}]` : '';
      console.log(`\n  [MONITOR] [${prefix}]${severity} ${incident.site_id}: ${incident.title}`);
      console.log(`  ${result.message}`);
      if (incident.failure_count > 1) {
        console.log(`  Konsekutiva fel: ${incident.failure_count}`);
      }
      const screenshot = result.details?.screenshot;
      if (screenshot?.filename) {
        console.log(`  Screenshot: ${screenshot.filename}`);
      }
      console.log('');
    },
  },

  email: {
    async send(type, incident, result) {
      try {
        // Läs SMTP-inställningar från DB (med env-fallback)
        const smtp = await getSettings('smtp');
        const config = getProject('monitor').alerting;

        if (smtp.enabled !== 'true') return;

        const smtpHost = smtp.host || process.env[config.smtpHost];
        if (!smtpHost) {
          console.log('  [MONITOR] E-postlarm: SMTP ej konfigurerat — hoppar över');
          return;
        }

        const recipients = smtp.recipients || process.env[config.emailRecipients];
        if (!recipients) return;

        const { createTransport } = await import('nodemailer');

        const transport = createTransport({
          host: smtpHost,
          port: parseInt(smtp.port || process.env[config.smtpPort] || '587'),
          secure: false,
          auth: {
            user: smtp.user || process.env[config.smtpUser],
            pass: smtp.password || process.env[config.smtpPass],
          },
        });

        const isRecovery = type === 'recovery';
        const subject = isRecovery
          ? `[OK] ${incident.site_id} återhämtad — ${incident.check_type}`
          : `[LARM] ${incident.site_id}: ${incident.title}`;

        // Screenshot-lank for deep checks
        const screenshot = result.details?.screenshot;
        const dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || 3000}`;
        const screenshotLine = screenshot?.path
          ? `Screenshot: ${dashboardUrl}${screenshot.path}`
          : null;

        const body = [
          isRecovery ? 'Sajten har återhämtat.' : 'Problem upptäckt:',
          '',
          `Sajt: ${incident.site_id}`,
          `Typ: ${incident.check_type}`,
          `Meddelande: ${result.message}`,
          isRecovery ? '' : `Konsekutiva fel: ${incident.failure_count}`,
          screenshotLine,
          '',
          `Tid: ${new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}`,
          '',
          '— Compuna Monitor',
        ].filter(Boolean).join('\n');

        await transport.sendMail({
          from: smtp.from_address || process.env[config.smtpFrom] || 'monitor@compuna.se',
          to: recipients,
          subject,
          text: body,
        });

        console.log(`  [MONITOR] E-post skickat till ${recipients}`);
      } catch (err) {
        console.error(`  [MONITOR] E-postfel: ${err.message}`);
      }
    },
  },

  sms: {
    async send(type, incident, result) {
      try {
        const sms = await getSettings('hellosms');
        if (sms.enabled !== 'true') return;
        if (!sms.api_key || !sms.recipient) return;

        const prefix = type === 'recovery' ? 'OK' : 'LARM';
        const msg = `[${prefix}] ${incident.site_id}: ${result.message}`;

        await fetch('https://api.hellosms.se/v1/sms', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sms.api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: sms.recipient,
            from: sms.sender_name || 'Compuna',
            message: msg,
          }),
        });

        console.log(`  [MONITOR] SMS skickat till ${sms.recipient}`);
      } catch (err) {
        console.error(`  [MONITOR] SMS-fel: ${err.message}`);
      }
    },
  },
};

/**
 * Skicka larm via alla aktiva kanaler
 */
export async function sendAlert(incident, result) {
  if (isRateLimited(incident.site_id)) {
    console.log(`  [MONITOR] Rate limit: ${incident.site_id} — hoppar över larm`);
    return;
  }

  const config = getProject('monitor').alerting;

  for (const channelName of config.channels) {
    const channel = channels[channelName];
    if (!channel) continue;

    try {
      await channel.send('alert', incident, result);
      await logAlert('alert', channelName, incident, result);
    } catch (err) {
      console.error(`  [MONITOR] Alert-fel (${channelName}): ${err.message}`);
    }
  }
}

/**
 * Skicka aterhamtnings-notis via alla aktiva kanaler
 */
export async function sendRecovery(incident, result) {
  const config = getProject('monitor').alerting;

  for (const channelName of config.channels) {
    const channel = channels[channelName];
    if (!channel) continue;

    try {
      await channel.send('recovery', incident, result);
      await logAlert('recovery', channelName, incident, result);
    } catch (err) {
      console.error(`  [MONITOR] Recovery-fel (${channelName}): ${err.message}`);
    }
  }
}

/**
 * Logga larm i mon_alerts-tabellen
 */
async function logAlert(alertType, channelName, incident, result) {
  try {
    await pool.execute(
      `INSERT INTO mon_alerts (incident_id, site_id, channel, alert_type, message)
       VALUES (?, ?, ?, ?, ?)`,
      [incident.id, incident.site_id, channelName, alertType, result.message]
    );
  } catch (err) {
    console.error(`  [MONITOR] Loggning av larm misslyckades: ${err.message}`);
  }
}
