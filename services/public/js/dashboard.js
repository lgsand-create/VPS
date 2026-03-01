// ======= Auth =======
let isLoggedIn = false;

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (data.authenticated) {
      isLoggedIn = true;
      document.getElementById('login-overlay')?.classList.add('hidden');
      const logoutBtn = document.getElementById('nav-logout');
      if (logoutBtn) logoutBtn.style.display = '';
      try { handleRoute(); } catch (e) { console.error('Route-fel vid auth:', e); }
    } else {
      document.getElementById('login-overlay')?.classList.remove('hidden');
      document.getElementById('login-user')?.focus();
    }
  } catch {
    // Auth-endpoint saknas (gammal server) — hoppa över auth
    isLoggedIn = true;
    document.getElementById('login-overlay')?.classList.add('hidden');
    try { handleRoute(); } catch (e) { console.error('Route-fel vid auth:', e); }
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  btn.disabled = true;
  btn.textContent = 'Loggar in...';
  errorEl.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (res.ok) {
      isLoggedIn = true;
      document.getElementById('login-overlay').classList.add('hidden');
      document.getElementById('nav-logout').style.display = '';
      try { handleRoute(); } catch {}
    } else {
      errorEl.textContent = data.error || 'Inloggning misslyckades';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    // Skilja nätverksfel (fetch) från DOM-fel (renderingen)
    if (err instanceof TypeError && err.message.includes('null')) {
      console.error('Login post-render error:', err);
      // Inloggningen lyckades troligen — ladda om
      window.location.reload();
      return;
    }
    errorEl.textContent = 'Nätverksfel: ' + err.message;
    errorEl.style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'Logga in';
}

async function handleLogout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  isLoggedIn = false;
  if (refreshTimer) clearInterval(refreshTimer);
  document.getElementById('nav-logout').style.display = 'none';
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-user').focus();
}

// Fånga 401 på system-anrop — visa login om session gått ut
const _origFetch = window.fetch;
window.fetch = async function(url, ...args) {
  const res = await _origFetch.call(this, url, ...args);
  if (res.status === 401 && isLoggedIn && typeof url === 'string' && url.startsWith('/api/system')) {
    isLoggedIn = false;
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('nav-logout').style.display = 'none';
  }
  return res;
};

// ======= State =======
let projects = {};
let currentProject = null;
let refreshTimer = null;
let createdKeyValue = '';

// ======= Projekt-metadata (API-endpoints per projekt) =======
const PROJECT_ENDPOINTS = {
  minridskola: [
    { label: 'Statistik', path: '/stats' },
    { label: 'Kurser', path: '/courses' },
    { label: 'Ryttare', path: '/riders' },
    { label: 'Hästar', path: '/horses' },
    { label: 'Veckor', path: '/weeks' },
    { label: 'Närvaro', path: '/attendance?limit=20' },
    { label: 'Ändringar', path: '/changes?limit=20' },
    { label: 'Ändr.sammanfattning', path: '/changes/summary' },
  ],
  laget: [
    { label: 'Statistik', path: '/stats' },
    { label: 'Lag', path: '/teams' },
    { label: 'Aktiviteter', path: '/activities?limit=20' },
    { label: 'Medlemmar', path: '/members' },
    { label: 'Ändringar', path: '/changes?limit=20' },
  ],
  nyheter: [
    { label: 'Statistik', path: '/stats' },
    { label: 'Artiklar', path: '/articles?limit=20' },
  ],
  bgcheck: [
    { label: 'Statistik', path: '/stats' },
    { label: 'Status', path: '/status' },
    { label: 'Logg', path: '/log?limit=10' },
  ],
  vasttrafik: [
    { label: 'Statistik', path: '/stats' },
    { label: 'Hållplatser', path: '/stops' },
    { label: 'Avgångar (live)', path: '/departures/live' },
    { label: 'Förseningar (7d)', path: '/departures/delays?period=7d' },
  ],
  sportanalys: [
    { label: 'Statistik', path: '/stats' },
    { label: 'Health', path: '/health' },
    { label: 'Jobb', path: '/jobs' },
  ],
  mailwise: [
    { label: 'Statistik', path: '/stats' },
    { label: 'Brevlådor', path: '/mailboxes' },
    { label: 'Meddelanden', path: '/messages?limit=10' },
    { label: 'FAQ', path: '/faqs?limit=10' },
    { label: 'Jobb', path: '/jobs?limit=10' },
    { label: 'Diagnostik', path: '/diagnostics' },
  ],
};

const HUB_ENDPOINTS = [
  { label: 'Hub', url: '/api' },
  { label: 'Projekt', url: '/api/system/projects' },
  { label: 'CRON-logg', url: '/api/system/scrape-log' },
  { label: 'API-nycklar', url: '/api/system/keys' },
  { label: 'Scheman', url: '/api/system/schedules' },
  { label: 'Health', url: '/api/system/health' },
];

// Planerade projekt (visas som nedtonade kort)
// Projekt som döljs från projekt-griden (visas på annat sätt, t.ex. under Sajter)
const HIDDEN_PROJECTS = ['monitor'];

// ======= Routing =======
function navigate(hash) {
  window.location.hash = hash ? `/${hash}` : '';
}

function handleRoute() {
  const hash = window.location.hash.replace('#/', '').replace('#', '');

  // Rensa timer
  if (refreshTimer) clearInterval(refreshTimer);

  // Dölj alla vyer
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Uppdatera nav-knappar
  document.getElementById('nav-settings')?.classList.remove('active');
  document.getElementById('nav-tools')?.classList.remove('active');

  if (hash === 'tools' || hash === 'keys') {
    showToolsView();
  } else if (hash === 'settings') {
    showSettingsView();
  } else if (hash.match(/^keys\/\d+\/usage$/)) {
    const keyId = hash.split('/')[1];
    showKeyUsageView(keyId);
  } else if (hash.startsWith('machine/')) {
    showMachineView(hash.split('/')[1]);
  } else if (hash.startsWith('site/')) {
    showMonitorSiteView(hash.split('/')[1]);
  } else if (hash === 'vasttrafik') {
    showVasttrafikView();
  } else if (hash === 'sportanalys') {
    showSportanalysView();
  } else if (hash === 'mailwise') {
    showMailwiseView();
  } else if (hash && hash !== '') {
    showProjectView(hash);
  } else {
    showHubView();
  }
}

window.addEventListener('hashchange', handleRoute);

// ======= Hub-vy =======
function showHubView() {
  document.getElementById('view-hub').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = '';
  document.title = 'Compuna Hub';
  currentProject = null;

  loadMonitorSites();
  loadMonitorMachines();
  loadProjects();

  refreshTimer = setInterval(() => {
    loadMonitorSites();
    loadMonitorMachines();
    loadProjects();
  }, 30000);
}

async function loadProjects() {
  try {
    const res = await fetch('/api/system/projects');
    const { data } = await res.json();

    const grid = document.getElementById('project-grid');
    let html = '';

    const visible = data.filter(p => !HIDDEN_PROJECTS.includes(p.id));

    for (const p of visible) {
      projects[p.id] = p;
      html += `
        <div class="project-card" style="border-left-color: ${p.color || '#3b9eff'}"
             onclick="navigate('${p.id}')" id="pcard-${p.id}">
          <h3>${p.name}</h3>
          <div class="desc">${p.description || ''}</div>
          <div class="project-stats" id="pstats-${p.id}"></div>
          <div class="last-run" id="prun-${p.id}">—</div>
        </div>
      `;
    }

    grid.innerHTML = html;

    // Ladda projekt-stats asynkront
    for (const p of visible) {
      loadProjectCardStats(p.id);
      loadProjectCardLastRun(p.id);
    }
  } catch {
    document.getElementById('project-grid').innerHTML =
      '<div class="card"><h3>Fel</h3><div class="sub">Kunde inte hämta projekt</div></div>';
  }
}

// Per-projekt kort-stats: vilka fält som visas på projektkortet
const PROJECT_CARD_STATS = {
  minridskola: [
    { key: 'kurser', label: 'Kurser' },
    { key: 'ryttare', label: 'Ryttare' },
    { key: 'veckor', label: 'Veckor' },
    { key: 'narvarograd', label: 'Närvaro', suffix: '%' },
  ],
  laget: [
    { key: 'aktiviteter', label: 'Aktiviteter' },
    { key: 'lag', label: 'Lag' },
    { key: 'unika_deltagare', label: 'Spelare' },
    { key: 'lok_aktiviteter', label: 'LOK' },
  ],
  nyheter: [
    { key: 'antal_artiklar', label: 'Artiklar' },
    { key: 'totala_visningar', label: 'Visningar' },
    { key: 'antal_forfattare', label: 'Författare' },
    { key: 'totala_kommentarer', label: 'Kommentarer' },
  ],
  bgcheck: [
    { key: 'verifieringar', label: 'Verifieringar' },
    { key: 'lyckade', label: 'Lyckade' },
    { key: 'idag', label: 'Idag' },
  ],
  vasttrafik: [
    { key: 'aktiva_hallplatser', label: 'Hållplatser' },
    { key: 'i_tid_pct', label: 'Punktlighet', suffix: '%' },
    { key: 'avgangar_24h', label: 'Avgångar 24h' },
    { key: 'installda_24h', label: 'Inställda' },
  ],
  sportanalys: [
    { key: 'totalt', label: 'Jobb' },
    { key: 'klara', label: 'Klara' },
    { key: 'bearbetar', label: 'Bearbetar' },
    { key: 'misslyckade', label: 'Misslyckade' },
  ],
  mailwise: [
    { key: 'active_mailboxes', label: 'Brevlådor' },
    { key: 'total_messages', label: 'Meddelanden' },
    { key: 'faqs_approved', label: 'FAQ' },
    { key: 'messages_24h', label: 'Nya 24h' },
  ],
};

async function loadProjectCardStats(projectId) {
  try {
    const res = await fetch(`/api/${projectId}/stats`);
    if (!res.ok) throw new Error('Stats ej tillgängliga');
    const { data } = await res.json();
    const el = document.getElementById(`pstats-${projectId}`);
    if (!el) return;

    const fields = PROJECT_CARD_STATS[projectId];
    if (fields) {
      el.innerHTML = fields.map(f =>
        `<div class="stat"><div class="val">${data[f.key] ?? '—'}${f.suffix || ''}</div><div class="lbl">${f.label}</div></div>`
      ).join('');
    } else {
      // Fallback: visa första 4 numeriska fält
      const entries = Object.entries(data).filter(([k, v]) => typeof v === 'number' && !k.includes('senaste')).slice(0, 4);
      el.innerHTML = entries.map(([k, v]) =>
        `<div class="stat"><div class="val">${v}</div><div class="lbl">${k}</div></div>`
      ).join('');
    }
  } catch {
    const el = document.getElementById(`pstats-${projectId}`);
    if (el) el.innerHTML = '<span style="color:#94a3b8;font-size:0.85rem">Stats ej tillgängliga</span>';
  }
}

async function loadProjectCardLastRun(projectId) {
  try {
    const res = await fetch(`/api/system/scrape-log?project=${projectId}&limit=1`);
    const { data } = await res.json();
    const el = document.getElementById(`prun-${projectId}`);
    if (!el || data.length === 0) return;

    const row = data[0];
    const when = new Date(row.started_at).toLocaleString('sv-SE');
    const cls = row.status === 'success' ? 'ok' : row.status === 'failed' ? 'fail' : '';
    el.innerHTML = `Senaste körning: <span class="${cls}">${row.status}</span> — ${when}`;
  } catch { /* ignore */ }
}

async function loadHubCronLog() {
  try {
    const res = await fetch('/api/system/scrape-log?limit=15');
    const { data } = await res.json();
    const tbody = document.getElementById('hub-cron-body');

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">Inga körningar ännu</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(row => {
      const started = new Date(row.started_at).toLocaleString('sv-SE');
      const duration = row.finished_at
        ? Math.round((new Date(row.finished_at) - new Date(row.started_at)) / 1000) + 's'
        : '—';
      const isStale = row.status === 'running' && !row.finished_at
        && (Date.now() - new Date(row.started_at).getTime()) > 600000;
      const statusLabel = isStale ? 'running (stale)' : row.status;
      const statusClass = isStale ? 'status-failed' : `status-${row.status}`;
      const project = row.project || 'okänt';
      const color = projects[project]?.color || '#888';
      const errorMsg = row.error_message
        ? escapeHtml(row.error_message.length > 80 ? row.error_message.slice(0, 80) + '...' : row.error_message)
        : '—';
      const errorTitle = row.error_message ? `title="${escapeHtml(row.error_message)}"` : '';

      return `<tr>
        <td>${started}</td>
        <td><span class="project-badge" style="background:${color}">${project}</span></td>
        <td>${row.scraper}</td>
        <td><span class="status ${statusClass}">${statusLabel}</span></td>
        <td>${row.records || 0}</td>
        <td>${duration}</td>
        <td style="font-size:0.8rem;color:#ef4444;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" ${errorTitle}>${errorMsg}</td>
      </tr>`;
    }).join('');
  } catch {
    document.getElementById('hub-cron-body').innerHTML =
      '<tr><td colspan="7">Kunde inte hämta logg</td></tr>';
  }
}

function renderHubEndpoints() {
  const el = document.getElementById('hub-endpoints');
  el.innerHTML = '';
  for (const ep of HUB_ENDPOINTS) {
    const btn = document.createElement('button');
    btn.className = 'endpoint-btn';
    btn.textContent = ep.label;
    btn.onclick = () => {
      document.getElementById('hub-url-input').value = ep.url;
      el.querySelectorAll('.endpoint-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fetchApi('hub');
    };
    el.appendChild(btn);
  }
}

// ======= Projekt-detaljvy =======
function showProjectView(projectId) {
  document.getElementById('view-project').classList.add('active');
  currentProject = projectId;

  const p = projects[projectId];
  const name = p?.name || projectId;
  document.getElementById('breadcrumb').innerHTML = `/ <span>${name}</span>`;
  document.title = `${name} — Compuna Hub`;

  loadProjectStats(projectId);
  loadProjectTeams(projectId);
  loadProjectSchedules(projectId);
  loadProjectCronLog(projectId);
  loadProjectChanges(projectId);
  initActivityViewer(projectId);
  initArticleViewer(projectId);
  initBgcheckViewer(projectId);
  renderProjectEndpoints(projectId);
  loadProjectDocs(projectId);

  refreshTimer = setInterval(() => {
    loadProjectStats(projectId);
    loadProjectCronLog(projectId);
    loadProjectChanges(projectId);
  }, 30000);
}

// Per-projekt detaljstats: vilka fält som visas i projektdetaljvyn
const PROJECT_DETAIL_STATS = {
  minridskola: [
    { key: 'veckor', label: 'Veckor' },
    { key: 'kurser', label: 'Kurser' },
    { key: 'ryttare', label: 'Ryttare' },
    { key: 'hastar', label: 'Hästar' },
    { key: 'narvarograd', label: 'Närvarograd', suffix: '%', sub: d => `${d.narvarande} av ${d.aktiva_platser} platser` },
    { key: 'avbokade', label: 'Avbokade', sub: d => `av ${d.bokningar} bokningar` },
  ],
  laget: [
    { key: 'aktiviteter', label: 'Aktiviteter' },
    { key: 'lag', label: 'Lag' },
    { key: 'lok_aktiviteter', label: 'LOK-aktiviteter' },
    { key: 'unika_deltagare', label: 'Unika spelare' },
    { key: 'unika_ledare', label: 'Unika ledare' },
    { key: 'totalt_deltar', label: 'Deltar' },
    { key: 'totalt_deltar_ej', label: 'Deltar ej' },
    { key: 'totalt_ej_svarat', label: 'Ej svarat' },
    { key: 'totalt_ej_kallad', label: 'Ej kallad' },
    { key: 'totalt_schemalagd', label: 'Schemalagd' },
  ],
  nyheter: [
    { key: 'antal_artiklar', label: 'Artiklar' },
    { key: 'totala_visningar', label: 'Visningar' },
    { key: 'totala_kommentarer', label: 'Kommentarer' },
    { key: 'antal_forfattare', label: 'Författare' },
    { key: 'senaste_artikel', label: 'Senaste artikel' },
    { key: 'aldsta_artikel', label: 'Äldsta artikel' },
  ],
  bgcheck: [
    { key: 'verifieringar', label: 'Verifieringar' },
    { key: 'lyckade', label: 'Äkta' },
    { key: 'misslyckade', label: 'Ej äkta' },
    { key: 'ej_kontrollerade', label: 'Ej kontrollerade' },
    { key: 'fel', label: 'Fel' },
    { key: 'snitt_ms', label: 'Svarstid', suffix: 'ms' },
    { key: 'idag', label: 'Idag' },
  ],
};

async function loadProjectStats(projectId) {
  try {
    const res = await fetch(`/api/${projectId}/stats`);
    if (!res.ok) throw new Error('Stats ej tillgängliga');
    const { data } = await res.json();

    const color = projects[projectId]?.color || '#3b9eff';
    const fields = PROJECT_DETAIL_STATS[projectId];

    if (fields) {
      document.getElementById('project-stats-grid').innerHTML = fields.map(f => {
        const val = data[f.key] ?? '—';
        const subText = f.sub ? f.sub(data) : '';
        return `
          <div class="card">
            <h3>${f.label}</h3>
            <div class="value" style="color:${color}">${val}${f.suffix || ''}</div>
            ${subText ? `<div class="sub">${subText}</div>` : ''}
          </div>
        `;
      }).join('');
    } else {
      // Fallback: visa alla numeriska fält
      const entries = Object.entries(data).filter(([k, v]) => typeof v === 'number').slice(0, 6);
      document.getElementById('project-stats-grid').innerHTML = entries.map(([k, v]) => `
        <div class="card">
          <h3>${k}</h3>
          <div class="value" style="color:${color}">${v}</div>
        </div>
      `).join('');
    }
  } catch {
    document.getElementById('project-stats-grid').innerHTML =
      '<div class="card"><h3>Fel</h3><div class="value">—</div><div class="sub">Kunde inte hämta statistik</div></div>';
  }
}

async function loadProjectCronLog(projectId) {
  try {
    const res = await fetch(`/api/system/scrape-log?project=${projectId}&limit=15`);
    const { data } = await res.json();
    const tbody = document.getElementById('project-cron-body');

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Inga körningar ännu</td></tr>';
      return;
    }

    // Filtrera bort interna importsteg — visa bara schema-körningar
    const importFormats = new Set(['scrape', 'avprickning', 'historik', 'summary']);
    const rows = data.filter(r => !importFormats.has(r.scraper));

    // Fallback för gamla loggposter (innan labeln sparades)
    const legacyLabels = { 'cron-quick': 'Snabb', 'cron-full': 'Fullscan' };

    tbody.innerHTML = rows.map(row => {
      const started = new Date(row.started_at).toLocaleString('sv-SE');
      const duration = row.finished_at
        ? Math.round((new Date(row.finished_at) - new Date(row.started_at)) / 1000) + 's'
        : '\u2014';
      const label = legacyLabels[row.scraper] || row.scraper;
      return `<tr>
        <td>${started}</td>
        <td>${escapeHtml(label)}</td>
        <td><span class="status status-${row.status}">${row.status}</span></td>
        <td>${row.records || 0}</td>
        <td>${duration}</td>
        <td>${row.error_message ? escapeHtml(row.error_message.slice(0, 60)) + '...' : '\u2014'}</td>
      </tr>`;
    }).join('');
  } catch {
    document.getElementById('project-cron-body').innerHTML =
      '<tr><td colspan="6">Kunde inte hämta logg</td></tr>';
  }
}

// Per-projekt ändringsrendering
const PROJECT_CHANGES_CONFIG = {
  minridskola: {
    headers: ['Upptäckt', 'Ryttare', 'Kurs', 'Vecka', 'Fält', 'Gammalt', 'Nytt'],
    fieldLabels: { avbokad: 'Avbokning', narvaro: 'Närvaro', hast: 'Häst', bokning: 'Bokning' },
    renderRow(row) {
      const detected = new Date(row.detected_at).toLocaleString('sv-SE');
      const field = this.fieldLabels[row.field_name] || row.field_name;
      let oldVal = row.old_value ?? '—';
      let newVal = row.new_value ?? '—';
      if (row.field_name === 'avbokad' || row.field_name === 'narvaro') {
        oldVal = oldVal === 'true' ? 'Ja' : oldVal === 'false' ? 'Nej' : oldVal;
        newVal = newVal === 'true' ? 'Ja' : newVal === 'false' ? 'Nej' : newVal;
      }
      return `<tr>
        <td>${detected}</td>
        <td>${row.ryttare || row.rider_id}</td>
        <td>${row.kursnamn || row.lnummer || '—'}</td>
        <td>${row.vecka || '—'}</td>
        <td>${field}</td>
        <td>${oldVal}</td>
        <td>${newVal}</td>
      </tr>`;
    },
  },
  laget: {
    headers: ['Tidpunkt', 'Medlem', 'Aktivitet', 'Lag', 'Fält', 'Före', 'Efter'],
    fieldLabels: { status: 'Status', roll: 'Roll', lok_aktivitet: 'LOK', kommentar: 'Kommentar' },
    renderRow(row) {
      const created = new Date(row.created_at).toLocaleString('sv-SE');
      const field = this.fieldLabels[row.field_name] || row.field_name;
      const activity = row.datum ? `${row.datum} ${row.typ || ''}` : '—';
      return `<tr>
        <td>${created}</td>
        <td>${row.medlem || '—'}</td>
        <td>${activity}</td>
        <td>${row.lag_namn || '—'}</td>
        <td>${field}</td>
        <td>${row.old_value ?? '—'}</td>
        <td>${row.new_value ?? '—'}</td>
      </tr>`;
    },
  },
};

async function loadProjectChanges(projectId) {
  try {
    const res = await fetch(`/api/${projectId}/changes?limit=25`);
    if (!res.ok) throw new Error();
    const { data } = await res.json();

    const table = document.getElementById('project-changes-table');
    const empty = document.getElementById('project-changes-empty');
    const thead = table.querySelector('thead tr');
    const tbody = document.getElementById('project-changes-body');

    if (!data || data.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    const config = PROJECT_CHANGES_CONFIG[projectId];
    if (config) {
      thead.innerHTML = config.headers.map(h => `<th>${h}</th>`).join('');
      tbody.innerHTML = data.map(row => config.renderRow(row)).join('');
    } else {
      // Fallback: generisk rendering
      thead.innerHTML = '<th>Tidpunkt</th><th>Fält</th><th>Före</th><th>Efter</th>';
      tbody.innerHTML = data.map(row => {
        const time = new Date(row.detected_at || row.created_at).toLocaleString('sv-SE');
        return `<tr><td>${time}</td><td>${row.field_name}</td><td>${row.old_value ?? '—'}</td><td>${row.new_value ?? '—'}</td></tr>`;
      }).join('');
    }
  } catch {
    document.getElementById('project-changes-table').style.display = 'none';
    document.getElementById('project-changes-empty').style.display = 'block';
  }
}

function renderProjectEndpoints(projectId) {
  const el = document.getElementById('project-endpoints');
  const input = document.getElementById('project-url-input');
  el.innerHTML = '';

  const endpoints = PROJECT_ENDPOINTS[projectId] || [];
  const base = `/api/${projectId}`;

  for (const ep of endpoints) {
    const btn = document.createElement('button');
    btn.className = 'endpoint-btn';
    btn.textContent = ep.label;
    btn.onclick = () => {
      input.value = base + ep.path;
      el.querySelectorAll('.endpoint-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fetchApi('project');
    };
    el.appendChild(btn);
  }

  input.value = base + '/stats';
}

// ======= Lag-hantering (per-projekt team toggles) =======

async function loadProjectTeams(projectId) {
  const section = document.getElementById('project-teams-section');
  const grid = document.getElementById('project-teams-grid');
  const countEl = document.getElementById('project-teams-count');

  try {
    const res = await fetch(`/api/${projectId}/teams`);
    if (!res.ok) { section.style.display = 'none'; return; }
    const { data } = await res.json();

    if (!data || data.length === 0) { section.style.display = 'none'; return; }

    const active = data.filter(t => t.aktiv);
    countEl.textContent = `(${active.length}/${data.length} aktiva)`;

    grid.innerHTML = data.map(t => `
      <div class="team-item ${t.aktiv ? '' : 'inactive'}" id="team-${t.id}">
        <span class="team-name" title="${t.slug || ''}">${t.namn}</span>
        <label class="team-toggle">
          <input type="checkbox" ${t.aktiv ? 'checked' : ''} onchange="toggleTeam('${projectId}', '${t.id}', this.checked)">
          <span class="slider"></span>
        </label>
      </div>
    `).join('');

    section.style.display = '';
  } catch {
    section.style.display = 'none';
  }
}

async function toggleTeam(projectId, teamId, aktiv) {
  const item = document.getElementById(`team-${teamId}`);
  try {
    const res = await fetch(`/api/${projectId}/teams/${teamId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktiv }),
    });
    if (!res.ok) throw new Error();
    item.classList.toggle('inactive', !aktiv);

    // Uppdatera räknaren
    const items = document.querySelectorAll('.team-item');
    const activeCount = document.querySelectorAll('.team-item:not(.inactive)').length;
    document.getElementById('project-teams-count').textContent = `(${activeCount}/${items.length} aktiva)`;
  } catch {
    // Återställ checkbox vid fel
    const cb = item.querySelector('input[type="checkbox"]');
    cb.checked = !aktiv;
  }
}

// ======= API-dokumentation =======

const docsCache = {};

async function loadProjectDocs(projectId) {
  const section = document.getElementById('project-docs-section');
  const content = document.getElementById('project-docs-content');

  try {
    const url = `/docs/${projectId}-api.md`;
    if (!docsCache[projectId]) {
      const res = await fetch(url);
      if (!res.ok) { section.style.display = 'none'; return; }
      const text = await res.text();
      // Skydda mot SPA-fallback (server returnerar index.html istället för .md)
      if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html')) {
        section.style.display = 'none'; return;
      }
      docsCache[projectId] = text;
    }
    content.innerHTML = renderMarkdown(docsCache[projectId]);
    section.style.display = '';
    // Auto-expandera docs vid laddning
    document.querySelector('.docs-toggle').classList.add('open');
    document.getElementById('project-docs-body').classList.add('open');
  } catch (err) {
    console.error('loadProjectDocs fel:', err);
    section.style.display = 'none';
  }
}

function toggleDocs() {
  const toggle = document.querySelector('.docs-toggle');
  const body = document.getElementById('project-docs-body');
  toggle.classList.toggle('open');
  body.classList.toggle('open');
}

// Enkel markdown → HTML-renderare (inga externa beroenden)
function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inCode = false;
  let inTable = false;
  let inList = false;
  let listType = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Kodblock
    if (line.startsWith('```')) {
      if (inCode) {
        html += '</code></pre>';
        inCode = false;
      } else {
        inCode = true;
        html += '<pre><code>';
      }
      continue;
    }
    if (inCode) {
      html += esc(line) + '\n';
      continue;
    }

    // Tom rad — stäng lista
    if (line.trim() === '') {
      if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
      if (inTable) { html += '</tbody></table>'; inTable = false; }
      html += '\n';
      continue;
    }

    // Horisontell linje
    if (/^-{3,}$/.test(line.trim())) {
      html += '<hr>';
      continue;
    }

    // Rubriker
    const hMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      html += `<h${level}>${inline(hMatch[2])}</h${level}>`;
      continue;
    }

    // Tabell
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      // Separator-rad
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!inTable) {
        inTable = true;
        html += '<table><thead><tr>' + cells.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      } else {
        html += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
      }
      continue;
    }

    // Lista
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (ulMatch || olMatch) {
      const content = ulMatch ? ulMatch[2] : olMatch[2];
      const type = ulMatch ? 'ul' : 'ol';
      if (!inList || listType !== type) {
        if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
        html += type === 'ul' ? '<ul>' : '<ol>';
        inList = true;
        listType = type;
      }
      html += `<li>${inline(content)}</li>`;
      continue;
    }

    // Stäng tabell om vi lämnar den
    if (inTable) { html += '</tbody></table>'; inTable = false; }

    // Paragraf
    html += `<p>${inline(line)}</p>`;
  }

  if (inCode) html += '</code></pre>';
  if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
  if (inTable) html += '</tbody></table>';
  return html;
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// ======= CRON-scheman (projekt-vy) =======

// Enkla presets (utan dag/natt-uppdelning)
const CRON_PRESETS_SIMPLE = [
  { label: 'Var 5 min', cron: '*/5 * * * *' },
  { label: 'Var 10 min', cron: '*/10 * * * *' },
  { label: 'Var 15 min', cron: '*/15 * * * *' },
  { label: 'Var 30 min', cron: '*/30 * * * *' },
  { label: 'Varje timme', cron: '0 * * * *' },
  { label: 'Var 2:a timme', cron: '0 */2 * * *' },
  { label: 'Kl 03:00 dagligen', cron: '0 3 * * *' },
  { label: '1:a varje månad kl 03', cron: '0 3 1 * *' },
];

// Dag+natt presets — byggs dynamiskt baserat på nattläge-timmar
const CRON_PRESETS_DAYNIGHT = [
  { label: '15 min dag + 1h natt', dayInterval: '*/15', nightInterval: '0' },
  { label: '10 min dag + 1h natt', dayInterval: '*/10', nightInterval: '0' },
  { label: '15 min dag + 2h natt', dayInterval: '*/15', nightInterval: '0', nightStep: 2 },
  { label: '5 min dag + 30 min natt', dayInterval: '*/5', nightInterval: '*/30' },
];

/**
 * Bygg natt-timmarna som cron hour-range, t.ex. "23,0-4" från start=23 end=5
 */
function buildNightHours(nightStart, nightEnd) {
  if (nightStart > nightEnd) {
    // Wraps midnight: t.ex. 23-5 → "23,0-4" (end-1 eftersom cron hour är inklusive)
    const parts = [];
    if (nightStart <= 23) parts.push(nightStart === 23 ? '23' : `${nightStart}-23`);
    if (nightEnd > 0) parts.push(nightEnd === 1 ? '0' : `0-${nightEnd - 1}`);
    return parts.join(',');
  }
  // Inom samma dag (ovanligt men stöds)
  return `${nightStart}-${nightEnd - 1}`;
}

/**
 * Bygg komplett dag+natt cron-uttryck från preset + valda timmar
 */
