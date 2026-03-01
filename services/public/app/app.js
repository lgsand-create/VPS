/**
 * Compuna Monitor PWA — app.js
 *
 * Vanilla JS SPA för mobilövervakning.
 * PIN-auth, sajt-lista, detaljvy med grafer, offline-stöd.
 */

// === State ===

const APP_VERSION = '1.3.0';

let currentScreen = 'pin';
let currentSiteId = null;
let refreshTimer = null;
let isRefreshing = false;
let refreshInterval = 60000; // Default 60s, uppdateras från server

// === Init ===

document.addEventListener('DOMContentLoaded', () => {
  // PIN-input: auto-submit vid 4 siffror
  const pinInput = document.getElementById('pin-input');
  pinInput.addEventListener('input', onPinInput);

  // Klicka på dots → fokusera input
  document.getElementById('pin-dots').addEventListener('click', () => pinInput.focus());

  // Hash-routing
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('popstate', handleRoute);

  // Android back-knapp
  window.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && currentScreen === 'detail') {
      e.preventDefault();
      showSites();
    }
  });

  // Online/offline
  window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.add('hidden');
    if (currentScreen === 'sites') loadSites();
    if (currentScreen === 'detail' && currentSiteId) loadSiteDetail(currentSiteId);
  });
  window.addEventListener('offline', () => {
    document.getElementById('offline-banner').classList.remove('hidden');
  });

  // Visa version
  const versionEl = document.getElementById('settings-version');
  if (versionEl) versionEl.textContent = APP_VERSION;

  // Starta
  checkAuth();
});

// === Auth ===

async function checkAuth() {
  try {
    const res = await fetch('/api/pwa/auth/status', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.authenticated) {
      if (data.config?.refresh_seconds) {
        refreshInterval = data.config.refresh_seconds * 1000;
      }
      handleRoute();
      maybeShowInstallPrompt();
    } else {
      showScreen('pin');
    }
  } catch {
    // Offline — kolla om vi har cachad data
    if (localStorage.getItem('pwa_cache_/sites')) {
      handleRoute();
    } else {
      showScreen('pin');
    }
  }
}

function onPinInput() {
  const input = document.getElementById('pin-input');
  const dots = document.querySelectorAll('.pin-dot');
  const pin = input.value.replace(/\D/g, '');
  input.value = pin; // Strip non-digits

  // Uppdatera dots
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < pin.length);
    dot.classList.remove('error');
  });

  // Auto-submit vid 4 siffror
  if (pin.length === 4) {
    submitPin(pin);
  }
}

async function submitPin(pin) {
  const input = document.getElementById('pin-input');
  const dots = document.querySelectorAll('.pin-dot');
  const dotsContainer = document.getElementById('pin-dots');
  const errorEl = document.getElementById('pin-error');

  input.disabled = true;
  dotsContainer.classList.add('loading');
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/pwa/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin }),
    });

    const data = await res.json();

    if (res.ok) {
      if (data.config?.refresh_seconds) {
        refreshInterval = data.config.refresh_seconds * 1000;
      }
      input.value = '';
      showSites();
      maybeShowInstallPrompt();
    } else {
      // Visa felanimation
      dots.forEach(dot => {
        dot.classList.remove('filled');
        dot.classList.add('error');
      });
      errorEl.textContent = data.error || 'Fel PIN-kod';
      setTimeout(() => {
        dots.forEach(dot => dot.classList.remove('error'));
        input.value = '';
        input.disabled = false;
        input.focus();
      }, 600);
      return;
    }
  } catch {
    errorEl.textContent = 'Kunde inte ansluta till servern';
  }

  dotsContainer.classList.remove('loading');
  input.disabled = false;
}

// === Navigation ===

function showScreen(name) {
  clearInterval(refreshTimer);
  refreshTimer = null;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(`${name}-screen`);
  if (screen) screen.classList.add('active');
  currentScreen = name;

  // Auto-fokusera PIN-input
  if (name === 'pin') {
    setTimeout(() => document.getElementById('pin-input')?.focus(), 100);
  }
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || '';

  if (hash.startsWith('site/')) {
    const id = hash.split('/')[1];
    showDetail(id);
  } else {
    showSites();
  }
}

function showSites() {
  window.location.hash = '';
  showScreen('sites');
  loadSites();
  refreshTimer = setInterval(loadSites, refreshInterval);
}

function showDetail(siteId) {
  currentSiteId = siteId;
  currentDetailTab = 'pwa-tab-monitor';
  if (window.location.hash !== `#site/${siteId}`) {
    window.location.hash = `site/${siteId}`;
  }
  showScreen('detail');
  loadSiteDetail(siteId);
  refreshTimer = setInterval(() => loadSiteDetail(siteId), refreshInterval);
}

// === API-lager med offline-cache ===

async function pwaFetch(path) {
  const cacheKey = `pwa_cache_${path}`;
  try {
    const res = await fetch(`/api/pwa${path}`, { credentials: 'same-origin' });
    if (res.status === 401) {
      showScreen('pin');
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Cacha framgångsrikt svar
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        data: json, timestamp: Date.now(),
      }));
    } catch { /* localStorage full */ }
    return json;
  } catch (err) {
    // Returnera cachad data om tillgänglig
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      document.getElementById('offline-banner').classList.remove('hidden');
      return parsed.data;
    }
    throw err;
  }
}

function getCacheTimestamp(path) {
  try {
    const cached = localStorage.getItem(`pwa_cache_${path}`);
    if (cached) return JSON.parse(cached).timestamp;
  } catch { /* ignore */ }
  return null;
}

// === Sajt-lista ===

async function loadSites() {
  try {
    const json = await pwaFetch('/sites');
    if (!json) return;
    renderSitesList(json.data);
    updateSyncBar('sync-bar', '/sites');
  } catch {
    document.getElementById('sites-list').innerHTML =
      '<div class="loading">Kunde inte ladda sajter</div>';
  }
}

