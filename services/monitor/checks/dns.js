/**
 * DNS Check — verifierar DNS-upplosning + hijack-detektering
 *
 * Kontrollerar att domanen pekar ratt via resolve4() och resolveNs().
 * Jamfor aktuella IP:er mot sparad baseline — larmar om IP andras.
 * Anvander Node.js inbyggda dns/promises.
 */

import dns from 'dns/promises';
import pool from '../../db/connection.js';

export async function runDnsCheck(site) {
  const hostname = new URL(site.url).hostname;

  try {
    const addresses = await dns.resolve4(hostname);

    // Forsok hamta nameservers (kan misslyckas for subdomaner)
    let nameservers = [];
    try {
      nameservers = await dns.resolveNs(hostname);
    } catch {
      // Subdomaner har ofta inga NS-poster — ignorera
    }

    if (addresses.length === 0) {
      return {
        siteId: site.id,
        type: 'dns',
        status: 'critical',
        responseMs: null,
        statusCode: null,
        message: `DNS: Inga A-poster for ${hostname}`,
        details: { hostname, addresses: [], nameservers },
      };
    }

    // --- Hijack-detektering ---
    const currentSorted = [...addresses].sort().join(',');
    const hijackResult = await checkDnsBaseline(site.id, currentSorted, addresses);

    if (hijackResult) {
      return {
        siteId: site.id,
        type: 'dns',
        status: 'critical',
        responseMs: null,
        statusCode: null,
        message: hijackResult.message,
        details: {
          hostname,
          addresses,
          nameservers,
          baseline: hijackResult.baseline,
          hijack: true,
        },
      };
    }

    return {
      siteId: site.id,
      type: 'dns',
      status: 'ok',
      responseMs: null,
      statusCode: null,
      message: `DNS: ${addresses.join(', ')}`,
      details: { hostname, addresses, nameservers },
    };
  } catch (err) {
    return {
      siteId: site.id,
      type: 'dns',
      status: 'critical',
      responseMs: null,
      statusCode: null,
      message: `DNS-fel: ${err.code || err.message}`,
      details: { hostname, error: err.code || err.message },
    };
  }
}

/**
 * Jamfor aktuella IP:er mot baseline — returnerar hijack-info eller null
 */
async function checkDnsBaseline(siteId, currentSorted, addresses) {
  try {
    const [rows] = await pool.execute(
      'SELECT dns_baseline_ips FROM mon_sites WHERE id = ?',
      [siteId]
    );

    const baseline = rows[0]?.dns_baseline_ips;

    if (!baseline) {
      // Forsta lyckade check — spara som baseline
      await pool.execute(
        'UPDATE mon_sites SET dns_baseline_ips = ? WHERE id = ?',
        [currentSorted, siteId]
      );
      console.log(`  [MONITOR] DNS baseline sparad for ${siteId}: ${currentSorted}`);
      return null;
    }

    if (baseline === currentSorted) {
      return null; // IP:er matchar — allt ok
    }

    // IP:er har andrats!
    return {
      message: `DNS HIJACK: IP andrad! Forvantat: ${baseline}, fick: ${currentSorted}`,
      baseline: baseline.split(','),
    };
  } catch (err) {
    // DB-fel ska inte stoppa DNS-checken
    console.error(`  [MONITOR] DNS baseline-check misslyckades: ${err.message}`);
    return null;
  }
}

/**
 * Acceptera nuvarande IP:er som ny baseline
 * Anropas fran dashboard/API nar en IP-andring ar forklarad
 */
export async function acceptDnsBaseline(siteId) {
  const [rows] = await pool.execute('SELECT url FROM mon_sites WHERE id = ?', [siteId]);
  if (rows.length === 0) throw new Error(`Sajt ${siteId} finns inte`);

  const hostname = new URL(rows[0].url).hostname;
  const addresses = await dns.resolve4(hostname);
  const sorted = [...addresses].sort().join(',');

  await pool.execute(
    'UPDATE mon_sites SET dns_baseline_ips = ? WHERE id = ?',
    [sorted, siteId]
  );

  return { siteId, hostname, addresses, baseline: sorted };
}