function buildDayNightCron(preset, nightStart, nightEnd) {
  const dayStart = nightEnd;                          // Dag börjar när natt slutar
  const dayEnd = (nightStart - 1 + 24) % 24;         // Dag slutar timmen innan natt börjar (wrap-safe)
  const dayHours = `${dayStart}-${dayEnd}`;
  const nightHours = buildNightHours(nightStart, nightEnd);

  const dayCron = `${preset.dayInterval} ${dayHours} * * *`;

  let nightCron;
  if (preset.nightStep && preset.nightStep > 1) {
    // Specifika timmar, t.ex. var 2:a timme: "0 23,1,3 * * *"
    const hours = [];
    for (let h = nightStart; ; h = (h + preset.nightStep) % 24) {
      hours.push(h);
      if (((h + preset.nightStep) % 24) === nightEnd || hours.length > 12) break;
    }
    nightCron = `0 ${hours.join(',')} * * *`;
  } else {
    nightCron = `${preset.nightInterval} ${nightHours} * * *`;
  }

  return `${dayCron};${nightCron}`;
}

// Legacy: bygg CRON_PRESETS med default nattläge 21-07
const CRON_PRESETS = [
  ...CRON_PRESETS_SIMPLE,
  ...CRON_PRESETS_DAYNIGHT.map(p => ({
    label: p.label,
    cron: buildDayNightCron(p, 21, 7),
  })),
];

// Beskrivningar per enskilt uttryck
const CRON_DESCRIPTIONS = {
  '*/5 * * * *': 'Var 5:e minut',
  '*/10 * * * *': 'Var 10:e minut',
  '*/15 * * * *': 'Var 15:e minut',
  '*/30 * * * *': 'Var 30:e minut',
  '0 * * * *': 'Varje hel timme',
  '0 */2 * * *': 'Varannan timme',
  '0 3 * * *': 'Dagligen kl 03:00',
  '0 3 1 * *': '1:a varje m\u00e5nad kl 03:00',
  '*/5 7-20 * * *': 'Var 5:e min (07\u201321)',
  '*/10 7-20 * * *': 'Var 10:e min (07\u201321)',
  '*/15 7-20 * * *': 'Var 15:e min (07\u201321)',
  '*/30 21-23,0-6 * * *': 'Var 30:e min (21\u201307)',
  '0 21-23,0-6 * * *': 'Varje timme (21\u201307)',
};

/**
 * Beskriv ett enskilt cron-uttryck på svenska.
 * Hanterar både kända presets och dynamiska dag/natt-uttryck.
 */
function describeSingleCron(expr) {
  // Kolla kända beskrivningar först
  if (CRON_DESCRIPTIONS[expr]) return CRON_DESCRIPTIONS[expr];

  // Dynamisk tolkning: "*/15 5-22 * * *" → "Var 15:e min (05–23)"
  const m = expr.match(/^(\*\/?\d*|\d+)\s+(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\s+\*\s+\*\s+\*$/);
  if (m) {
    const interval = m[1];
    const hours = m[2];
    let desc = '';
    if (interval === '0') desc = 'Varje timme';
    else if (interval.startsWith('*/')) desc = `Var ${interval.slice(2)}:e min`;
    else desc = `Kl ${interval}:00`;

    // Räkna ut timvisning
    const hourParts = hours.split(',');
    if (hourParts.length === 1 && hours.includes('-')) {
      const [s, e] = hours.split('-').map(Number);
      desc += ` (${String(s).padStart(2,'0')}\u2013${String(e + 1).padStart(2,'0')})`;
    } else {
      desc += ` (${hours.replace(/,/g, ', ')})`;
    }
    return desc;
  }

  return expr;
}

function describeCron(expr) {
  if (expr.includes(';')) {
    const parts = expr.split(';').map(s => s.trim()).filter(Boolean);
    return parts.map(p => describeSingleCron(p)).join(' + ');
  }
  return describeSingleCron(expr);
}

async function loadProjectSchedules(projectId) {
  const container = document.getElementById('project-schedules');
  try {
    const res = await fetch(`/api/system/schedules/${projectId}`);
    if (!res.ok) throw new Error('Kunde inte hämta scheman');
    const { data } = await res.json();

    if (data.length === 0) {
      container.innerHTML = '<div class="card"><div class="sub">Inga CRON-scheman konfigurerade för detta projekt.</div></div>';
      return;
    }

    container.innerHTML = data.map(s => renderScheduleCard(s, projectId)).join('');
  } catch {
    container.innerHTML = '<div class="card"><div class="sub">Kunde inte hämta CRON-scheman</div></div>';
  }
}

function renderScheduleCard(schedule, projectId) {
  const modeLabels = { quick: 'Snabb', full: 'Fullscan' };
  const modeName = modeLabels[schedule.mode] || schedule.mode;
  const statusText = schedule.enabled ? 'Aktiv' : 'Pausad';
  const statusColor = schedule.enabled ? '#22c55e' : '#94a3b8';
  const updated = schedule.updated_at
    ? new Date(schedule.updated_at).toLocaleString('sv-SE')
    : '—';

  return `
    <div class="schedule-card ${schedule.enabled ? '' : 'disabled'}" id="schedule-${schedule.id}">
      <div class="schedule-card-header">
        <h3>${escapeHtml(schedule.label)}</h3>
        <span style="font-size:0.8rem;color:${statusColor};font-weight:600">${statusText}</span>
      </div>
      <div class="schedule-card-info">
        <span>Typ: <strong>${modeName}</strong></span>
        <span>Schema: <code>${escapeHtml(schedule.cron_expr)}</code></span>
        <span>= ${describeCron(schedule.cron_expr)}</span>
        ${schedule.args ? `<span>Args: <code>${escapeHtml(schedule.args)}</code></span>` : ''}
        <span>Uppdaterad: ${updated}</span>
      </div>
      <div class="schedule-card-actions">
        <button class="btn-sm" style="background:#3b9eff;color:white"
                onclick="runScheduleNow('${projectId}', '${schedule.mode}')">Kör nu</button>
        <button class="btn-secondary btn-sm" onclick="toggleScheduleEdit('${schedule.id}', '${projectId}', '${schedule.mode}')">Redigera</button>
        <button class="btn-sm" style="background:${schedule.enabled ? '#f59e0b' : '#22c55e'};color:white"
                onclick="toggleScheduleEnabled('${projectId}', '${schedule.mode}', ${!schedule.enabled})">
          ${schedule.enabled ? 'Pausa' : 'Aktivera'}
        </button>
      </div>
      <div id="schedule-edit-${schedule.id}" style="display:none">
        <div class="schedule-edit-form">
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem">
            <div>
              <label>CRON-uttryck</label>
              <input type="text" id="sched-cron-${schedule.id}" value="${escapeHtml(schedule.cron_expr)}"
                     placeholder="*/15 5-22 * * *;0 23,1,3 * * *">
              <div class="hint">Semikolon-separera f\u00f6r flera uttryck (t.ex. dag + natt)</div>
              <div class="cron-presets">
                ${CRON_PRESETS_SIMPLE.map(p =>
                  `<button class="cron-preset" type="button"
                     onclick="document.getElementById('sched-cron-${schedule.id}').value='${p.cron}'">${p.label}</button>`
                ).join('')}
              </div>
            </div>
            <div>
              <label>Namn</label>
              <input type="text" id="sched-label-${schedule.id}" value="${escapeHtml(schedule.label)}" maxlength="100">
            </div>
          </div>

          <div style="margin-top:0.8rem;padding:0.6rem 0.8rem;background:#162040;border:1px solid #1e2d56;border-radius:6px">
            <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.8rem;font-weight:600;color:#cbd5e1">
              <input type="checkbox" id="sched-night-toggle-${schedule.id}"
                     ${schedule.cron_expr.includes(';') ? 'checked' : ''}
                     onchange="document.getElementById('sched-night-opts-${schedule.id}').style.display = this.checked ? 'block' : 'none'">
              Nattl\u00e4ge (vila-period)
            </label>
            <div id="sched-night-opts-${schedule.id}" style="display:${schedule.cron_expr.includes(';') ? 'block' : 'none'};margin-top:0.5rem">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
                <span style="font-size:0.8rem;color:#94a3b8">Fr\u00e5n kl</span>
                <input type="number" id="sched-night-start-${schedule.id}" value="${parseNightStart(schedule.cron_expr)}"
                       min="0" max="23" style="width:55px">
                <span style="font-size:0.8rem;color:#94a3b8">till kl</span>
                <input type="number" id="sched-night-end-${schedule.id}" value="${parseNightEnd(schedule.cron_expr)}"
                       min="0" max="23" style="width:55px">
                <span style="font-size:0.75rem;color:#94a3b8">(dagtid = resten)</span>
              </div>
              <div class="cron-presets">
                ${CRON_PRESETS_DAYNIGHT.map(p =>
                  `<button class="cron-preset" type="button"
                     onclick="applyDayNightPreset('${schedule.id}', ${JSON.stringify(p).replace(/"/g, '&quot;')})">${p.label}</button>`
                ).join('')}
              </div>
            </div>
          </div>

          <div style="margin-top:0.8rem;padding:0.6rem 0.8rem;background:#162040;border:1px solid #1e2d56;border-radius:6px">
            <div style="font-size:0.8rem;font-weight:600;color:#cbd5e1;margin-bottom:0.4rem">K\u00f6rl\u00e4ge</div>
            ${renderArgsRadios(schedule.id, schedule.args)}
          </div>
          <div style="margin-top:0.8rem;display:flex;gap:0.5rem">
            <button class="btn-primary btn-sm" onclick="saveSchedule('${projectId}', '${schedule.mode}', '${schedule.id}')">Spara</button>
            <button class="btn-secondary btn-sm" onclick="document.getElementById('schedule-edit-${schedule.id}').style.display='none'">Avbryt</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Parsa args till radio-val: { type: 'none'|'year'|'weeks', value: number|null }
function parseArgsType(args) {
  if (!args) return { type: 'none', value: null };
  const s = args.trim();
  const yearVal = s.match(/--year\s+(\d{4})/);
  if (yearVal) return { type: 'year', value: parseInt(yearVal[1]) };
  if (s === '--year') return { type: 'year', value: null };
  const weeksVal = s.match(/--weeks\s+(\d+)/);
  if (weeksVal) return { type: 'weeks', value: parseInt(weeksVal[1]) };
  return { type: 'none', value: null };
}

function renderArgsRadios(id, args) {
  const p = parseArgsType(args);
  const thisYear = new Date().getFullYear();
  return `
    <div style="display:flex;flex-direction:column;gap:0.35rem;font-size:0.85rem">
      <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer">
        <input type="radio" name="sched-args-type-${id}" value="none" ${p.type === 'none' ? 'checked' : ''}
               onchange="document.getElementById('sched-args-year-${id}').disabled=true;document.getElementById('sched-args-weeks-${id}').disabled=true">
        <span>Aktuell vecka</span> <span style="color:#94a3b8;font-size:0.75rem">(snabb)</span>
      </label>
      <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer">
        <input type="radio" name="sched-args-type-${id}" value="year" ${p.type === 'year' ? 'checked' : ''}
               onchange="document.getElementById('sched-args-year-${id}').disabled=false;document.getElementById('sched-args-weeks-${id}').disabled=true">
        <span>Hela \u00e5ret</span>
        <input type="number" id="sched-args-year-${id}" value="${p.type === 'year' && p.value ? p.value : thisYear}"
               min="2020" max="2099" style="width:65px" ${p.type !== 'year' ? 'disabled' : ''}>
      </label>
      <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer">
        <input type="radio" name="sched-args-type-${id}" value="weeks" ${p.type === 'weeks' ? 'checked' : ''}
               onchange="document.getElementById('sched-args-year-${id}').disabled=true;document.getElementById('sched-args-weeks-${id}').disabled=false">
        <span>Veckor bak\u00e5t</span>
        <input type="number" id="sched-args-weeks-${id}" value="${p.type === 'weeks' && p.value ? p.value : 8}"
               min="1" max="52" style="width:50px" ${p.type !== 'weeks' ? 'disabled' : ''}>
        <span style="color:#94a3b8;font-size:0.75rem">st</span>
      </label>
    </div>`;
}

// Läs radioknappar och bygg args-sträng
function getArgsFromRadios(scheduleId) {
  const type = document.querySelector(`input[name="sched-args-type-${scheduleId}"]:checked`)?.value || 'none';
  if (type === 'year') {
    const year = document.getElementById(`sched-args-year-${scheduleId}`).value;
    return `--year ${year}`;
  }
  if (type === 'weeks') {
    const weeks = document.getElementById(`sched-args-weeks-${scheduleId}`).value;
    return `--weeks ${weeks}`;
  }
  return '';
}

// Parsa nattläge-start från cron-uttryck, t.ex. "..5-22..;.." → 23
function parseNightStart(cronExpr) {
  if (!cronExpr.includes(';')) return 23; // Default
  const parts = cronExpr.split(';');
  // Dag-delen: "*/15 5-22 * * *" → dayEnd = 22, natt börjar 23
  const dayMatch = parts[0].match(/(\d+)-(\d+)\s+\*/);
  if (dayMatch) return parseInt(dayMatch[2]) + 1;
  return 23;
}

// Parsa nattläge-slut från cron-uttryck, t.ex. "..5-22..;.." → 5
function parseNightEnd(cronExpr) {
  if (!cronExpr.includes(';')) return 5; // Default
  const parts = cronExpr.split(';');
  // Dag-delen: "*/15 5-22 * * *" → dayStart = 5 = natt slutar
  const dayMatch = parts[0].match(/(\d+)-(\d+)\s+\*/);
  if (dayMatch) return parseInt(dayMatch[1]);
  return 5;
}

/**
 * Klick på en dag+natt-preset: läs nattläge-timmarna och bygg cron
 */
function applyDayNightPreset(scheduleId, preset) {
  const nightStart = parseInt(document.getElementById(`sched-night-start-${scheduleId}`).value) || 23;
  const nightEnd = parseInt(document.getElementById(`sched-night-end-${scheduleId}`).value) || 5;

  if (nightStart === nightEnd) {
    alert('Start och stopp kan inte vara samma timme');
    return;
  }

  const cronExpr = buildDayNightCron(preset, nightStart, nightEnd);
  document.getElementById(`sched-cron-${scheduleId}`).value = cronExpr;
}