// Exponera globalt för onclick
window.refreshSites = async function() {
  if (isRefreshing) return;
  isRefreshing = true;
  const btn = document.getElementById('refresh-btn');
  btn.innerHTML = '<span class="spinner"></span>';
  await loadSites();
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  isRefreshing = false;
};

function renderSitesList(sites) {
  const el = document.getElementById('sites-list');
  if (!sites || sites.length === 0) {
    el.innerHTML = '<div class="loading">Inga sajter att visa</div>';
    return;
  }

  el.innerHTML = sites.map(s => `
    <div class="site-card" onclick="showDetail('${escapeAttr(s.id)}')" role="button" tabindex="0">
      <div class="status-dot ${s.status || 'unknown'}"></div>
      <div class="site-info">
        <div class="site-name">${escapeHtml(s.name)}</div>
        <div class="site-url">${escapeHtml(stripProtocol(s.url))}</div>
      </div>
      <div class="site-meta">
        <div class="site-status-label ${s.status || 'unknown'}">${statusLabel(s.status)}</div>
        ${s.last_response_ms != null ? `<div class="site-response">${s.last_response_ms}ms</div>` : ''}
        ${s.open_incidents > 0 ? `<div class="site-incidents">${s.open_incidents} incident${s.open_incidents > 1 ? 'er' : ''}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// === Sajt-detalj ===

async function loadSiteDetail(siteId) {
  try {
    const json = await pwaFetch(`/sites/${siteId}`);
    if (!json) return;
    renderDetail(json.data);
    updateSyncBar('detail-sync-bar', `/sites/${siteId}`);
  } catch {
    document.getElementById('detail-content').innerHTML =
      '<div class="loading">Kunde inte ladda sajtdetaljer</div>';
  }
}

window.refreshDetail = async function() {
  if (!currentSiteId || isRefreshing) return;
  isRefreshing = true;
  await loadSiteDetail(currentSiteId);
  isRefreshing = false;
};

let currentDetailTab = 'pwa-tab-monitor';

function switchDetailTab(tabId) {
  document.querySelectorAll('.detail-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.detail-tab').forEach(el => el.classList.remove('active'));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
  const btn = document.querySelector(`.detail-tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
  currentDetailTab = tabId;
}

function renderDetail(data) {
  const { site, latestChecks, openIncidents, recentChecks, uptimeStats, dailyMetrics, recentDeepChecks } = data;

  document.getElementById('detail-name').textContent = site.name;
  document.getElementById('detail-url').textContent = stripProtocol(site.url);

  const el = document.getElementById('detail-content');

  // Uptime-kort
  const uptimeHtml = renderUptimeCards(uptimeStats);

  // Check-kort
  const checksHtml = renderCheckCards(latestChecks);

  // Health-detaljer
  const healthCheck = latestChecks.find(c => c.check_type === 'health');
  const healthHtml = healthCheck ? renderHealthDetails(healthCheck) : '';

  // Incidenter
  const incidentsHtml = renderIncidents(openIncidents);

  // Grafer
  const responseChartHtml = renderResponseChart(recentChecks);
  const uptimeChartHtml = renderUptimeChart(dailyMetrics);
  const deepChartHtml = renderDeepChart(recentDeepChecks);

  // Skyddsstatus
  const securityHtml = renderSecurityStatus(site, latestChecks);

  // Behåll aktiv tab vid refresh, default till monitor
  const isMonitor = currentDetailTab !== 'pwa-tab-charts';

  el.innerHTML = `
    ${uptimeHtml}
    <div class="detail-tabs">
      <button class="detail-tab ${isMonitor ? 'active' : ''}" data-tab="pwa-tab-monitor" onclick="switchDetailTab('pwa-tab-monitor')">Övervakning</button>
      <button class="detail-tab ${!isMonitor ? 'active' : ''}" data-tab="pwa-tab-charts" onclick="switchDetailTab('pwa-tab-charts')">Grafer</button>
    </div>
    <div class="detail-tab-content ${isMonitor ? 'active' : ''}" id="pwa-tab-monitor">
      ${checksHtml}
      ${securityHtml}
      ${incidentsHtml}
      ${healthHtml}
    </div>
    <div class="detail-tab-content ${!isMonitor ? 'active' : ''}" id="pwa-tab-charts">
      ${responseChartHtml}
      ${uptimeChartHtml}
      ${deepChartHtml}
    </div>
  `;
}

// === Rendering: Uptime-kort ===

function renderUptimeCards(stats) {
  if (!stats) return '';

  function uptimeClass(pct) {
    if (pct == null) return '';
    const n = parseFloat(pct);
    if (n >= 99.5) return 'good';
    if (n >= 95) return 'warn';
    return 'bad';
  }

  return `
    <div class="uptime-grid">
      <div class="uptime-card">
        <div class="uptime-value ${uptimeClass(stats['24h']?.pct)}">
          ${stats['24h']?.pct != null ? stats['24h'].pct + '%' : '—'}
        </div>
        <div class="uptime-label">Uptime 24h</div>
        <div class="uptime-sub">${stats['24h']?.avgMs != null ? stats['24h'].avgMs + 'ms' : ''}</div>
      </div>
      <div class="uptime-card">
        <div class="uptime-value ${uptimeClass(stats['7d']?.pct)}">
          ${stats['7d']?.pct != null ? stats['7d'].pct + '%' : '—'}
        </div>
        <div class="uptime-label">Uptime 7d</div>
        <div class="uptime-sub">${stats['7d']?.avgMs != null ? stats['7d'].avgMs + 'ms' : ''}</div>
      </div>
      <div class="uptime-card">
        <div class="uptime-value ${uptimeClass(stats['30d']?.pct)}">
          ${stats['30d']?.pct != null ? stats['30d'].pct + '%' : '—'}
        </div>
        <div class="uptime-label">Uptime 30d</div>
        <div class="uptime-sub">${stats['30d']?.avgMs != null ? stats['30d'].avgMs + 'ms' : ''}</div>
      </div>
    </div>
  `;
}

// === Rendering: Check-kort ===

const CHECK_LABELS = {
  http: 'HTTP', ssl: 'SSL', health: 'Health', dns: 'DNS',
  deep: 'Deep', integrity: 'Integritet', headers: 'Headers', content: 'Innehåll', canary: 'Canary',
};

const STATUS_LABELS = { ok: 'OK', warning: 'Varning', critical: 'Kritisk', error: 'Fel' };

function renderSecurityStatus(site, latestChecks) {
  const items = [];

  // Canary
  const hasCanary = !!site.canary_token;
  const canaryCheck = latestChecks?.find(c => c.check_type === 'canary');
  items.push({
    key: 'canary',
    active: hasCanary,
    label: 'Canary',
    detail: hasCanary
      ? (canaryCheck ? `Trigger: ${timeAgo(canaryCheck.checked_at)}` : 'Aktiv')
      : 'Ej konfigurerad',
  });

  // Screenshot
  items.push({
    key: 'screenshot',
    active: !!site.check_deep,
    label: 'Screenshot',
    detail: site.check_deep ? 'Vid deep-failure' : 'Inaktiv',
  });

  // Korrelation
  items.push({ key: 'correlation', active: true, label: 'Korrelation', detail: 'Aktiv' });

  return `
    <div class="section-title">Skyddsstatus</div>
    <div class="checks-grid">
      ${items.map(i => `
        <div class="check-card ${i.active ? 'ok' : ''}" style="min-height:auto;">
          <div class="check-card-header">
            <div class="check-type">${i.label}</div>
            <button class="check-info-btn" onclick="event.stopPropagation();showCheckInfo('${i.key}')" title="Mer info">?</button>
          </div>
          <div class="check-status ${i.active ? 'ok' : ''}">${i.active ? 'AKTIV' : 'AV'}</div>
          <div class="check-message">${i.detail}</div>
        </div>
      `).join('')}
    </div>
  `;
}

const CHECK_INFO = {
  http: {
    title: 'HTTP-check',
    desc: 'Skickar en HTTP-förfrågan till sajtens URL och verifierar att svaret har statuskod 200 (OK). Mäter svarstid i millisekunder.',
    action: 'Ansluter till sajten precis som en webbläsare, men laddar bara headern — inga bilder eller scripts.',
    alert: 'Larmar om sajten inte svarar eller svarar med felkod (500, 503 etc).',
  },
  ssl: {
    title: 'SSL-check',
    desc: 'Kontrollerar att sajtens SSL/TLS-certifikat är giltigt och inte snart löper ut.',
    action: 'Läser certifikatets utgångsdatum. Varnar 14 dagar innan, larmar 7 dagar innan.',
    alert: 'Larmar CRITICAL om certifikatet har gått ut eller löper ut inom 7 dagar.',
  },
  health: {
    title: 'Health-check',
    desc: 'Pollar en health.php-fil på sajten som rapporterar intern status: databas, disk, PHP-version, admin-konton, tabellstorlekar.',
    action: 'Skickar en autentiserad POST-förfrågan till health.php med krypterad nyckel. Sajten svarar med JSON.',
    alert: 'Larmar om databasen är nere, disken är full, eller antalet admin-konton har ändrats.',
  },
  dns: {
    title: 'DNS-check',
    desc: 'Verifierar att sajtens domännamn pekar på rätt IP-adress genom att jämföra mot en sparad baseline.',
    action: 'Gör en DNS-uppslagning och jämför A-records mot baslinjen. Upptäcker DNS-kapning.',
    alert: 'Larmar OMEDELBART om IP-adressen har ändrats (möjlig DNS-kapning).',
  },
  deep: {
    title: 'Deep Test',
    desc: 'Startar en riktig webbläsare (Playwright/Chromium) som kör ett konfigurerbart steg-för-steg-flöde med login, navigation och verifiering. Tar screenshot efter varje steg.',
    action: 'Öppnar sajten i headless Chrome och kör konfigurerade steg (goto, fill, click, waitFor m.fl.). Mäter tid per steg och tar screenshot. Utan stegconfig körs standardtester (sidladdning, JS-fel, innehåll).',
    alert: 'Larmar om ett steg misslyckas eller om svarstid överskrider tröskelvärdet. Filmstrip-rapport visar exakt var det gick fel.',
  },
  integrity: {
    title: 'Filintegritet',
    desc: 'Kontrollerar att kritiska filer på servern inte har modifierats genom att jämföra SHA-256 hash mot en sparad baseline.',
    action: 'Ansluter via SSH/SFTP till servern, läser filerna och beräknar hash. Inga filer ändras.',
    alert: 'Larmar OMEDELBART om en fils hash har ändrats (möjlig intrång eller obehörig ändring).',
  },
  headers: {
    title: 'Headers-check',
    desc: 'Kontrollerar att sajten skickar rätt säkerhetsheaders: HSTS, Content-Security-Policy, X-Frame-Options m.fl.',
    action: 'Hämtar sajtens HTTP-headers och jämför mot bästa praxis för webbsäkerhet.',
    alert: 'Varnar om viktiga säkerhetsheaders saknas eller är felkonfigurerade.',
  },
  content: {
    title: 'Innehållsskanning',
    desc: 'Skannar sajtens sidor efter injicerad skadlig kod: okända scripts, iframes, obfuskerad JavaScript.',
    action: 'Laddar sajtens HTML och letar efter mönster som tyder på injektion: eval(), obfuskering, externa iframes.',
    alert: 'Larmar OMEDELBART om misstänkt injicerad kod hittas.',
  },
  canary: {
    title: 'Canary/Honeypot',
    desc: 'Webhook-baserad detektion av obehörig åtkomst. Dolda filer och scripttrackers rapporterar tillbaka om någon besöker dem.',
    action: 'Passiv — väntar på att canary-filer triggas. Ingen aktiv polling.',
    alert: 'Larmar OMEDELBART om en canary-fil aktiveras (möjlig intrång eller sajt-klon).',
  },
};

const SECURITY_INFO = {
  canary: {
    title: 'Canary / Honeypot',
    desc: 'Dolda filer placeras på sajten som inte syns för vanliga besökare. Om en angripare eller bot hittar och öppnar dem triggas ett larm.',
    action: 'Passivt skydd — inga aktiva förfrågningar. En canary-token konfigureras per sajt och länkas till dolda PHP- eller JS-filer. När filen öppnas skickar den en webhook tillbaka till monitorn.',
    alert: 'Larmar OMEDELBART om en canary-fil triggas. Detta kan tyda på att en angripare utforskar sajtens filstruktur eller att sajten har klonats.',
  },
  screenshot: {
    title: 'Screenshot vid failure',
    desc: 'När deep-check (headless webbläsare) upptäcker ett fel tas automatiskt en screenshot av sidan. Sparas i 7 dagar.',
    action: 'Kör som del av deep-checken. Om sidan ger JS-fel eller inte laddar korrekt tas en skärmbild innan webbläsaren stängs. Screenshoten visas i incidentdetaljer.',
    alert: 'Inget eget larm — screenshots bifogas till deep-check-larmet för enklare felsökning.',
  },
  correlation: {
    title: 'Incident-korrelation',
    desc: 'Analyserar om flera check-typer failar samtidigt, vilket kan tyda på ett allvarligare problem än en enskild check-failure.',
    action: 'Om 2 eller fler olika check-typer failar inom 10 minuter eskaleras larmet. 1 timmes cooldown förhindrar upprepade larm.',
    alert: 'Skickar ett eskalerat larm med alla berörda check-typer listade. Hjälper att skilja riktiga driftproblem från enskilda check-glapp.',
  },
};

window.showCheckInfo = function(type) {
  const info = CHECK_INFO[type] || SECURITY_INFO[type];
  if (!info) return;

  const modal = document.getElementById('info-modal');
  const overlay = document.getElementById('info-modal-overlay');
  if (!modal || !overlay) return;

  modal.innerHTML = `
    <div class="info-modal-header">
      <h3>${escapeHtml(info.title)}</h3>
      <button class="header-btn" onclick="closeCheckInfo()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="info-modal-body">
      <p>${escapeHtml(info.desc)}</p>
      <div class="info-section">
        <div class="info-section-title">Hur den fungerar</div>
        <p>${escapeHtml(info.action)}</p>
      </div>
      <div class="info-section">
        <div class="info-section-title">Larm</div>
        <p>${escapeHtml(info.alert)}</p>
      </div>
    </div>
  `;
  overlay.classList.remove('hidden');
};

window.closeCheckInfo = function() {
  const overlay = document.getElementById('info-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
};

// Deep report state for lightbox navigation
let _pwaDeepDetails = null;

window.showDeepReport = function(el) {
  let details;
  try { details = JSON.parse(el.getAttribute('data-details')); } catch { return; }
  if (!details?.steps) return;
  _pwaDeepDetails = details;
  _pwaRenderDeepGrid();
};

function _pwaRenderDeepGrid() {
  const details = _pwaDeepDetails;
  if (!details?.steps) return;

  const steps = details.steps;
  const okCount = steps.filter(s => s.ok).length;
  const totalMs = details.totalMs || steps.reduce((sum, s) => sum + (s.ms || 0), 0);
  const maxMs = details.thresholds?.maxTotalMs || 30000;
  const allOk = okCount === steps.length;
  const statusClass = !allOk ? 'status-fail' : (totalMs > maxMs ? 'status-warning' : 'status-ok');
  const statusText = !allOk ? 'FAIL' : (totalMs > maxMs ? 'SLOW' : 'OK');

  const stepsHtml = steps.map((s, idx) => {
    const cls = !s.ok ? 'fail' : (s.overThreshold ? 'slow' : 'ok');
    const thumbHtml = s.screenshotPath
      ? `<div class="filmstrip-thumb" onclick="_pwaShowDeepImage(${idx})"><img src="${s.screenshotPath}" alt="${escapeAttr(s.name)}" loading="lazy"></div>`
      : `<div class="filmstrip-thumb"><div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray-500);font-size:0.8rem;">Ingen bild</div></div>`;
    const errorHtml = s.error ? `<div class="filmstrip-error">${escapeHtml(s.error)}</div>` : '';
    const msClass = s.overThreshold ? 'slow' : '';
    return `
      <div class="filmstrip-step ${cls}">
        ${thumbHtml}
        <div class="filmstrip-step-info">
          <div class="filmstrip-step-name">${s.index}. ${escapeHtml(s.name)}</div>
          <span class="filmstrip-step-action">${escapeHtml(s.action || '')}</span>
          <div class="filmstrip-step-meta">
            <span class="ms ${msClass}">${s.ms || 0}ms</span>
            <span>${s.ok ? 'OK' : 'FEL'}</span>
          </div>
          ${errorHtml}
        </div>
      </div>
    `;
  }).join('');

  const jsErrorsHtml = details.jsErrors?.length
    ? `<div class="filmstrip-js-errors"><h5>JS-fel</h5><ul>${details.jsErrors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
    : '';

  const modal = document.getElementById('info-modal');
  const overlay = document.getElementById('info-modal-overlay');
  if (!modal || !overlay) return;

  modal.innerHTML = `
    <div class="info-modal-header">
      <h3>Deep Test — Stegrapport</h3>
      <button class="header-btn" onclick="closeCheckInfo()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="info-modal-body">
      <div class="filmstrip-summary">
        <span class="steps-count">${okCount}/${steps.length} steg</span>
        <span class="${statusClass}">${statusText}</span>
        <span class="total-ms">${totalMs}ms (max ${maxMs}ms)</span>
      </div>
      <div class="filmstrip-container">
        ${stepsHtml}
      </div>
      ${jsErrorsHtml}
    </div>
  `;
  overlay.classList.remove('hidden');
}

window._pwaShowDeepImage = function(idx) {
  const details = _pwaDeepDetails;
  if (!details?.steps) return;
  const step = details.steps[idx];
  if (!step?.screenshotPath) return;

  const modal = document.getElementById('info-modal');
  if (!modal) return;

  const hasPrev = idx > 0 && details.steps[idx - 1]?.screenshotPath;
  const hasNext = idx < details.steps.length - 1 && details.steps[idx + 1]?.screenshotPath;

  modal.innerHTML = `
    <div class="info-modal-header">
      <button class="lightbox-back-btn" onclick="_pwaRenderDeepGrid()">&larr; Rapport</button>
      <span class="lightbox-title">${step.index}. ${escapeHtml(step.name)}</span>
      <button class="header-btn" onclick="closeCheckInfo()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="lightbox-body">
      <div class="lightbox-nav">
        ${hasPrev ? `<button class="lightbox-arrow" onclick="_pwaShowDeepImage(${idx - 1})">&lsaquo;</button>` : '<div></div>'}
        <img src="${step.screenshotPath}" alt="${escapeHtml(step.name)}" class="lightbox-img">
        ${hasNext ? `<button class="lightbox-arrow" onclick="_pwaShowDeepImage(${idx + 1})">&rsaquo;</button>` : '<div></div>'}
      </div>
      <div class="lightbox-meta">
        <span class="filmstrip-step-action">${step.action}</span>
        <span class="ms ${step.overThreshold ? 'slow' : ''}">${step.ms || 0}ms</span>
        <span style="color:${step.ok ? 'var(--success)' : 'var(--error)'};font-weight:600;">${step.ok ? 'OK' : 'FEL'}</span>
        <span style="color:var(--gray-400);">${step.index} / ${details.steps.length}</span>
      </div>
      ${step.error ? `<div class="filmstrip-error">${escapeHtml(step.error)}</div>` : ''}
    </div>
  `;
};

function renderCheckCards(checks) {
  if (!checks || checks.length === 0) return '';

  const order = ['http', 'ssl', 'health', 'dns', 'deep', 'integrity', 'headers', 'content'];
  const sorted = [...checks].sort((a, b) =>
    order.indexOf(a.check_type) - order.indexOf(b.check_type)
  );

  return `
    <div class="checks-grid">
      ${sorted.map(c => {
        let details = null;
        if (c.check_type === 'deep' && c.details) {
          try { details = typeof c.details === 'string' ? JSON.parse(c.details) : c.details; } catch {}
        }
        const isStepBased = details?.mode === 'steps' && Array.isArray(details.steps);
        const stepBadge = isStepBased
          ? `<div class="check-step-link" onclick="event.stopPropagation();showDeepReport(this)" data-details='${escapeAttr(JSON.stringify(details))}'>${details.steps.filter(s=>s.ok).length}/${details.steps.length} steg — Visa rapport</div>`
          : '';
        return `
        <div class="check-card ${c.status}">
          <div class="check-card-header">
            <div class="check-type">${CHECK_LABELS[c.check_type] || c.check_type}</div>
            <button class="check-info-btn" onclick="event.stopPropagation();showCheckInfo('${c.check_type}')" title="Mer info">?</button>
          </div>
          <div class="check-status ${c.status}">${STATUS_LABELS[c.status] || c.status}</div>
          <div class="check-message" title="${escapeAttr(c.message || '')}">${escapeHtml(c.message || '')}</div>
          ${stepBadge}
          <div class="check-time">${timeAgo(c.checked_at)}</div>
        </div>
      `;}).join('')}
    </div>
  `;
}

// === Rendering: Health-detaljer ===

function renderHealthDetails(check) {
  let details;
  try {
    details = typeof check.details === 'string' ? JSON.parse(check.details) : check.details;
  } catch { return ''; }
  if (!details || typeof details !== 'object') return '';

  const items = [];
  const checks = details.checks || {};

  // Databas
  if (checks.database) {
    const db = checks.database;
    const val = db.latency_ms != null ? `${db.latency_ms}ms` : (db.status || '—');
    items.push({ label: 'Databas', value: val, status: db.status });
  }

  // PHP
  if (checks.php) {
    items.push({ label: 'PHP', value: checks.php.version || '—', status: checks.php.status });
  }

  // Disk
  if (checks.disk) {
    const parts = [];
    if (checks.disk.used_pct != null) parts.push(`${checks.disk.used_pct}%`);
    if (checks.disk.free_gb != null) parts.push(`${checks.disk.free_gb} GB`);
    items.push({ label: 'Disk', value: parts.join(' / ') || '—', status: checks.disk.status });
  }

  // Admin-konton
  if (checks.admin_users) {
    const au = checks.admin_users;
    let val = au.count != null ? `${au.count} st` : '—';
    if (au.expected != null) val += ` (${au.expected})`;
    items.push({ label: 'Admins', value: val, status: au.status });
  }

  // Fellogg
  if (checks.error_log) {
    const val = checks.error_log.size_mb != null ? `${checks.error_log.size_mb} MB` : '—';
    items.push({ label: 'Fellogg', value: val, status: checks.error_log.status });
  }

  // Misslyckade inlogg
  if (checks.failed_logins_1h) {
    const val = checks.failed_logins_1h.count != null ? `${checks.failed_logins_1h.count} st` : '—';
    items.push({ label: 'Inlogg (1h)', value: val, status: checks.failed_logins_1h.status });
  }

  // Tabellstorlekar
  if (checks.table_rows?.counts) {
    for (const [table, count] of Object.entries(checks.table_rows.counts)) {
      items.push({ label: table, value: String(count) + ' rader' });
    }
  }

  // Fallback: gamla formatet
  if (items.length === 0) {
    if (details.php_version) items.push({ label: 'PHP', value: details.php_version });
    if (details.db_connected != null) items.push({ label: 'Databas', value: details.db_connected ? 'OK' : 'Ej ansluten' });
    if (details.disk_free_pct != null) items.push({ label: 'Disk ledig', value: details.disk_free_pct + '%' });
    if (details.admin_users != null) items.push({ label: 'Admins', value: String(details.admin_users) });
  }

  if (items.length === 0) return '';

  return `
    <div class="section-title">Health-detaljer</div>
    <div class="health-grid">
      ${items.map(i => `
        <div class="health-item${i.status === 'critical' ? ' critical' : i.status === 'warning' ? ' warning' : ''}">
          <div class="health-label">${escapeHtml(i.label)}</div>
          <div class="health-value">${escapeHtml(i.value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// === Rendering: Incidenter ===

function getDismissedIncidents() {
  try {
    return JSON.parse(localStorage.getItem('pwa_dismissed_incidents') || '[]');
  } catch { return []; }
}

window.dismissIncident = function(id) {
  const dismissed = getDismissedIncidents();
  if (!dismissed.includes(id)) {
    dismissed.push(id);
    localStorage.setItem('pwa_dismissed_incidents', JSON.stringify(dismissed));
  }
  // Ta bort kortet med animation
  const card = document.getElementById(`incident-${id}`);
  if (card) {
    card.style.transition = 'opacity 0.3s, transform 0.3s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(100%)';
    setTimeout(() => {
      card.remove();
      // Kolla om alla är borta
      const remaining = document.querySelectorAll('.incident-card');
      if (remaining.length === 0) {
        const list = document.getElementById('pwa-incidents-list');
        if (list) list.innerHTML = '<div class="no-incidents">Inga öppna incidenter</div>';
      }
    }, 300);
  }
};

window.restoreIncidents = function() {
  localStorage.removeItem('pwa_dismissed_incidents');
  if (currentSiteId) loadSiteDetail(currentSiteId);
};

function renderIncidents(incidents) {
  const title = '<div class="section-title">Incidenter</div>';

  if (!incidents || incidents.length === 0) {
    return title + '<div class="no-incidents">Inga öppna incidenter</div>';
  }

  const dismissed = getDismissedIncidents();
  const visible = incidents.filter(i => !dismissed.includes(i.id));

  if (visible.length === 0) {
    return title + `
      <div class="no-incidents">Inga öppna incidenter</div>
      <button class="restore-btn" onclick="restoreIncidents()">Visa dolda (${incidents.length})</button>
    `;
  }

  const dismissedCount = incidents.length - visible.length;

  return title + `
    <div id="pwa-incidents-list">
      ${visible.map(i => `
        <div class="incident-card ${i.severity === 'critical' ? 'critical' : ''}" id="incident-${i.id}">
          <div class="incident-header">
            <div class="incident-title">${escapeHtml(i.title)}</div>
            <button class="incident-dismiss" onclick="dismissIncident(${i.id})" title="Dölj">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          ${i.message ? `<div class="incident-message">${escapeHtml(i.message)}</div>` : ''}
          <div class="incident-meta">
            Öppnad: ${new Date(i.opened_at).toLocaleString('sv-SE')} — ${i.failure_count} fel i rad
            ${i.status === 'acknowledged' ? ' — Kvitterad' : ''}
          </div>
        </div>
      `).join('')}
    </div>
    ${dismissedCount > 0 ? `<button class="restore-btn" onclick="restoreIncidents()">Visa dolda (${dismissedCount})</button>` : ''}
  `;
}

// === Grafer: Svarstid (24h) ===

function renderResponseChart(recentChecks) {
  const title = '<div class="section-title">Svarstid (24h)</div>';

  if (!recentChecks || recentChecks.length < 2) {
    return title + '<div class="chart-container"><div class="loading">Inte tillräckligt med data ännu</div></div>';
  }

  const W = 700, H = 180, PAD = { top: 10, right: 15, bottom: 35, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const msValues = recentChecks.map(c => c.response_ms || 0);
  const maxMs = Math.max(...msValues, 1);
  const yMax = Math.ceil(maxMs / 100) * 100 || 100;

  const points = recentChecks.map((c, i) => {
    const x = PAD.left + (i / (recentChecks.length - 1)) * plotW;
    const y = PAD.top + plotH - ((c.response_ms || 0) / yMax) * plotH;
    return { x, y, status: c.status, ms: c.response_ms, time: c.checked_at };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const areaD = pathD
    + ` L${points[points.length - 1].x.toFixed(1)},${PAD.top + plotH}`
    + ` L${points[0].x.toFixed(1)},${PAD.top + plotH} Z`;

  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((yMax / ySteps) * i);
    const y = PAD.top + plotH - (i / ySteps) * plotH;
    return `<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis">${val}</text>
      <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" class="chart-grid" />`;
  }).join('');

  const xLabelCount = Math.min(6, recentChecks.length);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / (xLabelCount - 1)) * (recentChecks.length - 1));
    const x = PAD.left + (idx / (recentChecks.length - 1)) * plotW;
    const t = new Date(recentChecks[idx].checked_at);
    const label = t.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    return `<text x="${x}" y="${H - 5}" text-anchor="middle" class="chart-axis">${label}</text>`;
  }).join('');

  const dots = points
    .filter(p => p.status !== 'ok')
    .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"
      fill="${p.status === 'warning' ? '#f59e0b' : '#ef4444'}" />`)
    .join('');

  return title + `
    <div class="chart-container">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${yLabels}
        ${xLabels}
        <text x="3" y="${PAD.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,10,${PAD.top + plotH / 2})"
          style="font-size:10px;fill:#64748b;">ms</text>
        <path d="${areaD}" fill="rgba(59,158,255,0.08)" />
        <path d="${pathD}" fill="none" stroke="#3b9eff" stroke-width="1.5" />
        ${dots}
      </svg>
    </div>
  `;
}

// === Grafer: Uptime (30 dagar) ===

function renderUptimeChart(dailyMetrics) {
  const title = '<div class="section-title">Uptime (30 dagar)</div>';

  if (!dailyMetrics || dailyMetrics.length < 2) {
    return '';
  }

  const W = 700, H = 200, PAD = { top: 15, right: 50, bottom: 40, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const bars = dailyMetrics.map((d, i) => {
    const x = PAD.left + (i / dailyMetrics.length) * plotW;
    const w = Math.max(plotW / dailyMetrics.length - 1, 2);
    const pct = d.uptime_pct != null ? parseFloat(d.uptime_pct) : 100;
    const barH = (pct / 100) * plotH;
    const y = PAD.top + plotH - barH;

    let color = '#22c55e';
    if (pct < 99.5) color = '#f59e0b';
    if (pct < 95) color = '#ef4444';

    const dateStr = d.date ? new Date(d.date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barH.toFixed(1)}"
      fill="${color}" rx="1">
      <title>${dateStr}: ${pct}% uptime, ${d.avg_response_ms || '—'}ms medel</title>
    </rect>`;
  }).join('');

  const maxAvgMs = Math.max(...dailyMetrics.map(d => d.avg_response_ms || 0), 1);
  const msYMax = Math.ceil(maxAvgMs / 100) * 100 || 500;
  const msPoints = dailyMetrics.map((d, i) => {
    const x = PAD.left + (i + 0.5) * (plotW / dailyMetrics.length);
    const ms = d.avg_response_ms || 0;
    const y = PAD.top + plotH - (ms / msYMax) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const msPath = msPoints.length > 1
    ? `<polyline points="${msPoints.join(' ')}" fill="none" stroke="#3b9eff" stroke-width="2" stroke-dasharray="4,2" />`
    : '';

  const yLabels = [100, 99, 98, 95].map(pct => {
    const y = PAD.top + plotH - (pct / 100) * plotH;
    return `<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis">${pct}%</text>
      <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" class="chart-grid" />`;
  }).join('');

  const msLabels = [0, Math.round(msYMax / 2), msYMax].map(ms => {
    const y = PAD.top + plotH - (ms / msYMax) * plotH;
    return `<text x="${PAD.left + plotW + 8}" y="${y + 3}" text-anchor="start" style="font-size:10px;fill:#3b9eff;">${ms}ms</text>`;
  }).join('');

  const xStep = Math.max(Math.floor(dailyMetrics.length / 7), 1);
  const xLabels = dailyMetrics.map((d, i) => {
    if (i % xStep !== 0 && i !== dailyMetrics.length - 1) return '';
    const x = PAD.left + (i + 0.5) * (plotW / dailyMetrics.length);
    const dateStr = d.date ? new Date(d.date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) : '';
    return `<text x="${x}" y="${H - 5}" text-anchor="middle" class="chart-axis">${dateStr}</text>`;
  }).join('');

  return title + `
    <div class="chart-container">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${yLabels}
        ${msLabels}
        ${bars}
        ${msPath}
        ${xLabels}
        <text x="3" y="${PAD.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,10,${PAD.top + plotH / 2})"
          style="font-size:10px;fill:#22c55e;">uptime</text>
      </svg>
      <div class="chart-legend">
        <span class="legend-item"><span class="legend-bar" style="background:#22c55e"></span> Uptime %</span>
        <span class="legend-item"><span class="legend-line"></span> Medel svarstid</span>
      </div>
    </div>
  `;
}

// === Grafer: Deep Test Total tid ===

function renderDeepChart(deepChecks) {
  const title = '<div class="section-title">Deep Test — Total tid</div>';

  if (!deepChecks || deepChecks.length < 2) {
    return '';
  }

  const W = 700, H = 200, PAD = { top: 15, right: 15, bottom: 35, left: 55 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const msValues = deepChecks.map(c => c.response_ms || 0);
  const maxMs = Math.max(...msValues, 1000);
  const yMax = Math.ceil(maxMs / 5000) * 5000 || 30000;

  const barW = Math.max(plotW / deepChecks.length - 2, 4);
  const bars = deepChecks.map((c, i) => {
    const x = PAD.left + (i / deepChecks.length) * plotW + 1;
    const ms = c.response_ms || 0;
    const barH = Math.max((ms / yMax) * plotH, 2);
    const y = PAD.top + plotH - barH;
    const color = c.status === 'ok' ? '#22c55e' : c.status === 'warning' ? '#f59e0b' : '#ef4444';
    const t = new Date(c.checked_at);
    const timeStr = t.toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}"
      fill="${color}" rx="1"><title>${timeStr}: ${ms}ms — ${c.status}</title></rect>`;
  }).join('');

  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((yMax / ySteps) * i);
    const y = PAD.top + plotH - (i / ySteps) * plotH;
    const label = val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}s` : `${val}ms`;
    return `<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis">${label}</text>
      <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" class="chart-grid" />`;
  }).join('');

  const xLabelCount = Math.min(6, deepChecks.length);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / (xLabelCount - 1)) * (deepChecks.length - 1));
    const x = PAD.left + (idx / deepChecks.length) * plotW + barW / 2;
    const t = new Date(deepChecks[idx].checked_at);
    const label = t.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
    return `<text x="${x}" y="${H - 5}" text-anchor="middle" class="chart-axis">${label}</text>`;
  }).join('');

  return title + `
    <div class="chart-container">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${yLabels}
        ${xLabels}
        <text x="3" y="${PAD.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,10,${PAD.top + plotH / 2})"
          style="font-size:10px;fill:#64748b;">tid</text>
        ${bars}
      </svg>
      <div class="chart-legend">
        <span class="legend-item"><span class="legend-bar" style="background:#22c55e"></span> OK</span>
        <span class="legend-item"><span class="legend-bar" style="background:#f59e0b"></span> Slow</span>
        <span class="legend-item"><span class="legend-bar" style="background:#ef4444"></span> Fail</span>
      </div>
    </div>
  `;
}

