/**
 * Projektregister — Compuna Hub
 *
 * Importera alla projekt här. Följer samma mönster som sites/index.js.
 */

import minridskola from './minridskola.js';
import monitor from './monitor.js';
import laget from './laget.js';
import nyheter from './nyheter.js';
import bgcheck from './bgcheck.js';
import vasttrafik from './vasttrafik.js';
import sportanalys from './sportanalys.js';
import mailwise from './mailwise.js';

const PROJECTS = {
  minridskola,
  monitor,
  laget,
  nyheter,
  bgcheck,
  vasttrafik,
  sportanalys,
  mailwise,
};

export function getProject(id) {
  const project = PROJECTS[id];
  if (!project) {
    const available = Object.keys(PROJECTS).join(', ');
    throw new Error(`Projekt "${id}" finns inte. Tillgängliga: ${available}`);
  }
  return project;
}

export function getAllProjects() {
  return PROJECTS;
}