function toggleScheduleEdit(scheduleId) {
  const el = document.getElementById(`schedule-edit-${scheduleId}`);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function saveSchedule(projectId, mode, scheduleId) {
  const cronExpr = document.getElementById(`sched-cron-${scheduleId}`).value.trim();
  const label = document.getElementById(`sched-label-${scheduleId}`).value.trim();
  const args = getArgsFromRadios(scheduleId);

  if (!cronExpr) return alert('CRON-uttryck kan inte vara tomt');
  if (!label) return alert('Namn kan inte vara tomt');

  try {
    const res = await fetch(`/api/system/schedules/${projectId}/${mode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron_expr: cronExpr, label, args }),
    });

    const result = await res.json();
    if (!res.ok) {
      alert('Fel: ' + (result.error || 'Okänt fel'));
      return;
    }

    loadProjectSchedules(projectId);
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

async function runScheduleNow(projectId, mode) {
  if (!confirm(`Vill du köra "${mode}" för ${projectId} nu?`)) return;

  try {
    const res = await fetch(`/api/system/schedules/${projectId}/${mode}/run`, {
      method: 'POST',
    });

    const result = await res.json();
    if (!res.ok) {
      alert('Fel: ' + (result.error || 'Okänt fel'));
      return;
    }

    alert(`Startad: ${result.label || mode}\n\nPipelinen körs i bakgrunden. Följ CRON-loggen nedan.`);
    // Uppdatera CRON-loggen efter kort delay
    setTimeout(() => loadProjectCronLog(projectId), 3000);
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

async function toggleScheduleEnabled(projectId, mode, enabled) {
  const action = enabled ? 'aktivera' : 'pausa';
  if (!confirm(`Vill du ${action} schemat "${mode}" för ${projectId}?`)) return;

  try {
    const res = await fetch(`/api/system/schedules/${projectId}/${mode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });

    const result = await res.json();
    if (!res.ok) {
      alert('Fel: ' + (result.error || 'Okänt fel'));
      return;
    }

    loadProjectSchedules(projectId);
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

// ======= API-nycklar (visas under Verktyg) =======

async function loadKeysProjectDropdown() {
  try {
    const res = await fetch('/api/system/projects');
    const { data } = await res.json();
    const select = document.getElementById('key-project');
    select.innerHTML = data.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');
  } catch { /* ignore */ }
}

async function loadKeys() {
  try {
    const res = await fetch('/api/system/keys');
    const { data } = await res.json();

    const active = data.filter(k => !k.revoked);
    const revoked = data.filter(k => k.revoked);

    const activeEl = document.getElementById('keys-active-list');
    const revokedEl = document.getElementById('keys-revoked-list');
    const revokedSection = document.getElementById('keys-revoked-section');

    if (active.length === 0) {
      activeEl.innerHTML = '<div class="card"><div class="sub">Inga aktiva API-nycklar. Skapa en ovan.</div></div>';
    } else {
      activeEl.innerHTML = active.map(k => renderKeyCard(k)).join('');
    }

    if (revoked.length > 0) {
      revokedSection.style.display = 'block';
      revokedEl.innerHTML = revoked.map(k => renderKeyCard(k)).join('');
    } else {
      revokedSection.style.display = 'none';
    }
  } catch {
    document.getElementById('keys-active-list').innerHTML =
      '<div class="card"><div class="sub">Kunde inte hämta API-nycklar</div></div>';
  }
}

function renderKeyCard(key) {
  const created = new Date(key.created_at).toLocaleDateString('sv-SE');
  const lastUsed = key.last_used_at
    ? new Date(key.last_used_at).toLocaleString('sv-SE')
    : 'Aldrig';
  const expires = key.expires_at
    ? new Date(key.expires_at).toLocaleDateString('sv-SE')
    : 'Aldrig';
  const projectColor = projects[key.project_id]?.color || '#888';

  const typeLabels = { web: 'Webb', mobile: 'Mobil', server: 'Server', other: 'Annat' };

  return `
    <div class="key-card ${key.revoked ? 'revoked' : ''}">
      <div class="key-card-header">
        <div>
          <h3>${escapeHtml(key.label)}</h3>
          <span class="key-card-prefix">${escapeHtml(key.key_prefix)}...</span>
        </div>
        <span class="project-badge" style="background:${projectColor}">${key.project_id}</span>
      </div>
      <div class="key-card-meta">
        <span>Typ: ${typeLabels[key.consumer_type] || key.consumer_type}</span>
        <span>Rate: ${key.rate_limit}/min</span>
        <span>Skapad: ${created}</span>
        <span>Utgår: ${expires}</span>
      </div>
      <div class="key-card-stats">
        <div class="stat"><div class="val">${formatNumber(key.total_requests)}</div><div class="lbl">Anrop totalt</div></div>
        <div class="stat"><div class="val" style="font-size:0.9rem">${lastUsed}</div><div class="lbl">Senast använd</div></div>
      </div>
      ${key.revoked ? `
        <div style="margin-top:0.8rem;font-size:0.85rem;color:#ef4444">
          Revokerad: ${new Date(key.revoked_at).toLocaleString('sv-SE')}
        </div>
      ` : `
        <div class="key-card-actions">
          <button class="btn-secondary" onclick="navigate('keys/${key.id}/usage')">Statistik</button>
          <button class="btn-danger" onclick="revokeKey(${key.id}, '${escapeHtml(key.label)}')">Revokera</button>
        </div>
      `}
    </div>
  `;
}

async function createApiKey() {
  const label = document.getElementById('key-label').value.trim();
  const projectId = document.getElementById('key-project').value;
  const consumerType = document.getElementById('key-type').value;
  const rateLimit = parseInt(document.getElementById('key-rate').value) || 100;
  const originsRaw = document.getElementById('key-origins').value.trim();
  const expiresRaw = document.getElementById('key-expires').value;

  if (!label) return alert('Ange ett namn för nyckeln');
  if (!projectId) return alert('Välj ett projekt');

  const body = {
    label,
    project_id: projectId,
    consumer_type: consumerType,
    rate_limit: rateLimit,
  };

  if (originsRaw) {
    body.allowed_origins = originsRaw.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (expiresRaw) {
    body.expires_at = expiresRaw + 'T23:59:59';
  }

  try {
    const res = await fetch('/api/system/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await res.json();

    if (!res.ok) {
      alert('Fel: ' + (result.error || 'Okänt fel'));
      return;
    }

    // Visa nyckeln i modal
    createdKeyValue = result.data.key;
    document.getElementById('modal-key-label').textContent = result.data.label;
    document.getElementById('modal-key-value').textContent = result.data.key;
    document.getElementById('copy-feedback').textContent = '';
    document.getElementById('key-created-modal').classList.add('active');

    // Rensa formuläret
    document.getElementById('key-label').value = '';
    document.getElementById('key-origins').value = '';
    document.getElementById('key-expires').value = '';
    document.getElementById('key-rate').value = '100';

    loadKeys();
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

function copyKey() {
  navigator.clipboard.writeText(createdKeyValue).then(() => {
    document.getElementById('copy-feedback').textContent = 'Kopierad!';
  }).catch(() => {
    // Fallback
    const el = document.getElementById('modal-key-value');
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.getElementById('copy-feedback').textContent = 'Markerad — kopiera med Ctrl+C';
  });
}

function closeKeyModal() {
  document.getElementById('key-created-modal').classList.remove('active');
  createdKeyValue = '';
}

async function revokeKey(id, label) {
  if (!confirm(`Vill du revokera nyckeln "${label}"?\n\nDetta blockerar alla anrop med denna nyckel omedelbart.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/system/keys/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const result = await res.json();
      alert('Fel: ' + (result.error || 'Okänt fel'));
      return;
    }
    loadKeys();
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

// ======= Nyckel-statistik =======
async function showKeyUsageView(keyId) {
  document.getElementById('view-key-usage').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = '/ <span>Verktyg</span> / <span>Nyckelstatistik</span>';
  document.getElementById('nav-tools')?.classList.add('active');
  document.title = 'Nyckelstatistik — Compuna Hub';

  try {
    const res = await fetch(`/api/system/keys/${keyId}/usage`);
    const { data } = await res.json();

    document.getElementById('key-usage-title').textContent =
      `Statistik: ${data.key.label} (${data.key.key_prefix}...)`;

    // Sammanfattningskort
    document.getElementById('key-usage-summary').innerHTML = `
      <div class="card">
        <h3>Idag</h3>
        <div class="value" style="color:#3b9eff">${formatNumber(data.summary.today)}</div>
      </div>
      <div class="card">
        <h3>Senaste 7 dagar</h3>
        <div class="value" style="color:#3b9eff">${formatNumber(data.summary.this_week)}</div>
      </div>
      <div class="card">
        <h3>Senaste 30 dagar</h3>
        <div class="value" style="color:#3b9eff">${formatNumber(data.summary.this_month)}</div>
      </div>
      <div class="card">
        <h3>Totalt</h3>
        <div class="value" style="color:#3b9eff">${formatNumber(data.key.total_requests)}</div>
      </div>
    `;

    // Per endpoint
    const epTbody = document.getElementById('key-usage-endpoints');
    if (data.summary.by_endpoint.length === 0) {
      epTbody.innerHTML = '<tr><td colspan="2">Inga anrop ännu</td></tr>';
    } else {
      epTbody.innerHTML = data.summary.by_endpoint.map(ep =>
        `<tr><td style="font-family:monospace">${escapeHtml(ep.path)}</td><td>${formatNumber(ep.count)}</td></tr>`
      ).join('');
    }

    // Statuskoder
    const statusEl = document.getElementById('key-usage-status');
    if (data.summary.by_status.length === 0) {
      statusEl.innerHTML = '<div class="card"><div class="sub">Inga anrop ännu</div></div>';
    } else {
      statusEl.innerHTML = data.summary.by_status.map(s => {
        const color = s.status_code < 300 ? '#22c55e' : s.status_code < 400 ? '#3b9eff' : '#ef4444';
        return `<div class="card">
          <h3>HTTP ${s.status_code}</h3>
          <div class="value" style="color:${color}">${formatNumber(s.count)}</div>
        </div>`;
      }).join('');
    }

    // Senaste anrop
    const recentTbody = document.getElementById('key-usage-recent');
    if (data.recent.length === 0) {
      recentTbody.innerHTML = '<tr><td colspan="6">Inga anrop ännu</td></tr>';
    } else {
      recentTbody.innerHTML = data.recent.map(r => {
        const time = new Date(r.logged_at).toLocaleString('sv-SE');
        const statusColor = r.status_code < 300 ? '#22c55e' : r.status_code < 400 ? '#3b9eff' : '#ef4444';
        return `<tr>
          <td>${time}</td>
          <td>${r.method}</td>
          <td style="font-family:monospace;font-size:0.85rem">${escapeHtml(r.path)}</td>
          <td style="color:${statusColor};font-weight:600">${r.status_code}</td>
          <td>${r.response_ms}ms</td>
          <td style="font-size:0.8rem;color:#94a3b8">${r.ip_address || '—'}</td>
        </tr>`;
      }).join('');
    }
  } catch {
    document.getElementById('key-usage-summary').innerHTML =
      '<div class="card"><div class="sub">Kunde inte hämta statistik</div></div>';
  }
}

// ======= API-testare (delad) =======
async function fetchApi(prefix) {
  const url = document.getElementById(`${prefix}-url-input`).value;
  const responseEl = document.getElementById(`${prefix}-response`);
  const timeEl = document.getElementById(`${prefix}-response-time`);

  responseEl.textContent = 'Laddar...';
  responseEl.classList.add('loading');

  const start = Date.now();
  try {
    const res = await fetch(url);
    const data = await res.json();
    const ms = Date.now() - start;

    responseEl.textContent = JSON.stringify(data, null, 2);
    responseEl.classList.remove('loading');
    timeEl.textContent = `${res.status} ${res.statusText} — ${ms}ms`;
  } catch (err) {
    responseEl.textContent = `FEL: ${err.message}`;
    responseEl.classList.remove('loading');
    timeEl.textContent = '';
  }
}

// ======= Hjälpfunktioner =======
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('sv-SE');
}

// ======= Monitor =======

async function loadMonitorSites() {
  const grid = document.getElementById('monitor-grid');
  try {
    const res = await fetch('/api/monitor/sites');
    if (!res.ok) {
      grid.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Monitor ej aktivt</div>';
      return;
    }
    const { data } = await res.json();
    if (!data || data.length === 0) {
      grid.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Inga sajter konfigurerade</div>';
      return;
    }

    grid.innerHTML = data.map(site => {
      const st = site.status || 'unknown';
      const incidents = site.open_incidents || 0;
      const ms = site.last_response_ms;
      const responseStr = ms ? `${ms}ms` : '—';

      return `
        <div class="site-card ${st}" onclick="navigate('site/${site.id}')">
          <div class="site-indicator ${st}"></div>
          <div class="site-info">
            <h3>${site.name}</h3>
            <div class="site-url">${site.url}</div>
          </div>
          <div class="site-meta">
            <div class="uptime">${st === 'up' ? 'UP' : st === 'degraded' ? 'SLOW' : st === 'down' ? 'DOWN' : '?'}</div>
            <div class="response-time">${responseStr}</div>
            ${incidents > 0 ? `<div class="incidents-badge">${incidents} incident${incidents > 1 ? 'er' : ''}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch {
    grid.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Monitor ej tillgängligt</div>';
  }
}

function switchSiteTab(tabId) {
  document.querySelectorAll('.site-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.site-tab').forEach(el => el.classList.remove('active'));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
  const btn = document.querySelector(`.site-tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
}

// --- Check/Security info-modal ---

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

function showCheckInfo(type) {
  const info = CHECK_INFO[type] || SECURITY_INFO[type];
  if (!info) return;

  const modal = document.getElementById('info-modal');
  const overlay = document.getElementById('info-modal-overlay');
  if (!modal || !overlay) return;

  modal.innerHTML = `
    <div class="info-modal-header">
      <h3>${escapeHtml(info.title)}</h3>
      <button class="info-modal-close" onclick="closeCheckInfo()" title="Stäng">&times;</button>
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
  overlay.classList.add('active');
}

function closeCheckInfo() {
  const overlay = document.getElementById('info-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

// Deep report state — anvands for lightbox-navigation
let _deepReportDetails = null;

function showDeepReport(el) {
  let details;
  try {
    details = JSON.parse(el.dataset.details);
  } catch { return; }
  if (!details?.steps) return;

  _deepReportDetails = details;
  _renderDeepReportGrid();
}

function _renderDeepReportGrid() {
  const details = _deepReportDetails;
  if (!details?.steps) return;

  const modal = document.getElementById('info-modal');
  const overlay = document.getElementById('info-modal-overlay');
  if (!modal || !overlay) return;

  const stepsHtml = details.steps.map((step, idx) => `
    <div class="filmstrip-step ${step.ok ? 'ok' : 'fail'} ${step.overThreshold ? 'slow' : ''}">
      <div class="filmstrip-thumb" ${step.screenshotPath ? `onclick="_showDeepImage(${idx})"` : ''}>
        ${step.screenshotPath
          ? `<img src="${step.screenshotPath}" alt="${escapeHtml(step.name)}" loading="lazy">`
          : '<div class="filmstrip-no-img">Ingen bild</div>'}
      </div>
      <div class="filmstrip-step-info">
        <div class="filmstrip-step-name">${step.index}. ${escapeHtml(step.name)}</div>
        <span class="filmstrip-step-action">${step.action}</span>
        <div class="filmstrip-step-meta">
          <span class="ms ${step.overThreshold ? 'slow' : ''}">${step.ms}ms</span>
          <span>${step.ok ? 'OK' : 'FEL'}</span>
        </div>
        ${step.error ? `<div class="filmstrip-error">${escapeHtml(step.error)}</div>` : ''}
      </div>
    </div>
  `).join('');

  const totalOk = details.steps.filter(s => s.ok).length;
  const totalMs = details.totalMs || details.steps.reduce((sum, s) => sum + s.ms, 0);

  modal.innerHTML = `
    <div class="info-modal-header">
      <h3>Deep Test — Stegrapport</h3>
      <button class="info-modal-close" onclick="closeCheckInfo()" title="Stang">&times;</button>
    </div>
    <div class="info-modal-body">
      <div class="filmstrip-summary">
        <span>${totalOk}/${details.steps.length} steg OK</span>
        <span>Totalt: ${totalMs}ms</span>
        ${details.thresholds ? `<span>Max: ${details.thresholds.maxTotalMs}ms</span>` : ''}
      </div>
      <div class="filmstrip-container">
        ${stepsHtml}
      </div>
      ${details.jsErrors?.length > 0 ? `
        <div class="filmstrip-js-errors">
          <strong>JS-fel:</strong>
          <ul>${details.jsErrors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>
      ` : ''}
    </div>
  `;
  overlay.classList.add('active');
}

function _showDeepImage(idx) {
  const details = _deepReportDetails;
  if (!details?.steps) return;
  const step = details.steps[idx];
  if (!step?.screenshotPath) return;

  const modal = document.getElementById('info-modal');
  if (!modal) return;

  const hasPrev = idx > 0 && details.steps[idx - 1]?.screenshotPath;
  const hasNext = idx < details.steps.length - 1 && details.steps[idx + 1]?.screenshotPath;

  modal.innerHTML = `
    <div class="info-modal-header">
      <button class="lightbox-back-btn" onclick="_renderDeepReportGrid()">&larr; Tillbaka</button>
      <span class="lightbox-title">${step.index}. ${escapeHtml(step.name)}</span>
      <button class="info-modal-close" onclick="closeCheckInfo()" title="Stang">&times;</button>
    </div>
    <div class="lightbox-body">
      <div class="lightbox-nav">
        ${hasPrev ? `<button class="lightbox-arrow" onclick="_showDeepImage(${idx - 1})">&lsaquo;</button>` : '<div></div>'}
        <img src="${step.screenshotPath}" alt="${escapeHtml(step.name)}" class="lightbox-img">
        ${hasNext ? `<button class="lightbox-arrow" onclick="_showDeepImage(${idx + 1})">&rsaquo;</button>` : '<div></div>'}
      </div>
      <div class="lightbox-meta">
        <span class="filmstrip-step-action">${step.action}</span>
        <span class="ms ${step.overThreshold ? 'slow' : ''}">${step.ms}ms</span>
        <span style="color:${step.ok ? '#22c55e' : '#ef4444'};font-weight:600;">${step.ok ? 'OK' : 'FEL'}</span>
        <span style="color:#94a3b8;">${step.index} / ${details.steps.length}</span>
      </div>
      ${step.error ? `<div class="filmstrip-error">${escapeHtml(step.error)}</div>` : ''}
    </div>
  `;
}

async function showMonitorSiteView(siteId) {
  document.getElementById('view-monitor-site').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = ' <span>Sajt</span>';
  document.title = `Monitor — ${siteId}`;
  // Återställ till första tabben
  switchSiteTab('tab-monitor');

  await loadMonitorSiteData(siteId);

  // Auto-refresh — sätt bara EN timer (inte vid varje laddning)
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadMonitorSiteData(siteId), 60000);
}

async function loadMonitorSiteData(siteId) {
  // Avbryt om vyn inte längre är aktiv
  const view = document.getElementById('view-monitor-site');
  if (!view || !view.classList.contains('active')) return;

  try {
    const res = await fetch(`/api/monitor/sites/${siteId}`);
    if (!res.ok) throw new Error('Kunde inte hämta sajt');
    const { data } = await res.json();
    const { site, latestChecks, openIncidents, recentChecks, uptimeStats, dailyMetrics, recentDeepChecks } = data;

    // Dubbelkolla att vi fortfarande är på rätt vy
    if (!document.getElementById('view-monitor-site')?.classList.contains('active')) return;

    document.getElementById('monitor-site-title').textContent = site.name;
    document.getElementById('monitor-site-url').textContent = site.url;

    renderSiteSettings(site);
    renderSiteTools(site);
    renderUptimeCards(uptimeStats, recentChecks);
    renderSecurityStatus(site, latestChecks);
    renderCheckCards(latestChecks);
    renderHealthDetails(latestChecks);
    renderIncidents(openIncidents);
    renderResponseChart(recentChecks);
    renderUptimeChart(dailyMetrics);
    renderDeepChart(recentDeepChecks);
    renderRawChecks(latestChecks);
  } catch (err) {
    const grid = document.getElementById('monitor-checks-grid');
    if (grid) grid.innerHTML = `<div class="card"><h3>Fel</h3><div class="sub">${err.message}</div></div>`;
  }
}

function renderUptimeCards(stats, recentChecks) {
  const el = document.getElementById('monitor-uptime-cards');
  if (!el) return;
  if (!stats) { el.innerHTML = ''; return; }

  function uptimeColor(pct) {
    if (pct === null) return '#94a3b8';
    const p = parseFloat(pct);
    if (p >= 99.5) return '#22c55e';
    if (p >= 95) return '#f59e0b';
    return '#ef4444';
  }

  // Senaste svarstid
  const lastMs = recentChecks && recentChecks.length > 0
    ? recentChecks[recentChecks.length - 1].response_ms : null;

  el.innerHTML = `
    <div class="uptime-card">
      <div class="uptime-value" style="color:${uptimeColor(stats['24h'].pct)}">${stats['24h'].pct !== null ? stats['24h'].pct + '%' : '—'}</div>
      <div class="uptime-label">Uptime 24h</div>
      <div class="uptime-sub">${stats['24h'].total} checks</div>
    </div>
    <div class="uptime-card">
      <div class="uptime-value" style="color:${uptimeColor(stats['7d'].pct)}">${stats['7d'].pct !== null ? stats['7d'].pct + '%' : '—'}</div>
      <div class="uptime-label">Uptime 7 dagar</div>
      <div class="uptime-sub">${stats['7d'].total} checks</div>
    </div>
    <div class="uptime-card">
      <div class="uptime-value" style="color:${uptimeColor(stats['30d'].pct)}">${stats['30d'].pct !== null ? stats['30d'].pct + '%' : '—'}</div>
      <div class="uptime-label">Uptime 30 dagar</div>
      <div class="uptime-sub">${stats['30d'].total} checks</div>
    </div>
    <div class="uptime-card">
      <div class="uptime-value" style="color:#3b9eff">${stats['24h'].avgMs !== null ? stats['24h'].avgMs + 'ms' : '—'}</div>
      <div class="uptime-label">Medel svarstid</div>
      <div class="uptime-sub">${lastMs !== null ? 'Senaste: ' + lastMs + 'ms' : ''}</div>
    </div>
  `;
}

function renderSecurityStatus(site, latestChecks) {
  const el = document.getElementById('monitor-security-status');
  if (!el) return;

  // Canary-status
  const hasCanary = !!site.canary_token;
  const canaryCheck = latestChecks?.find(c => c.check_type === 'canary');
  const canaryTime = canaryCheck ? timeAgo(canaryCheck.checked_at) : null;

  // Screenshot-status (kolla om deep check ar aktiv)
  const hasDeep = !!site.check_deep;
  const deepCheck = latestChecks?.find(c => c.check_type === 'deep');
  let deepDetails = deepCheck?.details;
  if (typeof deepDetails === 'string') { try { deepDetails = JSON.parse(deepDetails); } catch {} }
  const hasScreenshot = !!deepDetails?.screenshot?.path;

  // Korrelation — alltid aktiv
  const correlationActive = true;

  function badge(active, label, detail, infoKey) {
    const color = active ? '#22c55e' : '#94a3b8';
    const bg = active ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.08)';
    const icon = active ? '\u2713' : '\u2014';
    return `
      <div class="check-card" style="border-left:3px solid ${color};background:${bg};min-height:auto;padding:0.6rem 0.8rem;">
        <div class="check-card-header">
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span style="color:${color};font-weight:700;font-size:1rem;">${icon}</span>
            <strong style="font-size:0.85rem;">${label}</strong>
          </div>
          <button class="check-info-btn" onclick="event.stopPropagation();showCheckInfo('${infoKey}')" title="Mer info">?</button>
        </div>
        <div style="color:#94a3b8;font-size:0.75rem;margin-top:0.2rem;">${detail}</div>
      </div>
    `;
  }

  el.innerHTML = [
    badge(hasCanary, 'Canary/Honeypot',
      hasCanary
        ? (canaryCheck ? `Senaste trigger: ${canaryTime}` : 'Token konfigurerad — inga triggers')
        : 'Ej konfigurerad — generera token under Verktyg',
      'canary'),
    badge(hasDeep, 'Screenshot vid failure',
      hasDeep
        ? (hasScreenshot ? 'Senaste screenshot finns' : 'Aktivt — tar screenshot vid deep check-failure')
        : 'Inaktivt — aktivera Deep Test',
      'screenshot'),
    badge(correlationActive, 'Incident-korrelation',
      'Aktiv — larmar om 2+ check-typer failar inom 10 min',
      'correlation'),
  ].join('');
}

function renderCheckCards(latestChecks) {
  const checksGrid = document.getElementById('monitor-checks-grid');
  if (!checksGrid) return;

  const checkDescriptions = {
    http: 'Verifierar att sajten svarar med HTTP 200',
    ssl: 'Kontrollerar SSL-certifikatets giltighet',
    health: 'Pollar health.php — DB, PHP, disk',
    dns: 'Verifierar DNS-upplösning',
    deep: 'Playwright-test: laddar sida, kollar JS-fel',
    integrity: 'Kontrollerar filintegritet via SSH',
    headers: 'Kontrollerar säkerhetsheaders (HSTS, CSP m.fl.)',
    content: 'Skannar sidor efter injicerad kod (scripts, iframes)',
    canary: 'Honeypots och klon-detektion (webhook-baserad)',
  };

  if (latestChecks && latestChecks.length > 0) {
    checksGrid.innerHTML = latestChecks.map(c => {
      const typeLabels = { http: 'HTTP', ssl: 'SSL', health: 'Health', dns: 'DNS', deep: 'Deep Test', integrity: 'Filintegritet', headers: 'Headers', content: 'Innehåll', canary: 'Canary' };
      const desc = checkDescriptions[c.check_type] || '';

      // Parsa details for extra info
      let details = c.details;
      if (typeof details === 'string') { try { details = JSON.parse(details); } catch {} }

      // Deep check: stegrapport eller screenshot
      const hasSteps = details?.mode === 'steps' && details?.steps?.length > 0;
      const hasScreenshot = details?.screenshot?.path;
      let screenshotBadge = '';
      if (hasSteps) {
        const stepsOk = details.steps.filter(s => s.ok).length;
        screenshotBadge = `<a href="#" class="deep-report-link" onclick="event.preventDefault();event.stopPropagation();showDeepReport(this)" data-details='${JSON.stringify(details).replace(/'/g, '&#39;')}'
          style="font-size:0.75rem;color:#3b9eff;text-decoration:none;">
          ${stepsOk}/${details.steps.length} steg — Visa rapport
        </a>`;
      } else if (hasScreenshot) {
        screenshotBadge = `<a href="${details.screenshot.path}" target="_blank" style="font-size:0.75rem;color:#3b9eff;text-decoration:none;" title="Visa screenshot">Visa screenshot</a>`;
      }

      // Canary-typ (honeypot/clone/dns)
      const canaryDetail = c.check_type === 'canary' && details?.canaryType
        ? `<div class="check-detail" style="color:#ef4444;font-size:0.8rem;font-weight:600;">${details.canaryType} — IP: ${details.sourceIp || 'okand'}</div>`
        : '';

      return `
        <div class="check-card ${c.status}">
          <div class="check-card-header">
            <h4>${typeLabels[c.check_type] || c.check_type}</h4>
            <button class="check-info-btn" onclick="event.stopPropagation();showCheckInfo('${c.check_type}')" title="Mer info">?</button>
          </div>
          <div class="check-status status-${c.status === 'ok' ? 'success' : 'failed'}">${c.status.toUpperCase()}</div>
          <div class="check-detail">${c.message || ''}</div>
          ${canaryDetail}
          ${screenshotBadge}
          <div class="check-detail" style="color:#94a3b8;font-size:0.75rem;">${desc}</div>
          <div class="check-detail" style="color:#94a3b8;">${c.checked_at ? timeAgo(c.checked_at) : ''}</div>
        </div>
      `;
    }).join('');
  } else {
    checksGrid.innerHTML = '<div style="color:#94a3b8;">Inga checks ännu</div>';
  }
}

/**
 * Formatera health-check detaljer for visning
 * Hanterar alla check-typer fran health.php (databas, admin, tabeller etc.)
 */
function formatHealthDetail(name, info) {
  switch (name) {
    case 'database':
      return info.latency_ms != null
        ? escapeHtml(`${info.latency_ms}ms svarstid`)
        : '';

    case 'disk':
      if (info.used_pct != null || info.free_gb != null) {
        const parts = [];
        if (info.used_pct != null) parts.push(`${info.used_pct}% anvant`);
        if (info.free_gb != null) parts.push(`${info.free_gb} GB ledigt`);
        return escapeHtml(parts.join(' — '));
      }
      return '';

    case 'error_log':
      return info.size_mb != null
        ? escapeHtml(`${info.size_mb} MB`)
        : '';

    case 'failed_logins_1h':
      return info.count != null
        ? escapeHtml(`${info.count} st`)
        : '';

    case 'admin_users': {
      if (info.count == null) return '';
      let text = `${info.count} st`;
      if (info.expected != null) text += ` (forvantat: ${info.expected})`;
      const cls = info.status === 'critical' ? ' style="color:#ef4444;font-weight:600;"' : '';
      return `<span${cls}>${escapeHtml(text)}</span>`;
    }

    case 'table_rows': {
      if (!info.counts || typeof info.counts !== 'object') return '';
      const items = Object.entries(info.counts)
        .map(([table, count]) => `${escapeHtml(table)}: ${count}`)
        .join(', ');
      return `<span style="font-family:monospace;font-size:0.82rem;">${items}</span>`;
    }

    case 'php':
      return info.version ? escapeHtml(info.version) : '';

    case 'writable':
      return info.tmp != null
        ? escapeHtml(info.tmp ? 'tmp OK' : 'tmp EJ skrivbar')
        : '';

    default: {
      // Fallback — visa forsta relevanta falt
      const val = info.details || info.version || info.message || '';
      if (typeof val === 'object') {
        return `<span style="font-family:monospace;font-size:0.82rem;">${escapeHtml(JSON.stringify(val))}</span>`;
      }
      return escapeHtml(String(val));
    }
  }
}

function renderHealthDetails(latestChecks) {
  const section = document.getElementById('monitor-health-details-section');
  const container = document.getElementById('monitor-health-details');
  if (!section || !container) return;
  if (!latestChecks) { section.style.display = 'none'; return; }

  const healthCheck = latestChecks.find(c => c.check_type === 'health');
  if (!healthCheck || !healthCheck.details) { section.style.display = 'none'; return; }

  let details = healthCheck.details;
  if (typeof details === 'string') {
    try { details = JSON.parse(details); } catch { section.style.display = 'none'; return; }
  }

  if (!details.checks) { section.style.display = 'none'; return; }

  section.style.display = '';
  const checks = details.checks;

  const healthLabels = {
    database: 'Databas',
    disk: 'Disk',
    writable: 'Skrivbar',
    error_log: 'Fellogg',
    failed_logins_1h: 'Misslyckade inlogg (1h)',
    admin_users: 'Admin-konton',
    table_rows: 'Tabellstorlekar',
    php: 'PHP',
  };

  const rows = Object.entries(checks).map(([name, info]) => {
    const status = info.status || 'ok';
    const label = healthLabels[name] || name.charAt(0).toUpperCase() + name.slice(1);
    const detail = formatHealthDetail(name, info);
    return `<tr>
      <td><strong>${escapeHtml(label)}</strong></td>
      <td><span class="health-badge ${status}">${status.toUpperCase()}</span></td>
      <td>${detail}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="health-table">
      <thead><tr><th>Kontroll</th><th>Status</th><th>Detaljer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function getDismissedIncidents() {
  try {
    return JSON.parse(localStorage.getItem('dashboard_dismissed_incidents') || '[]');
  } catch { return []; }
}

function dismissIncident(id) {
  const dismissed = getDismissedIncidents();
  if (!dismissed.includes(id)) {
    dismissed.push(id);
    localStorage.setItem('dashboard_dismissed_incidents', JSON.stringify(dismissed));
  }
  const card = document.getElementById(`incident-${id}`);
  if (card) {
    card.style.transition = 'opacity 0.3s, transform 0.3s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(100%)';
    setTimeout(() => {
      card.remove();
      const remaining = document.querySelectorAll('.incident-card');
      if (remaining.length === 0) {
        const list = document.getElementById('monitor-incidents-list');
        if (list) list.innerHTML = '<div style="color:#22c55e;font-size:0.9rem;">Inga öppna incidenter</div>';
      }
    }, 300);
  }
}

function restoreIncidents() {
  localStorage.removeItem('dashboard_dismissed_incidents');
  const hash = window.location.hash.replace('#', '');
  if (hash.startsWith('site/')) {
    loadMonitorSiteData(hash.split('/')[1]);
  }
}

function renderIncidents(openIncidents) {
  const incidentsList = document.getElementById('monitor-incidents-list');
  if (!incidentsList) return;
  if (openIncidents && openIncidents.length > 0) {
    const dismissed = getDismissedIncidents();
    const visible = openIncidents.filter(i => !dismissed.includes(i.id));

    if (visible.length === 0) {
      incidentsList.innerHTML = `
        <div style="color:#22c55e;font-size:0.9rem;">Inga öppna incidenter</div>
        <button class="incident-restore-btn" onclick="restoreIncidents()">Visa dolda (${openIncidents.length})</button>
      `;
      return;
    }

    const dismissedCount = openIncidents.length - visible.length;

    incidentsList.innerHTML = visible.map(i => `
      <div class="incident-card card" id="incident-${i.id}" style="margin-bottom:0.5rem;border-left:4px solid ${i.severity === 'critical' ? '#ef4444' : '#f59e0b'};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
          <strong>${escapeHtml(i.title)}</strong>
          <button class="incident-dismiss-btn" onclick="dismissIncident(${i.id})" title="Dölj incident">&times;</button>
        </div>
        <div style="font-size:0.85rem;color:#94a3b8;">${escapeHtml(i.message || '')}</div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:0.3rem;">
          Öppnad: ${new Date(i.opened_at).toLocaleString('sv-SE')} — ${i.failure_count} fel i rad
          ${i.status === 'open' ? `<button onclick="acknowledgeIncident(${i.id})" style="margin-left:0.5rem;padding:0.2rem 0.5rem;font-size:0.75rem;cursor:pointer;">Kvittera</button>` : ''}
        </div>
      </div>
    `).join('')
    + (dismissedCount > 0 ? `<button class="incident-restore-btn" onclick="restoreIncidents()">Visa dolda (${dismissedCount})</button>` : '');
  } else {
    incidentsList.innerHTML = '<div style="color:#22c55e;font-size:0.9rem;">Inga öppna incidenter</div>';
  }
}

function renderResponseChart(recentChecks) {
  const chartEl = document.getElementById('monitor-response-chart');
  if (!chartEl) return;
  if (!recentChecks || recentChecks.length < 2) {
    chartEl.innerHTML = '<div style="color:#94a3b8;padding:1rem;">Inte tillräckligt med data ännu</div>';
    return;
  }

  const W = 700, H = 180, PAD = { top: 10, right: 15, bottom: 35, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const msValues = recentChecks.map(c => c.response_ms || 0);
  const maxMs = Math.max(...msValues, 1);
  const yMax = Math.ceil(maxMs / 100) * 100 || 100;

  // Bygg SVG-path
  const points = recentChecks.map((c, i) => {
    const x = PAD.left + (i / (recentChecks.length - 1)) * plotW;
    const y = PAD.top + plotH - ((c.response_ms || 0) / yMax) * plotH;
    return { x, y, status: c.status, ms: c.response_ms, time: c.checked_at };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Area under kurvan
  const areaD = pathD
    + ` L${points[points.length - 1].x.toFixed(1)},${PAD.top + plotH}`
    + ` L${points[0].x.toFixed(1)},${PAD.top + plotH} Z`;

  // Y-axel-etiketter (4 steg)
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((yMax / ySteps) * i);
    const y = PAD.top + plotH - (i / ySteps) * plotH;
    return `<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis">${val}</text>
      <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" class="chart-grid" />`;
  }).join('');

  // X-axel-etiketter (6 tidpunkter)
  const xLabelCount = Math.min(6, recentChecks.length);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / (xLabelCount - 1)) * (recentChecks.length - 1));
    const x = PAD.left + (idx / (recentChecks.length - 1)) * plotW;
    const t = new Date(recentChecks[idx].checked_at);
    const label = t.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    return `<text x="${x}" y="${H - 5}" text-anchor="middle" class="chart-axis">${label}</text>`;
  }).join('');

  // Prickar för avvikande värden
  const dots = points
    .filter(p => p.status !== 'ok')
    .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"
      fill="${p.status === 'warning' ? '#f59e0b' : '#ef4444'}" />`)
    .join('');

  chartEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yLabels}
      ${xLabels}
      <text x="${3}" y="${PAD.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,10,${PAD.top + plotH / 2})"
        style="font-size:10px;fill:#94a3b8;">ms</text>
      <path d="${areaD}" fill="rgba(59,158,255,0.08)" />
      <path d="${pathD}" fill="none" stroke="#3b9eff" stroke-width="1.5" />
      ${dots}
    </svg>
  `;
}

function renderUptimeChart(dailyMetrics) {
  const section = document.getElementById('monitor-uptime-chart-section');
  const chartEl = document.getElementById('monitor-uptime-chart');
  if (!section || !chartEl) return;

  if (!dailyMetrics || dailyMetrics.length < 2) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';

  const W = 700, H = 200, PAD = { top: 15, right: 15, bottom: 40, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Dubbel Y-axel: uptime % (vänster) och avg_response_ms (höger)
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
      <title>${dateStr}: ${pct}% uptime, ${d.avg_response_ms || '—'}ms medel, ${d.total_checks || 0} checks, ${d.failed_checks || 0} fel</title>
    </rect>`;
  }).join('');

  // Svarstidslinje ovanpå
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

  // Y-axel vänster (uptime %)
  const yLabels = [100, 99, 98, 95].map(pct => {
    const y = PAD.top + plotH - (pct / 100) * plotH;
    return `<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" style="font-size:10px;fill:#94a3b8;">${pct}%</text>
      <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" stroke="#1e2d56" />`;
  }).join('');

  // Y-axel höger (ms)
  const msLabels = [0, Math.round(msYMax / 2), msYMax].map(ms => {
    const y = PAD.top + plotH - (ms / msYMax) * plotH;
    return `<text x="${PAD.left + plotW + 8}" y="${y + 3}" text-anchor="start" style="font-size:10px;fill:#3b9eff;">${ms}ms</text>`;
  }).join('');

  // X-axel (datum)
  const xStep = Math.max(Math.floor(dailyMetrics.length / 7), 1);
  const xLabels = dailyMetrics.map((d, i) => {
    if (i % xStep !== 0 && i !== dailyMetrics.length - 1) return '';
    const x = PAD.left + (i + 0.5) * (plotW / dailyMetrics.length);
    const dateStr = d.date ? new Date(d.date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) : '';
    return `<text x="${x}" y="${H - 5}" text-anchor="middle" style="font-size:9px;fill:#94a3b8;">${dateStr}</text>`;
  }).join('');

  chartEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yLabels}
      ${msLabels}
      ${bars}
      ${msPath}
      ${xLabels}
      <text x="${3}" y="${PAD.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,10,${PAD.top + plotH / 2})"
        style="font-size:10px;fill:#22c55e;">uptime</text>
    </svg>
    <div style="display:flex;gap:1.5rem;font-size:0.75rem;color:#94a3b8;margin-top:0.5rem;justify-content:center;">
      <span style="display:flex;align-items:center;gap:0.3rem;"><span style="width:12px;height:12px;background:#22c55e;border-radius:2px;display:inline-block;"></span> Uptime %</span>
      <span style="display:flex;align-items:center;gap:0.3rem;"><span style="width:16px;height:2px;background:#3b9eff;display:inline-block;border-top:2px dashed #3b9eff;"></span> Medel svarstid</span>
    </div>
  `;
}

function renderDeepChart(deepChecks) {
  const section = document.getElementById('monitor-deep-chart-section');
  const chartEl = document.getElementById('monitor-deep-chart');
  if (!section || !chartEl) return;

  if (!deepChecks || deepChecks.length < 2) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';

  const W = 700, H = 200, PAD = { top: 15, right: 15, bottom: 35, left: 55 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const msValues = deepChecks.map(c => c.response_ms || 0);
  const maxMs = Math.max(...msValues, 1000);
  const yMax = Math.ceil(maxMs / 5000) * 5000 || 30000;

  // Staplar — fargkodade per status
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
      fill="${color}" rx="1"><title>${timeStr}: ${ms}ms — ${c.status}${c.message ? '\n' + c.message : ''}</title></rect>`;
  }).join('');

  // Y-axel
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((yMax / ySteps) * i);
    const y = PAD.top + plotH - (i / ySteps) * plotH;
    const label = val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}s` : `${val}ms`;
    return `<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis">${label}</text>
      <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" class="chart-grid" />`;
  }).join('');

  // X-axel
  const xLabelCount = Math.min(6, deepChecks.length);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / (xLabelCount - 1)) * (deepChecks.length - 1));
    const x = PAD.left + (idx / deepChecks.length) * plotW + barW / 2;
    const t = new Date(deepChecks[idx].checked_at);
    const label = t.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
    return `<text x="${x}" y="${H - 5}" text-anchor="middle" class="chart-axis">${label}</text>`;
  }).join('');

  chartEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yLabels}
      ${xLabels}
      <text x="${3}" y="${PAD.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,10,${PAD.top + plotH / 2})"
        style="font-size:10px;fill:#94a3b8;">tid</text>
      ${bars}
    </svg>
    <div style="display:flex;gap:1.5rem;font-size:0.75rem;color:#94a3b8;margin-top:0.5rem;justify-content:center;">
      <span style="display:flex;align-items:center;gap:0.3rem;"><span style="width:12px;height:12px;background:#22c55e;border-radius:2px;display:inline-block;"></span> OK</span>
      <span style="display:flex;align-items:center;gap:0.3rem;"><span style="width:12px;height:12px;background:#f59e0b;border-radius:2px;display:inline-block;"></span> Slow</span>
      <span style="display:flex;align-items:center;gap:0.3rem;"><span style="width:12px;height:12px;background:#ef4444;border-radius:2px;display:inline-block;"></span> Fail</span>
    </div>
  `;
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);

  if (diff < 60) return 'just nu';
  if (diff < 3600) return `${Math.floor(diff / 60)} min sedan`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h sedan`;
  return d.toLocaleString('sv-SE');
}

function updateIntervalLabel(input) {
  const min = parseInt(input.value) || 1;
  const label = document.getElementById(input.id + '-label');
  if (!label) return;
  if (min === 1) label.textContent = 'Varje minut';
  else if (min < 60) label.textContent = `Var ${min}:e minut`;
  else if (min === 60) label.textContent = 'Varje timme';
  else if (min % 60 === 0) label.textContent = `Var ${min / 60}:e timme`;
  else { const h = Math.floor(min / 60); const m = min % 60; label.textContent = `${h}h ${m}min`; }
}

function toggleSshSettings() {
  const body = document.getElementById('ssh-settings-body');
  const arrow = document.getElementById('ssh-settings-arrow');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
}

function toggleDeepStepsSettings() {
  const body = document.getElementById('deep-steps-body');
  const arrow = document.getElementById('deep-steps-arrow');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
}

function toggleRawChecks() {
  const body = document.getElementById('monitor-raw-checks');
  const arrow = document.getElementById('raw-checks-arrow');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
}

function renderRawChecks(latestChecks) {
  const container = document.getElementById('monitor-raw-checks');
  if (!container) return;
  if (!latestChecks || latestChecks.length === 0) {
    container.innerHTML = '<div class="sub" style="padding:0.5rem;">Inga checks ännu</div>';
    return;
  }

  const typeLabels = {
    http: 'HTTP', ssl: 'SSL', health: 'Health',
    deep: 'Deep Test', integrity: 'Filintegritet', dns: 'DNS',
    headers: 'Headers', content: 'Innehåll', canary: 'Canary',
  };

  container.innerHTML = latestChecks.map(check => {
    let details = check.details;
    if (typeof details === 'string') {
      try { details = JSON.parse(details); } catch { /* keep as string */ }
    }
    const detailsJson = details ? JSON.stringify(details, null, 2) : 'null';
    const statusClass = check.status === 'ok' ? 'ok' : check.status === 'warning' ? 'warning' : 'critical';
    const time = new Date(check.checked_at).toLocaleString('sv-SE');

    // Filmstrip eller screenshot for deep checks
    let screenshotHtml = '';
    if (details?.mode === 'steps' && details?.steps?.length > 0) {
      screenshotHtml = `
        <div class="raw-check-filmstrip">
          ${details.steps.map(s => `
            <div class="raw-filmstrip-thumb ${s.ok ? 'ok' : 'fail'}">
              ${s.screenshotPath ? `<a href="${s.screenshotPath}" target="_blank"><img src="${s.screenshotPath}" alt="${escapeHtml(s.name)}" loading="lazy"></a>` : ''}
              <span>${s.index}. ${s.ms}ms</span>
            </div>
          `).join('')}
        </div>`;
    } else if (details?.screenshot?.path) {
      screenshotHtml = `<div class="raw-check-screenshot">
           <a href="${details.screenshot.path}" target="_blank">
             <img src="${details.screenshot.path}" alt="Screenshot vid failure" style="max-width:100%;max-height:300px;border:1px solid #1e2d56;border-radius:4px;margin-top:0.5rem;">
           </a>
         </div>`;
    }

    return `
      <div class="raw-check-card">
        <div class="raw-check-header">
          <strong>${typeLabels[check.check_type] || check.check_type}</strong>
          <span class="status-badge ${statusClass}">${check.status.toUpperCase()}</span>
          <span class="raw-check-time">${time}</span>
          ${check.response_ms ? `<span class="raw-check-ms">${check.response_ms}ms</span>` : ''}
        </div>
        <div class="raw-check-message">${escapeHtml(check.message || '')}</div>
        ${screenshotHtml}
        <pre class="raw-check-json">${escapeHtml(detailsJson)}</pre>
      </div>
    `;
  }).join('');
}

