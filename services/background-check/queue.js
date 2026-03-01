/**
 * Playwright-kö — serialiserar bakgrundskontroller
 *
 * Playwright öppnar en riktig browser per körning. Parallella körningar
 * innebär parallella browsers → minnesproblem på VPS. Denna kö säkerställer
 * att max EN kontroll körs åt gången; övriga väntar i tur och ordning.
 *
 * Timeout per kontroll: 60 sekunder (polisen.se kan vara trög).
 * Maxkölängd: 10 väntande anrop — fler avvisas med 503.
 */

const MAX_QUEUE_LENGTH = 10;
const CHECK_TIMEOUT_MS = 60_000;

let running = false;
const waiters = [];

/**
 * Kör fn() i tur och ordning. Returnerar fn():s resultat.
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function enqueue(fn) {
  if (waiters.length >= MAX_QUEUE_LENGTH) {
    const err = new Error('Kön är full — försök igen om en stund');
    err.code = 'QUEUE_FULL';
    throw err;
  }

  // Vänta tills det är vår tur
  if (running) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(resolve);
        if (idx !== -1) waiters.splice(idx, 1);
        const err = new Error('Timeout i väntan på ledig plats i kön');
        err.code = 'QUEUE_TIMEOUT';
        reject(err);
      }, CHECK_TIMEOUT_MS);

      waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  running = true;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => {
        const err = new Error('Kontrollen tog för lång tid (timeout)');
        err.code = 'CHECK_TIMEOUT';
        reject(err);
      }, CHECK_TIMEOUT_MS)),
    ]);
  } finally {
    running = false;
    // Väck nästa i kön
    const next = waiters.shift();
    if (next) next();
  }
}

/**
 * Aktuell kö-status (för diagnostik)
 */
export function queueStatus() {
  return {
    running,
    waiting: waiters.length,
    maxQueue: MAX_QUEUE_LENGTH,
  };
}
