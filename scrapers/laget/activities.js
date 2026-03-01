/**
 * Scraper: Aktiviteter med deltagarlista från laget.se
 *
 * Loggar in, navigerar till admin-kalendern för valt lag,
 * hämtar aktiviteter för valda månader och skrapar deltagarlista + LOK-status.
 *
 * Användning:
 *   node scrapers/laget/activities.js                          # alla lag, innevarande månad
 *   node scrapers/laget/activities.js --team alag              # bara A-Lag Herr
 *   node scrapers/laget/activities.js --team u17,alag          # flera lag
 *   node scrapers/laget/activities.js --months jan,feb         # specifika månader
 *   node scrapers/laget/activities.js --before 2026-02-15      # bara t.o.m. 14 feb
 *   node scrapers/laget/activities.js --after 2026-02-01       # bara fr.o.m. 1 feb
 *   node scrapers/laget/activities.js --days 3                 # 2 dagar bak + 3 dagar fram
 *   node scrapers/laget/activities.js --all                    # alla lag (default)
 *   node scrapers/laget/activities.js --list                   # lista tillgängliga lag
 */
import dotenv from 'dotenv';
dotenv.config();

import { createBrowser } from '../helpers/browser.js';
import { sleep, createRateLimiter } from '../helpers/retry.js';
import { saveJson } from '../helpers/storage.js';

// === LAGKONFIGURATION ===
const TEAMS = {
  // Herr
  alag:   { slug: 'BackatorpIF-Fotboll-HerrAlag',       name: 'A-Lag (Herr)' },
  u17:    { slug: 'BackatorpIF-Fotboll-U17Herr',         name: 'U17 (Herr)' },
  // Pojkar
  p12:    { slug: 'BackatorpIFP12Fotboll',               name: 'P-12 Fotboll' },
  p13:    { slug: 'BackatorpIFPF13',                     name: 'P-13 Fotboll' },
  p14:    { slug: 'BackatorpIFPF14',                     name: 'P-14 Fotboll' },
  p15:    { slug: 'BackatorpIFPF15',                     name: 'P-15 Fotboll' },
  p16:    { slug: 'BackatorpIF-Fotboll-FP-16Fotboll',    name: 'P-16 Fotboll' },
  p17:    { slug: 'BackatorpIF-Fotboll-P17',             name: 'P-2017 Fotboll' },
  p18:    { slug: 'BackatorpIF-Fotboll-P-2018',          name: 'P-2018 Fotboll' },
  p19:    { slug: 'BackatorpIF-Fotboll-FotbollP2019',    name: 'P-2019 Fotboll' },
  p20:    { slug: 'BackatorpIF-Fotboll-P2020',           name: 'P-2020 Fotboll' },
  // Flickor
  uflick: { slug: 'BackatorpIF-U-flickor-Fotboll',      name: 'U-flickor Fotboll' },
  f1112:  { slug: 'BackatorpIF-Knattelag-Fotboll',      name: 'F-11/12 Fotboll' },
  f1314:  { slug: 'BackatorpF1314',                     name: 'F-13/14 Fotboll' },
  f1516:  { slug: 'BackatorpIF-Fotboll-F15-16',         name: 'F-15/16 Fotboll' },
  f17:    { slug: 'BackatorpIF-Fotboll-F-17',            name: 'F-2017 Fotboll' },
  f18:    { slug: 'BackatorpIF-Fotboll-F-2018',          name: 'F-2018 Fotboll' },
  f19:    { slug: 'BackatorpIF-Fotboll-FotbollF2019',    name: 'F-2019 Fotboll' },
  f20:    { slug: 'BackatorpIF-Fotboll-F-2020',          name: 'F-2020 Fotboll' },
};

const MONTH_NAMES = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];