function renderSiteSettings(site) {
  const container = document.getElementById('monitor-site-settings');
  if (!container) return;

  const checks = [
    { key: 'http', label: 'HTTP', desc: 'Svarstid och statuskod', defaultInterval: 1 },
    { key: 'ssl', label: 'SSL', desc: 'Certifikatgiltighet', defaultInterval: 360 },
    { key: 'health', label: 'Health', desc: 'health.php sub-checks', defaultInterval: 1 },
    { key: 'deep', label: 'Deep Test', desc: 'Playwright browser-test', defaultInterval: 5 },
    { key: 'integrity', label: 'Filintegritet', desc: 'SSH-kontroll av filer', defaultInterval: 360 },
    { key: 'dns', label: 'DNS', desc: 'DNS-upplösning', defaultInterval: 60 },
    { key: 'headers', label: 'Headers', desc: 'Säkerhetsheaders (HSTS, CSP)', defaultInterval: 360 },
    { key: 'content', label: 'Innehåll', desc: 'Injektionsskanning (scripts, iframes)', defaultInterval: 60 },
  ];

  function readableInterval(min) {
    if (min === 1) return 'Varje minut';
    if (min < 60) return `Var ${min}:e minut`;
    if (min === 60) return 'Varje timme';
    if (min % 60 === 0) return `Var ${min / 60}:e timme`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${m}min`;
  }

  const checkRows = checks.map(c => {
    const checked = site[`check_${c.key}`] ? 'checked' : '';
    const interval = site[`interval_${c.key}`] || c.defaultInterval;
    const readable = readableInterval(interval);
    return `
      <tr class="check-setting-row">
        <td>
          <label class="check-toggle">
            <input type="checkbox" id="site-check_${c.key}" ${checked}>
            <span>${c.label}</span>
          </label>
          <div class="check-desc-inline">${c.desc}</div>
        </td>
        <td class="interval-cell">
          <div class="interval-control">
            <input type="number" id="site-interval_${c.key}" value="${interval}" min="1" max="1440"
              class="interval-input" onchange="updateIntervalLabel(this)">
            <span class="interval-unit">min</span>
          </div>
          <div class="interval-readable" id="site-interval_${c.key}-label">${readable}</div>
        </td>
      </tr>
    `;
  }).join('');

  const sshMethod = site.ssh_method || '';

  container.innerHTML = `
    <div class="site-settings-form">
      <div class="form-group">
        <label>Sajtnamn</label>
        <input type="text" id="site-name" value="${escapeHtml(site.name || '')}" placeholder="Min sajt">
      </div>

      <div class="settings-url-row">
        <div class="form-group">
          <label>URL</label>
          <input type="text" id="site-url" value="${escapeHtml(site.url || '')}" placeholder="https://example.com">
        </div>
        <div class="form-group">
          <label>Health-URL</label>
          <input type="text" id="site-health-url" value="${escapeHtml(site.health_url || '')}" placeholder="https://example.com/api/health.php">
        </div>
        <div class="form-group">
          <label>Health-nyckel</label>
          <input type="password" id="site-health_secret" value="${escapeHtml(site.health_secret || '')}" placeholder="Klistra in nyckeln från sajtens admin">
          <div class="hint">X-Monitor-Key — hämtas från sajtens Admin → Sajt Hälsa</div>
        </div>
      </div>

      <div class="form-group" style="margin-top:1.2rem;">
        <label style="margin-bottom:0.5rem;display:block;">Kontroller &amp; intervall</label>
        <table class="checks-table">
          <thead><tr><th>Check</th><th>Körs</th></tr></thead>
          <tbody>${checkRows}</tbody>
        </table>
      </div>

      <div class="form-group" style="margin-top:1rem;">
        <label>Förväntade admin-konton</label>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input type="number" id="site-health_expected_admins" value="${site.health_expected_admins || 0}" min="0" max="100" style="width:80px;">
          <span class="hint" style="margin:0;">0 = rapportera utan larm</span>
        </div>
        <div class="hint">Health-checken larmar CRITICAL om antalet admin-konton överstiger detta värde</div>
      </div>

      <div class="form-group" style="margin-top:1rem;">
        <label>Accepterade HTTP-statuskoder</label>
        <input type="text" id="site-accepted_statuses" value="${site.accepted_statuses || ''}" placeholder="T.ex. [200,302,403]">
        <div class="hint">JSON-array med statuskoder som räknas som OK. Tomt = standard (200-399)</div>
      </div>

      <div class="form-group" style="margin-top:1.2rem;">
        <div class="docs-toggle" onclick="toggleSshSettings()">
          <span class="arrow" id="ssh-settings-arrow">&#9654;</span>
          <label style="cursor:pointer;">SSH / Filintegritet</label>
        </div>
        <div id="ssh-settings-body" style="display:none;margin-top:0.5rem;">
          <div class="settings-url-row">
            <div class="form-group">
              <label>SSH-host</label>
              <input type="text" id="site-ssh_host" value="${escapeHtml(site.ssh_host || '')}" placeholder="ssh.example.com">
            </div>
            <div class="form-group">
              <label>SSH-port</label>
              <input type="number" id="site-ssh_port" value="${site.ssh_port || 22}" min="1" max="65535" style="width:80px;">
            </div>
          </div>
          <div class="settings-url-row">
            <div class="form-group">
              <label>Metod</label>
              <select id="site-ssh_method">
                <option value="" ${!sshMethod ? 'selected' : ''}>— Ej konfigurerad</option>
                <option value="ssh" ${sshMethod === 'ssh' ? 'selected' : ''}>SSH</option>
                <option value="sftp" ${sshMethod === 'sftp' ? 'selected' : ''}>SFTP</option>
              </select>
            </div>
            <div class="form-group">
              <label>Webroot</label>
              <input type="text" id="site-webroot" value="${escapeHtml(site.webroot || '')}" placeholder="/var/www/html">
            </div>
          </div>
          <div class="settings-url-row">
            <div class="form-group">
              <label>SSH-användarnamn</label>
              <input type="text" id="site-ssh_user" value="${escapeHtml(site.ssh_user || '')}" placeholder="7votaz">
              <div class="hint">Användarnamnet från hostingen (t.ex. Loopia)</div>
            </div>
            <div class="form-group">
              <label>SSH-nyckel</label>
              <select id="site-ssh_key_path" data-current="${escapeHtml(site.ssh_key_path || '')}">
                <option value="">— Välj nyckel —</option>
              </select>
              <div class="hint">Generera nya nycklar via Verktyg</div>
            </div>
          </div>
          <div class="form-group">
            <label>SFTP-lösenord</label>
            <input type="password" id="site-ssh_password" value="${escapeHtml(site.ssh_password || '')}" placeholder="Lösenord för SFTP-anslutning">
            <div class="hint">Används istället för SSH-nyckel (t.ex. one.com)</div>
          </div>
          <div class="form-group">
            <label>Integrity-filer</label>
            <textarea id="site-integrity_files" rows="4" placeholder="public_html/index.php&#10;public_html/.htaccess&#10;src/Config/config.php">${escapeHtml(site.integrity_files || '')}</textarea>
            <div class="hint">En fil per rad, relativt till webroot. Lämna tomt för default (index.php, .htaccess)</div>
          </div>
        </div>
      </div>

      <div class="form-group" style="margin-top:1.2rem;">
        <div class="docs-toggle" onclick="toggleDeepStepsSettings()">
          <span class="arrow" id="deep-steps-arrow">&#9654;</span>
          <label style="cursor:pointer;">Deep Test — Stegkonfiguration</label>
        </div>
        <div id="deep-steps-body" style="display:none;margin-top:0.5rem;">
          <div class="settings-url-row">
            <div class="form-group">
              <label>Username env-variabel</label>
              <input type="text" id="site-deep_username_env" value="${escapeHtml(site.deep_username_env || '')}" placeholder="BIF_ADMIN_USERNAME">
              <div class="hint">Env-var med inloggningsanvändarnamn</div>
            </div>
            <div class="form-group">
              <label>Password env-variabel</label>
              <input type="text" id="site-deep_password_env" value="${escapeHtml(site.deep_password_env || '')}" placeholder="BIF_ADMIN_PASSWORD">
              <div class="hint">Env-var med inloggningslösenord</div>
            </div>
          </div>
          <div class="settings-url-row">
            <div class="form-group">
              <label>Max tid per steg (ms)</label>
              <input type="number" id="site-deep_max_step_ms" value="${site.deep_max_step_ms || 10000}" min="1000" max="60000">
            </div>
            <div class="form-group">
              <label>Max total tid (ms)</label>
              <input type="number" id="site-deep_max_total_ms" value="${site.deep_max_total_ms || 30000}" min="5000" max="120000">
            </div>
          </div>
          <div class="form-group">
            <label>Steg (JSON)</label>
            <textarea id="site-deep_steps" rows="12" style="width:100%;font-family:monospace;font-size:0.82rem;"
              placeholder='[{"action":"goto","name":"Öppna login","value":"https://..."}]'
            >${site.deep_steps ? (typeof site.deep_steps === 'string' ? site.deep_steps : JSON.stringify(site.deep_steps, null, 2)) : ''}</textarea>
            <div class="hint">
              Åtgärder: goto, fill, click, select, waitFor, assert_url, wait<br>
              Placeholders: {env:BIF_ADMIN_USERNAME}, {env:BIF_ADMIN_PASSWORD}<br>
              Varje steg får automatisk screenshot.
            </div>
          </div>
        </div>
      </div>

      <div class="form-group" style="margin-top:1rem;">
        <label class="check-toggle enabled-label">
          <input type="checkbox" id="site-enabled" ${site.enabled ? 'checked' : ''}>
          <span>Övervakning aktiverad</span>
        </label>
      </div>

      <div style="margin-top:1.2rem;">
        <button class="btn-primary" onclick="saveSiteSettings('${site.id}')">Spara</button>
      </div>
    </div>
  `;

  // Ladda SSH-nycklar till dropdown
  loadSshKeyOptions();
}

async function loadSshKeyOptions() {
  const select = document.getElementById('site-ssh_key_path');
  if (!select) return;

  const currentValue = select.dataset.current || '';

  try {
    const res = await fetch('/api/monitor/tools/ssh-keys');
    const json = await res.json();
    const keys = json.data || [];

    // Behåll "Välj nyckel"-option
    select.innerHTML = '<option value="">— Välj nyckel —</option>';

    for (const key of keys) {
      const opt = document.createElement('option');
      opt.value = key.path;
      opt.textContent = `${key.name} (${key.path})`;
      if (key.path === currentValue) opt.selected = true;
      select.appendChild(opt);
    }

    // Om sparad sökväg inte finns bland nycklarna — visa den ändå
    if (currentValue && !keys.some(k => k.path === currentValue)) {
      const opt = document.createElement('option');
      opt.value = currentValue;
      opt.textContent = `${currentValue} (ej hittad)`;
      opt.selected = true;
      select.appendChild(opt);
    }
  } catch {
    // Fallback: behåll tom dropdown
  }
}

async function saveSiteSettings(siteId) {
  const body = {
    name: document.getElementById('site-name').value.trim(),
    url: document.getElementById('site-url').value.trim(),
    health_url: document.getElementById('site-health-url').value.trim(),
    ssh_host: document.getElementById('site-ssh_host').value.trim(),
    ssh_port: parseInt(document.getElementById('site-ssh_port').value) || 22,
    ssh_method: document.getElementById('site-ssh_method').value || null,
    webroot: document.getElementById('site-webroot').value.trim(),
    ssh_user: document.getElementById('site-ssh_user').value.trim(),
    ssh_key_path: document.getElementById('site-ssh_key_path').value.trim(),
    ssh_password: document.getElementById('site-ssh_password').value,
    health_secret: document.getElementById('site-health_secret').value,
    integrity_files: document.getElementById('site-integrity_files').value.trim() || null,
    check_http: document.getElementById('site-check_http').checked,
    check_ssl: document.getElementById('site-check_ssl').checked,
    check_health: document.getElementById('site-check_health').checked,
    check_deep: document.getElementById('site-check_deep').checked,
    check_integrity: document.getElementById('site-check_integrity').checked,
    check_dns: document.getElementById('site-check_dns').checked,
    check_headers: document.getElementById('site-check_headers').checked,
    check_content: document.getElementById('site-check_content').checked,
    health_expected_admins: parseInt(document.getElementById('site-health_expected_admins').value) || 0,
    accepted_statuses: document.getElementById('site-accepted_statuses').value.trim() || null,
    interval_http: parseInt(document.getElementById('site-interval_http').value) || 1,
    interval_ssl: parseInt(document.getElementById('site-interval_ssl').value) || 360,
    interval_health: parseInt(document.getElementById('site-interval_health').value) || 1,
    interval_deep: parseInt(document.getElementById('site-interval_deep').value) || 5,
    interval_integrity: parseInt(document.getElementById('site-interval_integrity').value) || 360,
    interval_dns: parseInt(document.getElementById('site-interval_dns').value) || 60,
    interval_headers: parseInt(document.getElementById('site-interval_headers').value) || 360,
    interval_content: parseInt(document.getElementById('site-interval_content').value) || 60,
    enabled: document.getElementById('site-enabled').checked,
  };

  // Deep test-fält — inkludera bara om sektionen finns i DOM
  const deepStepsEl = document.getElementById('site-deep_steps');
  if (deepStepsEl) {
    body.deep_steps = deepStepsEl.value.trim() || null;
    body.deep_username_env = document.getElementById('site-deep_username_env')?.value.trim() || null;
    body.deep_password_env = document.getElementById('site-deep_password_env')?.value.trim() || null;
    body.deep_max_step_ms = parseInt(document.getElementById('site-deep_max_step_ms')?.value) || 10000;
    body.deep_max_total_ms = parseInt(document.getElementById('site-deep_max_total_ms')?.value) || 30000;
  }

  const feedbackEl = document.getElementById('monitor-site-settings-feedback');

  try {
    const res = await fetch(`/api/monitor/sites/${siteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await res.json();

    if (res.ok) {
      feedbackEl.textContent = 'Inställningar sparade!';
      feedbackEl.className = 'settings-feedback success';
      feedbackEl.style.display = 'block';
    } else {
      feedbackEl.textContent = 'Fel: ' + (result.error || 'Okänt fel') + (result.detail ? ` (${result.detail})` : '');
      feedbackEl.className = 'settings-feedback error';
      feedbackEl.style.display = 'block';
    }

    setTimeout(() => { feedbackEl.style.display = 'none'; }, 6000);
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

async function acknowledgeIncident(incidentId) {
  try {
    await fetch(`/api/monitor/incidents/${incidentId}/acknowledge`, { method: 'POST' });
    // Ladda om aktuell vy
    handleRoute();
  } catch (err) {
    alert('Kunde inte kvittera: ' + err.message);
  }
}

// ======= Verktyg =======

const checkTypeLabelsForTools = {
  http: 'HTTP', ssl: 'SSL', health: 'Health', dns: 'DNS',
  integrity: 'Integritet', deep: 'Deep/Playwright', headers: 'Headers',
};

function showToolsView() {
  document.getElementById('view-tools').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = '/ <span>Verktyg</span>';
  document.getElementById('nav-tools').classList.add('active');
  document.title = 'Verktyg — Compuna Hub';
  renderGlobalTools();
  loadKeysProjectDropdown();
  loadKeys();
}

function renderGlobalTools() {
  const grid = document.getElementById('global-tools-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="tool-card">
      <h3>SSH-nyckelgenerator</h3>
      <p class="tool-desc">Generera ED25519-nyckelpar för SSH/SFTP-access till hostingservrar.</p>
      <div class="form-group" style="margin-bottom:0.8rem;">
        <label for="ssh-key-name">Nyckelnamn</label>
        <input type="text" id="ssh-key-name" value="mon_loopia" placeholder="mon_loopia" style="width:100%;">
        <div class="hint">Sparas i ~/.ssh/ på servern</div>
      </div>
      <button class="btn-tool" onclick="runGenerateSSHKey()">Generera nyckel</button>
    </div>

    <div class="tool-card">
      <h3>Testa SMTP</h3>
      <p class="tool-desc">Skicka ett testmail med aktuella SMTP-inställningar.</p>
      <button class="btn-tool" onclick="runTestSmtp()">Skicka testmail</button>
    </div>
  `;
}

async function runGenerateSSHKey() {
  const nameInput = document.getElementById('ssh-key-name');
  const name = (nameInput?.value || 'mon_compuna').trim();
  const resultEl = document.getElementById('global-tools-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="tool-result"><p>Genererar nyckel...</p></div>';

  try {
    const res = await fetch('/api/monitor/tools/generate-ssh-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error}</p></div>`;
      return;
    }

    const d = json.data;
    resultEl.innerHTML = `
      <div class="tool-result">
        <p><strong>${d.alreadyExisted ? 'Nyckel finns redan' : 'Nyckel genererad!'}</strong></p>
        <p style="font-size:0.85rem;color:#94a3b8;margin:0.3rem 0;">Privat nyckel: <code>${d.privatePath}</code></p>
        <label style="font-size:0.85rem;font-weight:600;display:block;margin-top:0.8rem;">Publik nyckel (kopiera till Loopia/hosting):</label>
        <textarea class="pubkey-textarea" id="pubkey-output" readonly onclick="this.select()">${d.publicKey}</textarea>
        <button class="btn-copy" style="margin-top:0.5rem;" onclick="copyPubKey(this)">Kopiera</button>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Fel: ${err.message}</p></div>`;
  }
}

async function runTestSmtp() {
  const resultEl = document.getElementById('global-tools-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="tool-result"><p>Skickar testmail...</p></div>';

  try {
    const res = await fetch('/api/monitor/tools/test-smtp', { method: 'POST' });
    const json = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error}</p></div>`;
      return;
    }

    const d = json.data;
    const color = d.ok ? '#22c55e' : '#ef4444';
    resultEl.innerHTML = `
      <div class="tool-result">
        <p style="color:${color};font-weight:600;">${d.ok ? 'Testmail skickat!' : 'SMTP-test misslyckades'}</p>
        <p style="font-size:0.85rem;color:#94a3b8;">${d.message}</p>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Fel: ${err.message}</p></div>`;
  }
}

function renderSiteTools(site) {
  const el = document.getElementById('monitor-site-tools');
  if (!el) return;

  // Check-typ options (bara de som är aktiverade)
  const checkTypes = ['http', 'ssl', 'health', 'dns', 'integrity', 'deep', 'headers'];
  const enabledChecks = checkTypes.filter(t => site[`check_${t}`]);
  const options = enabledChecks.map(t =>
    `<option value="${t}">${checkTypeLabelsForTools[t]}</option>`
  ).join('');

  const hasSsh = site.ssh_host && (site.ssh_user || site.ssh_user_env) && (site.ssh_key_path || site.ssh_key_env || site.ssh_password || site.ssh_password_env);
  const hasIntegrity = site.check_integrity && hasSsh;

  el.innerHTML = `
    <div class="tool-card">
      <h3>Kör check</h3>
      <p class="tool-desc">Kör en check manuellt — sparas i historiken.</p>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <select id="tool-check-type" style="padding:0.4rem 0.6rem;border:1px solid #1e2d56;border-radius:5px;font-size:0.85rem;background:#162040;color:#e2e8f0;">
          ${options}
        </select>
        <button class="btn-tool" onclick="runCheckNow('${site.id}')">Kör nu</button>
      </div>
    </div>

    ${hasSsh ? `
    <div class="tool-card">
      <h3>Testa SSH</h3>
      <p class="tool-desc">Testa SSH/SFTP-anslutning till ${site.ssh_host}.</p>
      <button class="btn-tool" onclick="runSshTest('${site.id}')">Testa anslutning</button>
    </div>` : ''}

    ${hasIntegrity ? `
    <div class="tool-card">
      <h3>Nollställ baseline</h3>
      <p class="tool-desc">Hasha om kritiska filer och spara som ny baseline.</p>
      <button class="btn-tool" onclick="runResetBaseline('${site.id}')">Nollställ</button>
    </div>` : ''}

    <div class="tool-card">
      <h3>DNS-info</h3>
      <p class="tool-desc">Visa alla DNS-poster för ${new URL(site.url).hostname}.</p>
      <button class="btn-tool" onclick="runDnsLookup('${site.id}')">Visa DNS</button>
    </div>

    ${hasSsh ? `
    <div class="tool-card">
      <h3>Bläddra filer</h3>
      <p class="tool-desc">Utforska filer via SFTP och välj filer för integrity-check.</p>
      <button class="btn-tool" onclick="browseFiles('${site.id}')">Öppna filbläddrare</button>
    </div>` : ''}

    <div class="tool-card">
      <h3>Canary Token</h3>
      <p class="tool-desc">Generera token för honeypots och klon-detektion.</p>
      ${site.canary_token
        ? `<div style="margin-bottom:0.5rem;">
            <code style="font-size:0.75rem;word-break:break-all;color:#22c55e;">${site.canary_token.substring(0, 12)}...</code>
            <button class="btn-tool-sm" onclick="navigator.clipboard.writeText('${site.canary_token}');this.textContent='Kopierad!';setTimeout(()=>this.textContent='Kopiera',1500)" style="margin-left:0.3rem;">Kopiera</button>
           </div>`
        : '<div style="margin-bottom:0.5rem;color:#94a3b8;font-size:0.85rem;">Ingen token genererad</div>'}
      <button class="btn-tool" onclick="generateCanaryToken('${site.id}')">
        ${site.canary_token ? 'Generera ny' : 'Generera token'}
      </button>
    </div>
  `;
}

async function runCheckNow(siteId) {
  const type = document.getElementById('tool-check-type')?.value;
  if (!type) return;
  const resultEl = document.getElementById('monitor-site-tools-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = `<div class="tool-result"><p>Kör ${checkTypeLabelsForTools[type]}-check...</p></div>`;

  try {
    const res = await fetch(`/api/monitor/tools/run-check/${siteId}/${type}`, { method: 'POST' });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Servern returnerade ogiltigt svar (${res.status}): ${text.substring(0, 200)}</p></div>`;
      return;
    }
    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error || 'Okänt fel'}${json.detail ? ' — ' + json.detail : ''}</p></div>`;
      return;
    }
    const d = json.data;

    // Asynkron check (deep) — visa meddelande och uppdatera efter delay
    if (d.status === 'running') {
      resultEl.innerHTML = `
        <div class="tool-result">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
            <span class="status-badge" style="background:#6366f1;color:#fff;">Körs</span>
            <strong>${checkTypeLabelsForTools[d.type] || d.type}</strong>
          </div>
          <p style="font-size:0.88rem;">${d.message || 'Checken körs i bakgrunden...'}</p>
          <p style="font-size:0.8rem;color:#94a3b8;margin-top:0.3rem;">Resultatet visas i check-korten när det är klart. Sidan uppdateras automatiskt om 60 sek.</p>
        </div>
      `;
      setTimeout(() => { if (typeof loadSiteDetail === 'function') loadSiteDetail(d.siteId); }, 60000);
      return;
    }

    const badgeClass = d.status === 'ok' ? 'ok' : d.status === 'warning' ? 'warning' : 'critical';
    resultEl.innerHTML = `
      <div class="tool-result">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
          <span class="status-badge ${badgeClass}">${d.status}</span>
          <strong>${checkTypeLabelsForTools[d.type]}</strong>
          ${d.responseMs ? `<span style="color:#94a3b8;font-size:0.82rem;">${d.responseMs}ms</span>` : ''}
        </div>
        <p style="font-size:0.88rem;">${d.message || ''}</p>
        ${d.details ? `<pre class="tool-result-json">${JSON.stringify(d.details, null, 2)}</pre>` : ''}
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Fel: ${err.message}</p></div>`;
  }
}

async function runSshTest(siteId) {
  const resultEl = document.getElementById('monitor-site-tools-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="tool-result"><p>Testar SSH-anslutning...</p></div>';

  try {
    const res = await fetch(`/api/monitor/tools/test-ssh/${siteId}`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error}</p></div>`;
      return;
    }
    const d = json.data;
    const color = d.ok ? '#22c55e' : '#ef4444';
    let html = `
      <div class="tool-result">
        <p style="color:${color};font-weight:600;">${d.message}</p>
        ${d.ms ? `<p style="font-size:0.82rem;color:#94a3b8;">Svarstid: ${d.ms}ms</p>` : ''}
    `;
    if (d.files && d.files.length > 0) {
      html += '<table style="margin-top:0.8rem;font-size:0.82rem;width:100%;">';
      html += '<thead><tr><th>Fil</th><th>Typ</th><th>Storlek</th></tr></thead><tbody>';
      for (const f of d.files) {
        const size = f.type === 'dir' ? '—' : (f.size > 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`);
        html += `<tr><td>${f.name}</td><td>${f.type}</td><td>${size}</td></tr>`;
      }
      html += '</tbody></table>';
      if (d.fileCount > 50) {
        html += `<p style="font-size:0.8rem;color:#94a3b8;margin-top:0.3rem;">Visar 50 av ${d.fileCount} filer</p>`;
      }
    }
    html += '</div>';
    resultEl.innerHTML = html;
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Fel: ${err.message}</p></div>`;
  }
}

async function runResetBaseline(siteId) {
  const resultEl = document.getElementById('monitor-site-tools-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="tool-result"><p>Nollställer baselines...</p></div>';

  try {
    const res = await fetch(`/api/monitor/tools/reset-baseline/${siteId}`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error}</p></div>`;
      return;
    }
    const files = json.data;
    let html = '<div class="tool-result"><p style="color:#22c55e;font-weight:600;">Baselines uppdaterade!</p>';
    html += '<table style="margin-top:0.8rem;font-size:0.82rem;width:100%;">';
    html += '<thead><tr><th>Fil</th><th>SHA-256</th><th>Storlek</th></tr></thead><tbody>';
    for (const f of files) {
      if (f.error) {
        html += `<tr><td>${f.path}</td><td colspan="2" style="color:#ef4444;">${f.error}</td></tr>`;
      } else {
        html += `<tr><td>${f.path}</td><td style="font-family:monospace;font-size:0.75rem;">${f.hash.slice(0, 16)}...</td><td>${f.size} B</td></tr>`;
      }
    }
    html += '</tbody></table></div>';
    resultEl.innerHTML = html;
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Fel: ${err.message}</p></div>`;
  }
}

async function runDnsLookup(siteId) {
  const resultEl = document.getElementById('monitor-site-tools-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="tool-result"><p>Hämtar DNS-poster...</p></div>';

  try {
    const res = await fetch(`/api/monitor/tools/dns-lookup/${siteId}`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error}</p></div>`;
      return;
    }
    const { hostname, records } = json.data;
    let html = `<div class="tool-result"><p style="font-weight:600;">DNS-poster för ${hostname}</p>`;
    html += '<table style="margin-top:0.8rem;font-size:0.82rem;width:100%;">';
    html += '<thead><tr><th>Typ</th><th>Värde</th></tr></thead><tbody>';

    for (const [type, values] of Object.entries(records)) {
      if (!values || values.length === 0) continue;
      for (const val of values) {
        let display;
        if (typeof val === 'object' && val.exchange) {
          display = `${val.exchange} (prio ${val.priority})`;
        } else {
          display = String(val);
        }
        html += `<tr><td><strong>${type}</strong></td><td style="font-family:monospace;font-size:0.82rem;">${display}</td></tr>`;
      }
    }
    html += '</tbody></table></div>';
    resultEl.innerHTML = html;
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Fel: ${err.message}</p></div>`;
  }
}

// ==================== Canary Token ====================

async function generateCanaryToken(siteId) {
  const resultEl = document.getElementById('monitor-site-tools-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="tool-result"><p>Genererar canary token...</p></div>';

  try {
    const res = await fetch(`/api/monitor/tools/generate-canary-token/${siteId}`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error}</p></div>`;
      return;
    }

    resultEl.innerHTML = `
      <div class="tool-result">
        <p style="font-weight:600;color:#22c55e;">Canary token genererad!</p>
        <table style="margin-top:0.8rem;font-size:0.82rem;width:100%;">
          <tr><td><strong>Token</strong></td><td><code style="word-break:break-all;">${json.token}</code></td></tr>
          <tr><td><strong>Webhook URL</strong></td><td><code style="word-break:break-all;">${json.webhookUrl}</code></td></tr>
          <tr><td><strong>Canarytokens.org memo</strong></td><td><code>${json.canarytokensMemo}</code></td></tr>
        </table>
        <p style="margin-top:0.8rem;font-size:0.82rem;color:#94a3b8;">
          Anvand token och webhook-URL i honeypot-filer (PHP) och clone-detect.js pa klientsajten.
          For canarytokens.org: anvand memo-vardet som identifierare.
        </p>
      </div>
    `;

    // Uppdatera sajtvyn sa token syns direkt
    handleRoute();
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${err.message}</p></div>`;
  }
}

// ==================== Filbläddrare ====================

const _browserSelected = new Set();

async function browseFiles(siteId, path) {
  const resultEl = document.getElementById('monitor-site-tools-result');
  resultEl.style.display = 'block';

  // Ladda befintliga integrity-filer som redan valda
  if (!path) {
    _browserSelected.clear();
    const textarea = document.getElementById('site-integrity_files');
    if (textarea && textarea.value.trim()) {
      textarea.value.trim().split('\n').forEach(f => { if (f.trim()) _browserSelected.add(f.trim()); });
    }
  }

  const displayPath = path || '(webroot)';
  resultEl.innerHTML = `<div class="tool-result"><p>Laddar ${displayPath}...</p></div>`;

  try {
    const res = await fetch(`/api/monitor/tools/browse-files/${siteId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path || undefined }),
    });
    const json = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">${json.error}</p></div>`;
      return;
    }

    const { path: currentPath, files } = json.data;

    let html = '<div class="tool-result">';
    html += `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.8rem;">`;
    html += `<div style="font-weight:600;font-size:0.9rem;">`;
    html += `<span style="color:#94a3b8;">Sökväg:</span> ${currentPath}`;
    html += `</div>`;
    html += `<div style="display:flex;gap:0.4rem;">`;

    // Upp-knapp (navigera till föräldramapp)
    if (currentPath !== '.' && currentPath.includes('/')) {
      const parent = currentPath.split('/').slice(0, -1).join('/') || '.';
      html += `<button class="btn-tool" style="font-size:0.78rem;padding:0.3rem 0.6rem;" onclick="browseFiles('${siteId}','${parent}')">Upp</button>`;
    }

    html += `<button class="btn-tool" style="font-size:0.78rem;padding:0.3rem 0.6rem;background:#22c55e;" onclick="applySelectedFiles()">Lägg till valda (${_browserSelected.size})</button>`;
    html += `</div></div>`;

    html += '<table style="font-size:0.82rem;width:100%;">';
    html += '<thead><tr><th style="width:30px;"></th><th>Namn</th><th>Typ</th><th>Storlek</th></tr></thead><tbody>';

    for (const f of files) {
      const size = f.type === 'dir' ? '—' : (f.size > 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`);
      const isSelected = _browserSelected.has(f.path);

      if (f.type === 'dir') {
        html += `<tr style="cursor:pointer;" onclick="browseFiles('${siteId}','${f.path}')">`;
        html += `<td></td>`;
        html += `<td style="color:#3b9eff;font-weight:500;">📁 ${f.name}/</td>`;
        html += `<td>mapp</td><td>${size}</td></tr>`;
      } else {
        html += `<tr class="file-row ${isSelected ? 'file-selected' : ''}" onclick="toggleFileSelect(this,'${f.path}','${siteId}')">`;
        html += `<td><input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation();toggleFileSelect(this.closest('tr'),'${f.path}','${siteId}')"></td>`;
        html += `<td>${f.name}</td>`;
        html += `<td>fil</td><td>${size}</td></tr>`;
      }
    }

    html += '</tbody></table>';

    if (_browserSelected.size > 0) {
      html += `<div style="margin-top:0.8rem;padding:0.5rem;background:rgba(34,197,94,0.12);border-radius:4px;font-size:0.8rem;">`;
      html += `<strong>Valda filer (${_browserSelected.size}):</strong><br>`;
      html += [..._browserSelected].join('<br>');
      html += '</div>';
    }

    html += '</div>';
    resultEl.innerHTML = html;
  } catch (err) {
    resultEl.innerHTML = `<div class="tool-result"><p style="color:#ef4444;">Fel: ${err.message}</p></div>`;
  }
}

function toggleFileSelect(row, filePath, siteId) {
  if (_browserSelected.has(filePath)) {
    _browserSelected.delete(filePath);
    row.classList.remove('file-selected');
    row.querySelector('input[type="checkbox"]').checked = false;
  } else {
    _browserSelected.add(filePath);
    row.classList.add('file-selected');
    row.querySelector('input[type="checkbox"]').checked = true;
  }
  // Uppdatera "Lägg till valda"-knappen
  const btn = document.querySelector('[onclick="applySelectedFiles()"]');
  if (btn) btn.textContent = `Lägg till valda (${_browserSelected.size})`;

  // Uppdatera valda-listan
  const resultEl = document.getElementById('monitor-site-tools-result');
  const existingList = resultEl.querySelector('[style*="f0fdf4"]');
  if (_browserSelected.size > 0) {
    const listHtml = `<div style="margin-top:0.8rem;padding:0.5rem;background:rgba(34,197,94,0.12);border-radius:4px;font-size:0.8rem;"><strong>Valda filer (${_browserSelected.size}):</strong><br>${[..._browserSelected].join('<br>')}</div>`;
    if (existingList) {
      existingList.outerHTML = listHtml;
    } else {
      resultEl.querySelector('.tool-result').insertAdjacentHTML('beforeend', listHtml);
    }
  } else if (existingList) {
    existingList.remove();
  }
}

function applySelectedFiles() {
  const textarea = document.getElementById('site-integrity_files');
  if (!textarea) return;
  textarea.value = [..._browserSelected].join('\n');
  const resultEl = document.getElementById('monitor-site-tools-result');
  resultEl.innerHTML = `<div class="tool-result"><p style="color:#22c55e;font-weight:600;">✓ ${_browserSelected.size} filer tillagda i Integrity-filer. Glöm inte att spara inställningarna!</p></div>`;
}

function copyPubKey(btn) {
  const textarea = document.getElementById('pubkey-output');
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Kopierad!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

// ======= Inställningar =======
let settingsData = null;
let activeSettingsCategory = null;

function showSettingsView() {
  document.getElementById('view-settings').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = '/ <span>Inst\u00e4llningar</span>';
  document.getElementById('nav-settings').classList.add('active');
  document.title = 'Inst\u00e4llningar \u2014 Compuna Hub';

  loadSettings();
}

async function loadSettings() {
  try {
    const res = await fetch('/api/system/settings');
    const { data } = await res.json();
    settingsData = data;

    renderSettingsTabs(data);

    // Auto-välj första kategorin
    const firstCategory = Object.keys(data)[0];
    if (firstCategory) selectSettingsCategory(activeSettingsCategory || firstCategory);
  } catch {
    document.getElementById('settings-form-container').innerHTML =
      '<div class="card"><div class="sub">Kunde inte hämta inställningar</div></div>';
  }
}

function renderSettingsTabs(data) {
  const tabsEl = document.getElementById('settings-tabs');
  tabsEl.innerHTML = Object.entries(data).map(([cat, info]) =>
    `<button class="nav-btn settings-tab" data-category="${cat}"
            onclick="selectSettingsCategory('${cat}')">${escapeHtml(info.label)}</button>`
  ).join('');
}

function selectSettingsCategory(category) {
  activeSettingsCategory = category;

  // Uppdatera aktiv flik
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.settings-tab[data-category="${category}"]`);
  if (activeTab) activeTab.classList.add('active');

  // Rendera formulär
  const info = settingsData[category];
  if (!info) return;

  // Custom rendering för PWA-kategorin
  if (category === 'pwa') {
    renderPwaSettings(info);
    document.getElementById('settings-feedback').style.display = 'none';
    return;
  }

  const fields = info.settings.map(s => {
    let input;
    if (s.value_type === 'boolean') {
      input = `<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
        <input type="checkbox" id="setting-${s.key}" ${s.value === 'true' ? 'checked' : ''}>
        <span>${escapeHtml(s.label)}</span>
      </label>`;
    } else if (s.value_type === 'password') {
      input = `<label>${escapeHtml(s.label)}</label>
        <input type="password" id="setting-${s.key}" value="${escapeHtml(s.value || '')}"
               placeholder="${escapeHtml(s.description || '')}">`;
    } else if (s.value_type === 'number') {
      input = `<label>${escapeHtml(s.label)}</label>
        <input type="number" id="setting-${s.key}" value="${escapeHtml(s.value || '')}"
               placeholder="${escapeHtml(s.description || '')}">`;
    } else {
      input = `<label>${escapeHtml(s.label)}</label>
        <input type="text" id="setting-${s.key}" value="${escapeHtml(s.value || '')}"
               placeholder="${escapeHtml(s.description || '')}">`;
    }

    const hint = s.description ? `<div class="hint">${escapeHtml(s.description)}</div>` : '';
    return `<div class="form-group">${input}${hint}</div>`;
  }).join('');

  // Testknapp för SMTP och HelloSMS
  let testButton = '';
  if (category === 'smtp') {
    testButton = `<button class="btn-secondary" style="margin-left:0.5rem" onclick="testSmtp()">Skicka test-mail</button>`;
  } else if (category === 'hellosms') {
    testButton = `<button class="btn-secondary" style="margin-left:0.5rem" onclick="testSms()">Skicka test-SMS</button>`;
  }

  document.getElementById('settings-form-container').innerHTML = `
    <div class="form-section">
      <h3 style="margin-bottom:1rem">${escapeHtml(info.label)}</h3>
      ${fields}
      <div style="margin-top:1rem">
        <button class="btn-primary" onclick="saveSettings('${category}')">Spara</button>
        ${testButton}
      </div>
    </div>
  `;

  // Dölj feedback
  document.getElementById('settings-feedback').style.display = 'none';
}

// Custom PWA-inställningar med snyggare layout
function renderPwaSettings(info) {
  const val = key => {
    const s = info.settings.find(s => s.key === key);
    return s ? s.value : '';
  };

  const enabled = val('enabled') === 'true';
  const sessionDays = val('session_days') || '30';
  const refreshSec = val('refresh_seconds') || '60';
  const appUrl = `${window.location.origin}/app/`;

  document.getElementById('settings-form-container').innerHTML = `
    <div class="form-section" style="max-width:520px">
      <h3 style="margin-bottom:1rem">Monitorapp (PWA)</h3>

      <!-- App-länk -->
      <div style="padding:0.8rem;background:rgba(59,158,255,0.1);border:1px solid #1e2d56;border-radius:8px;margin-bottom:1.2rem">
        <div style="font-weight:600;font-size:0.9rem;color:#cbd5e1;margin-bottom:0.3rem">Compuna Monitor</div>
        <a href="${appUrl}" target="_blank" style="color:#3b9eff;font-size:0.82rem;word-break:break-all">${appUrl}</a>
        <div style="margin-top:0.5rem">
          <a href="${appUrl}" target="_blank" class="btn-primary" style="text-decoration:none;font-size:0.82rem;padding:0.35rem 0.8rem;display:inline-block">Öppna appen</a>
        </div>
      </div>

      <!-- Aktivera -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
          <input type="checkbox" id="setting-enabled" ${enabled ? 'checked' : ''}>
          <span>Aktiverad</span>
        </label>
        <div class="hint">Tillåt inloggning via PIN-kod</div>
      </div>

      <!-- PIN-kod -->
      <div class="form-group">
        <label>PIN-kod</label>
        <input type="text" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6"
               id="setting-pin_hash" value="" placeholder="Ange ny PIN (4–6 siffror)"
               style="max-width:200px;font-family:monospace;letter-spacing:0.2rem">
        <div class="hint">Lämna tomt för att behålla nuvarande PIN.</div>
      </div>

      <!-- Session -->
      <div class="form-group">
        <label>Session (dagar)</label>
        <input type="number" id="setting-session_days" value="${escapeHtml(sessionDays)}" min="1" max="365"
               style="max-width:100px">
        <div class="hint">Hur länge inloggningen gäller</div>
      </div>

      <!-- Refresh -->
      <div class="form-group">
        <label>Auto-refresh (sek)</label>
        <input type="number" id="setting-refresh_seconds" value="${escapeHtml(refreshSec)}" min="10" max="600"
               style="max-width:100px">
        <div class="hint">Hur ofta data uppdateras</div>
      </div>

      <!-- Spara -->
      <div style="margin-top:1rem">
        <button class="btn-primary" onclick="saveSettings('pwa')">Spara</button>
      </div>

      <!-- Instruktion -->
      <div style="margin-top:1.2rem;padding:0.7rem 0.9rem;background:#162040;border:1px solid #1e2d56;border-radius:6px;font-size:0.8rem;color:#94a3b8;line-height:1.6">
        <strong style="color:#cbd5e1">Installation:</strong>
        Öppna länken ovan på mobilen → Logga in med PIN → Välj "Lägg till på hemskärmen"
      </div>
    </div>
  `;
}

async function saveSettings(category) {
  const info = settingsData[category];
  if (!info) return;

  const body = {};
  for (const s of info.settings) {
    const el = document.getElementById(`setting-${s.key}`);
    if (!el) continue;

    if (s.value_type === 'boolean') {
      body[s.key] = el.checked ? 'true' : 'false';
    } else {
      body[s.key] = el.value;
    }
  }

  try {
    const res = await fetch(`/api/system/settings/${category}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    const feedbackEl = document.getElementById('settings-feedback');

    if (res.ok) {
      feedbackEl.textContent = 'Inställningar sparade!';
      feedbackEl.style.cssText = 'display:block;margin-top:1rem;padding:0.8rem;border-radius:6px;font-size:0.9rem;background:rgba(34,197,94,0.12);color:#22c55e;';
      // Ladda om för att få tillbaka maskade lösenord
      await loadSettings();
    } else {
      feedbackEl.textContent = 'Fel: ' + (result.error || 'Okänt fel');
      feedbackEl.style.cssText = 'display:block;margin-top:1rem;padding:0.8rem;border-radius:6px;font-size:0.9rem;background:rgba(239,68,68,0.12);color:#ef4444;';
    }

    setTimeout(() => { feedbackEl.style.display = 'none'; }, 4000);
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

async function testSmtp() {
  try {
    const res = await fetch('/api/system/settings/test/smtp', { method: 'POST' });
    const result = await res.json();
    alert(res.ok ? 'Test-mail skickat!' : 'Fel: ' + (result.error || 'SMTP-test misslyckades'));
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

async function testSms() {
  try {
    const res = await fetch('/api/system/settings/test/hellosms', { method: 'POST' });
    const result = await res.json();
    alert(res.ok ? 'Test-SMS skickat!' : 'Fel: ' + (result.error || 'SMS-test misslyckades'));
  } catch (err) {
    alert('Nätverksfel: ' + err.message);
  }
}

// ======= Aktivitetsvy (laget) =======

const STATUS_CLASS = {
  'Deltar': 'av-status--deltar',
  'Deltar ej': 'av-status--deltar-ej',
  'Ej svarat': 'av-status--ej-svarat',
  'Ej kallad': 'av-status--ej-kallad',
  'Schemalagd': 'av-status--schemalagd',
};

function statusBadge(status) {
  const cls = STATUS_CLASS[status] || '';
  return `<span class="av-status ${cls}">${escapeHtml(status)}</span>`;
}

async function initActivityViewer(projectId) {
  const section = document.getElementById('activity-viewer-section');
  if (projectId !== 'laget') { section.style.display = 'none'; return; }

  const teamSelect = document.getElementById('av-team-filter');
  const activitySelect = document.getElementById('av-activity-select');

  // Nollställ
  document.getElementById('av-activity-info').style.display = 'none';
  document.getElementById('av-attendance-table').style.display = 'none';
  document.getElementById('av-changes').style.display = 'none';

  // Hämta lag för filtret
  try {
    const res = await fetch(`/api/${projectId}/teams`);
    const { data } = await res.json();
    teamSelect.innerHTML = '<option value="">Alla lag</option>' +
      data.map(t => `<option value="${t.id}">${escapeHtml(t.namn)}</option>`).join('');
  } catch { /* behåll default */ }

  await loadActivityOptions(projectId);

  teamSelect.onchange = () => loadActivityOptions(projectId);
  activitySelect.onchange = () => {
    const id = activitySelect.value;
    if (id) loadActivityDetail(projectId, id);
    else {
      document.getElementById('av-activity-info').style.display = 'none';
      document.getElementById('av-attendance-table').style.display = 'none';
      document.getElementById('av-changes').style.display = 'none';
    }
  };

  section.style.display = '';
}

async function loadActivityOptions(projectId) {
  const teamId = document.getElementById('av-team-filter').value;
  const select = document.getElementById('av-activity-select');

  let url = `/api/${projectId}/activities?limit=100`;
  if (teamId) url += `&team=${teamId}`;

  try {
    const res = await fetch(url);
    const { data } = await res.json();

    select.innerHTML = '<option value="">Välj aktivitet...</option>' +
      data.map(a => {
        const datum = a.datum || '—';
        const typ = a.typ || 'Okänd';
        const lag = a.lag_namn || '';
        const extra = a.deltar_count != null ? ` (${a.deltar_count} deltar)` : '';
        return `<option value="${a.id}">${escapeHtml(`${datum} — ${typ} — ${lag}${extra}`)}</option>`;
      }).join('');
  } catch {
    select.innerHTML = '<option value="">Kunde inte ladda aktiviteter</option>';
  }

  document.getElementById('av-activity-info').style.display = 'none';
  document.getElementById('av-attendance-table').style.display = 'none';
  document.getElementById('av-changes').style.display = 'none';
}

async function loadActivityDetail(projectId, activityId) {
  const infoEl = document.getElementById('av-activity-info');
  const tableEl = document.getElementById('av-attendance-table');
  const changesEl = document.getElementById('av-changes');
  const jsonEl = document.getElementById('av-json');

  infoEl.innerHTML = '<div class="sub">Laddar...</div>';
  infoEl.style.display = '';

  try {
    const [actRes, chgRes] = await Promise.all([
      fetch(`/api/${projectId}/activities/${activityId}`),
      fetch(`/api/${projectId}/changes?activity=${activityId}`),
    ]);

    const { data: activity } = await actRes.json();
    const { data: changes } = await chgRes.json();

    infoEl.innerHTML = renderActivityInfo(activity);
    tableEl.innerHTML = renderAttendanceTable(activity.deltagare, activity.ledare);
    tableEl.style.display = '';

    if (changes && changes.length > 0) {
      changesEl.innerHTML = renderActivityChanges(changes);
      changesEl.style.display = '';
    } else {
      changesEl.style.display = 'none';
    }

    jsonEl.innerHTML = renderActivityJson(activity);
    jsonEl.style.display = '';
  } catch {
    infoEl.innerHTML = '<div class="sub">Kunde inte ladda aktiviteten.</div>';
    tableEl.style.display = 'none';
    changesEl.style.display = 'none';
    jsonEl.style.display = 'none';
  }
}

function renderActivityInfo(a) {
  const datumStr = a.datum_till ? `${a.datum} → ${a.datum_till}` : (a.datum || '—');
  const tidStr = a.heldag ? 'Heldag' : `${a.starttid || '—'} – ${a.sluttid || '—'}`;
  const lok = a.lok_aktivitet === true ? 'Ja' : a.lok_aktivitet === false ? 'Nej' : '—';
  const heldag = a.heldag ? 'Ja' : 'Nej';

  return `<div class="av-info-card">
    <div class="av-info-row">
      <span><strong>Datum:</strong> ${escapeHtml(datumStr)}</span>
      <span><strong>Tid:</strong> ${escapeHtml(tidStr)}</span>
      <span><strong>Typ:</strong> ${escapeHtml(a.typ || '—')}</span>
    </div>
    <div class="av-info-row">
      <span><strong>Plats:</strong> ${escapeHtml(a.plats || '—')}</span>
      <span><strong>Lag:</strong> ${escapeHtml(a.lag_namn || '—')}</span>
      <span><strong>Heldag:</strong> ${heldag}</span>
      <span><strong>LOK:</strong> ${lok}</span>
    </div>
  </div>`;
}

function renderAttendanceTable(deltagare, ledare) {
  let html = '';

  if (ledare && ledare.length > 0) {
    html += `<h4 class="av-group-header">Ledare (${ledare.length})</h4>`;
    html += `<table class="av-table"><thead><tr><th>Namn</th><th>Status</th><th>Kommentar</th></tr></thead><tbody>`;
    for (const l of ledare) {
      html += `<tr>
        <td>${escapeHtml(l.namn)}</td>
        <td>${statusBadge(l.status)}</td>
        <td>${escapeHtml(l.kommentar || '')}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }

  if (deltagare && deltagare.length > 0) {
    const deltarCount = deltagare.filter(d => d.status === 'Deltar').length;
    html += `<h4 class="av-group-header">Spelare (${deltagare.length}) — ${deltarCount} deltar</h4>`;
    html += `<table class="av-table"><thead><tr><th>Namn</th><th>Status</th><th>Kommentar</th><th>Inlånad</th></tr></thead><tbody>`;
    for (const d of deltagare) {
      html += `<tr>
        <td>${escapeHtml(d.namn)}</td>
        <td>${statusBadge(d.status)}</td>
        <td>${escapeHtml(d.kommentar || '')}</td>
        <td>${d.inlanad_fran ? escapeHtml(d.inlanad_fran) : ''}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }

  if (!html) html = '<div class="sub">Inga deltagare registrerade.</div>';
  return html;
}

function renderActivityChanges(changes) {
  const fieldLabels = { status: 'Status', roll: 'Roll', lok_aktivitet: 'LOK', kommentar: 'Kommentar', ny: 'Ny spelare' };
  let html = `<h4 class="av-group-header">Ändringar (${changes.length})</h4>`;
  html += `<table class="av-table"><thead><tr><th>Tidpunkt</th><th>Medlem</th><th>Fält</th><th>Före</th><th>Efter</th></tr></thead><tbody>`;
  for (const row of changes) {
    const created = new Date(row.created_at).toLocaleString('sv-SE');
    const field = fieldLabels[row.field_name] || row.field_name;
    html += `<tr>
      <td>${created}</td>
      <td>${escapeHtml(row.medlem || '—')}</td>
      <td>${escapeHtml(field)}</td>
      <td>${escapeHtml(row.old_value ?? '—')}</td>
      <td>${escapeHtml(row.new_value ?? '—')}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function renderActivityJson(activity) {
  const json = JSON.stringify(activity, null, 2);
  return `<details class="av-json-details">
    <summary>Visa JSON-data</summary>
    <pre>${escapeHtml(json)}</pre>
  </details>`;
}

// ======= Artikelvy (nyheter) =======

let nvSearchTimer = null;

async function initBgcheckViewer(projectId) {
  const section = document.getElementById('bgcheck-log-section');
  if (projectId !== 'bgcheck') { section.style.display = 'none'; return; }

  section.style.display = '';
  const tbody = document.getElementById('bgcheck-log-body');

  try {
    const res = await fetch(`/api/${projectId}/log?limit=25`);
    if (!res.ok) throw new Error();
    const { data } = await res.json();

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Inga verifieringar ännu</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(row => {
      const time = new Date(row.created_at).toLocaleString('sv-SE');
      const ms = row.response_ms != null ? `${(row.response_ms / 1000).toFixed(1)}s` : '—';

      let resultHtml;
      if (row.error_message) {
        resultHtml = `<span class="status status-failed">Fel</span>`;
      } else if (row.authentic === 1) {
        resultHtml = `<span class="status status-success">Äkta</span>`;
      } else if (row.authentic === 0) {
        resultHtml = `<span class="status status-failed">Ej äkta</span>`;
      } else {
        resultHtml = `<span class="status status-warning">Ej kontrollerad</span>`;
      }

      const verId = row.verification_number
        ? `<span class="mono" style="font-size:0.8em">${escapeHtml(row.verification_number.slice(0, 8))}…</span>`
        : '—';

      const warns = row.warnings ? escapeHtml(row.warnings) : '—';

      return `<tr>
        <td>${time}</td>
        <td><strong>${escapeHtml(row.arendenummer)}</strong></td>
        <td>${resultHtml}</td>
        <td title="${escapeHtml(row.verification_number || '')}">${verId}</td>
        <td>${ms}</td>
        <td>${warns}</td>
      </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="6">Kunde inte hämta logg</td></tr>';
  }
}

async function initArticleViewer(projectId) {
  const section = document.getElementById('article-viewer-section');
  if (projectId !== 'nyheter') { section.style.display = 'none'; return; }

  const searchInput = document.getElementById('nv-search');
  const articleSelect = document.getElementById('nv-article-select');

  document.getElementById('nv-article-detail').style.display = 'none';
  searchInput.value = '';

  await loadArticleOptions(projectId);

  searchInput.oninput = () => {
    clearTimeout(nvSearchTimer);
    nvSearchTimer = setTimeout(() => loadArticleOptions(projectId), 300);
  };

  articleSelect.onchange = () => {
    const id = articleSelect.value;
    if (id) loadArticleDetail(projectId, id);
    else document.getElementById('nv-article-detail').style.display = 'none';
  };

  section.style.display = '';
}

async function loadArticleOptions(projectId) {
  const search = document.getElementById('nv-search').value.trim();
  const select = document.getElementById('nv-article-select');

  let url = `/api/${projectId}/articles?limit=100`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const res = await fetch(url);
    const { data } = await res.json();

    select.innerHTML = '<option value="">Välj artikel...</option>' +
      data.map(a => {
        const datum = a.datum ? a.datum.slice(0, 10) : '—';
        const visn = a.visningar != null ? ` (${a.visningar} visn.)` : '';
        return `<option value="${a.id}">${escapeHtml(`${datum} — ${a.rubrik}${visn}`)}</option>`;
      }).join('');
  } catch {
    select.innerHTML = '<option value="">Kunde inte ladda artiklar</option>';
  }

  document.getElementById('nv-article-detail').style.display = 'none';
}

async function loadArticleDetail(projectId, articleId) {
  const detailEl = document.getElementById('nv-article-detail');
  detailEl.innerHTML = '<div class="sub">Laddar...</div>';
  detailEl.style.display = '';

  try {
    const res = await fetch(`/api/${projectId}/articles/${articleId}`);
    const { data: a } = await res.json();

    const datum = a.datum ? a.datum.slice(0, 10) : '—';

    let html = `<div class="av-info-card">
      <div class="av-info-row">
        <span><strong>Rubrik:</strong> ${escapeHtml(a.rubrik || '—')}</span>
      </div>
      <div class="av-info-row">
        <span><strong>Datum:</strong> ${escapeHtml(datum)}</span>
        <span><strong>Författare:</strong> ${escapeHtml(a.forfattare || '—')}</span>
        <span><strong>Visningar:</strong> ${a.visningar ?? 0}</span>
        <span><strong>Kommentarer:</strong> ${a.kommentarer ?? 0}</span>
      </div>`;

    if (a.url) {
      html += `<div class="av-info-row">
        <span><strong>URL:</strong> <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.url)}</a></span>
      </div>`;
    }

    html += `</div>`;

    if (a.text_content) {
      html += `<div class="nv-article-text">${escapeHtml(a.text_content)}</div>`;
    }

    detailEl.innerHTML = html;
  } catch {
    detailEl.innerHTML = '<div class="sub">Kunde inte ladda artikeln.</div>';
  }
}

// ======= Västtrafik =======

let vtActiveTab = 'vt-tab-live';
let vtActiveStop = null;

function showVasttrafikView() {
  document.getElementById('view-vasttrafik').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = '<span class="sep">/</span>Västtrafik';
  document.title = 'Västtrafik — Compuna Hub';
  currentProject = 'vasttrafik';

  loadVtStops();
  loadVtLive();
  loadVtStats();
  loadVtDelayStats();
  loadVtFavorites();

  refreshTimer = setInterval(() => {
    if (vtActiveTab === 'vt-tab-live') loadVtLive();
  }, 30000);
}

function switchVtTab(tabId) {
  vtActiveTab = tabId;
  document.querySelectorAll('#vt-tabs .site-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('#view-vasttrafik .site-tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));

  if (tabId === 'vt-tab-live') loadVtLive();
  if (tabId === 'vt-tab-stats') loadVtDelayStats();
}

async function loadVtStops() {
  try {
    const res = await fetch('/api/vasttrafik/stops');
    const { data } = await res.json();

    const listEl = document.getElementById('vt-stops-list');
    if (!listEl) return;

    if (data.length === 0) {
      listEl.innerHTML = '<div class="card"><div class="sub">Inga hållplatser konfigurerade.</div></div>';
      return;
    }

    listEl.innerHTML = data.map(s => `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
        <div style="min-width:0;flex:1">
          <strong>${escapeHtml(s.name)}</strong>
          <div class="sub" style="font-family:var(--font-mono);font-size:0.75rem">${escapeHtml(s.stop_area_gid)}${s.enabled ? '' : ' <span style="color:var(--warning)">(inaktiv)</span>'}</div>
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center;flex-shrink:0">
          <button class="btn-small${s.enabled ? ' btn-warn' : ' btn-primary'}" onclick="toggleVtStop('${escapeHtml(s.id)}', ${!s.enabled})">
            ${s.enabled ? 'Pausa' : 'Aktivera'}
          </button>
          <button class="btn-small btn-primary" onclick="testVtStop('${escapeHtml(s.id)}')">Testa</button>
          <button class="btn-small btn-danger" onclick="removeVtStop('${escapeHtml(s.id)}')">Ta bort</button>
        </div>
      </div>
    `).join('');

    // Uppdatera stop-tabs i live-vyn
    const tabsEl = document.getElementById('vt-stop-tabs');
    if (tabsEl) {
      if (!vtActiveStop && data.length > 0) vtActiveStop = data[0].id;
      tabsEl.innerHTML = data.filter(s => s.enabled).map(s =>
        `<button class="site-tab${s.id === vtActiveStop ? ' active' : ''}" onclick="selectVtStop('${escapeHtml(s.id)}')">${escapeHtml(s.name)}</button>`
      ).join('');
    }
  } catch {
    const el = document.getElementById('vt-stops-list');
    if (el) el.innerHTML = '<div class="card"><div class="sub">Kunde inte hämta hållplatser</div></div>';
  }
}

async function loadVtLive() {
  try {
    const res = await fetch('/api/vasttrafik/departures/live');
    const { data } = await res.json();

    const boardEl = document.getElementById('vt-departures-board');
    if (!boardEl) return;

    // Visa aktiv hållplats
    const stops = Object.entries(data);
    if (stops.length === 0) {
      boardEl.innerHTML = '<div class="card"><div class="sub">Inga avgångar i cache — väntar på första poll...</div></div>';
      return;
    }

    // Filtrera på aktiv hållplats om vald
    const filtered = vtActiveStop ? stops.filter(([id]) => id === vtActiveStop) : stops;
    if (filtered.length === 0 && stops.length > 0) {
      vtActiveStop = stops[0][0];
      loadVtStops(); // Uppdatera tabs
      return loadVtLive();
    }

    let html = '';
    for (const [stopId, stop] of filtered) {
      const deps = stop.departures || [];
      if (deps.length === 0) {
        html += `<div class="card"><div class="sub">${escapeHtml(stop.name)}: Inga avgångar</div></div>`;
        continue;
      }

      html += `<table class="vt-departures-table"><thead><tr>
        <th>Linje</th><th>Destination</th><th>Avgång</th><th>Läge</th><th>Status</th>
      </tr></thead><tbody>`;

      for (const d of deps) {
        const line = d.serviceJourney?.line || d.line || {};
        const lineName = line.shortName || line.designation || d.sname || line.name || '?';
        const direction = d.serviceJourney?.direction || d.direction || '';
        const scheduled = d.plannedTime || d.time || '';
        const estimated = d.estimatedTime || d.rtTime || '';
        const track = d.stopPoint?.platform || d.track || '';
        const cancelled = d.isCancelled || false;

        let delaySeconds = 0;
        if (scheduled && estimated) {
          delaySeconds = Math.round((new Date(estimated) - new Date(scheduled)) / 1000);
        }

        const delayMin = Math.round(delaySeconds / 60);
        const timeStr = scheduled ? new Date(scheduled).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '—';

        let statusHtml;
        if (cancelled) {
          statusHtml = '<span style="color:var(--error);font-weight:600">Inställd</span>';
        } else if (delayMin >= 3) {
          statusHtml = `<span style="color:var(--error);font-weight:600">+${delayMin} min</span>`;
        } else if (delayMin >= 1) {
          statusHtml = `<span style="color:var(--warning)">+${delayMin} min</span>`;
        } else {
          statusHtml = '<span style="color:var(--success)">I tid</span>';
        }

        const bgColor = line.backgroundColor || d.bgColor || '#666';
        const fgColor = line.foregroundColor || d.fgColor || '#fff';

        const rowId = `vt-hist-${stopId}-${lineName}`.replace(/\s/g, '-');
        html += `<tr class="vt-dep-row" style="cursor:pointer;${cancelled ? 'opacity:0.5;text-decoration:line-through;' : ''}" onclick="toggleVtLineHistory('${escapeHtml(stopId)}','${escapeHtml(lineName)}','${rowId}')">
          <td><span class="vt-line-badge" style="background:${bgColor};color:${fgColor}">${escapeHtml(lineName)}</span></td>
          <td>${escapeHtml(direction)}</td>
          <td style="font-family:var(--font-mono)">${timeStr}</td>
          <td>${escapeHtml(track)}</td>
          <td>${statusHtml}</td>
        </tr>
        <tr id="${rowId}" class="vt-history-row" style="display:none">
          <td colspan="5" style="padding:0"><div class="vt-history-panel"><div class="spinner-sm"></div> Laddar historik...</div></td>
        </tr>`;
      }

      html += '</tbody></table>';
    }

    boardEl.innerHTML = html;

    // Uppdatera tidstämpel
    const tsEl = document.getElementById('vt-last-updated');
    if (tsEl) tsEl.textContent = `Uppdaterad ${new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    const el = document.getElementById('vt-departures-board');
    if (el) el.innerHTML = `<div class="card"><div class="sub">Fel: ${err.message}</div></div>`;
  }
}

async function toggleVtLineHistory(stopId, lineName, rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  // Toggle synlighet
  if (row.style.display !== 'none') {
    row.style.display = 'none';
    return;
  }

  // Dölj andra öppna historik-rader
  document.querySelectorAll('.vt-history-row').forEach(r => { r.style.display = 'none'; });
  row.style.display = 'table-row';

  const panel = row.querySelector('.vt-history-panel');
  panel.innerHTML = '<div class="spinner-sm"></div> Laddar historik...';

  try {
    const res = await fetch(`/api/vasttrafik/departures/line-history?stop=${encodeURIComponent(stopId)}&line=${encodeURIComponent(lineName)}`);
    const json = await res.json();
    const data = json.data || {};

    const summary = data.summary || {};
    const daily = data.daily || [];
    const recent = data.recent || [];

    // Beräkna trend (jämför senaste vs föregående dagars on_time_pct)
    let trendHtml = '';
    if (daily.length >= 2) {
      const latest = daily[0]?.on_time_pct ?? 0;
      const prev = daily.slice(1).reduce((s, d) => s + (d.on_time_pct ?? 0), 0) / (daily.length - 1);
      const diff = latest - prev;
      if (diff > 2) trendHtml = '<span style="color:var(--success)">&#9650; Förbättras</span>';
      else if (diff < -2) trendHtml = '<span style="color:var(--error)">&#9660; Försämras</span>';
      else trendHtml = '<span style="color:var(--text-muted)">&#9644; Stabil</span>';
    }

    let html = '<div class="vt-history-content">';

    // Sammanfattningskort
    html += '<div class="vt-history-summary">';
    html += `<div class="vt-hist-stat"><div class="vt-hist-val" style="color:var(--accent)">${summary.avg_on_time ?? '—'}%</div><div class="vt-hist-label">Punktlighet</div></div>`;
    html += `<div class="vt-hist-stat"><div class="vt-hist-val">${summary.avg_delay != null ? `${Math.round(summary.avg_delay / 60)}m` : '—'}</div><div class="vt-hist-label">Snittförsening</div></div>`;
    if (trendHtml) html += `<div class="vt-hist-stat"><div class="vt-hist-val">${trendHtml}</div><div class="vt-hist-label">Trend (7d)</div></div>`;
    html += '</div>';

    // Daglig tabell
    if (daily.length > 0) {
      html += '<div class="vt-hist-section-title">Senaste 7 dagarna</div>';
      html += '<div class="vt-history-days">';
      for (const d of daily) {
        const pct = d.on_time_pct ?? 0;
        const barColor = pct >= 90 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--error)';
        const dayName = new Date(d.date).toLocaleDateString('sv-SE', { weekday: 'short' });
        html += `<div class="vt-hist-day">
          <div class="vt-hist-day-label">${dayName}</div>
          <div class="vt-hist-bar-bg"><div class="vt-hist-bar" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="vt-hist-day-pct">${Math.round(pct)}%</div>
        </div>`;
      }
      html += '</div>';
    }

    // Senaste avgångar
    if (recent.length > 0) {
      html += '<div class="vt-hist-section-title">Senaste avgångar</div>';
      html += '<div class="vt-history-recent">';
      for (const r of recent) {
        const time = new Date(r.scheduled_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(r.scheduled_at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
        const delay = Math.round((r.delay_seconds || 0) / 60);
        let statusDot, statusText;
        if (r.is_cancelled) { statusDot = 'var(--error)'; statusText = 'Inställd'; }
        else if (delay >= 3) { statusDot = 'var(--error)'; statusText = `+${delay}m`; }
        else if (delay >= 1) { statusDot = 'var(--warning)'; statusText = `+${delay}m`; }
        else { statusDot = 'var(--success)'; statusText = 'I tid'; }

        html += `<div class="vt-hist-recent-row">
          <span style="color:var(--text-muted)">${date} ${time}</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusDot};margin-right:4px"></span>${statusText}</span>
        </div>`;
      }
      html += '</div>';
    }

    if (daily.length === 0 && recent.length === 0) {
      html += '<div style="color:var(--text-muted);text-align:center;padding:1rem">Ingen historik ännu — data byggs upp</div>';
    }

    html += '</div>';
    panel.innerHTML = html;
  } catch (err) {
    panel.innerHTML = `<div style="color:var(--error);padding:0.5rem">Kunde inte ladda historik: ${err.message}</div>`;
  }
}

function selectVtStop(stopId) {
  vtActiveStop = stopId;
  document.querySelectorAll('#vt-stop-tabs .site-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim() === stopId || t.onclick?.toString().includes(stopId));
  });
  loadVtLive();
}

async function loadVtStats() {
  try {
    const res = await fetch('/api/vasttrafik/stats');
    const { data } = await res.json();

    const gridEl = document.getElementById('vt-stats-grid');
    if (!gridEl) return;

    gridEl.innerHTML = `
      <div class="card"><h3>${data.aktiva_hallplatser}</h3><div class="sub">Hållplatser</div></div>
      <div class="card"><h3>${data.avgangar_24h}</h3><div class="sub">Avgångar (24h)</div></div>
      <div class="card"><h3>${data.i_tid_pct || 0}%</h3><div class="sub">Punktlighet</div></div>
      <div class="card"><h3>${data.installda_24h}</h3><div class="sub">Inställda (24h)</div></div>
      <div class="card"><h3>${data.linjer}</h3><div class="sub">Linjer</div></div>
      <div class="card"><h3>${data.genomsnittlig_forsening}</h3><div class="sub">Snittförsening</div></div>
    `;
  } catch {
    const el = document.getElementById('vt-stats-grid');
    if (el) el.innerHTML = '<div class="card"><div class="sub">Statistik ej tillgänglig</div></div>';
  }
}

async function loadVtFavorites() {
  const el = document.getElementById('vt-stop-favorites');
  if (!el) return;
  try {
    const res = await fetch('/api/vasttrafik/stops/favorites');
    const { data } = await res.json();

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="card"><div class="sub">Inga favoriter ännu</div></div>';
      return;
    }

    el.innerHTML = `<table class="simple-table"><thead><tr>
      <th>Hållplats</th><th>Tillagd av</th><th>Senast</th><th>GID</th>
    </tr></thead><tbody>${data.map(f => `<tr>
      <td>${esc(f.stop_name)}</td>
      <td style="text-align:center;font-weight:600">${f.added_count} st</td>
      <td style="font-size:0.85em;color:var(--gray-500)">${new Date(f.last_added_at).toLocaleDateString('sv-SE')}</td>
      <td style="font-size:0.8em;font-family:var(--font-mono);color:var(--gray-500)">${esc(f.stop_area_gid)}</td>
    </tr>`).join('')}</tbody></table>`;
  } catch {
    el.innerHTML = '<div class="card"><div class="sub">Kunde inte ladda favoriter</div></div>';
  }
}

async function loadVtDelayStats() {
  try {
    const res = await fetch('/api/vasttrafik/departures/delays?period=7d');
    const json = await res.json();
    const data = json.data || {};

    // Per linje
    const lineEl = document.getElementById('vt-delay-by-line');
    if (lineEl && data.byLine?.length > 0) {
      lineEl.innerHTML = `<table><thead><tr>
        <th></th><th>Linje</th><th>Hållplats</th><th>Avgångar</th><th>Försenade</th><th>Inställda</th><th>Snitt</th><th>Punktlighet</th>
      </tr></thead><tbody>` + data.byLine.map((r, i) => {
        const rowId = `vt-delay-detail-${i}`;
        const stopId = escapeHtml(r.stop_id || '');
        const lineName = escapeHtml(r.line_name || '');
        return `
        <tr class="vt-delay-row" onclick="toggleDelayDetail('${stopId}','${lineName}','${rowId}')">
          <td class="vt-delay-chevron" id="chev-${rowId}">&#9656;</td>
          <td><strong>${escapeHtml(r.line_name)}</strong></td>
          <td>${escapeHtml((r.stop_name || '').replace(/, Göteborg$/i, ''))}</td>
          <td>${r.total}</td>
          <td>${r.delayed_count}</td>
          <td>${r.cancelled}</td>
          <td style="font-family:var(--font-mono)">${r.avg_delay ? Math.round(r.avg_delay / 60) + ' min' : '—'}</td>
          <td><span style="color:${r.on_time_pct >= 90 ? 'var(--success)' : r.on_time_pct >= 75 ? 'var(--warning)' : 'var(--error)'};font-weight:600">${r.on_time_pct || 0}%</span></td>
        </tr>
        <tr id="${rowId}" class="vt-delay-detail-row" style="display:none">
          <td colspan="8" style="padding:0"><div class="vt-history-panel"></div></td>
        </tr>`;
      }).join('') + '</tbody></table>';
    } else if (lineEl) {
      lineEl.innerHTML = '<div class="card"><div class="sub">Ingen data ännu</div></div>';
    }

    // Per hållplats
    const stopEl = document.getElementById('vt-delay-by-stop');
    if (stopEl && data.byStop?.length > 0) {
      stopEl.innerHTML = `<table><thead><tr>
        <th>Hållplats</th><th>Avgångar</th><th>Försenade</th><th>Inställda</th><th>Snitt</th><th>Punktlighet</th>
      </tr></thead><tbody>` + data.byStop.map(r => `
        <tr>
          <td><strong>${escapeHtml(r.stop_name)}</strong></td>
          <td>${r.total}</td>
          <td>${r.delayed_count}</td>
          <td>${r.cancelled}</td>
          <td style="font-family:var(--font-mono)">${r.avg_delay ? Math.round(r.avg_delay / 60) + ' min' : '—'}</td>
          <td><span style="color:${r.on_time_pct >= 90 ? 'var(--success)' : r.on_time_pct >= 75 ? 'var(--warning)' : 'var(--error)'};font-weight:600">${r.on_time_pct || 0}%</span></td>
        </tr>
      `).join('') + '</tbody></table>';
    } else if (stopEl) {
      stopEl.innerHTML = '<div class="card"><div class="sub">Ingen data ännu</div></div>';
    }

    // Trend
    const trendEl = document.getElementById('vt-delay-trend');
    if (trendEl && data.trend?.length > 0) {
      renderVtTrendChart(trendEl, data.trend);
    } else if (trendEl) {
      trendEl.innerHTML = '<div class="card"><div class="sub">Ingen trenddata ännu</div></div>';
    }
  } catch (err) {
    console.error('loadVtDelayStats error:', err);
    const lineEl = document.getElementById('vt-delay-by-line');
    if (lineEl && !lineEl.innerHTML) lineEl.innerHTML = '<div class="card"><div class="sub">Kunde inte ladda data</div></div>';
  }
}

async function toggleDelayDetail(stopId, lineName, rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const chevron = document.getElementById(`chev-${rowId}`);

  // Toggle synlighet
  if (row.style.display !== 'none') {
    row.style.display = 'none';
    if (chevron) chevron.classList.remove('open');
    return;
  }

  // Dölj andra öppna detail-rader
  document.querySelectorAll('.vt-delay-detail-row').forEach(r => { r.style.display = 'none'; });
  document.querySelectorAll('.vt-delay-chevron').forEach(c => c.classList.remove('open'));
  row.style.display = 'table-row';
  if (chevron) chevron.classList.add('open');

  const panel = row.querySelector('.vt-history-panel');
  panel.innerHTML = '<div class="spinner-sm"></div> Laddar...';

  try {
    const res = await fetch(`/api/vasttrafik/departures/line-history?stop=${encodeURIComponent(stopId)}&line=${encodeURIComponent(lineName)}`);
    const json = await res.json();
    const data = json.data || {};

    const summary = data.summary || {};
    const daily = data.daily || [];
    const recent = data.recent || [];
    const byHour = data.byHour || [];

    // Trend
    let trendHtml = '';
    if (daily.length >= 2) {
      const latest = daily[0]?.on_time_pct ?? 0;
      const prev = daily.slice(1).reduce((s, d) => s + (d.on_time_pct ?? 0), 0) / (daily.length - 1);
      const diff = latest - prev;
      if (diff > 2) trendHtml = '<span style="color:var(--success)">&#9650; Förbättras</span>';
      else if (diff < -2) trendHtml = '<span style="color:var(--error)">&#9660; Försämras</span>';
      else trendHtml = '<span style="color:var(--text-muted)">&#9644; Stabil</span>';
    }

    let html = '<div class="vt-history-content">';

    // Sammanfattningskort
    html += '<div class="vt-history-summary">';
    html += `<div class="vt-hist-stat"><div class="vt-hist-val" style="color:var(--accent)">${summary.avg_on_time ?? '—'}%</div><div class="vt-hist-label">Punktlighet</div></div>`;
    html += `<div class="vt-hist-stat"><div class="vt-hist-val">${summary.avg_delay != null ? `${Math.round(summary.avg_delay / 60)}m` : '—'}</div><div class="vt-hist-label">Snittförsening</div></div>`;
    html += `<div class="vt-hist-stat"><div class="vt-hist-val">${summary.total_deps ?? '—'}</div><div class="vt-hist-label">Avgångar totalt</div></div>`;
    if (trendHtml) html += `<div class="vt-hist-stat"><div class="vt-hist-val">${trendHtml}</div><div class="vt-hist-label">Trend (7d)</div></div>`;
    html += '</div>';

    // Dagliga bars
    if (daily.length > 0) {
      html += '<div class="vt-hist-section-title">Senaste 7 dagarna</div>';
      html += '<div class="vt-history-days">';
      for (const d of daily) {
        const pct = d.on_time_pct ?? 0;
        const barColor = pct >= 90 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--error)';
        const dayName = new Date(d.date).toLocaleDateString('sv-SE', { weekday: 'short' });
        html += `<div class="vt-hist-day">
          <div class="vt-hist-day-label">${dayName}</div>
          <div class="vt-hist-bar-bg"><div class="vt-hist-bar" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="vt-hist-day-pct">${Math.round(pct)}%</div>
        </div>`;
      }
      html += '</div>';
    }

    // Per timme
    if (byHour.length > 0) {
      html += '<div class="vt-hist-section-title" style="margin-top:0.6rem">Per timme (senaste 7 dagar)</div>';
      html += '<div class="vt-hist-hours">';
      const maxTotal = Math.max(...byHour.map(h => h.total), 1);
      for (const h of byHour) {
        const pct = h.on_time_pct ?? 0;
        const barColor = pct >= 90 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--error)';
        const barWidth = Math.round((h.total / maxTotal) * 100);
        const avgMin = h.avg_delay ? Math.round(h.avg_delay / 60) : 0;
        const hourLabel = `${String(h.hour).padStart(2, '0')}:00`;
        html += `<div class="vt-hist-hour">
          <div class="vt-hist-hour-label">${hourLabel}</div>
          <div class="vt-hist-bar-bg"><div class="vt-hist-bar" style="width:${barWidth}%;background:${barColor}"></div></div>
          <div class="vt-hist-hour-stats">${Math.round(pct)}% <span style="color:var(--gray-500)">(${h.total} avg, ${avgMin > 0 ? '+' + avgMin + 'm' : 'i tid'})</span></div>
        </div>`;
      }
      html += '</div>';
    }

    // Senaste avgångar
    if (recent.length > 0) {
      html += '<div class="vt-hist-section-title" style="margin-top:0.6rem">Senaste avgångar</div>';
      html += '<div class="vt-history-recent">';
      for (const r of recent) {
        const time = new Date(r.scheduled_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(r.scheduled_at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
        const delay = Math.round((r.delay_seconds || 0) / 60);
        let statusDot, statusText;
        if (r.is_cancelled) { statusDot = 'var(--error)'; statusText = 'Inställd'; }
        else if (delay >= 3) { statusDot = 'var(--error)'; statusText = `+${delay}m`; }
        else if (delay >= 1) { statusDot = 'var(--warning)'; statusText = `+${delay}m`; }
        else { statusDot = 'var(--success)'; statusText = 'I tid'; }

        html += `<div class="vt-hist-recent-row">
          <span style="color:var(--text-muted)">${date} ${time}</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusDot};margin-right:4px"></span>${statusText}</span>
        </div>`;
      }
      html += '</div>';
    }

    if (daily.length === 0 && recent.length === 0 && byHour.length === 0) {
      html += '<div style="color:var(--text-muted);text-align:center;padding:1rem">Ingen historik ännu — data byggs upp</div>';
    }

    html += '</div>';
    panel.innerHTML = html;
  } catch (err) {
    panel.innerHTML = `<div style="color:var(--error);padding:0.5rem">Kunde inte ladda detaljer: ${err.message}</div>`;
  }
}

function renderVtTrendChart(container, trend) {
  const W = 600, H = 200, P = 40;
  const maxDelay = Math.max(...trend.map(t => Math.abs(t.avg_delay || 0)), 60);

  const scaleX = (i) => P + (i / (trend.length - 1 || 1)) * (W - P * 2);
  const scaleY = (v) => H - P - (v / maxDelay) * (H - P * 2);

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // Gridlinjer
  for (let i = 0; i <= 4; i++) {
    const y = P + i * (H - P * 2) / 4;
    const val = Math.round(maxDelay * (1 - i / 4) / 60);
    svg += `<line x1="${P}" y1="${y}" x2="${W - P}" y2="${y}" class="chart-grid"/>`;
    svg += `<text x="${P - 5}" y="${y + 4}" text-anchor="end" class="chart-axis">${val}m</text>`;
  }

  // Datumaxel
  trend.forEach((t, i) => {
    if (i % Math.ceil(trend.length / 7) === 0) {
      const x = scaleX(i);
      const label = t.date?.slice(5) || '';
      svg += `<text x="${x}" y="${H - 8}" text-anchor="middle" class="chart-axis">${label}</text>`;
    }
  });

  // Linje
  const points = trend.map((t, i) => `${scaleX(i)},${scaleY(Math.abs(t.avg_delay || 0))}`).join(' ');
  svg += `<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;

  // Punkter
  trend.forEach((t, i) => {
    svg += `<circle cx="${scaleX(i)}" cy="${scaleY(Math.abs(t.avg_delay || 0))}" r="3" fill="var(--accent)"/>`;
  });

  svg += '</svg>';
  container.innerHTML = `<div class="chart-container">${svg}</div>`;
}

async function addVtStop() {
  const queryEl = document.getElementById('vt-search-input');
  const resultEl = document.getElementById('vt-search-results');
  if (!queryEl?.value) return;

  resultEl.innerHTML = '<div class="sub">Söker...</div>';

  try {
    const res = await fetch('/api/vasttrafik/stops/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryEl.value }),
    });
    const { data } = await res.json();

    if (data.length === 0) {
      resultEl.innerHTML = '<div class="sub">Inga resultat</div>';
      return;
    }

    resultEl.innerHTML = data.map(s => {
      const id = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
      return `<div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.3rem;padding:0.6rem 0.8rem;">
        <div>
          <strong>${escapeHtml(s.name)}</strong>
          <div class="sub">${escapeHtml(s.gid)}</div>
        </div>
        <button class="btn-small btn-primary" onclick="saveVtStop('${escapeHtml(id)}', '${escapeHtml(s.name)}', '${escapeHtml(s.gid)}', ${s.latitude || 'null'}, ${s.longitude || 'null'})">Lägg till</button>
      </div>`;
    }).join('');
  } catch (err) {
    resultEl.innerHTML = `<div class="sub" style="color:var(--error)">${err.message}</div>`;
  }
}

async function saveVtStop(id, name, gid, lat, lng) {
  try {
    const res = await fetch('/api/vasttrafik/stops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, stop_area_gid: gid, latitude: lat, longitude: lng }),
    });
    const data = await res.json();
    if (res.ok) {
      loadVtStops();
      document.getElementById('vt-search-results').innerHTML = `<div class="sub" style="color:var(--success)">${data.message}</div>`;
    } else {
      document.getElementById('vt-search-results').innerHTML = `<div class="sub" style="color:var(--error)">${data.error}</div>`;
    }
  } catch (err) {
    document.getElementById('vt-search-results').innerHTML = `<div class="sub" style="color:var(--error)">${err.message}</div>`;
  }
}

async function toggleVtStop(id, enabled) {
  try {
    await fetch(`/api/vasttrafik/stops/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    loadVtStops();
  } catch {}
}

async function removeVtStop(id) {
  if (!confirm(`Ta bort hållplats "${id}"? All historisk data raderas.`)) return;
  try {
    await fetch(`/api/vasttrafik/stops/${id}`, { method: 'DELETE' });
    loadVtStops();
  } catch {}
}

async function testVtStop(id) {
  try {
    const res = await fetch(`/api/vasttrafik/stops/${id}/test`, { method: 'POST' });
    const data = await res.json();
    alert(data.ok
      ? `Hämtade ${data.departures} avgångar på ${data.responseMs}ms`
      : `Fel: ${data.error}`
    );
  } catch (err) {
    alert('Test misslyckades: ' + err.message);
  }
}

async function testVtApi() {
  const btn = document.getElementById('vt-test-api-btn');
  const resultEl = document.getElementById('vt-test-api-result');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/vasttrafik/stops/test-api', { method: 'POST' });
    const data = await res.json();
    if (resultEl) {
      resultEl.innerHTML = data.ok
        ? `<span style="color:var(--success)">${data.message}</span>`
        : `<span style="color:var(--error)">${data.message}</span>`;
      resultEl.style.display = '';
    }
  } catch (err) {
    if (resultEl) {
      resultEl.innerHTML = `<span style="color:var(--error)">Fel: ${err.message}</span>`;
      resultEl.style.display = '';
    }
  }

  if (btn) btn.disabled = false;
}

// ======= Sportanalys =======

let saActiveTab = 'sa-tab-dashboard';
let saAllJobs = [];
let saCurrentFilter = 'all';
let saSelectedFile = null;

function showSportanalysView() {
  document.getElementById('view-sportanalys').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = '<span class="sep">/</span>Sportanalys';
  document.title = 'Sportanalys — Compuna Hub';
  currentProject = 'sportanalys';

  loadSaStats();
  loadSaRecentJobs();
  initSaUploadZone();

  refreshTimer = setInterval(() => {
    if (saActiveTab === 'sa-tab-dashboard') {
      loadSaStats();
      loadSaRecentJobs();
    }
  }, 30000);
}

function switchSaTab(tabId) {
  saActiveTab = tabId;
  document.querySelectorAll('#sa-tabs .site-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('#view-sportanalys .site-tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));

  if (tabId === 'sa-tab-dashboard') { loadSaStats(); loadSaRecentJobs(); }
  if (tabId === 'sa-tab-jobs') loadSaJobs();
}

async function loadSaStats() {
  try {
    const res = await fetch('/api/sportanalys/stats');
    const { data } = await res.json();
    const grid = document.getElementById('sa-stats-grid');
    if (!grid) return;

    const color = projects.sportanalys?.color || '#e74c3c';
    const fields = [
      { key: 'totalt', label: 'Totalt' },
      { key: 'vantande', label: 'Väntande' },
      { key: 'bearbetar', label: 'Bearbetar' },
      { key: 'klara', label: 'Klara' },
      { key: 'misslyckade', label: 'Misslyckade' },
    ];

    grid.innerHTML = fields.map(f => `
      <div class="card">
        <h3>${f.label}</h3>
        <div class="value" style="color:${color}">${data[f.key] ?? '—'}</div>
      </div>
    `).join('');

    if (data.backend_status === 'offline') {
      grid.innerHTML += `<div class="card"><h3>Backend</h3><div class="value" style="color:var(--error)">Offline</div><div class="sub">${escapeHtml(data.error || '')}</div></div>`;
    }
  } catch {
    const grid = document.getElementById('sa-stats-grid');
    if (grid) grid.innerHTML = '<div class="card"><h3>Fel</h3><div class="sub">Kunde inte ladda statistik</div></div>';
  }
}

async function loadSaRecentJobs() {
  try {
    const res = await fetch('/api/sportanalys/jobs');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    saAllJobs = data.jobs || [];
    const tbody = document.getElementById('sa-recent-jobs');
    if (!tbody) return;

    const recent = saAllJobs.slice(-10).reverse();
    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--navy-400)">Inga jobb ännu</td></tr>';
      return;
    }
    tbody.innerHTML = recent.map(j => `
      <tr>
        <td>#${j.id}</td>
        <td>${escapeHtml(j.home || '')} vs ${escapeHtml(j.away || '')}</td>
        <td>${j.date || '—'}</td>
        <td><span class="status-badge ${saStatusClass(j.status)}">${saStatusLabel(j.status)}</span></td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(j.filename || '')}</td>
        <td>
          <button class="btn-small" onclick="showSaJobDetail(${j.id})">Detaljer</button>
          ${j.status === 'done' ? `<button class="btn-small btn-primary" onclick="showSaResult(${j.id})">Resultat</button>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    const tbody = document.getElementById('sa-recent-jobs');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--error)">Kunde inte ladda: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadSaJobs() {
  try {
    const url = saCurrentFilter === 'all' ? '/api/sportanalys/jobs' : `/api/sportanalys/jobs?status=${saCurrentFilter}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = (data.jobs || []).slice().reverse();
    const tbody = document.getElementById('sa-jobs-table');
    if (!tbody) return;

    if (jobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--navy-400)">Inga jobb matchar filtret</td></tr>';
      return;
    }
    tbody.innerHTML = jobs.map(j => `
      <tr>
        <td>#${j.id}</td>
        <td>${escapeHtml(j.home || '')} vs ${escapeHtml(j.away || '')}</td>
        <td>${j.date || '—'}</td>
        <td>${saHalfLabel(j.half)}</td>
        <td><span class="status-badge ${saStatusClass(j.status)}">${saStatusLabel(j.status)}</span></td>
        <td>${j.progress != null ? j.progress + '%' : '—'}</td>
        <td>
          <button class="btn-small" onclick="showSaJobDetail(${j.id})">Detaljer</button>
          ${j.status === 'done' ? `<button class="btn-small btn-primary" onclick="showSaResult(${j.id})">Resultat</button>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    const tbody = document.getElementById('sa-jobs-table');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--error)">Kunde inte ladda: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function filterSaJobs(filter) {
  saCurrentFilter = filter;
  document.querySelectorAll('.sa-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  loadSaJobs();
}

async function showSaJobDetail(id) {
  switchSaTab('sa-tab-jobs');
  const section = document.getElementById('sa-detail-section');
  const grid = document.getElementById('sa-detail-grid');
  document.getElementById('sa-detail-title').textContent = `Jobbdetaljer — #${id}`;
  section.style.display = '';
  grid.innerHTML = '<div class="card"><div class="sub">Laddar...</div></div>';

  try {
    const res = await fetch(`/api/sportanalys/jobs/${id}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();

    const fields = [
      { label: 'Status', val: `<span class="status-badge ${saStatusClass(j.status)}">${saStatusLabel(j.status)}</span>` },
      j.progress != null ? { label: 'Progress', val: `${j.progress}%` } : null,
      j.home ? { label: 'Hemmalag', val: escapeHtml(j.home) } : null,
      j.away ? { label: 'Bortalag', val: escapeHtml(j.away) } : null,
      j.date ? { label: 'Matchdatum', val: j.date } : null,
      j.half ? { label: 'Halvlek', val: saHalfLabel(j.half) } : null,
      j.filename ? { label: 'Fil', val: escapeHtml(j.filename) } : null,
      j.created_at ? { label: 'Skapad', val: j.created_at } : null,
      j.error ? { label: 'Fel', val: `<span style="color:var(--error)">${escapeHtml(j.error)}</span>` } : null,
    ].filter(Boolean);

    grid.innerHTML = fields.map(f =>
      `<div class="card"><h3>${f.label}</h3><div class="value" style="font-size:1rem">${f.val}</div></div>`
    ).join('');
    section.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    grid.innerHTML = `<div class="card"><div class="sub" style="color:var(--error)">Kunde inte ladda: ${escapeHtml(err.message)}</div></div>`;
  }
}

// Översätt vanliga stats-nycklar till svenska
const SA_STAT_LABELS = {
  possession: 'Bollinnehav', possession_home: 'Bollinnehav hemma', possession_away: 'Bollinnehav borta',
  shots: 'Skott', shots_home: 'Skott hemma', shots_away: 'Skott borta',
  passes: 'Passningar', passes_home: 'Passningar hemma', passes_away: 'Passningar borta',
  goals: 'Mål', goals_home: 'Mål hemma', goals_away: 'Mål borta',
  corners: 'Hörnor', fouls: 'Regelbrott', offsides: 'Offsides',
  distance: 'Total distans', avg_speed: 'Medelhastighet',
  players_detected: 'Spelar detekterade', ball_detected: 'Boll detekterad',
  total_frames: 'Antal frames', fps: 'FPS', duration: 'Längd',
  heatmap: 'Heatmap', formations: 'Formationer',
};

function saFormatStatValue(key, val) {
  if (val == null) return '—';
  if (typeof val === 'boolean') return val ? 'Ja' : 'Nej';
  if (typeof val === 'number') {
    if (key.includes('possession')) return val + '%';
    if (key.includes('speed')) return val.toFixed(1) + ' km/h';
    if (key.includes('distance')) return val >= 1000 ? (val / 1000).toFixed(1) + ' km' : val + ' m';
    if (key === 'duration') return val >= 60 ? Math.floor(val / 60) + ':' + String(Math.floor(val % 60)).padStart(2, '0') : val + 's';
    return typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(2) : String(val);
  }
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function saRenderStatsGrid(stats) {
  if (!stats || typeof stats !== 'object') return '';
  const keys = Object.keys(stats).filter(k => typeof stats[k] !== 'object' || stats[k] === null);
  if (keys.length === 0) return '';

  const cards = keys.map(k => {
    const label = SA_STAT_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const val = saFormatStatValue(k, stats[k]);
    return `<div class="card"><h3>${escapeHtml(label)}</h3><div class="value" style="font-size:1.1rem">${escapeHtml(val)}</div></div>`;
  }).join('');

  // Kolla om det finns nested objekt (t.ex. per-lag stats)
  const nested = Object.keys(stats).filter(k => stats[k] && typeof stats[k] === 'object' && !Array.isArray(stats[k]));
  let nestedHtml = '';
  for (const nk of nested) {
    const subLabel = SA_STAT_LABELS[nk] || nk.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const subKeys = Object.keys(stats[nk]);
    const subCards = subKeys.map(sk => {
      const label = SA_STAT_LABELS[sk] || sk.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `<div class="card"><h3>${escapeHtml(label)}</h3><div class="value" style="font-size:1.1rem">${escapeHtml(saFormatStatValue(sk, stats[nk][sk]))}</div></div>`;
    }).join('');
    nestedHtml += `<h3 style="margin:1rem 0 0.5rem;color:var(--gray-400)">${escapeHtml(subLabel)}</h3><div class="grid">${subCards}</div>`;
  }

  return `<h3 style="margin-bottom:0.5rem">Statistik</h3><div class="grid">${cards}</div>${nestedHtml}`;
}

function saRenderTracking(tracking) {
  if (!tracking || typeof tracking !== 'object') return '';

  // Försök extrahera sammanfattning oavsett format
  const summary = [];
  if (Array.isArray(tracking)) {
    summary.push({ label: 'Spårade objekt', val: tracking.length });
  } else {
    for (const [k, v] of Object.entries(tracking)) {
      if (Array.isArray(v)) {
        summary.push({ label: SA_STAT_LABELS[k] || k.replace(/_/g, ' '), val: `${v.length} poster` });
      } else if (typeof v === 'number' || typeof v === 'string') {
        summary.push({ label: SA_STAT_LABELS[k] || k.replace(/_/g, ' '), val: saFormatStatValue(k, v) });
      }
    }
  }

  if (summary.length === 0) return '';

  const cards = summary.map(s =>
    `<div class="card"><h3>${escapeHtml(s.label)}</h3><div class="value" style="font-size:1.1rem">${escapeHtml(String(s.val))}</div></div>`
  ).join('');

  return `<h3 style="margin-bottom:0.5rem">Tracking</h3><div class="grid">${cards}</div>`;
}

async function showSaResult(id) {
  switchSaTab('sa-tab-jobs');
  const section = document.getElementById('sa-result-section');
  const meta = document.getElementById('sa-result-meta');
  const statsEl = document.getElementById('sa-result-stats');
  const trackingEl = document.getElementById('sa-result-tracking');
  const rawEl = document.getElementById('sa-result-raw');

  document.getElementById('sa-result-title').textContent = `Analysresultat — Jobb #${id}`;
  section.style.display = '';
  meta.innerHTML = '<div class="card"><div class="sub">Laddar...</div></div>';
  statsEl.innerHTML = '';
  trackingEl.innerHTML = '';
  rawEl.innerHTML = '';

  try {
    const [statusRes, resultRes] = await Promise.all([
      fetch(`/api/sportanalys/jobs/${id}/status`),
      fetch(`/api/sportanalys/jobs/${id}/result`),
    ]);
    if (!statusRes.ok || !resultRes.ok) throw new Error('Kunde inte hämta resultat');
    const status = await statusRes.json();
    const result = await resultRes.json();

    // Matchinfo
    meta.innerHTML = [
      { label: 'Hemmalag', val: status.home },
      { label: 'Bortalag', val: status.away },
      { label: 'Datum', val: status.date },
      { label: 'Halvlek', val: saHalfLabel(status.half) },
    ].map(f => `<div class="card"><h3>${f.label}</h3><div class="value">${escapeHtml(f.val || '—')}</div></div>`).join('');

    // Statistik
    statsEl.innerHTML = saRenderStatsGrid(result.stats);

    // Tracking
    trackingEl.innerHTML = saRenderTracking(result.tracking);

    // Rå JSON (alltid tillgängligt, kollapsat)
    rawEl.innerHTML = `
      <details style="margin-top:1rem">
        <summary style="cursor:pointer;color:var(--gray-400);font-size:0.85rem">Visa rå JSON-data</summary>
        <div class="card" style="margin-top:0.5rem">
          <pre style="white-space:pre-wrap;font-size:0.75rem;font-family:var(--font-mono);max-height:400px;overflow:auto">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
        </div>
      </details>`;

    section.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    meta.innerHTML = '';
    statsEl.innerHTML = `<div class="card"><div class="sub" style="color:var(--error)">Kunde inte ladda: ${escapeHtml(err.message)}</div></div>`;
  }
}

// Upload

let saUploadZoneInitialized = false;

function initSaUploadZone() {
  if (saUploadZoneInitialized) return;
  saUploadZoneInitialized = true;

  const zone = document.getElementById('sa-upload-zone');
  const input = document.getElementById('sa-file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--navy-600)'; });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = 'var(--navy-600)';
    if (e.dataTransfer.files.length) handleSaFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files.length) handleSaFile(input.files[0]); });
}

function handleSaFile(file) {
  const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
  if (!allowed.includes(file.type)) {
    alert('Filtypen stöds inte. Välj mp4, mov, avi eller webm.');
    return;
  }
  if (file.size > 5 * 1024 * 1024 * 1024) {
    alert('Filen är för stor. Max 5 GB.');
    return;
  }
  saSelectedFile = file;
  const zone = document.getElementById('sa-upload-zone');
  zone.style.borderColor = 'var(--success)';
  document.getElementById('sa-file-info').style.display = '';
  document.getElementById('sa-file-info').innerHTML =
    `<strong>${escapeHtml(file.name)}</strong> (${saFormatBytes(file.size)}) <span style="color:var(--error);cursor:pointer;margin-left:0.5rem" onclick="clearSaFile(event)">✕ Ta bort</span>`;
}

function clearSaFile(e) {
  if (e) e.stopPropagation();
  saSelectedFile = null;
  document.getElementById('sa-file-input').value = '';
  document.getElementById('sa-upload-zone').style.borderColor = 'var(--navy-600)';
  document.getElementById('sa-file-info').style.display = 'none';
}

function startSaUpload() {
  if (!saSelectedFile) { alert('Välj en videofil först.'); return; }

  const home = document.getElementById('sa-input-home').value.trim();
  const away = document.getElementById('sa-input-away').value.trim();
  const date = document.getElementById('sa-input-date').value;
  const half = document.getElementById('sa-input-half').value;

  if (!home || !away) { alert('Fyll i hemmalag och bortalag.'); return; }
  if (!date) { alert('Välj matchdatum.'); return; }

  const form = new FormData();
  form.append('video', saSelectedFile);
  form.append('home', home);
  form.append('away', away);
  form.append('date', date);
  form.append('half', half);

  const btn = document.getElementById('sa-btn-upload');
  btn.disabled = true;
  const progressSection = document.getElementById('sa-upload-progress');
  progressSection.style.display = '';

  const xhr = new XMLHttpRequest();
  const startTime = Date.now();

  xhr.upload.addEventListener('progress', e => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    document.getElementById('sa-progress-bar').style.width = pct + '%';
    document.getElementById('sa-upload-percent').textContent = pct + '%';
    document.getElementById('sa-upload-size').textContent = saFormatBytes(e.loaded) + ' / ' + saFormatBytes(e.total);
  });

  xhr.addEventListener('load', () => {
    btn.disabled = false;
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        document.getElementById('sa-upload-status-text').textContent = 'Uppladdning klar!';
        alert('Jobb #' + data.job_id + ' skapades.');
        clearSaFile();
        document.getElementById('sa-input-home').value = '';
        document.getElementById('sa-input-away').value = '';
        document.getElementById('sa-input-date').value = '';
        setTimeout(() => {
          progressSection.style.display = 'none';
          document.getElementById('sa-progress-bar').style.width = '0%';
          document.getElementById('sa-upload-status-text').textContent = 'Laddar upp...';
        }, 2000);
      } catch {
        document.getElementById('sa-upload-status-text').textContent = 'Oväntat svar.';
      }
    } else {
      document.getElementById('sa-upload-status-text').textContent = 'Uppladdning misslyckades.';
      alert('Fel: HTTP ' + xhr.status + ' — ' + xhr.responseText);
    }
  });

  xhr.addEventListener('error', () => {
    btn.disabled = false;
    document.getElementById('sa-upload-status-text').textContent = 'Nätverksfel.';
    alert('Nätverksfel vid uppladdning.');
  });

  xhr.open('POST', '/api/sportanalys/upload');
  document.getElementById('sa-upload-status-text').textContent = 'Laddar upp...';
  xhr.send(form);
}

async function testSaBackend() {
  const el = document.getElementById('sa-health-result');
  el.style.display = '';
  el.innerHTML = 'Testar...';
  try {
    const res = await fetch('/api/sportanalys/health');
    const data = await res.json();
    if (data.status === 'ok') {
      el.innerHTML = `<span style="color:var(--success)">OK — ${data.time || ''}</span>`;
    } else {
      el.innerHTML = `<span style="color:var(--warning)">Svar: ${JSON.stringify(data)}</span>`;
    }
  } catch (err) {
    el.innerHTML = `<span style="color:var(--error)">Ej nåbar: ${escapeHtml(err.message)}</span>`;
  }
}

// Helpers

function saStatusLabel(s) {
  const map = { pending: 'Väntande', processing: 'Bearbetar', done: 'Klar', failed: 'Misslyckad' };
  return map[s] || s || '—';
}

function saStatusClass(s) {
  const map = { pending: 'warning', processing: 'info', done: 'ok', failed: 'error' };
  return map[s] || 'info';
}

function saHalfLabel(h) {
  if (h === '1' || h === 1) return '1:a';
  if (h === '2' || h === 2) return '2:a';
  if (h === 'full') return 'Hel';
  return h || '—';
}

function saFormatBytes(b) {
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0) + ' ' + sizes[i];
}

// Diagnostik

async function runSaDiagnostics() {
  const btn = document.getElementById('sa-diag-btn');
  const el = document.getElementById('sa-diag-results');
  btn.disabled = true;
  btn.textContent = 'Testar...';
  el.innerHTML = '<div class="card"><div class="sub">Kör diagnostik...</div></div>';

  try {
    const start = Date.now();
    const res = await fetch('/api/sportanalys/diagnostics');
    const data = await res.json();
    const totalMs = Date.now() - start;
    const tests = data.tests || [];

    if (tests.length === 0 && data.error) {
      el.innerHTML = `
        <div class="card"><div class="sub" style="color:var(--error)">Server-fel: ${escapeHtml(data.error)}</div></div>
      `;
    } else {
      el.innerHTML = `
        <div style="margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem">
          <span class="status-badge ${data.ok ? 'ok' : 'error'}">${data.ok ? 'ALLA OK' : 'FEL'}</span>
          <span class="sub">${data.timestamp || ''} (${totalMs}ms totalt)</span>
        </div>
        ${tests.map(t => `
          <div class="card" style="margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between">
            <div>
              <strong>${escapeHtml(t.test)}</strong>
              ${t.error ? `<div class="sub" style="color:var(--error)">${escapeHtml(t.error)}</div>` : ''}
              ${t.data ? `<div class="sub">${escapeHtml(JSON.stringify(t.data))}</div>` : ''}
              ${t.jobCount != null ? `<div class="sub">${t.jobCount} jobb</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span class="status-badge ${t.ok ? 'ok' : 'error'}">${t.ok ? 'OK' : 'FEL'}</span>
              <div class="sub" style="font-family:var(--font-mono)">${t.ms}ms</div>
            </div>
          </div>
        `).join('')}
      `;
    }
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="sub" style="color:var(--error)">Diagnostik misslyckades: ${escapeHtml(err.message)}</div></div>`;
  }

  btn.disabled = false;
  btn.textContent = 'Kör diagnostik';
}

const SA_ENDPOINT_TESTS = [
  { method: 'GET',  path: '/health',         label: 'Health' },
  { method: 'GET',  path: '/stats',          label: 'Stats' },
  { method: 'GET',  path: '/jobs',           label: 'Jobs-lista' },
  { method: 'GET',  path: '/jobs/1/status',  label: 'Jobb #1 status' },
  { method: 'GET',  path: '/jobs/1/result',  label: 'Jobb #1 resultat' },
  { method: 'GET',  path: '/jobs/1/video',   label: 'Jobb #1 video', binary: true },
  { method: 'GET',  path: '/jobs/1/tracking', label: 'Jobb #1 tracking' },
  { method: 'GET',  path: '/annotations/1',  label: 'Annotations #1' },
  { method: 'POST', path: '/annotations/1',  label: 'POST annotations', body: { test: true } },
  { method: 'PUT',  path: '/annotations/1',  label: 'PUT annotations', body: { test: true } },
];

async function runSaEndpointTests() {
  const btn = document.getElementById('sa-endpoints-btn');
  const el = document.getElementById('sa-endpoints-results');
  btn.disabled = true;
  btn.textContent = 'Testar endpoints...';

  const results = [];

  for (const ep of SA_ENDPOINT_TESTS) {
    const start = Date.now();
    try {
      const opts = { method: ep.method };
      if (ep.body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(ep.body);
      }
      const res = await fetch(`/api/sportanalys${ep.path}`, opts);
      const ms = Date.now() - start;
      const contentType = res.headers.get('content-type') || '';

      let size = '';
      let detail = '';
      if (ep.binary) {
        const blob = await res.blob();
        size = blob.size > 1024*1024
          ? (blob.size / (1024*1024)).toFixed(1) + ' MB'
          : (blob.size / 1024).toFixed(0) + ' KB';
        detail = contentType.split(';')[0];
      } else {
        try {
          const data = await res.json();
          detail = JSON.stringify(data).slice(0, 120);
          if (detail.length >= 120) detail += '…';
        } catch {
          detail = `(${contentType.split(';')[0]})`;
        }
      }

      results.push({
        label: ep.label,
        method: ep.method,
        path: ep.path,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        ms,
        size,
        detail,
      });
    } catch (err) {
      results.push({
        label: ep.label,
        method: ep.method,
        path: ep.path,
        ok: false,
        status: 0,
        ms: Date.now() - start,
        error: err.message,
      });
    }
  }

  const allOk = results.every(r => r.ok);
  const okCount = results.filter(r => r.ok).length;

  el.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem">
      <span class="status-badge ${allOk ? 'ok' : 'error'}">${okCount}/${results.length} OK</span>
      <span class="sub">${new Date().toLocaleTimeString('sv-SE')}</span>
    </div>
    ${results.map(r => `
      <div class="card" style="margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between">
        <div style="min-width:0;flex:1">
          <strong>${escapeHtml(r.label)}</strong>
          <div class="sub" style="font-family:var(--font-mono);font-size:0.8rem">${r.method} ${r.path}</div>
          ${r.error ? `<div class="sub" style="color:var(--error)">${escapeHtml(r.error)}</div>` : ''}
          ${r.detail ? `<div class="sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:500px">${escapeHtml(r.detail)}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:1rem">
          <span class="status-badge ${r.ok ? 'ok' : 'error'}">${r.status || 'FEL'}${r.size ? ' · ' + r.size : ''}</span>
          <div class="sub" style="font-family:var(--font-mono)">${r.ms}ms</div>
        </div>
      </div>
    `).join('')}
  `;

  btn.disabled = false;
  btn.textContent = 'Testa alla endpoints';
}

async function testSaEndpoint(path, method) {
  const resultEl = document.getElementById('sa-endpoint-result');
  const jsonEl = document.getElementById('sa-endpoint-json');
  resultEl.style.display = '';
  jsonEl.textContent = `${method} /api/sportanalys${path}\nLaddar...`;

  try {
    const start = Date.now();
    const res = await fetch(`/api/sportanalys${path}`);
    const ms = Date.now() - start;
    const contentType = res.headers.get('content-type') || '';

    if (contentType.startsWith('video/') || contentType.startsWith('application/octet')) {
      const blob = await res.blob();
      const size = blob.size > 1024*1024
        ? (blob.size / (1024*1024)).toFixed(1) + ' MB'
        : (blob.size / 1024).toFixed(0) + ' KB';
      jsonEl.textContent = `${method} /api/sportanalys${path} → ${res.status} (${ms}ms)\n\nBinär: ${size} (${contentType})`;
    } else {
      const data = await res.json();
      jsonEl.textContent = `${method} /api/sportanalys${path} → ${res.status} (${ms}ms)\n\n${JSON.stringify(data, null, 2)}`;
    }
  } catch (err) {
    jsonEl.textContent = `${method} /api/sportanalys${path} → FEL\n\n${err.message}`;
  }
}

// ======= MailWise =======

let mwActiveTab = 'mw-tab-dashboard';
let mwInboxPage = 1;

function showMailwiseView() {
  document.getElementById('view-mailwise').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = '<span class="sep">/</span>MailWise';
  document.title = 'MailWise — Compuna Hub';
  currentProject = 'mailwise';

  loadMwStats();
  loadMwDashboardMailboxes();
  checkMwOAuthReturn();

  refreshTimer = setInterval(() => {
    if (mwActiveTab === 'mw-tab-dashboard') loadMwStats();
    if (mwActiveTab === 'mw-tab-inbox') loadMwInbox();
  }, 30000);
}

function switchMwTab(tabId) {
  mwActiveTab = tabId;
  document.querySelectorAll('#mw-tabs .site-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('#view-mailwise .site-tab-content').forEach(c =>
    c.classList.toggle('active', c.id === tabId));

  if (tabId === 'mw-tab-dashboard') { loadMwStats(); loadMwDashboardMailboxes(); }
  if (tabId === 'mw-tab-mailboxes') loadMwMailboxes();
  if (tabId === 'mw-tab-inbox') { loadMwInboxMailboxFilter(); loadMwInbox(); }
  if (tabId === 'mw-tab-faq') loadMwFaqs();
  if (tabId === 'mw-tab-jobs') loadMwJobs();
  if (tabId === 'mw-tab-stats') loadMwDetailStats();
}

// Kolla om vi just kommit tillbaka från OAuth
function checkMwOAuthReturn() {
  const hash = window.location.hash;
  if (hash.includes('setup=success')) {
    showMwNotice('Gmail-konto anslutet!', 'ok');
    window.location.hash = '#/mailwise';
  } else if (hash.includes('setup=error')) {
    const match = hash.match(/message=([^&]*)/);
    const msg = match ? decodeURIComponent(match[1]) : 'Okänt fel';
    showMwNotice('OAuth-fel: ' + msg, 'error');
    window.location.hash = '#/mailwise';
  }
}

function showMwNotice(msg, type) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:1rem;right:1rem;padding:0.75rem 1.25rem;border-radius:8px;z-index:9999;font-size:0.9rem;color:white;background:${type === 'ok' ? '#22c55e' : '#ef4444'};box-shadow:0 4px 12px rgba(0,0,0,0.3)`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// --- Dashboard-tab ---

async function loadMwStats() {
  try {
    const res = await fetch('/api/mailwise/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const grid = document.getElementById('mw-stats-grid');
    if (!grid) return;

    const color = projects.mailwise?.color || '#6366f1';
    grid.innerHTML = [
      { label: 'Brevlådor', value: data.mailboxes?.active || 0 },
      { label: 'Meddelanden', value: formatNumber(data.messages?.total || 0) },
      { label: 'Analyserade', value: formatNumber(data.messages?.analyzed || 0) },
      { label: 'Nya 24h', value: data.messages?.last_24h || 0 },
      { label: 'FAQ (godkända)', value: data.faqs?.approved || 0 },
      { label: 'LLM', value: data.llm_status === 'online' ? 'Online' : 'Offline' },
    ].map(f => `<div class="card"><h3>${f.label}</h3><div class="value" style="color:${f.value === 'Offline' ? 'var(--error)' : color}">${f.value}</div></div>`).join('');
  } catch {
    const grid = document.getElementById('mw-stats-grid');
    if (grid) grid.innerHTML = '<div class="card"><h3>Fel</h3><div class="sub">Kunde inte ladda statistik</div></div>';
  }
}

async function loadMwDashboardMailboxes() {
  try {
    const res = await fetch('/api/mailwise/mailboxes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mailboxes = await res.json();

    const el = document.getElementById('mw-dashboard-mailboxes');
    if (!el) return;

    if (mailboxes.length === 0) {
      el.innerHTML = '<div class="card"><div class="sub">Inga brevlådor konfigurerade. Gå till Brevlådor-fliken för att lägga till.</div></div>';
      return;
    }

    el.innerHTML = mailboxes.map(mb => `
      <div class="card" style="margin-bottom:0.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${escapeHtml(mb.email || mb.display_name || '#' + mb.id)}</strong>
            <span class="status-badge ${mb.is_connected ? 'ok' : 'error'}">${mb.is_connected ? 'Ansluten' : 'Ej ansluten'}</span>
            <span class="status-badge ${mb.sync_status === 'idle' ? 'ok' : mb.sync_status === 'syncing' ? 'warning' : 'error'}">${mb.sync_status}</span>
          </div>
          <div style="font-size:0.8rem;color:var(--navy-400)">
            ${mb.message_count || 0} meddelanden
            ${mb.last_sync_at ? ' · Senast ' + new Date(mb.last_sync_at).toLocaleString('sv-SE') : ''}
          </div>
        </div>
        ${mb.sync_error ? `<div style="font-size:0.8rem;color:var(--error);margin-top:0.25rem">${escapeHtml(mb.sync_error)}</div>` : ''}
      </div>
    `).join('');
  } catch {
    const el = document.getElementById('mw-dashboard-mailboxes');
    if (el) el.innerHTML = '<div class="card"><div class="sub">Kunde inte ladda brevlådor</div></div>';
  }
}

// --- Brevlådor-tab ---

async function loadMwMailboxes() {
  try {
    const res = await fetch('/api/mailwise/mailboxes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mailboxes = await res.json();

    const el = document.getElementById('mw-mailbox-list');
    if (!el) return;

    if (mailboxes.length === 0) {
      el.innerHTML = '<div class="card"><div class="sub">Inga brevlådor. Klicka "Lägg till brevlåda" för att komma igång.</div></div>';
      return;
    }

    const anySyncing = mailboxes.some(mb => mb.sync_status === 'syncing');

    el.innerHTML = mailboxes.map(mb => {
      const syncPct = mb.sync_total > 0 ? Math.round((mb.sync_progress / mb.sync_total) * 100) : 0;
      const isSyncing = mb.sync_status === 'syncing';
      const progressBar = isSyncing && mb.sync_total > 0 ? `
        <div style="margin:0.5rem 0">
          <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--navy-300);margin-bottom:0.25rem">
            <span>Synkar: ${mb.sync_progress} / ${mb.sync_total} meddelanden</span>
            <span>${syncPct}%</span>
          </div>
          <div style="background:var(--navy-700);border-radius:4px;height:8px;overflow:hidden">
            <div style="background:var(--primary);height:100%;width:${syncPct}%;transition:width 0.3s ease;border-radius:4px"></div>
          </div>
        </div>` : '';

      return `
      <div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <h3 style="margin:0 0 0.25rem 0">${escapeHtml(mb.email || mb.display_name || '#' + mb.id)}</h3>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.5rem">
              <span class="status-badge ${mb.is_connected ? 'ok' : 'error'}">${mb.is_connected ? 'Ansluten' : 'Ej ansluten'}</span>
              <span class="status-badge ${mb.sync_status === 'idle' ? 'ok' : isSyncing ? 'warning' : 'error'}">${isSyncing ? 'Synkar...' : mb.sync_status}</span>
              <span class="status-badge info">${mb.message_count || 0} meddelanden</span>
              ${mb.unanalyzed_count > 0 ? `<span class="status-badge warning">${mb.unanalyzed_count} oanalyserade</span>` : ''}
            </div>
            ${progressBar}
            ${mb.sync_error ? `<div style="font-size:0.8rem;color:var(--error)">${escapeHtml(mb.sync_error)}</div>` : ''}
            ${mb.last_sync_at ? `<div style="font-size:0.75rem;color:var(--navy-400)">Senast synkad: ${new Date(mb.last_sync_at).toLocaleString('sv-SE')}</div>` : ''}
          </div>
          <div style="display:flex;gap:0.4rem;flex-shrink:0">
            ${!mb.is_connected ? `<button class="btn-small btn-primary" onclick="window.location.href='/api/mailwise/oauth/start?mailbox_id=${mb.id}'">Anslut Gmail</button>` : ''}
            <button class="btn-small" onclick="mwSyncMailbox(${mb.id})" ${isSyncing ? 'disabled' : ''}>Synka</button>
            <button class="btn-small" onclick="mwTestMailbox(${mb.id})">Testa</button>
            <button class="btn-small" style="color:var(--error)" onclick="mwDeleteMailbox(${mb.id})">Ta bort</button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Auto-refresh var 3:e sekund om synk pågår
    if (anySyncing) {
      clearTimeout(window._mwSyncPollTimer);
      window._mwSyncPollTimer = setTimeout(() => loadMwMailboxes(), 3000);
    }
  } catch {
    const el = document.getElementById('mw-mailbox-list');
    if (el) el.innerHTML = '<div class="card"><div class="sub">Kunde inte ladda brevlådor</div></div>';
  }
}

function showMwAddMailbox() {
  const wizard = document.getElementById('mw-setup-wizard');
  wizard.style.display = wizard.style.display === 'none' ? '' : 'none';
  if (wizard.style.display !== 'none') {
    mwSetupNext(1);
    loadMwRedirectUri();
  }
}

async function loadMwRedirectUri() {
  try {
    const res = await fetch('/api/system/settings/mailwise');
    const data = await res.json();
    const settings = data.settings || [];
    const uri = settings.find(s => s.key === 'redirect_uri');
    const el = document.getElementById('mw-redirect-uri-display');
    if (el) el.textContent = uri?.value || 'https://vpn.compuna.se/api/mailwise/oauth/callback';
  } catch {
    const el = document.getElementById('mw-redirect-uri-display');
    if (el) el.textContent = 'https://compuna.se/api/mailwise/oauth/callback';
  }
}

function mwSetupNext(step) {
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`mw-setup-step${i}`);
    const badge = document.getElementById(`mw-step-${i}-badge`);
    if (stepEl) stepEl.style.display = i === step ? '' : 'none';
    if (badge) badge.className = `status-badge ${i < step ? 'ok' : i === step ? 'warning' : 'info'}`;
  }
}

