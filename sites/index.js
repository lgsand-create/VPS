import 'dotenv/config';
import backatorpif from './backatorpif.js';
import backatorpifDev from './backatorpif-dev.js';

const SITES = {
  backatorpif,
  'backatorpif-dev': backatorpifDev,
};

export function getSite(siteId) {
  const site = SITES[siteId];
  if (!site) {
    const available = Object.keys(SITES).join(', ');
    throw new Error(`Site "${siteId}" finns inte. Tillgängliga: ${available}`);
  }
  return site;
}

export function getAllSites() {
  return SITES;
}

export function getActiveSite() {
  const siteId = process.env.SITE || 'backatorpif';
  return getSite(siteId);
}
