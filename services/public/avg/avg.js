/**
 * Avgångar PWA — Västtrafik realtidsavgångar
 *
 * Ingen inloggning — alla inställningar i localStorage.
 * Data hämtas från /api/avg/ (serveras från server-side cache).
 */

// === State ===

let allStops = [];
let customStops = JSON.parse(localStorage.getItem('avg_custom_stops') || '[]');
let selectedStopIds = JSON.parse(localStorage.getItem('avg_stops') || '[]');
let activeStopId = localStorage.getItem('avg_active_stop') || null;
let departures = {};
let refreshTimer = null;
let deferredPrompt = null;
let watchedJourneys = new Set(); // journey_ids som bevakas
let searchDebounceTimer = null;

// Inställningar
const settings = {
  notificationsEnabled: localStorage.getItem('avg_notif') === 'true',
  delayThreshold: parseInt(localStorage.getItem('avg_threshold') || '3'),
};

// === Init ===

async function init() {
  // Registrera service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/avg/sw.js');
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  }

  // Ladda hållplatser
  await loadStops();

  // Ladda bevakningar
  await loadWatched();

  // Ladda avgångar
  await loadDepartures();

  // Auto-refresh varje 30 sekunder
  refreshTimer = setInterval(loadDepartures, 30_000);

  // Nedräkningstimer (varje sekund)
  setInterval(updateCountdowns, 1_000);

  // Offline-detektion
  window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.add('hidden');
    loadDepartures();
  });
  window.addEventListener('offline', () => {
    document.getElementById('offline-banner').classList.remove('hidden');
  });

  // Install prompt
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  if (!isStandalone) {
    if (isIos) {
      // iOS — ingen beforeinstallprompt, visa instruktion istället
      const installSection = document.getElementById('settings-install');
      if (installSection) installSection.classList.remove('hidden');
      const btnRow = document.getElementById('install-btn-row');
      if (btnRow) btnRow.classList.add('hidden');
      const iosGuide = document.getElementById('ios-install-guide');
      if (iosGuide) iosGuide.classList.remove('hidden');
      // Visa iOS-banner om inte avfärdad
      if (!localStorage.getItem('avg_install_dismissed')) {
        document.getElementById('ios-install-banner').classList.remove('hidden');
      }
    } else {
      // Android/desktop — vänta på beforeinstallprompt
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installSection = document.getElementById('settings-install');
        if (installSection) installSection.classList.remove('hidden');
        if (!localStorage.getItem('avg_install_dismissed')) {
          document.getElementById('install-banner').classList.remove('hidden');
        }
      });
    }

    // Dölj allt om appen installeras
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      document.getElementById('install-banner').classList.add('hidden');
      const iosBanner = document.getElementById('ios-install-banner');
      if (iosBanner) iosBanner.classList.add('hidden');
      const installSection = document.getElementById('settings-install');
      if (installSection) installSection.classList.add('hidden');
    });
  }

  // Uppdatera inställningar-UI
  updateSettingsUI();
}

// === Stops ===

async function loadStops() {
  try {
    const res = await fetch('/api/avg/stops');
    const { data } = await res.json();
    allStops = data.map(s => ({ ...s, name: s.name.replace(/, Göteborg$/i, '') }));

    // Om inga stops valda, välj alla
    if (selectedStopIds.length === 0 && allStops.length > 0) {
      selectedStopIds = allStops.map(s => s.id);
      localStorage.setItem('avg_stops', JSON.stringify(selectedStopIds));
    }

    // Säkerställ att activeStop är giltig (preset + egna)
    const allValidIds = [...selectedStopIds, ...customStops.map(s => s.gid)];
    if (!activeStopId || !allValidIds.includes(activeStopId)) {
      activeStopId = allValidIds[0] || null;
      localStorage.setItem('avg_active_stop', activeStopId || '');
    }

    renderStopTabs();
    renderSettingsStops();
  } catch (err) {
    console.error('Kunde inte ladda hållplatser:', err);
  }
}

function renderStopTabs() {
  const container = document.getElementById('stop-tabs');
  if (!container) return;

  // Förinställda hållplatser
  const presetStops = allStops.filter(s => selectedStopIds.includes(s.id));
  let html = presetStops.map(s =>
    `<button class="stop-pill${s.id === activeStopId ? ' active' : ''}"
             onclick="selectStop('${esc(s.id)}')">${esc(s.name)}</button>`
  ).join('');

  // Egna hållplatser
  html += customStops.map(s =>
    `<button class="stop-pill custom${s.gid === activeStopId ? ' active' : ''}"
             onclick="selectStop('${esc(s.gid)}')">${esc(s.name)}</button>`
  ).join('');

  container.innerHTML = html;
}