async function mwConnectMailbox() {
  const clientId = document.getElementById('mw-setup-client-id').value.trim();
  const clientSecret = document.getElementById('mw-setup-client-secret').value.trim();
  const displayName = document.getElementById('mw-setup-display-name').value.trim();
  const errorEl = document.getElementById('mw-setup-error');
  const btn = document.getElementById('mw-setup-connect-btn');

  if (!clientId || !clientSecret) {
    errorEl.textContent = 'Client ID och Client Secret krävs';
    errorEl.style.display = '';
    return;
  }

  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Skapar...';

  try {
    const res = await fetch('/api/mailwise/mailboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, display_name: displayName }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Misslyckades');

    // Omdirigera till OAuth-flöde
    window.location.href = data.oauth_start_url;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Anslut Gmail-konto';
  }
}

async function mwSyncMailbox(id) {
  try {
    await fetch(`/api/mailwise/mailboxes/${id}/sync`, { method: 'POST' });
    showMwNotice('Synk startad', 'ok');
    setTimeout(() => loadMwMailboxes(), 2000);
  } catch {
    showMwNotice('Kunde inte starta synk', 'error');
  }
}

async function mwTestMailbox(id) {
  try {
    const res = await fetch(`/api/mailwise/mailboxes/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showMwNotice(`OK: ${data.email} (${data.messagesTotal} meddelanden)`, 'ok');
    } else {
      showMwNotice('Test misslyckades: ' + (data.error || 'Okänt fel'), 'error');
    }
  } catch (err) {
    showMwNotice('Testfel: ' + err.message, 'error');
  }
}

async function mwDeleteMailbox(id) {
  if (!confirm('Är du säker? All e-postdata för denna brevlåda raderas.')) return;
  try {
    await fetch(`/api/mailwise/mailboxes/${id}`, { method: 'DELETE' });
    showMwNotice('Brevlåda borttagen', 'ok');
    loadMwMailboxes();
  } catch {
    showMwNotice('Kunde inte ta bort', 'error');
  }
}

// --- Inkorg-tab ---

async function loadMwInboxMailboxFilter() {
  try {
    const res = await fetch('/api/mailwise/mailboxes');
    if (!res.ok) return;
    const mailboxes = await res.json();
    const select = document.getElementById('mw-inbox-mailbox');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Alla brevlådor</option>' +
      mailboxes.map(mb => `<option value="${mb.id}">${escapeHtml(mb.email || mb.display_name || '#' + mb.id)}</option>`).join('');
    select.value = current;
  } catch { /* ignorera */ }
}

async function loadMwInbox() {
  const mailboxId = document.getElementById('mw-inbox-mailbox')?.value || '';
  const category = document.getElementById('mw-inbox-category')?.value || '';
  const priority = document.getElementById('mw-inbox-priority')?.value || '';

  const params = new URLSearchParams({ page: mwInboxPage, limit: 30 });
  if (mailboxId) params.set('mailbox_id', mailboxId);
  if (category) params.set('category', category);
  if (priority) params.set('priority', priority);

  try {
    const res = await fetch(`/api/mailwise/messages?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const tbody = document.getElementById('mw-inbox-tbody');
    if (!tbody) return;

    if (!data.messages || data.messages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--navy-400)">Inga meddelanden</td></tr>';
      return;
    }

    tbody.innerHTML = data.messages.map(m => `
      <tr>
        <td style="white-space:nowrap;font-size:0.8rem">${m.date ? new Date(m.date).toLocaleString('sv-SE', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.from_name || m.from_address || '—')}</td>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.subject || '(inget ämne)')}</td>
        <td>${m.category ? `<span class="status-badge info">${mwCategoryLabel(m.category)}</span>` : '<span style="color:var(--navy-500)">—</span>'}</td>
        <td>${m.priority ? `<span class="status-badge ${mwPriorityClass(m.priority)}">${mwPriorityLabel(m.priority)}</span>` : '—'}</td>
        <td>${m.sentiment ? mwSentimentIcon(m.sentiment) : '—'}</td>
        <td>
          ${!m.analyzed_at ? `<button class="btn-small" onclick="mwAnalyzeMessage(${m.id})">Analysera</button>` : ''}
        </td>
      </tr>
    `).join('');

    // Paginering
    const pagination = document.getElementById('mw-inbox-pagination');
    if (pagination && data.pages > 1) {
      let html = '';
      if (data.page > 1) html += `<button class="btn-small" onclick="mwInboxPage=${data.page - 1};loadMwInbox()">Föregående</button>`;
      html += `<span style="line-height:2rem;font-size:0.85rem">Sida ${data.page} av ${data.pages}</span>`;
      if (data.page < data.pages) html += `<button class="btn-small" onclick="mwInboxPage=${data.page + 1};loadMwInbox()">Nästa</button>`;
      pagination.innerHTML = html;
    }
  } catch {
    const tbody = document.getElementById('mw-inbox-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="color:var(--error)">Kunde inte ladda inkorg</td></tr>';
  }
}

async function mwAnalyzeMessage(id) {
  try {
    await fetch(`/api/mailwise/messages/${id}/analyze`, { method: 'POST' });
    showMwNotice('Analysjobb skapat', 'ok');
  } catch {
    showMwNotice('Kunde inte skapa jobb', 'error');
  }
}

function mwCategoryLabel(cat) {
  const map = { inquiry:'Förfrågan', complaint:'Klagomål', order:'Beställning', support:'Support',
                billing:'Faktura', feedback:'Feedback', info:'Information', other:'Övrigt' };
  return map[cat] || cat;
}

function mwPriorityLabel(p) {
  const map = { urgent:'Brådskande', high:'Hög', normal:'Normal', low:'Låg' };
  return map[p] || p;
}

function mwPriorityClass(p) {
  const map = { urgent:'error', high:'warning', normal:'ok', low:'info' };
  return map[p] || 'info';
}

function mwSentimentIcon(s) {
  const map = { positive:'🟢', neutral:'🟡', negative:'🔴' };
  return map[s] || '—';
}

// --- FAQ-tab ---

async function loadMwFaqs() {
  const filter = document.getElementById('mw-faq-filter')?.value || '';

  const params = new URLSearchParams({ limit: '50' });
  if (filter === 'approved') params.set('approved', 'true');
  if (filter === 'pending') params.set('approved', 'false');
  if (filter === 'archived') params.set('archived', 'true');

  try {
    const res = await fetch(`/api/mailwise/faqs?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const el = document.getElementById('mw-faq-list');
    if (!el) return;

    if (!data.faqs || data.faqs.length === 0) {
      el.innerHTML = '<div class="card"><div class="sub">Inga FAQ-par hittade</div></div>';
      return;
    }

    el.innerHTML = data.faqs.map(faq => `
      <div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem">
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
            ${faq.approved ? '<span class="status-badge ok">Godkänd</span>' : '<span class="status-badge warning">Ej godkänd</span>'}
            ${faq.confidence ? `<span class="status-badge info">${Math.round(faq.confidence * 100)}% säkerhet</span>` : ''}
            ${faq.tags ? JSON.parse(typeof faq.tags === 'string' ? faq.tags : '[]').map(t => `<span class="status-badge" style="background:var(--navy-600)">${escapeHtml(t)}</span>`).join('') : ''}
          </div>
          <div style="display:flex;gap:0.3rem">
            ${!faq.approved ? `<button class="btn-small btn-primary" onclick="mwApproveFaq(${faq.id})">Godkänn</button>` : ''}
            <button class="btn-small" style="color:var(--error)" onclick="mwDeleteFaq(${faq.id})">Ta bort</button>
          </div>
        </div>
        <div style="margin-bottom:0.5rem">
          <strong style="color:var(--navy-200)">F:</strong> ${escapeHtml(faq.question)}
        </div>
        <div>
          <strong style="color:var(--navy-200)">S:</strong> ${escapeHtml(faq.answer)}
        </div>
      </div>
    `).join('');
  } catch {
    const el = document.getElementById('mw-faq-list');
    if (el) el.innerHTML = '<div class="card"><div class="sub">Kunde inte ladda FAQ</div></div>';
  }
}

async function mwApproveFaq(id) {
  try {
    await fetch(`/api/mailwise/faqs/${id}/approve`, { method: 'PUT' });
    loadMwFaqs();
  } catch { showMwNotice('Kunde inte godkänna', 'error'); }
}

async function mwDeleteFaq(id) {
  if (!confirm('Ta bort denna FAQ?')) return;
  try {
    await fetch(`/api/mailwise/faqs/${id}`, { method: 'DELETE' });
    loadMwFaqs();
  } catch { showMwNotice('Kunde inte ta bort', 'error'); }
}

async function exportMwFaqs() {
  try {
    const res = await fetch('/api/mailwise/faqs/export');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mailwise-faqs-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch { showMwNotice('Kunde inte exportera', 'error'); }
}

// --- Jobb-tab ---

async function loadMwJobs() {
  try {
    const res = await fetch('/api/mailwise/jobs?limit=50');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const tbody = document.getElementById('mw-jobs-tbody');
    if (!tbody) return;

    if (!data.jobs || data.jobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--navy-400)">Inga jobb</td></tr>';
      return;
    }

    tbody.innerHTML = data.jobs.map(j => `
      <tr>
        <td>#${j.id}</td>
        <td>${mwJobTypeLabel(j.type)}</td>
        <td>${escapeHtml(j.mailbox_email || '—')}</td>
        <td><span class="status-badge ${mwJobStatusClass(j.status)}">${mwJobStatusLabel(j.status)}</span></td>
        <td>
          ${j.status === 'processing' ? `<div style="background:var(--navy-700);border-radius:4px;overflow:hidden;height:6px;width:80px"><div style="background:var(--primary);height:100%;width:${j.progress || 0}%"></div></div>` : (j.progress || 0) + '%'}
        </td>
        <td style="font-size:0.8rem">${j.created_at ? new Date(j.created_at).toLocaleString('sv-SE') : '—'}</td>
        <td>
          ${j.status === 'pending' ? `<button class="btn-small" style="color:var(--error)" onclick="mwCancelJob(${j.id})">Avbryt</button>` : ''}
          ${j.error_message ? `<span style="font-size:0.75rem;color:var(--error)" title="${escapeHtml(j.error_message)}">Fel</span>` : ''}
        </td>
      </tr>
    `).join('');
  } catch {
    const tbody = document.getElementById('mw-jobs-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="color:var(--error)">Kunde inte ladda jobb</td></tr>';
  }
}

function mwJobTypeLabel(t) {
  const map = { analyze_message:'Analysera', analyze_thread:'Trådanalys', extract_faq:'FAQ-extraktion',
                batch_analyze:'Batchanalys', label_sync:'Etikettsynk' };
  return map[t] || t;
}

function mwJobStatusLabel(s) {
  const map = { pending:'Väntande', processing:'Bearbetar', completed:'Klar', failed:'Misslyckad' };
  return map[s] || s;
}

function mwJobStatusClass(s) {
  const map = { pending:'warning', processing:'info', completed:'ok', failed:'error' };
  return map[s] || 'info';
}

async function mwCancelJob(id) {
  try {
    await fetch(`/api/mailwise/jobs/${id}`, { method: 'DELETE' });
    loadMwJobs();
  } catch { showMwNotice('Kunde inte avbryta', 'error'); }
}

// --- Statistik-tab ---

async function loadMwDetailStats() {
  try {
    const res = await fetch('/api/mailwise/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const grid = document.getElementById('mw-detail-stats-grid');
    if (grid) {
      const color = projects.mailwise?.color || '#6366f1';
      grid.innerHTML = [
        { label: 'Totalt meddelanden', value: formatNumber(data.messages?.total || 0) },
        { label: 'Analyserade', value: formatNumber(data.messages?.analyzed || 0) },
        { label: 'Väntande analys', value: data.messages?.pending || 0 },
        { label: 'FAQ (totalt)', value: data.faqs?.total || 0 },
        { label: 'FAQ (godkända)', value: data.faqs?.approved || 0 },
        { label: 'Jobb (aktiva)', value: (data.jobs?.pending || 0) + (data.jobs?.processing || 0) },
      ].map(f => `<div class="card"><h3>${f.label}</h3><div class="value" style="color:${color}">${f.value}</div></div>`).join('');
    }

    // Kategorier
    loadMwCategories();
    loadMwDailyChart();
  } catch {
    const grid = document.getElementById('mw-detail-stats-grid');
    if (grid) grid.innerHTML = '<div class="card"><h3>Fel</h3><div class="sub">Kunde inte ladda</div></div>';
  }
}

async function loadMwCategories() {
  try {
    const res = await fetch('/api/mailwise/stats/categories');
    if (!res.ok) return;
    const categories = await res.json();

    const el = document.getElementById('mw-category-chart');
    if (!el || categories.length === 0) {
      if (el) el.innerHTML = '<div class="card"><div class="sub">Inga kategoriserade meddelanden ännu</div></div>';
      return;
    }

    const colors = { inquiry:'#3b82f6', complaint:'#ef4444', order:'#22c55e', support:'#f59e0b',
                     billing:'#8b5cf6', feedback:'#06b6d4', info:'#6b7280', other:'#9ca3af' };

    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.5rem">
      ${categories.map(c => `
        <div class="card" style="display:flex;align-items:center;gap:0.75rem">
          <div style="width:12px;height:12px;border-radius:50%;background:${colors[c.category] || '#6b7280'}"></div>
          <div>
            <div style="font-weight:600">${mwCategoryLabel(c.category)}</div>
            <div class="sub">${c.count} (${c.percentage || 0}%)</div>
          </div>
        </div>
      `).join('')}
    </div>`;
  } catch { /* ignorera */ }
}

async function loadMwDailyChart() {
  try {
    const res = await fetch('/api/mailwise/stats/trends?period=30d');
    if (!res.ok) return;
    const data = await res.json();

    const el = document.getElementById('mw-daily-chart');
    if (!el) return;

    if (!data.daily || data.daily.length === 0) {
      el.innerHTML = '<div class="card"><div class="sub">Ingen daglig data ännu</div></div>';
      return;
    }

    // Enkel ASCII-diagram
    const max = Math.max(...data.daily.map(d => d.messages || 0), 1);
    el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:2px;height:120px;padding:0.5rem">
      ${data.daily.map(d => {
        const h = Math.max(2, Math.round(((d.messages || 0) / max) * 100));
        const label = d.date?.slice(5) || '';
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">
          <div style="width:100%;max-width:20px;height:${h}px;background:#6366f1;border-radius:2px" title="${label}: ${d.messages || 0} meddelanden"></div>
          <div style="font-size:0.6rem;color:var(--navy-500);margin-top:2px;writing-mode:vertical-rl;transform:rotate(180deg)">${label}</div>
        </div>`;
      }).join('')}
    </div>`;
  } catch { /* ignorera */ }
}

// --- Diagnostik-tab ---

async function runMwDiagnostics() {
  const el = document.getElementById('mw-diag-results');
  const btn = document.getElementById('mw-diag-run-btn');
  if (!el) return;

  btn.disabled = true;
  btn.textContent = 'Testar...';
  el.innerHTML = '<div class="card"><div class="sub">Kör diagnostik...</div></div>';

  try {
    const res = await fetch('/api/mailwise/diagnostics');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    el.innerHTML = data.tests.map(t => `
      <div class="card" style="margin-bottom:0.5rem;display:flex;align-items:center;gap:0.75rem">
        <span style="font-size:1.2rem">${t.ok ? '✅' : '❌'}</span>
        <div style="flex:1">
          <strong>${escapeHtml(t.name)}</strong>
          <div class="sub">${escapeHtml(t.message || '')}</div>
        </div>
      </div>
    `).join('') + `<div style="text-align:center;margin-top:0.5rem;font-size:0.8rem;color:var(--navy-400)">${data.timestamp}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="sub" style="color:var(--error)">Diagnostik misslyckades: ${escapeHtml(err.message)}</div></div>`;
  }

  btn.disabled = false;
  btn.textContent = 'Kör alla tester';
}

// ======= Maskiner =======

async function loadMonitorMachines() {
  const grid = document.getElementById('machine-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/monitor/machines');
    if (!res.ok) {
      grid.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Maskinovervakning ej aktivt</div>';
      return;
    }
    const { data } = await res.json();
    if (!data || data.length === 0) {
      grid.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Inga maskiner konfigurerade</div>';
      return;
    }

    grid.innerHTML = data.map(m => {
      const st = m.status || 'unknown';
      const incidents = m.open_incidents || 0;
      const pingMs = m.last_ping_ms;
      const desc = m.description ? ` — ${escapeHtml(m.description)}` : '';
      const hostStr = m.host === 'localhost' ? '' : escapeHtml(m.host);

      return `
        <div class="site-card ${st}" onclick="navigate('machine/${m.id}')">
          <div class="site-indicator ${st}"></div>
          <div class="site-info">
            <h3>${escapeHtml(m.name)}</h3>
            <div class="site-url">${hostStr}${desc}</div>
          </div>
          <div class="site-meta">
            <div class="uptime">${st === 'up' ? 'UP' : st === 'degraded' ? 'SLOW' : st === 'down' ? 'DOWN' : '?'}</div>
            <div class="response-time">${pingMs ? pingMs + 'ms' : '—'}</div>
            ${incidents > 0 ? `<div class="incidents-badge">${incidents} incident${incidents > 1 ? 'er' : ''}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch {
    grid.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Maskinovervakning ej tillgangligt</div>';
  }
}

function switchMachineTab(tabId) {
  document.querySelectorAll('#view-machine .site-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#machine-tabs .site-tab').forEach(el => el.classList.remove('active'));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
  const btn = document.querySelector(`#machine-tabs .site-tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
}

let currentMachineId = null;

async function showMachineView(machineId) {
  currentMachineId = machineId;
  document.getElementById('view-machine').classList.add('active');
  document.getElementById('breadcrumb').innerHTML = `<span onclick="navigate('')" style="cursor:pointer;opacity:0.6">Hub</span> / Maskin`;
  document.title = `Maskin — Compuna Hub`;

  await loadMachineData(machineId);

  refreshTimer = setInterval(() => loadMachineData(machineId), 60000);
}

async function loadMachineData(machineId) {
  try {
    const res = await fetch(`/api/monitor/machines/${machineId}`);
    if (!res.ok) return;
    const { data } = await res.json();
    const { machine, latestChecks, openIncidents, recentSystemChecks, uptimeStats, dailyMetrics } = data;

    // Titel
    document.getElementById('machine-title').textContent = machine.name;
    document.getElementById('machine-desc').textContent =
      `${machine.host}${machine.description ? ' — ' + machine.description : ''}`;
    document.title = `${machine.name} — Compuna Hub`;
    document.getElementById('breadcrumb').innerHTML =
      `<span onclick="navigate('')" style="cursor:pointer;opacity:0.6">Hub</span> / ${escapeHtml(machine.name)}`;

    // Gauges — CPU, RAM, Disk
    renderMachineGauges(latestChecks, machine);

    // Uptime-kort
    renderMachineUptimeCards(uptimeStats);

    // Senaste checks
    renderMachineChecks(latestChecks);

    // Tjanster
    renderMachineServices(latestChecks);

    // Incidenter
    renderMachineIncidents(openIncidents);

    // Grafer
    renderMachineCpuChart(recentSystemChecks);
    renderMachineUptimeChart(dailyMetrics);

    // Installningar
    renderMachineSettings(machine);
  } catch (err) {
    console.error('Machine load error:', err);
  }
}

function renderMachineGauges(latestChecks, machine) {
  const el = document.getElementById('machine-gauges');
  const systemCheck = latestChecks.find(c => c.check_type === 'system');

  if (!systemCheck || !systemCheck.details) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Vantar pa forsta system-check...</div>';
    return;
  }

  const d = typeof systemCheck.details === 'string' ? JSON.parse(systemCheck.details) : systemCheck.details;

  const cpuPct = d.cpu?.pct ?? 0;
  const ramPct = d.ram?.pct ?? 0;
  const diskPct = d.disk?.worstPct ?? 0;
  const uptimeDays = d.uptime?.days ?? 0;

  const gaugeColor = (pct, warnT, critT) =>
    pct >= critT ? 'var(--error)' : pct >= warnT ? 'var(--warning)' : 'var(--success)';

  const gpu = d.gpu || null;
  const gpuUtilPct = gpu?.utilPct ?? 0;
  const vramPct = gpu?.vramPct ?? 0;

  let html = `
    <div class="gauge-card">
      <div class="gauge-ring" style="--pct:${cpuPct};--color:${gaugeColor(cpuPct, machine.threshold_cpu_warn || 90, machine.threshold_cpu_crit || 95)}">
        <span class="gauge-value">${cpuPct}%</span>
      </div>
      <div class="gauge-label">CPU</div>
      <div class="gauge-sub">Load ${d.cpu?.load1?.toFixed(2) || '—'} / ${d.cpu?.cores || '?'} karnor</div>
    </div>
    <div class="gauge-card">
      <div class="gauge-ring" style="--pct:${ramPct};--color:${gaugeColor(ramPct, machine.threshold_ram_warn || 85, machine.threshold_ram_crit || 95)}">
        <span class="gauge-value">${ramPct}%</span>
      </div>
      <div class="gauge-label">RAM</div>
      <div class="gauge-sub">${d.ram?.usedMb || 0} / ${d.ram?.totalMb || 0} MB</div>
    </div>
    <div class="gauge-card">
      <div class="gauge-ring" style="--pct:${diskPct};--color:${gaugeColor(diskPct, machine.threshold_disk_warn || 80, machine.threshold_disk_crit || 90)}">
        <span class="gauge-value">${diskPct}%</span>
      </div>
      <div class="gauge-label">Disk</div>
      <div class="gauge-sub">${d.disk?.mounts?.[0]?.usedGb || '—'} / ${d.disk?.mounts?.[0]?.totalGb || '—'} GB</div>
    </div>`;

  // GPU-gauges (villkorligt — bara for maskiner med GPU)
  if (gpu) {
    html += `
    <div class="gauge-card">
      <div class="gauge-ring" style="--pct:${gpuUtilPct};--color:${gaugeColor(gpuUtilPct, machine.threshold_gpu_warn || 85, machine.threshold_gpu_crit || 95)}">
        <span class="gauge-value">${gpuUtilPct}%</span>
      </div>
      <div class="gauge-label">GPU</div>
      <div class="gauge-sub">${gpu.tempC || 0}°C, ${gpu.powerW || 0}W</div>
    </div>
    <div class="gauge-card">
      <div class="gauge-ring" style="--pct:${vramPct};--color:${gaugeColor(vramPct, machine.threshold_vram_warn || 80, machine.threshold_vram_crit || 90)}">
        <span class="gauge-value">${vramPct}%</span>
      </div>
      <div class="gauge-label">VRAM</div>
      <div class="gauge-sub">${gpu.vramUsedMb || 0} / ${gpu.vramTotalMb || 0} MB</div>
    </div>`;
  }

  html += `
    <div class="gauge-card">
      <div class="gauge-ring" style="--pct:${Math.min(uptimeDays, 100)};--color:#3b9eff">
        <span class="gauge-value">${uptimeDays}d</span>
      </div>
      <div class="gauge-label">Uptime</div>
      <div class="gauge-sub">${uptimeDays > 0 ? uptimeDays + ' dagar' : 'Just startad'}</div>
    </div>`;

  el.innerHTML = html;
}

function renderMachineUptimeCards(uptimeStats) {
  const el = document.getElementById('machine-uptime-cards');
  if (!uptimeStats) { el.innerHTML = ''; return; }

  const cardColor = pct => {
    if (pct === null) return '#64748b';
    const p = parseFloat(pct);
    if (p >= 99.5) return 'var(--success)';
    if (p >= 95) return 'var(--warning)';
    return 'var(--error)';
  };

  el.innerHTML = ['24h', '7d', '30d'].map(label => {
    const s = uptimeStats[label];
    return `
      <div class="uptime-card">
        <div class="uptime-value" style="color:${cardColor(s?.pct)}">${s?.pct ? s.pct + '%' : '—'}</div>
        <div class="uptime-label">Uptime ${label}</div>
        <div class="uptime-sub">${s?.total || 0} checks</div>
      </div>
    `;
  }).join('');
}

function renderMachineChecks(latestChecks) {
  const el = document.getElementById('machine-checks-grid');
  if (!latestChecks || latestChecks.length === 0) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Inga checks registrerade annu</div>';
    return;
  }

  const typeLabels = { ping: 'Ping', system: 'System', services: 'Tjanster' };

  el.innerHTML = latestChecks.map(c => {
    const st = c.status || 'unknown';
    const ago = timeAgo(c.checked_at);
    return `
      <div class="check-card ${st}">
        <div class="check-card-header">
          <h4>${typeLabels[c.check_type] || c.check_type}</h4>
        </div>
        <div class="check-status status-${st}">${st === 'ok' ? 'OK' : st.toUpperCase()}</div>
        <div class="check-detail">${escapeHtml(c.message || '—')}</div>
        <div class="check-detail" style="color:#64748b;font-size:0.75rem;">${ago}</div>
      </div>
    `;
  }).join('');
}

function renderMachineServices(latestChecks) {
  const el = document.getElementById('machine-services-list');
  const svcCheck = latestChecks.find(c => c.check_type === 'services');

  if (!svcCheck || !svcCheck.details) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Inga tjanster konfigurerade</div>';
    return;
  }

  const d = typeof svcCheck.details === 'string' ? JSON.parse(svcCheck.details) : svcCheck.details;
  const services = d.services || {};

  if (Object.keys(services).length === 0) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Inga tjanster konfigurerade</div>';
    return;
  }

  el.innerHTML = `<div class="service-list">${Object.entries(services).map(([name, running]) => `
    <div class="service-item">
      <span class="service-dot ${running ? 'running' : 'stopped'}"></span>
      <span>${escapeHtml(name)}</span>
    </div>
  `).join('')}</div>`;
}

function renderMachineIncidents(incidents) {
  const el = document.getElementById('machine-incidents-list');
  if (!incidents || incidents.length === 0) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">Inga oppna incidenter</div>';
    return;
  }

  el.innerHTML = incidents.map(inc => `
    <div class="card" style="border-left:3px solid ${inc.severity === 'critical' ? 'var(--error)' : 'var(--warning)'}; margin-bottom:0.5rem;">
      <div style="font-weight:600;margin-bottom:0.3rem;">${escapeHtml(inc.title)}</div>
      <div style="font-size:0.85rem;color:#94a3b8;">${escapeHtml(inc.message || '')} — ${inc.failure_count} failures</div>
      <div style="font-size:0.75rem;color:#64748b;margin-top:0.3rem;">${timeAgo(inc.opened_at)}</div>
    </div>
  `).join('');
}

function renderMachineCpuChart(recentSystemChecks) {
  const el = document.getElementById('machine-cpu-chart');
  if (!recentSystemChecks || recentSystemChecks.length < 2) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">For lite data for graf</div>';
    return;
  }

  // Extrahera CPU och RAM-procent fran details
  const points = recentSystemChecks.map(c => {
    const d = typeof c.details === 'string' ? JSON.parse(c.details) : c.details;
    return {
      time: new Date(c.checked_at),
      cpu: d?.cpu?.pct ?? null,
      ram: d?.ram?.pct ?? null,
    };
  }).filter(p => p.cpu !== null);

  if (points.length < 2) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">For lite data for graf</div>';
    return;
  }

  // Enkel SVG-linjegraf
  const W = 800, H = 200, PAD = 40;
  const chartW = W - PAD * 2, chartH = H - PAD * 2;

  const minT = points[0].time.getTime();
  const maxT = points[points.length - 1].time.getTime();
  const rangeT = maxT - minT || 1;

  const toX = t => PAD + ((t - minT) / rangeT) * chartW;
  const toY = v => PAD + chartH - (v / 100) * chartH;

  const cpuPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.time.getTime()).toFixed(1)},${toY(p.cpu).toFixed(1)}`).join(' ');
  const ramPath = points.filter(p => p.ram !== null).map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.time.getTime()).toFixed(1)},${toY(p.ram).toFixed(1)}`).join(' ');

  // Tidsmarkeringar
  const timeLabels = [];
  const step = Math.max(1, Math.floor(points.length / 6));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    timeLabels.push(`<text x="${toX(p.time.getTime())}" y="${H - 5}" fill="#64748b" font-size="10" text-anchor="middle">${p.time.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</text>`);
  }

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:250px;">
      <rect x="${PAD}" y="${PAD}" width="${chartW}" height="${chartH}" fill="none" stroke="#1e293b" stroke-width="1"/>
      ${[0, 25, 50, 75, 100].map(v => `<line x1="${PAD}" y1="${toY(v)}" x2="${W - PAD}" y2="${toY(v)}" stroke="#1e293b" stroke-dasharray="4"/><text x="${PAD - 5}" y="${toY(v) + 4}" fill="#64748b" font-size="10" text-anchor="end">${v}%</text>`).join('')}
      <path d="${cpuPath}" fill="none" stroke="#3b9eff" stroke-width="2"/>
      <path d="${ramPath}" fill="none" stroke="#f59e0b" stroke-width="2"/>
      ${timeLabels.join('')}
      <circle cx="${W - PAD - 80}" cy="12" r="4" fill="#3b9eff"/><text x="${W - PAD - 72}" y="16" fill="#94a3b8" font-size="11">CPU</text>
      <circle cx="${W - PAD - 35}" cy="12" r="4" fill="#f59e0b"/><text x="${W - PAD - 27}" y="16" fill="#94a3b8" font-size="11">RAM</text>
    </svg>
  `;
}

function renderMachineUptimeChart(dailyMetrics) {
  const el = document.getElementById('machine-uptime-chart');
  if (!dailyMetrics || dailyMetrics.length < 2) {
    el.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;">For lite data for graf</div>';
    return;
  }

  const W = 800, H = 180, PAD = 40;
  const chartW = W - PAD * 2, chartH = H - PAD * 2;
  const barW = Math.max(4, chartW / dailyMetrics.length - 2);

  const bars = dailyMetrics.map((d, i) => {
    const pct = parseFloat(d.uptime_pct) || 0;
    const barH = (pct / 100) * chartH;
    const x = PAD + (i / dailyMetrics.length) * chartW;
    const color = pct >= 99.5 ? 'var(--success)' : pct >= 95 ? 'var(--warning)' : 'var(--error)';
    return `<rect x="${x}" y="${PAD + chartH - barH}" width="${barW}" height="${barH}" fill="${color}" rx="2"><title>${d.date}: ${pct}%</title></rect>`;
  });

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:220px;">
      ${[95, 99, 100].map(v => `<line x1="${PAD}" y1="${PAD + chartH - (v / 100) * chartH}" x2="${W - PAD}" y2="${PAD + chartH - (v / 100) * chartH}" stroke="#1e293b" stroke-dasharray="4"/><text x="${PAD - 5}" y="${PAD + chartH - (v / 100) * chartH + 4}" fill="#64748b" font-size="10" text-anchor="end">${v}%</text>`).join('')}
      ${bars.join('')}
    </svg>
  `;
}

function renderMachineSettings(machine) {
  const el = document.getElementById('machine-settings-form');

  const services = (() => {
    try { return JSON.parse(machine.services || '[]').join(', '); } catch { return machine.services || ''; }
  })();
  const diskPaths = (() => {
    try { return JSON.parse(machine.disk_paths || '["\/"]').join(', '); } catch { return machine.disk_paths || '/'; }
  })();

  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label>Intervall (minuter)</label>
        <input type="number" id="mset-interval" value="${machine.interval_minutes || 2}" min="1" max="60">
      </div>
      <div class="form-group">
        <label>CPU varning (%)</label>
        <input type="number" id="mset-cpu-warn" value="${machine.threshold_cpu_warn || 90}" min="1" max="100">
      </div>
      <div class="form-group">
        <label>CPU kritisk (%)</label>
        <input type="number" id="mset-cpu-crit" value="${machine.threshold_cpu_crit || 95}" min="1" max="100">
      </div>
      <div class="form-group">
        <label>RAM varning (%)</label>
        <input type="number" id="mset-ram-warn" value="${machine.threshold_ram_warn || 85}" min="1" max="100">
      </div>
      <div class="form-group">
        <label>RAM kritisk (%)</label>
        <input type="number" id="mset-ram-crit" value="${machine.threshold_ram_crit || 95}" min="1" max="100">
      </div>
      <div class="form-group">
        <label>Disk varning (%)</label>
        <input type="number" id="mset-disk-warn" value="${machine.threshold_disk_warn || 80}" min="1" max="100">
      </div>
      <div class="form-group">
        <label>Disk kritisk (%)</label>
        <input type="number" id="mset-disk-crit" value="${machine.threshold_disk_crit || 90}" min="1" max="100">
      </div>
      <div class="form-group" style="grid-column:span 2;">
        <label>Tjanster (kommaseparerade)</label>
        <input type="text" id="mset-services" value="${escapeHtml(services)}">
      </div>
      <div class="form-group" style="grid-column:span 2;">
        <label>Disksokvagar (kommaseparerade)</label>
        <input type="text" id="mset-diskpaths" value="${escapeHtml(diskPaths)}">
      </div>
    </div>
    <button class="btn" style="margin-top:1rem;" onclick="saveMachineSettings('${machine.id}')">Spara installningar</button>
  `;
}

async function saveMachineSettings(machineId) {
  const fb = document.getElementById('machine-settings-feedback');
  const body = {
    interval_minutes: parseInt(document.getElementById('mset-interval').value, 10),
    threshold_cpu_warn: parseInt(document.getElementById('mset-cpu-warn').value, 10),
    threshold_cpu_crit: parseInt(document.getElementById('mset-cpu-crit').value, 10),
    threshold_ram_warn: parseInt(document.getElementById('mset-ram-warn').value, 10),
    threshold_ram_crit: parseInt(document.getElementById('mset-ram-crit').value, 10),
    threshold_disk_warn: parseInt(document.getElementById('mset-disk-warn').value, 10),
    threshold_disk_crit: parseInt(document.getElementById('mset-disk-crit').value, 10),
    services: JSON.stringify(document.getElementById('mset-services').value.split(',').map(s => s.trim()).filter(Boolean)),
    disk_paths: JSON.stringify(document.getElementById('mset-diskpaths').value.split(',').map(s => s.trim()).filter(Boolean)),
  };

  try {
    const res = await fetch(`/api/monitor/machines/${machineId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    fb.style.display = 'block';
    fb.innerHTML = `<div class="card" style="border-left:3px solid var(--success);margin-top:0.5rem;">${data.message || 'Sparat!'}</div>`;
    setTimeout(() => { fb.style.display = 'none'; }, 3000);
  } catch (err) {
    fb.style.display = 'block';
    fb.innerHTML = `<div class="card" style="border-left:3px solid var(--error);margin-top:0.5rem;">Fel: ${err.message}</div>`;
  }
}

// ======= Init =======
checkAuth();