// === CLI-ARGUMENT ===
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };

  // --list: visa tillgängliga lag och avsluta
  if (args.includes('--list')) {
    console.log('Tillgängliga lag:\n');
    for (const [key, team] of Object.entries(TEAMS)) {
      console.log(`  ${key.padEnd(8)} → ${team.name}`);
    }
    process.exit(0);
  }

  // --team: specifika lag (kommaseparerade), default = alla
  const teamKeys = get('--team')?.split(',') || Object.keys(TEAMS);

  // --year: alla månader fram till och med nuvarande, bara t.o.m. idag
  const yearFlag = args.includes('--year');

  // --months: specifika månader
  const monthStr = get('--months');
  let months;
  if (yearFlag) {
    const currentMonthIdx = new Date().getMonth(); // 0-based
    months = MONTH_NAMES.slice(0, currentMonthIdx + 1);
  } else {
    months = monthStr ? monthStr.toLowerCase().split(',') : null; // null = default (innevarande)
  }

  // --days N: rullande fönster (2 dagar bak + N dagar fram)
  let afterDate = get('--after') || null;
  let beforeDate = get('--before') || null;

  // --year: sätt beforeDate till imorgon (inkluderar idag, exkluderar framtiden)
  if (yearFlag && !beforeDate) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    beforeDate = tomorrow.toISOString().slice(0, 10);
  }
  const daysArg = get('--days');

  if (daysArg) {
    const n = parseInt(daysArg, 10);
    const today = new Date();
    const after = new Date(today);
    after.setDate(after.getDate() - 2);
    const before = new Date(today);
    before.setDate(before.getDate() + n + 1);
    afterDate = after.toISOString().slice(0, 10);
    beforeDate = before.toISOString().slice(0, 10);
  }

  return { teamKeys, months, afterDate, beforeDate };
}

// === KONFIGURATION ===
const BASE_URL = 'https://www.backatorpif.se/';
const EMAIL = process.env.LAGET_EMAIL || 'js@vda.se';
const PASSWORD = process.env.LAGET_PASSWORD || 'h888ztkp';

const rateLimit = createRateLimiter(1000, 0.3);