// === Sync-bar ===

function updateSyncBar(elementId, cachePath) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const ts = getCacheTimestamp(cachePath);
  if (ts) {
    const d = new Date(ts);
    el.textContent = `Uppdaterad ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    el.textContent = '';
  }
}

// === Hjälpfunktioner ===

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function stripProtocol(url) {
  return String(url || '').replace(/^https?:\/\//, '');
}

function statusLabel(status) {
  const labels = { up: 'UP', degraded: 'SLOW', down: 'DOWN', unknown: '—' };
  return labels[status] || '—';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just nu';
  if (diff < 3600) return `${Math.floor(diff / 60)} min sedan`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h sedan`;
  return d.toLocaleString('sv-SE');
}

// === Installationsprompt ===

let deferredInstallPrompt = null;

// Fånga Chrome/Edge beforeinstallprompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Visa bara om användaren inte redan avvisat
  if (!localStorage.getItem('pwa_install_dismissed')) {
    showInstallBanner();
  }
});

// Kolla om redan installerad
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  hideInstallBanner();
  localStorage.setItem('pwa_installed', 'true');
});

function showInstallBanner() {
  // Kolla om redan körs som standalone (redan installerad)
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    return;
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);

  if (isIos && isSafari) {
    // iOS Safari — visa manuell instruktion
    showIosInstallHint();
  } else if (deferredInstallPrompt) {
    // Chrome/Edge — visa installationsbanner
    const banner = document.getElementById('install-banner');
    if (banner) {
      banner.classList.remove('hidden');

      document.getElementById('install-accept').onclick = async () => {
        banner.classList.add('hidden');
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          const { outcome } = await deferredInstallPrompt.userChoice;
          if (outcome === 'accepted') {
            localStorage.setItem('pwa_installed', 'true');
          }
          deferredInstallPrompt = null;
        }
      };

      document.getElementById('install-dismiss').onclick = () => {
        banner.classList.add('hidden');
        localStorage.setItem('pwa_install_dismissed', Date.now().toString());
      };
    }
  }
}

function hideInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.add('hidden');
}

function showIosInstallHint() {
  // Skapa iOS-specifik instruktion
  if (document.getElementById('ios-hint')) return;

  const hint = document.createElement('div');
  hint.id = 'ios-hint';
  hint.className = 'ios-install-hint';
  hint.innerHTML = `
    <strong>Installera Compuna Monitor</strong>
    <p>Tryck på <span class="share-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b9eff" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></span> och sedan <strong>"Lägg till på hemskärmen"</strong></p>
    <button class="ios-install-close" onclick="this.parentElement.classList.add('hidden'); localStorage.setItem('pwa_install_dismissed', Date.now().toString());">Stäng</button>
  `;
  document.body.appendChild(hint);
}

// Visa installationsprompt efter inloggning (med fördröjning)
function maybeShowInstallPrompt() {
  // Vänta 3 sekunder efter inloggning
  setTimeout(() => {
    if (localStorage.getItem('pwa_installed')) return;

    const dismissed = localStorage.getItem('pwa_install_dismissed');
    // Visa igen efter 7 dagar om avvisad
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    showInstallBanner();
  }, 3000);
}

// === Inställningspanel ===

window.toggleSettings = function() {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.toggle('hidden');

  // Visa/dölj installera-knappen
  const installBtn = document.getElementById('settings-install');
  if (installBtn) {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const isInstalled = localStorage.getItem('pwa_installed');
    const canInstall = deferredInstallPrompt || (!isStandalone && !isInstalled);
    installBtn.style.display = canInstall ? 'flex' : 'none';
  }
};

