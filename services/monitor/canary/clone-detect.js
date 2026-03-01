/**
 * Compuna Clone Detection — lagg till i klientsajtens HTML
 *
 * Detekterar om sajten laddas fran en obehorig doman (phishing-klon).
 * Skickar tyst larm till Compuna Hub webhook.
 *
 * INSTALLATION:
 *   Lagg till fore </body> i klientsajtens layout/footer:
 *   <script src="/assets/cd.js"></script>
 *
 *   Eller inline:
 *   <script>
 *     (function(){ ... kopiera koden nedan ... })();
 *   </script>
 *
 * KONFIGURATION:
 *   Andra ALLOWED_DOMAINS, CANARY_TOKEN och WEBHOOK_URL nedan.
 */

(function () {
  // --- KONFIG (andras per sajt) ---
  var ALLOWED_DOMAINS = ['portal.backatorpif.se', 'www.backatorpif.se'];
  var CANARY_TOKEN = 'BYTTILLDINTOKEN';
  var WEBHOOK_URL = 'https://DIN-VPS-URL/webhooks/canary';
  // ---------------------------------

  try {
    var currentDomain = window.location.hostname.toLowerCase();

    // Kolla om domanen ar tilaten
    var allowed = false;
    for (var i = 0; i < ALLOWED_DOMAINS.length; i++) {
      if (currentDomain === ALLOWED_DOMAINS[i] || currentDomain === 'localhost') {
        allowed = true;
        break;
      }
    }

    if (allowed) return;

    // Domanen ar INTE tilaten — sajten ar klonad!
    var data = JSON.stringify({
      token: CANARY_TOKEN,
      type: 'clone',
      meta: {
        domain: currentDomain,
        fullUrl: window.location.href,
        referer: document.referrer || null,
      },
    });

    // Skicka via Beacon API (fire-and-forget, inga CORS-problem)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(WEBHOOK_URL, new Blob([data], { type: 'application/json' }));
    } else {
      // Fallback for aldre browsers
      var xhr = new XMLHttpRequest();
      xhr.open('POST', WEBHOOK_URL, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(data);
    }
  } catch (e) {
    // Tyst — avsloja aldrig honeypot-logik
  }
})();
