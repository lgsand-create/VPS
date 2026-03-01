/**
 * SSL Check — kontrollerar certifikatets giltighet
 *
 * Ansluter via TLS och laser certifikat-info.
 * Varnar vid <30 dagar, kritiskt vid <7 dagar.
 */

import tls from 'tls';

const CONNECT_TIMEOUT_MS = 10000;
const WARN_DAYS = 30;
const CRITICAL_DAYS = 7;

export async function runSslCheck(site) {
  const hostname = new URL(site.url).hostname;

  return new Promise((resolve) => {
    const socket = tls.connect(443, hostname, { servername: hostname }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();

      if (!cert || !cert.valid_to) {
        return resolve({
          siteId: site.id,
          type: 'ssl',
          status: 'critical',
          responseMs: null,
          statusCode: null,
          message: 'Inget certifikat mottaget',
          details: {},
        });
      }

      const validTo = new Date(cert.valid_to);
      const validFrom = new Date(cert.valid_from);
      const daysLeft = Math.ceil((validTo - Date.now()) / 86400000);

      let status = 'ok';
      if (daysLeft <= CRITICAL_DAYS) status = 'critical';
      else if (daysLeft <= WARN_DAYS) status = 'warning';

      resolve({
        siteId: site.id,
        type: 'ssl',
        status,
        responseMs: null,
        statusCode: null,
        message: `SSL giltig ${daysLeft} dagar till (${validTo.toISOString().split('T')[0]})`,
        details: {
          daysLeft,
          validTo: validTo.toISOString(),
          validFrom: validFrom.toISOString(),
          issuer: cert.issuer?.O || cert.issuer?.CN || 'unknown',
          subject: cert.subject?.CN || hostname,
          serialNumber: cert.serialNumber,
        },
      });
    });

    socket.on('error', (err) => {
      resolve({
        siteId: site.id,
        type: 'ssl',
        status: 'critical',
        responseMs: null,
        statusCode: null,
        message: `SSL-fel: ${err.code || err.message}`,
        details: { error: err.code || err.message },
      });
    });

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy();
      resolve({
        siteId: site.id,
        type: 'ssl',
        status: 'error',
        responseMs: null,
        statusCode: null,
        message: 'SSL check timeout',
        details: { timeout: true },
      });
    });
  });
}