window.closeSettings = function(e) {
  // Stäng bara om klick på overlay-bakgrunden
  if (e.target === e.currentTarget) {
    document.getElementById('settings-overlay').classList.add('hidden');
  }
};

window.installFromSettings = async function() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);

  if (deferredInstallPrompt) {
    // Chrome/Edge — trigga installationsprompt
    document.getElementById('settings-overlay').classList.add('hidden');
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem('pwa_installed', 'true');
    }
    deferredInstallPrompt = null;
  } else if (isIos && isSafari) {
    // iOS Safari — visa instruktion
    document.getElementById('settings-overlay').classList.add('hidden');
    showIosInstallHint();
  } else if (isIos) {
    // iOS men ej Safari — visa instruktion att öppna i Safari
    document.getElementById('settings-overlay').classList.add('hidden');
    alert('Öppna denna sida i Safari och välj "Lägg till på hemskärmen" för att installera.');
  } else {
    // Annan webbläsare utan beforeinstallprompt
    document.getElementById('settings-overlay').classList.add('hidden');
    alert('Öppna webbläsarens meny och välj "Installera app" eller "Lägg till på hemskärmen".');
  }
};

window.forceSwUpdate = async function() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/app/');
    if (reg) {
      await reg.update();
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }
    // Ladda om sidan för att aktivera ny version
    window.location.reload();
  } catch {
    window.location.reload();
  }
};

window.logout = async function() {
  document.getElementById('settings-overlay').classList.add('hidden');
  try {
    await fetch('/api/pwa/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch { /* ignore */ }
  // Rensa cachad data
  localStorage.removeItem('pwa_cache_/sites');
  showScreen('pin');
  // Fokusera PIN-input
  setTimeout(() => {
    const input = document.getElementById('pin-input');
    input.value = '';
    input.disabled = false;
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('filled', 'error'));
    document.getElementById('pin-error').textContent = '';
    input.focus();
  }, 100);
};

// === Service Worker ===

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })
    .catch(() => { /* SW ej stödd eller fel */ });
}
