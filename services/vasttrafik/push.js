/**
 * Västtrafik Push — Web Push-notiser vid förseningar
 *
 * Läser VAPID-nycklar från hub_settings (kategori 'vasttrafik').
 * Anropas från engine.js vid detekterade förseningar.
 */

import pool from '../db/connection.js';
import { getSettings } from '../db/settings.js';

let webpush = null;
let initialized = false;

/**
 * Initialisera web-push med VAPID-nycklar från DB
 */
async function initPush() {
  if (initialized) return !!webpush;

  try {
    const settings = await getSettings('vasttrafik');
    const publicKey = settings?.vapid_public;
    const privateKey = settings?.vapid_private;
    const email = settings?.vapid_email || 'mailto:jonas@compuna.se';

    if (!publicKey || !privateKey) {
      console.log('  [VASTTRAFIK] VAPID-nycklar saknas i inställningar — push-notiser inaktiva');
      initialized = true;
      return false;
    }

    const mod = await import('web-push');
    webpush = mod.default || mod;
    webpush.setVapidDetails(email, publicKey, privateKey);
    initialized = true;
    console.log('  [VASTTRAFIK] Web Push konfigurerad');
    return true;
  } catch (err) {
    console.log(`  [VASTTRAFIK] web-push ej tillgänglig: ${err.message}`);
    initialized = true;
    return false;
  }
}

/**
 * Skicka push till alla prenumeranter som matchar hållplats + linje
 */
export async function notifySubscribers(stopId, departure) {
  const ready = await initPush();
  if (!ready) return;

  try {
    // Hitta prenumeranter som bevakar denna hållplats
    const [subs] = await pool.execute(
      `SELECT * FROM vt_push_subscriptions WHERE consecutive_failures <= 3`
    );

    if (subs.length === 0) return;

    const delayMinutes = Math.round(departure.delaySeconds / 60);

    const payload = JSON.stringify({
      title: `Linje ${departure.lineName} försenad`,
      body: `${departure.lineName} mot ${departure.direction || '?'} är ${delayMinutes} min försenad`,
      icon: '/avg/icons/icon.svg',
      badge: '/avg/icons/icon.svg',
      tag: `vt-delay-${departure.lineName}-${stopId}`,
      data: { url: `/avg/#${stopId}`, stopId },
    });

    for (const sub of subs) {
      // Kolla om prenumeranten bevakar denna hållplats
      const stopIds = sub.stop_ids ? JSON.parse(sub.stop_ids) : [];
      if (stopIds.length > 0 && !stopIds.includes(stopId)) continue;

      // Kolla linjefilter
      const lineFilters = sub.line_filters ? JSON.parse(sub.line_filters) : [];
      if (lineFilters.length > 0 && !lineFilters.includes(departure.lineName)) continue;

      // Kolla tröskel
      if (departure.delaySeconds < (sub.delay_threshold || 180)) continue;

      // Skicka push
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      };

      try {
        await webpush.sendNotification(subscription, payload);
        // Uppdatera last_used_at
        pool.execute(
          'UPDATE vt_push_subscriptions SET last_used_at = NOW(), consecutive_failures = 0 WHERE id = ?',
          [sub.id]
        ).catch(() => {});
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Prenumerationen har gått ut — ta bort
          await pool.execute('DELETE FROM vt_push_subscriptions WHERE id = ?', [sub.id]);
        } else {
          // Öka failure-räknaren
          await pool.execute(
            'UPDATE vt_push_subscriptions SET consecutive_failures = consecutive_failures + 1 WHERE id = ?',
            [sub.id]
          );
        }
      }
    }
  } catch (err) {
    console.error(`  [VASTTRAFIK] Push-fel: ${err.message}`);
  }
}

/**
 * Skicka push för en bevakad avgång
 */
export async function sendWatchNotification(watcher, departure) {
  const ready = await initPush();
  if (!ready) return;

  try {
    const delayMinutes = Math.round(departure.delaySeconds / 60);

    let title, body;
    if (departure.isCancelled) {
      title = `${departure.lineName} inställd`;
      body = `${departure.lineName} mot ${departure.direction || '?'} kl ${fmtTime(departure.scheduledAt)} är inställd`;
    } else {
      title = `${departure.lineName} försenad +${delayMinutes} min`;
      body = `${departure.lineName} mot ${departure.direction || '?'} — ny tid ${fmtTime(departure.estimatedAt || departure.scheduledAt)}`;
    }

    const payload = JSON.stringify({
      title,
      body,
      icon: '/avg/icons/icon.svg',
      badge: '/avg/icons/icon.svg',
      tag: `vt-watch-${departure.lineName}-${watcher.id}`,
      data: { url: '/avg/' },
    });

    const subscription = {
      endpoint: watcher.endpoint,
      keys: { p256dh: watcher.p256dh, auth: watcher.auth_key },
    };

    await webpush.sendNotification(subscription, payload);

    pool.execute(
      'UPDATE vt_push_subscriptions SET last_used_at = NOW(), consecutive_failures = 0 WHERE endpoint = ?',
      [watcher.endpoint]
    ).catch(() => {});
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await pool.execute('DELETE FROM vt_push_subscriptions WHERE endpoint = ?', [watcher.endpoint]);
      await pool.execute('DELETE FROM vt_watched_departures WHERE endpoint = ?', [watcher.endpoint]);
    }
  }
}

function fmtTime(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Hämta VAPID public key från DB (för frontend)
 */
export async function getVapidPublicKey() {
  try {
    const settings = await getSettings('vasttrafik');
    return settings?.vapid_public || null;
  } catch {
    return null;
  }
}