function selectStop(stopId) {
  activeStopId = stopId;
  localStorage.setItem('avg_active_stop', stopId);
  renderStopTabs();
  renderDepartures();
}

// === Departures ===

async function loadDepartures() {
  try {
    departures = {};

    // Förinställda hållplatser (från DB)
    if (selectedStopIds.length > 0) {
      const stopParam = selectedStopIds.map(id => `stop=${encodeURIComponent(id)}`).join('&');
      const res = await fetch(`/api/avg/departures?${stopParam}`);
      const { data } = await res.json();
      Object.assign(departures, data);
    }

    // Egna hållplatser (via GID, on-demand)
    if (customStops.length > 0) {
      const gidParam = customStops.map(s => `gid=${encodeURIComponent(s.gid)}`).join('&');
      const res = await fetch(`/api/avg/departures/gid?${gidParam}`);
      const { data } = await res.json();
      for (const [gid, stopData] of Object.entries(data)) {
        const cs = customStops.find(s => s.gid === gid);
        if (cs) stopData.name = cs.name;
        departures[gid] = stopData;
      }
    }

    renderDepartures();
    updateSyncBar();
  } catch (err) {
    console.error('Avgångsfel:', err);
    updateSyncBar('Offline');
  }
}

function renderDepartures() {
  const container = document.getElementById('departure-list');
  if (!container) return;

  const stopData = departures[activeStopId];
  if (!stopData || !stopData.departures || stopData.departures.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Inga avgångar</h2>
        <p>${allStops.length === 0 && customStops.length === 0 ? 'Inga hållplatser konfigurerade' : 'Väntar på data...'}</p>
      </div>`;
    return;
  }

  // Egna hållplatser har inte notiser eller historik
  const isCustomStop = customStops.some(s => s.gid === activeStopId);

  container.innerHTML = '';
  stopData.departures.forEach(d => {
    const bgColor = d.bgColor || '#555';
    const fgColor = d.fgColor || '#fff';
    const scheduled = d.scheduledAt ? new Date(d.scheduledAt) : null;
    const timeStr = scheduled
      ? scheduled.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
      : '—';

    const delayMin = Math.round((d.delaySeconds || 0) / 60);
    let delayClass = 'delay-ok';
    let delayText = 'I tid';

    if (d.isCancelled) {
      delayClass = 'delay-cancelled';
      delayText = 'Inställd';
    } else if (delayMin >= 5) {
      delayClass = 'delay-major';
      delayText = `+${delayMin} min`;
    } else if (delayMin >= 2) {
      delayClass = 'delay-minor';
      delayText = `+${delayMin} min`;
    }

    // Nedräkning
    const now = Date.now();
    const effective = d.estimatedAt ? new Date(d.estimatedAt) : scheduled;
    const diffMin = effective ? Math.round((effective.getTime() - now) / 60_000) : null;
    let countdownText = '';
    if (diffMin !== null) {
      if (diffMin <= 0) countdownText = 'Nu';
      else if (diffMin === 1) countdownText = '1 min';
      else countdownText = `${diffMin} min`;
    }

    const isWatched = !isCustomStop && d.journeyId && watchedJourneys.has(d.journeyId);

    // Bevakningsknapp bara för förinställda hållplatser
    const watchBtnHtml = (!isCustomStop && d.journeyId)
      ? `<button class="watch-btn${isWatched ? ' active' : ''}" data-watch aria-label="${isWatched ? 'Sluta bevaka' : 'Bevaka'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${isWatched ? 'var(--accent)' : 'none'}" stroke="${isWatched ? 'var(--accent)' : 'currentColor'}" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </button>`
      : '';

    // Bygg row — data-attribut för klickhantering (undviker escaping-problem med inline onclick)
    const row = document.createElement('div');
    row.className = `departure-row${d.isCancelled ? ' cancelled' : ''}${isWatched ? ' watched' : ''}`;
    row.dataset.scheduled = d.scheduledAt || '';
    row.dataset.estimated = d.estimatedAt || '';
    if (d.journeyId) row.dataset.journey = d.journeyId;
    if (!isCustomStop) {
      row.dataset.stop = activeStopId;
      row.dataset.line = d.line;
      row.dataset.direction = d.direction || '';
    }

    row.innerHTML = `
        <div class="line-badge" style="background:${bgColor};color:${fgColor}">${esc(d.line)}</div>
        <div class="departure-info">
          <div class="departure-destination">${esc(d.direction)}</div>
          ${d.track ? `<div class="departure-track">Läge ${esc(d.track)}</div>` : ''}
        </div>
        <div class="departure-time">
          <div class="departure-scheduled">${timeStr}</div>
          <div class="departure-countdown">${countdownText}</div>
        </div>
        <div class="departure-delay ${delayClass}">${delayText}</div>
        ${watchBtnHtml}`;

    // Klickhanterare
    if (!isCustomStop) {
      row.querySelector('.departure-info').addEventListener('click', () => {
        showDepartureDetail(activeStopId, d.line, d.journeyId || '', d.direction || '');
      });
    }

    if (!isCustomStop && d.journeyId) {
      row.querySelector('[data-watch]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWatch(d.journeyId, activeStopId, d.line, d.direction || '', d.scheduledAt || '');
        renderDepartures();
      });
    }

    container.appendChild(row);
  });
}

function updateCountdowns() {
  const now = Date.now();
  document.querySelectorAll('.departure-countdown').forEach(el => {
    const row = el.closest('.departure-row');
    const estimated = row?.dataset.estimated || row?.dataset.scheduled;
    if (!estimated) return;

    const diff = Math.round((new Date(estimated).getTime() - now) / 60_000);
    if (diff <= 0) el.textContent = 'Nu';
    else if (diff === 1) el.textContent = '1 min';
    else el.textContent = `${diff} min`;
  });
}

function updateSyncBar(status) {
  const el = document.getElementById('sync-bar');
  if (!el) return;

  if (status) {
    el.textContent = status;
    return;
  }

  const now = new Date();
  el.textContent = `Uppdaterad ${now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
}

// === Settings ===

function toggleSettings() {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.toggle('hidden');
  document.body.classList.toggle('overlay-open', !overlay.classList.contains('hidden'));
  if (!overlay.classList.contains('hidden')) {
    renderWatchedList();
  }
}

function renderWatchedList() {
  const container = document.getElementById('watched-list');
  const wrapper = document.getElementById('watched-list-container');
  if (!container || !wrapper) return;

  if (watchedJourneys.size === 0) {
    wrapper.classList.add('hidden');
    return;
  }

  wrapper.classList.remove('hidden');

  // Hitta aktuella avgångar som matchar bevakade journeys
  const items = [];
  for (const stopId of Object.keys(departures)) {
    const stopData = departures[stopId];
    if (!stopData?.departures) continue;
    for (const d of stopData.departures) {
      if (d.journeyId && watchedJourneys.has(d.journeyId)) {
        const scheduled = d.scheduledAt ? new Date(d.scheduledAt) : null;
        const timeStr = scheduled
          ? scheduled.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
          : '?';
        items.push({ ...d, stopId, timeStr });
      }
    }
  }

  if (items.length === 0 && watchedJourneys.size > 0) {
    container.innerHTML = '<span style="font-size:0.78rem;color:var(--gray-500)">Bevakade avgångar har passerat</span>';
    return;
  }

  container.innerHTML = items.map(d => `
    <div class="watched-item">
      <span class="watched-line" style="background:${d.bgColor || 'var(--navy-600)'};color:${d.fgColor || '#fff'}">${esc(d.line)}</span>
      <span class="watched-info">${esc(d.direction)} ${d.timeStr}</span>
      <button class="watched-remove" onclick="toggleWatch('${esc(d.journeyId)}','${esc(d.stopId)}','${esc(d.line)}','${esc(d.direction || '')}','${esc(d.scheduledAt || '')}');renderWatchedList();" aria-label="Ta bort">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
}

function renderSettingsStops() {
  // Egna hållplatser (user-added)
  const customContainer = document.getElementById('custom-stops-list');
  if (customContainer) {
    let html = customStops.map(s => `
      <div class="settings-item">
        <span class="settings-label">${esc(s.name)}</span>
        <button class="remove-stop-btn" onclick="removeCustomStop('${esc(s.gid)}')" aria-label="Ta bort">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
    if (customStops.length > 0) {
      html += '<span style="font-size:0.72rem;color:var(--gray-500);display:block;padding:0.3rem 0.8rem;line-height:1.4;">Förseningsnotiser och linjehistorik är inte tillgängliga för egna hållplatser.</span>';
    }
    customContainer.innerHTML = html;
  }

  // Visa divider om det finns egna + förinställda
  const divider = document.getElementById('preset-stops-divider');
  if (divider) divider.classList.toggle('hidden', customStops.length === 0 || allStops.length === 0);

  // Förinställda hållplatser (admin-added)
  const container = document.getElementById('settings-stops-list');
  if (!container) return;

  container.innerHTML = allStops.map(s => {
    const selected = selectedStopIds.includes(s.id);
    return `
      <div class="settings-item">
        <span class="settings-label">${esc(s.name)}</span>
        <button class="toggle${selected ? ' active' : ''}" onclick="toggleStop('${esc(s.id)}')"></button>
      </div>`;
  }).join('');
}

function toggleStop(stopId) {
  const idx = selectedStopIds.indexOf(stopId);
  if (idx >= 0) {
    selectedStopIds.splice(idx, 1);
  } else {
    selectedStopIds.push(stopId);
  }
  localStorage.setItem('avg_stops', JSON.stringify(selectedStopIds));

  if (activeStopId === stopId && idx >= 0) {
    activeStopId = selectedStopIds[0] || null;
    localStorage.setItem('avg_active_stop', activeStopId || '');
  }

  renderStopTabs();
  renderSettingsStops();
  loadDepartures();
}

// === Hållplatssökning ===

function onStopSearch(query) {
  clearTimeout(searchDebounceTimer);
  const resultsEl = document.getElementById('stop-search-results');

  if (!query || query.length < 2) {
    if (resultsEl) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; }
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/avg/stops/search?q=${encodeURIComponent(query)}`);
      const { data } = await res.json();
      renderSearchResults(data);
    } catch (err) {
      console.error('Sökfel:', err);
    }
  }, 300);
}

function renderSearchResults(results) {
  const container = document.getElementById('stop-search-results');
  if (!container) return;

  if (!results || results.length === 0) {
    container.innerHTML = '<div class="search-result-empty">Inga resultat</div>';
    container.classList.remove('hidden');
    return;
  }

  const existingGids = new Set([
    ...allStops.map(s => s.stop_area_gid),
    ...customStops.map(s => s.gid),
  ]);

  container.innerHTML = results.map(s => {
    const displayName = s.name.replace(/, Göteborg$/i, '');
    const alreadyAdded = existingGids.has(s.gid);

    return `
      <div class="search-result-item${alreadyAdded ? ' disabled' : ''}"
           onclick="${alreadyAdded ? '' : `addCustomStop('${esc(s.gid)}','${esc(displayName)}')`}">
        <span class="search-result-name">${esc(displayName)}</span>
        ${alreadyAdded
          ? '<span class="search-result-badge">Tillagd</span>'
          : '<span class="search-result-add">+ Lägg till</span>'}
      </div>`;
  }).join('');

  container.classList.remove('hidden');
}

function addCustomStop(gid, name) {
  if (customStops.some(s => s.gid === gid)) return;
  customStops.push({ gid, name });
  localStorage.setItem('avg_custom_stops', JSON.stringify(customStops));

  // Logga favoritvalet till backend (statistik, fire-and-forget)
  fetch('/api/avg/stops/favorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gid, name }),
  }).catch(() => {});

  // Rensa sökningen
  const input = document.getElementById('stop-search-input');
  if (input) input.value = '';
  const results = document.getElementById('stop-search-results');
  if (results) { results.classList.add('hidden'); results.innerHTML = ''; }

  // Aktivera nya hållplatsen direkt
  activeStopId = gid;
  localStorage.setItem('avg_active_stop', gid);

  renderStopTabs();
  renderSettingsStops();
  loadDepartures();
}

function removeCustomStop(gid) {
  customStops = customStops.filter(s => s.gid !== gid);
  localStorage.setItem('avg_custom_stops', JSON.stringify(customStops));

  // Om borttagen var aktiv, byt till första tillgängliga
  if (activeStopId === gid) {
    const allValidIds = [...selectedStopIds, ...customStops.map(s => s.gid)];
    activeStopId = allValidIds[0] || null;
    localStorage.setItem('avg_active_stop', activeStopId || '');
  }

  renderStopTabs();
  renderSettingsStops();
  loadDepartures();
}

// Stäng sökresultat vid klick utanför
document.addEventListener('click', (e) => {
  const container = document.querySelector('.stop-search-container');
  const results = document.getElementById('stop-search-results');
  if (container && results && !container.contains(e.target)) {
    results.classList.add('hidden');
  }
});

function updateThreshold(value) {
  settings.delayThreshold = parseInt(value);
  localStorage.setItem('avg_threshold', value);
  document.getElementById('threshold-value').textContent = `${value} min`;

  // Uppdatera push-prenumeration om aktiv
  if (settings.notificationsEnabled) {
    updatePushSubscription();
  }
}

function updateSettingsUI() {
  const toggle = document.getElementById('notif-toggle');
  if (toggle) toggle.classList.toggle('active', settings.notificationsEnabled);

  const slider = document.getElementById('threshold-slider');
  if (slider) slider.value = settings.delayThreshold;

  const thresholdVal = document.getElementById('threshold-value');
  if (thresholdVal) thresholdVal.textContent = `${settings.delayThreshold} min`;

}

// === Push Notifications ===

async function toggleNotifications() {
  if (settings.notificationsEnabled) {
    settings.notificationsEnabled = false;
    localStorage.setItem('avg_notif', 'false');
    updateSettingsUI();
    await unsubscribePush();
    return;
  }

  // iOS Safari: push-notiser kräver installerad PWA (standalone)
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (isIos && !isStandalone) {
    showNotifStatus('Push-notiser kräver att appen är installerad på hemskärmen. Tryck på dela-knappen och "Lägg till på hemskärmen" först.');
    return;
  }

  // Kolla om Notification API finns
  if (!('Notification' in window)) {
    showNotifStatus('Din webbläsare stöder inte notiser');
    return;
  }

  if (!('PushManager' in window)) {
    showNotifStatus('Din webbläsare stöder inte push-notiser');
    return;
  }

  // Kolla om redan blockerade
  if (Notification.permission === 'denied') {
    showNotifStatus('Notiser är blockerade. Gå till webbläsarens inställningar → Webbplatsinnst. → Aviseringar och tillåt denna sida.');
    return;
  }

  // Visa förklaring innan vi frågar webbläsaren
  showNotifPrompt();
}

function showNotifPrompt() {
  const overlay = document.getElementById('notif-prompt-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    document.body.classList.add('overlay-open');
  }
}

function closeNotifPrompt() {
  const overlay = document.getElementById('notif-prompt-overlay');
  if (overlay) overlay.classList.add('hidden');
  // Stäng inte overlay-open om settings fortfarande är öppet
  if (document.getElementById('settings-overlay').classList.contains('hidden')) {
    document.body.classList.remove('overlay-open');
  }
}

async function confirmEnableNotifs() {
  // Inaktivera knappen för att förhindra dubbelklick
  const btn = document.getElementById('notif-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Väntar...'; }

  // KRITISKT: Begär tillstånd DIREKT i klickhanteraren (user gesture)
  // Stäng INTE overlayen först — det bryter gesture-kedjan på mobil
  const permission = await Notification.requestPermission();

  // Återställ knappen och stäng overlayen
  if (btn) { btn.disabled = false; btn.textContent = 'Tillåt notiser'; }
  closeNotifPrompt();

  if (permission !== 'granted') {
    if (permission === 'denied') {
      showNotifStatus('Du nekade notiser. Gå till webbläsarens inställningar → Webbplatsinnst. → Aviseringar och tillåt denna sida.');
    } else {
      showNotifStatus('Notiser avfärdade — du kan försöka igen senare.');
    }
    return;
  }

  settings.notificationsEnabled = true;
  localStorage.setItem('avg_notif', 'true');
  updateSettingsUI();
  showNotifStatus('Notiser aktiverade!', true);
  await subscribePush();

  // Återuppta väntande bevakning
  if (window._pendingWatch) {
    const w = window._pendingWatch;
    window._pendingWatch = null;
    toggleWatch(w.journeyId, w.stopId, w.lineName, w.direction, w.scheduledAt);
  }
}

function showNotifStatus(message, success = false) {
  const el = document.getElementById('notif-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = success ? 'var(--success)' : 'var(--warning)';
  el.classList.remove('hidden');
  if (success) setTimeout(() => el.classList.add('hidden'), 4000);
}

async function subscribePush() {
  try {
    // Hämta VAPID-nyckel
    const keyRes = await fetch('/api/avg/push/vapid-key');
    const { publicKey } = await keyRes.json();
    if (!publicKey) {
      console.warn('VAPID-nyckel saknas');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Registrera på servern
    await fetch('/api/avg/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        stopIds: selectedStopIds,
        delayThreshold: settings.delayThreshold * 60,
      }),
    });
  } catch (err) {
    console.error('Push-prenumeration misslyckades:', err);
  }
}

async function unsubscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/avg/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
  } catch (err) {
    console.error('Avregistrering misslyckades:', err);
  }
}

async function updatePushSubscription() {
  if (!settings.notificationsEnabled) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/avg/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          stopIds: selectedStopIds,
          delayThreshold: settings.delayThreshold * 60,
        }),
      });
    }
  } catch (err) {
    console.error('Uppdatering av prenumeration misslyckades:', err);
  }
}

// === Watch departures ===

async function getEndpoint() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub?.endpoint || null;
  } catch {
    return null;
  }
}

async function toggleWatch(journeyId, stopId, lineName, direction, scheduledAt) {
  // Säkerställ att notiser är aktiverade
  if (!settings.notificationsEnabled) {
    // Starta notis-flödet först
    if (!('Notification' in window)) {
      showNotifStatus('Din webbläsare stöder inte notiser');
      return;
    }
    if (Notification.permission === 'denied') {
      showNotifStatus('Notiser är blockerade. Gå till webbläsarens inställningar.');
      return;
    }
    showNotifPrompt();
    // Spara pending watch för att återuppta efter permission
    window._pendingWatch = { journeyId, stopId, lineName, direction, scheduledAt };
    return;
  }

  const endpoint = await getEndpoint();
  if (!endpoint) {
    showNotifStatus('Ingen push-prenumeration hittad — aktivera notiser först');
    return;
  }

  const isWatched = watchedJourneys.has(journeyId);

  try {
    if (isWatched) {
      await fetch('/api/avg/watch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, journeyId }),
      });
      watchedJourneys.delete(journeyId);
    } else {
      await fetch('/api/avg/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint,
          journeyId,
          stopId,
          lineName,
          direction,
          scheduledAt,
          delayThreshold: settings.delayThreshold * 60,
        }),
      });
      watchedJourneys.add(journeyId);
    }
    renderDepartures();
  } catch (err) {
    console.error('Watch toggle misslyckades:', err);
  }
}

async function loadWatched() {
  try {
    const endpoint = await getEndpoint();
    if (!endpoint) return;

    const res = await fetch(`/api/avg/watched?endpoint=${encodeURIComponent(endpoint)}`);
    const json = await res.json();
    const data = json.data || [];

    watchedJourneys = new Set(data.map(w => w.journey_id));
  } catch {
    // Ignorera — inte kritiskt
  }
}

// === Departure Detail ===

async function showDepartureDetail(stopId, lineName, journeyId, direction) {
  const overlay = document.getElementById('history-overlay');
  if (!overlay) return;

  document.getElementById('history-line-name').textContent = `${lineName} ${direction}`;
  document.getElementById('history-content').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');

  let html = '';

  // 1) Sträcka — alla hållplatser med tider
  if (journeyId) {
    try {
      const res = await fetch(`/api/avg/journey-details?stop=${encodeURIComponent(stopId)}&ref=${encodeURIComponent(journeyId)}`);
      const json = await res.json();
      const route = json.data;

      if (route && route.stops && route.stops.length > 0) {
        html += '<div class="hist-section-title">Sträcka</div>';
        html += '<div class="route-stops">';

        for (let i = 0; i < route.stops.length; i++) {
          const s = route.stops[i];
          const isFirst = i === 0;
          const isLast = i === route.stops.length - 1;

          // Välj tid att visa (ankomst förutom vid första = avgång)
          const planned = isFirst ? s.plannedDeparture : s.plannedArrival;
          const estimated = isFirst ? s.estimatedDeparture : s.estimatedArrival;

          const timeStr = planned
            ? new Date(planned).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
            : '';

          let delayStr = '';
          if (planned && estimated) {
            const diff = Math.round((new Date(estimated) - new Date(planned)) / 60000);
            if (diff > 0) delayStr = `+${diff}`;
          }

          // Markera användarens hållplats
          const isCurrentStop = s.gid === stopId ||
            (allStops.find(as => as.id === stopId)?.stop_area_gid === s.gid);

          html += `<div class="route-stop${isCurrentStop ? ' current' : ''}${s.isCancelled ? ' cancelled' : ''}">
            <div class="route-stop-dot">
              <div class="route-line-segment${isFirst ? ' first' : ''}${isLast ? ' last' : ''}"></div>
              <div class="route-dot${isCurrentStop ? ' current' : ''}"></div>
            </div>
            <div class="route-stop-name">${esc(s.name)}</div>
            <div class="route-stop-time">${timeStr}</div>
            ${delayStr ? `<div class="route-stop-delay">${delayStr}</div>` : ''}
          </div>`;
        }
        html += '</div>';
      }
    } catch (err) {
      console.error('Sträcka-fel:', err);
      html += '<div class="hist-empty" style="color:var(--gray-500)">Kunde inte ladda sträckan</div>';
    }
  }

  // 2) Journey-tracking — kompakt sammanfattning + tidslinje vid variation
  if (journeyId) {
    try {
      const res = await fetch(`/api/avg/departure-tracking?journey=${encodeURIComponent(journeyId)}&stop=${encodeURIComponent(stopId)}`);
      const json = await res.json();
      const tracking = json.data || [];

      if (tracking.length > 0) {
        const last = tracking[tracking.length - 1];
        const first = tracking[0];
        const lastDelay = last?.delay_seconds || 0;
        const firstDelay = first?.delay_seconds || 0;
        const minDelay = Math.min(...tracking.map(t => t.delay_seconds || 0));
        const maxDelay = Math.max(...tracking.map(t => t.delay_seconds || 0));
        const delayRange = maxDelay - minDelay;
        const isCancelled = last?.is_cancelled;
        const trend = lastDelay - firstDelay;
        const observations = tracking.length;

        const scheduledTime = last?.scheduled_at
          ? new Date(last.scheduled_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
          : '—';
        const estimatedTime = last?.estimated_at
          ? new Date(last.estimated_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
          : scheduledTime;
        const firstSeen = new Date(first.observed_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        const lastSeen = new Date(last.observed_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

        // Status + färg
        let statusText, statusColor;
        if (isCancelled) {
          statusText = 'Inställd'; statusColor = 'var(--error)';
        } else if (lastDelay >= 180) {
          statusText = `+${Math.round(lastDelay / 60)} min`; statusColor = 'var(--error)';
        } else if (lastDelay >= 60) {
          statusText = `+${Math.round(lastDelay / 60)} min`; statusColor = 'var(--warning)';
        } else if (lastDelay > 0) {
          statusText = `+${lastDelay}s`; statusColor = 'var(--success)';
        } else {
          statusText = 'I tid'; statusColor = 'var(--success)';
        }

        // Sammanfattningskort
        html += '<div class="hist-section-title">Denna avgång</div>';
        html += '<div class="detail-status-card">';
        html += `<div class="detail-status-badge" style="background:${statusColor}">${statusText}</div>`;
        html += '<div class="hist-summary" style="margin-top:0.6rem">';
        html += `<div class="hist-stat"><div class="hist-val">${scheduledTime}</div><div class="hist-label">Planerad</div></div>`;
        html += `<div class="hist-stat"><div class="hist-val accent">${estimatedTime}</div><div class="hist-label">Förväntad</div></div>`;

        // Trend
        if (trend > 30) html += `<div class="hist-stat"><div class="hist-val" style="color:var(--error)">+${Math.round(trend / 60)}m</div><div class="hist-label">Ökar</div></div>`;
        else if (trend < -30) html += `<div class="hist-stat"><div class="hist-val" style="color:var(--success)">${Math.round(trend / 60)}m</div><div class="hist-label">Minskar</div></div>`;
        else html += `<div class="hist-stat"><div class="hist-val" style="color:var(--gray-400)">Stabil</div><div class="hist-label">Trend</div></div>`;
        html += '</div>';

        // Mätningsinfo
        html += `<div class="detail-meta">${observations} mätningar (${firstSeen}–${lastSeen})</div>`;
        html += '</div>';

        // Visa tidslinje BARA om förseningen varierade (range > 30s)
        if (delayRange > 30) {
          html += '<div class="hist-section-title" style="margin-top:0.8rem">Försening över tid</div>';
          html += '<div class="tracking-timeline">';

          const absMax = Math.max(60, Math.abs(maxDelay), Math.abs(minDelay));

          // Sampla ner: visa max ~15 datapunkter (första, sista, jämnt fördelat)
          const maxPoints = 15;
          let sampled;
          if (tracking.length <= maxPoints) {
            sampled = tracking;
          } else {
            sampled = [tracking[0]];
            const step = (tracking.length - 1) / (maxPoints - 1);
            for (let i = 1; i < maxPoints - 1; i++) {
              sampled.push(tracking[Math.round(i * step)]);
            }
            sampled.push(tracking[tracking.length - 1]);
          }

          for (const t of sampled) {
            const time = new Date(t.observed_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
            const delaySec = t.delay_seconds || 0;
            const delayMin = Math.round(delaySec / 60);
            // Bara positiv delay ger bar-bredd
            const pct = delaySec > 0 ? Math.min(100, delaySec / absMax * 100) : 0;

            let barColor, valText;
            if (t.is_cancelled) {
              barColor = 'var(--error)'; valText = 'Inställd';
            } else if (delaySec >= 180) {
              barColor = 'var(--error)'; valText = `+${delayMin}m`;
            } else if (delaySec >= 60) {
              barColor = 'var(--warning)'; valText = `+${delayMin}m`;
            } else if (delaySec > 0) {
              barColor = 'var(--success)'; valText = `+${delaySec}s`;
            } else {
              barColor = 'var(--success)'; valText = 'I tid';
            }

            html += `<div class="tracking-row">
              <div class="tracking-time">${time}</div>
              <div class="tracking-bar-bg"><div class="tracking-bar" style="width:${Math.max(pct, 2)}%;background:${barColor}"></div></div>
              <div class="tracking-val">${valText}</div>
            </div>`;
          }

          html += '</div>';
        }
      } else {
        html += '<div class="hist-empty">Första mätningen — data byggs upp</div>';
      }
    } catch {
      html += '<div class="hist-empty">Kunde inte ladda tracking</div>';
    }
  } else {
    html += '<div class="hist-empty">Ingen journey-referens tillgänglig</div>';
  }

  // 2) Linjehistorik (aggregerad statistik)
  try {
    const res = await fetch(`/api/avg/line-history?stop=${encodeURIComponent(stopId)}&line=${encodeURIComponent(lineName)}`);
    const json = await res.json();
    const data = json.data || {};
    const summary = data.summary || {};
    const daily = data.daily || [];
    const recent = data.recent || [];

    if (daily.length > 0 || recent.length > 0) {
      html += '<div class="hist-section-title" style="margin-top:1rem">Linje ' + esc(lineName) + ' — statistik</div>';

      // Sammanfattning
      html += '<div class="hist-summary">';
      html += `<div class="hist-stat"><div class="hist-val accent">${summary.avg_on_time ?? '—'}%</div><div class="hist-label">Punktlighet</div></div>`;
      html += `<div class="hist-stat"><div class="hist-val">${summary.avg_delay != null ? `${Math.round(summary.avg_delay / 60)}m` : '—'}</div><div class="hist-label">Snittförsening</div></div>`;
      html += '</div>';

      // Dagliga bars
      if (daily.length > 0) {
        html += '<div class="hist-days">';
        for (const d of daily) {
          const pct = d.on_time_pct ?? 0;
          const barColor = pct >= 90 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--error)';
          const dayName = new Date(d.date).toLocaleDateString('sv-SE', { weekday: 'short' });
          html += `<div class="hist-day">
            <div class="hist-day-label">${dayName}</div>
            <div class="hist-bar-bg"><div class="hist-bar" style="width:${pct}%;background:${barColor}"></div></div>
            <div class="hist-day-pct">${Math.round(pct)}%</div>
          </div>`;
        }
        html += '</div>';
      }
    }
  } catch {
    // Linjehistorik misslyckades — visa ändå tracking ovan
  }

  if (!html) {
    html = '<div class="hist-empty">Ingen data ännu — byggs upp automatiskt</div>';
  }

  document.getElementById('history-content').innerHTML = html;
}

function closeHistory() {
  document.getElementById('history-overlay').classList.add('hidden');
  document.body.classList.remove('overlay-open');
}

// === Install ===

async function installApp() {
  if (!deferredPrompt) {
    // Fallback: visa instruktion
    alert('Installera via webbläsarmenyn:\n\nChrome: ⋮ → "Lägg till på startskärmen"\nSafari: ⬆ → "Lägg till på hemskärmen"');
    return;
  }
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('install-banner').classList.add('hidden');
    const installSection = document.getElementById('settings-install');
    if (installSection) installSection.classList.add('hidden');
  } catch {
    alert('Installera via webbläsarmenyn:\n\nChrome: ⋮ → "Lägg till på startskärmen"');
  }
}

function dismissInstall() {
  localStorage.setItem('avg_install_dismissed', 'true');
  document.getElementById('install-banner').classList.add('hidden');
  const iosBanner = document.getElementById('ios-install-banner');
  if (iosBanner) iosBanner.classList.add('hidden');
}

// === Helpers ===

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const array = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    array[i] = rawData.charCodeAt(i);
  }
  return array;
}

// === Start ===
init();