// === LOGIN ===
async function login(page) {
  console.log('🔐 Loggar in på laget.se...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('a:has-text("Logga in")');
  await sleep(500);
  await page.fill('#Email', EMAIL);
  await page.fill('#Password', PASSWORD);
  await page.click('#js-login-btn');
  await page.waitForLoadState('networkidle');
  await sleep(1500);

  const loggedIn = await page.$('.userbar__itemInner--profile');
  if (!loggedIn) throw new Error('Inloggning misslyckades');
  console.log('   ✅ Inloggad!');
}

// === HÄMTA AKTIVITETER FRÅN EN MÅNAD ===
async function getActivitiesForMonth(page, calendarUrl, monthName) {
  // Navigera till kalendern
  await page.goto(calendarUrl, { waitUntil: 'networkidle' });
  await sleep(1000);

  // Klicka på rätt månad om angiven
  if (monthName) {
    // Månads-länkarna har format "Jan (16)", "Feb (13)" etc.
    // Matcha på att texten börjar med månadsnamnet (case-insensitive)
    const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    const monthLink = await page.$(`a:has-text("${capitalized}")`);
    if (monthLink) {
      await monthLink.click();
      await page.waitForLoadState('networkidle');
      await sleep(1000);
    } else {
      console.log(`   ⚠️  Kunde inte hitta månadslänk "${capitalized}"`);
    }
  }

  // Parsa alla aktivitetsrader
  const activities = await page.$$eval('tr.listEventsRow', rows => {
    return rows.map(row => {
      const dateEl = row.querySelector('.listEventsDataDate');
      const typeEls = row.querySelectorAll('.listEventsDataLabel');
      const placeEl = row.querySelector('.listEventsDataPlace');
      const presenceEl = row.querySelector('.listEventsDataPresenceWebinfo');
      const editLink = row.querySelector('a.button_large_black[href*="/Calendar/Edit/"]');

      const dateText = dateEl?.textContent.trim() || '';
      const type = typeEls[0]?.textContent.trim() || '';
      const location = placeEl?.textContent.trim() || '';
      const presence = presenceEl?.textContent.trim() || '';
      const editUrl = editLink?.href || '';
      const eventId = editUrl.match(/\/Edit\/(\d+)/)?.[1] || '';

      return { eventId, dateText, type, location, presence, editUrl };
    });
  });

  return activities;
}

// === DATUM-PARSING ===
function parseDateText(text) {
  const months = Object.fromEntries(MONTH_NAMES.map((m, i) => [m, String(i + 1).padStart(2, '0')]));

  // Mönster 1: Endagsevent — "15 feb 18:00 - 19:30"
  const singleDay = text.match(/(\d+)\s+(\w+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (singleDay) {
    const [, day, monthStr, startTime, endTime] = singleDay;
    const month = months[monthStr.toLowerCase()] || '00';
    const year = new Date().getFullYear();
    const dateStr = `${year}-${month}-${day.padStart(2, '0')}`;
    return { date: dateStr, startTime, endTime, raw: text };
  }

  // Mönster 2: Flerdagsevent MED tider — "7 feb 14:00 - 8 feb 16:00"
  const multiDayTimed = text.match(/(\d+)\s+(\w+)\s+(\d{1,2}:\d{2})\s*-\s*(\d+)\s+(\w+)\s+(\d{1,2}:\d{2})/);
  if (multiDayTimed) {
    const [, startDay, startMonthStr, startTime, endDay, endMonthStr, endTime] = multiDayTimed;
    const startMonth = months[startMonthStr.toLowerCase()];
    const endMonth = months[endMonthStr.toLowerCase()];
    if (!startMonth || !endMonth) return { raw: text };

    const year = new Date().getFullYear();
    let endYear = year;
    if (parseInt(startMonth) > parseInt(endMonth)) endYear = year + 1;

    const dateStr = `${year}-${startMonth}-${startDay.padStart(2, '0')}`;
    const dateToStr = `${endYear}-${endMonth}-${endDay.padStart(2, '0')}`;
    return { date: dateStr, dateTo: dateToStr, startTime, endTime, raw: text };
  }

  // Mönster 3: Flerdagsevent UTAN tider — "7 feb - 8 feb (2 dagar)" eller "30 dec - 2 jan"
  const multiDay = text.match(/(\d+)\s+(\w+)\s*-\s*(\d+)\s+(\w+)/);
  if (multiDay) {
    const [, startDay, startMonthStr, endDay, endMonthStr] = multiDay;
    const startMonth = months[startMonthStr.toLowerCase()];
    const endMonth = months[endMonthStr.toLowerCase()];
    if (!startMonth || !endMonth) return { raw: text };

    const year = new Date().getFullYear();
    let endYear = year;
    if (parseInt(startMonth) > parseInt(endMonth)) endYear = year + 1;

    const dateStr = `${year}-${startMonth}-${startDay.padStart(2, '0')}`;
    const dateToStr = `${endYear}-${endMonth}-${endDay.padStart(2, '0')}`;
    return { date: dateStr, dateTo: dateToStr, raw: text };
  }

  return { raw: text };
}

function isCompleted(dateInfo) {
  if (!dateInfo.date) return false;
  const today = new Date().toISOString().slice(0, 10);
  const endDate = dateInfo.dateTo || dateInfo.date;
  return endDate < today;
}

// === SKRAPA LOK-STATUS ===
async function scrapeLokStatus(page) {
  // Klicka på "Aktivitetsinfo"-fliken (AJAX-laddad)
  const tab = await page.$('a.subItem:has-text("Aktivitetsinfo")');
  if (!tab) return null;

  await tab.click();
  await sleep(2000);

  const checked = await page.$eval('#intEventFunding', el => el.checked).catch(() => null);
  return checked;
}

// === SKRAPA TIDER FRÅN AKTIVITETSINFO-FLIKEN ===
// Anropas EFTER scrapeLokStatus() som klickar på Aktivitetsinfo-fliken.
// DOM-layout (tabell med rader):
//   <tr> Startdatum [datuminput] [timme-select] [minut-select] </tr>
//   <tr> Slutdatum  [datuminput] [timme-select] [minut-select] </tr>
//   <tr> Hela dagen [checkbox]                                  </tr>
async function scrapeEditPageTimes(page) {
  return page.evaluate(() => {
    let startTime = null;
    let endTime = null;
    let helaDagen = false;
    let found = false;

    const rows = document.querySelectorAll('tr');

    for (const row of rows) {
      const rowText = row.textContent;
      const selects = row.querySelectorAll('select');

      // Startdatum-rad: innehåller "Startdatum" + 2 selects (timme, minut)
      if (/startdatum/i.test(rowText) && selects.length >= 2) {
        const h = selects[0].value.padStart(2, '0');
        const m = selects[1].value.padStart(2, '0');
        startTime = `${h}:${m}`;
        found = true;
      }

      // Slutdatum-rad: innehåller "Slutdatum" + 2 selects (timme, minut)
      if (/slutdatum/i.test(rowText) && selects.length >= 2) {
        const h = selects[0].value.padStart(2, '0');
        const m = selects[1].value.padStart(2, '0');
        endTime = `${h}:${m}`;
        found = true;
      }

      // Hela dagen-rad: checkbox
      if (/hela dagen/i.test(rowText)) {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb) {
          helaDagen = cb.checked;
          found = true;
        }
      }
    }

    // null = kunde inte hitta fälten (fel flik/sida)
    return found ? { startTime, endTime, helaDagen } : null;
  });
}

// === SKRAPA DELTAGARE ===
async function scrapeParticipants(page, editUrl) {
  await rateLimit();
  await page.goto(editUrl, { waitUntil: 'networkidle' });
  await sleep(1500);

  // Steg 1: Skrapa deltagare (vi landar på "Deltagare"-fliken)
  let result;
  const hasGrid = await page.$('.attendees-grid').then(el => !!el);
  if (hasGrid) {
    result = await scrapeAttendanceMode(page);
  } else {
    const hasScheduleTable = await page.$('table.attendee_list').then(el => !!el);
    if (hasScheduleTable) {
      result = await scrapeScheduleMode(page);
    } else {
      console.log('   ⚠️  Okänt sidformat');
      result = { deltagare: [], ledare: [] };
    }
  }

  // Steg 2: Klicka på "Aktivitetsinfo"-fliken (LOK + tider finns här)
  const lokAktivitet = await scrapeLokStatus(page);
  result.lokAktivitet = lokAktivitet;

  // Steg 3: Nu är vi på Aktivitetsinfo — hämta tider från formuläret
  const editTimes = await scrapeEditPageTimes(page);
  result.editTimes = editTimes;

  return result;
}

async function scrapeAttendanceMode(page) {
  const result = await page.evaluate(() => {
    const grids = document.querySelectorAll('.attendees-grid');
    const sections = [];

    for (const grid of grids) {
      const cells = grid.querySelectorAll('.rsvp-cell');
      const participants = [];

      for (const cell of cells) {
        const nameEl = cell.querySelector('.listAttendeeDataName');
        if (!nameEl) continue;
        const name = nameEl.textContent.trim();
        if (!name) continue;

        let status = 'Ej kallad';
        const statusIcon = cell.querySelector('.attendanceIcon');
        if (statusIcon) {
          if (statusIcon.classList.contains('attending')) status = 'Deltar';
          else if (statusIcon.classList.contains('notAttending')) status = 'Deltar ej';
          else if (statusIcon.classList.contains('noAnswer')) status = 'Ej svarat';
        }

        const tooltipEl = cell.querySelector('.tooltip');
        const comment = tooltipEl?.textContent.trim() || '';

        participants.push({ name, status, comment });
      }
      sections.push(participants);
    }
    return { sections };
  });

  return { deltagare: result.sections[0] || [], ledare: result.sections[1] || [] };
}

async function scrapeScheduleMode(page) {
  console.log('   📋 Schemaläggningsläge');
  const result = await page.evaluate(() => {
    function parseTable(sel) {
      const table = document.querySelector(sel);
      if (!table) return [];
      return [...table.querySelectorAll('tr[class*="userid-"]')].map(row => {
        const nameEl = row.querySelector('.listAttendeeDataName');
        return { name: nameEl?.textContent.trim() || '', status: 'Schemalagd', comment: '' };
      }).filter(p => p.name);
    }
    return {
      deltagare: parseTable('table.attendee_list.js-list-4'),
      ledare: parseTable('table.attendee_list.js-list-3')
    };
  });
  return result;
}

// === BYGG RESULTAT-OBJEKT ===
function buildResult(activity, { deltagare = [], ledare = [], lokAktivitet = null, editTimes = null, error } = {}) {
  // Tider: föredra Aktivitetsinfo-flikens formulär (alltid korrekta),
  // falla tillbaka på kalenderlistan (kan sakna tider för flerdagsevent)
  const startTime = editTimes?.startTime || activity.startTime || null;
  const endTime = editTimes?.endTime || activity.endTime || null;

  // Heldag: checkboxen på Aktivitetsinfo är auktoritativ.
  // Utan editTimes (fallback): gissa baserat på avsaknad av tider.
  let heldag;
  if (editTimes) {
    heldag = editTimes.helaDagen;
  } else {
    heldag = (!startTime && !endTime) ||
      (startTime === '00:00' && endTime === '23:59');
  }

  return {
    eventId: activity.eventId,
    datum: activity.date || activity.dateText,
    datum_till: activity.dateTo || null,
    starttid: heldag ? '' : (startTime || ''),
    sluttid: heldag ? '' : (endTime || ''),
    heldag,
    typ: activity.type,
    plats: activity.location,
    narvaroSammanfattning: activity.presence,
    genomford: activity.completed,
    lokAktivitet,
    deltagare,
    ledare,
    ...(error ? { error } : {})
  };
}

// === HUVUDFUNKTION ===
async function run() {
  const { teamKeys, months, afterDate, beforeDate } = parseArgs();
  const startTime = Date.now();

  console.log('🏃 Startar aktivitetsscraper');
  console.log(`   Lag: ${teamKeys.length === Object.keys(TEAMS).length ? 'alla' : teamKeys.join(', ')}`);
  console.log(`   Månader: ${months ? months.join(', ') : 'default'}`);
  if (afterDate) console.log(`   Efter: ${afterDate}`);
  if (beforeDate) console.log(`   Före: ${beforeDate}`);
  console.log();

  const { browser, page } = await createBrowser({ headless: true });
  const allTeamResults = {};

  try {
    await login(page);

    for (const teamKey of teamKeys) {
      const team = TEAMS[teamKey];
      if (!team) {
        console.error(`❌ Okänt lag: "${teamKey}". Tillgängliga: ${Object.keys(TEAMS).join(', ')}`);
        continue;
      }

      const calendarUrl = `https://admin.laget.se/${team.slug}/Calendar`;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`⚽ ${team.name}`);
      console.log(`${'='.repeat(60)}`);

      const teamResults = [];
      const monthsToScrape = months || [null]; // null = default (innevarande)

      for (const month of monthsToScrape) {
        if (month) console.log(`\n📅 Månad: ${month.toUpperCase()}`);

        let activities;
        try {
          activities = await getActivitiesForMonth(page, calendarUrl, month);
        } catch (err) {
          console.error(`   ❌ Kunde inte hämta ${month || 'default'}: ${err.message}`);
          continue;
        }

        console.log(`   Hittade ${activities.length} aktiviteter`);

        // Parsa datum och filtrera
        const parsed = activities.map(a => ({
          ...a,
          ...parseDateText(a.dateText),
          completed: isCompleted(parseDateText(a.dateText))
        }));

        let toScrape = parsed;

        // Filtrera på --after om angivet (kolla slutdatum för flerdagsevents)
        if (afterDate) {
          toScrape = toScrape.filter(a => {
            if (!a.date) return true;
            const endDate = a.dateTo || a.date;
            return endDate >= afterDate;
          });
        }

        // Filtrera på --before om angivet
        if (beforeDate) {
          toScrape = toScrape.filter(a => !a.date || a.date < beforeDate);
        }

        if (toScrape.length === 0) {
          console.log('   Inga aktiviteter att skrapa efter filtrering');
          continue;
        }

        console.log(`   Skrapar ${toScrape.length} aktiviteter...`);

        for (let i = 0; i < toScrape.length; i++) {
          const activity = toScrape[i];
          const label = `[${i + 1}/${toScrape.length}]`;
          console.log(`\n   📋 ${label} ${activity.dateText} - ${activity.type}`);

          if (!activity.editUrl) {
            console.log('      ⚠️  Ingen redigera-URL');
            teamResults.push(buildResult(activity, { error: 'Ingen redigera-URL' }));
            continue;
          }

          try {
            const { deltagare, ledare, lokAktivitet, editTimes } = await scrapeParticipants(page, activity.editUrl);

            if (editTimes) {
              console.log(`      ⏰ ${editTimes.startTime}–${editTimes.endTime} ${editTimes.helaDagen ? '(heldag)' : ''}`);
            } else {
              console.log('      ⏰ Inga tider från Aktivitetsinfo (fliken hittades inte)');
            }

            const deltarCount = deltagare.filter(d => d.status === 'Deltar').length;
            const schemCount = deltagare.filter(d => d.status === 'Schemalagd').length;
            const ledDeltarCount = ledare.filter(l => l.status === 'Deltar').length;
            const ledSchemCount = ledare.filter(l => l.status === 'Schemalagd').length;
            const lokLabel = lokAktivitet === true ? 'LOK' : lokAktivitet === false ? 'ej LOK' : '?';

            if (schemCount > 0) {
              console.log(`      ✅ ${schemCount} schemalagda, ${ledSchemCount} ledare [${lokLabel}]`);
            } else {
              console.log(`      ✅ ${deltarCount} deltar, ${ledDeltarCount} ledare (${deltagare.length} kallade) [${lokLabel}]`);
            }

            teamResults.push(buildResult(activity, { deltagare, ledare, lokAktivitet, editTimes }));
          } catch (err) {
            console.error(`      ❌ ${err.message}`);
            teamResults.push(buildResult(activity, { error: err.message }));
          }
        }
      }

      // Spara per lag
      const fileName = `aktiviteter-${teamKey}`;
      saveJson('laget', fileName, {
        skrapadVid: new Date().toISOString(),
        lag: team.name,
        lagSlug: team.slug,
        antalAktiviteter: teamResults.length,
        aktiviteter: teamResults
      });

      allTeamResults[teamKey] = teamResults;

      // Sammanfattning per lag
      console.log(`\n--- ${team.name}: ${teamResults.length} aktiviteter ---`);
      for (const r of teamResults) {
        const dCount = r.deltagare.filter(d => d.status === 'Deltar').length;
        const sCount = r.deltagare.filter(d => d.status === 'Schemalagd').length;
        const lCount = r.ledare.filter(l => l.status === 'Deltar' || l.status === 'Schemalagd').length;
        const info = sCount > 0 ? `${sCount} schem.` : `${dCount} deltar`;
        const lok = r.lokAktivitet === true ? 'LOK' : r.lokAktivitet === false ? 'ej LOK' : '?';
        console.log(`  ${r.datum} ${r.starttid}-${r.sluttid} ${r.typ} | ${info}, ${lCount} led. [${lok}]`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Total tid: ${elapsed}s`);

  } catch (error) {
    console.error('\n❌ Kritiskt fel:', error.message);
  } finally {
    await browser.close();
  }
}

run();
