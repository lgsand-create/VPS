/**
 * Playwright Deep Check — djuptest via child_process.fork()
 *
 * Startar playwright-worker.js som separat process for isolering.
 * Forhindrar att en hangande browser blockar monitor-eventloopen.
 *
 * Timeout: 60 sekunder.
 */

import { resolve } from 'path';
import { fork } from 'child_process';

const WORKER_PATH = resolve(import.meta.dirname, 'playwright-worker.js');
const TIMEOUT_MS = 60000;

export async function runDeepCheck(site) {
  const start = Date.now();

  return new Promise((resolve) => {
    const acceptedStatuses = site.accepted_statuses || '';

    // Steg-config fran DB (JSON-kolumn)
    let stepsJson = '';
    if (site.deep_steps) {
      try {
        const parsed = typeof site.deep_steps === 'string'
          ? JSON.parse(site.deep_steps)
          : site.deep_steps;
        if (Array.isArray(parsed) && parsed.length > 0) {
          stepsJson = JSON.stringify(parsed);
        }
      } catch { /* Faller tillbaka pa standardtester */ }
    }

    const thresholdsJson = JSON.stringify({
      maxStepMs: site.deep_max_step_ms || 10000,
      maxTotalMs: site.deep_max_total_ms || 30000,
    });

    const worker = fork(WORKER_PATH, [
      site.id, site.url, acceptedStatuses, stepsJson, thresholdsJson,
    ], {
      env: { ...process.env },
      silent: true,
    });

    let result = null;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      worker.kill('SIGTERM');
    }, TIMEOUT_MS);

    worker.on('message', (msg) => {
      result = msg;
    });

    worker.on('exit', (code) => {
      clearTimeout(timer);

      if (result) {
        result.responseMs = Date.now() - start;
        return resolve(result);
      }

      resolve({
        siteId: site.id,
        type: 'deep',
        status: 'error',
        responseMs: Date.now() - start,
        statusCode: null,
        message: timedOut
          ? `Playwright timeout efter ${TIMEOUT_MS / 1000}s`
          : `Playwright-worker avslutades med kod ${code}`,
        details: { exitCode: code, timeout: timedOut },
      });
    });

    worker.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        siteId: site.id,
        type: 'deep',
        status: 'error',
        responseMs: Date.now() - start,
        statusCode: null,
        message: `Playwright-fel: ${err.message}`,
        details: { error: err.message },
      });
    });
  });
}
