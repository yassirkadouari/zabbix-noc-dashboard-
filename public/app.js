let allGroups = [];
let pollTimer;
const alertPageByGroup = new Map();
const ALERTS_PER_PAGE = 3;
const ALERT_ROTATION_MS = 6000;

const content = document.querySelector('#content');
const count = document.querySelector('#problem-count');
const dot = document.querySelector('#connection-dot');
const connectionText = document.querySelector('#connection-text');
const updatedAt = document.querySelector('#updated-at');
const scope = document.querySelector('#scope');

function applyDashboardConfig(config) {
  if (!config) return;
  const eyebrow = document.querySelector('#eyebrow');
  const title = document.querySelector('#dashboard-title');
  const titleText = config.title?.trim() || 'NOC TC3-TCR';
  const eyebrowText = config.eyebrow?.trim() || '';
  const comparableText = (value) => value.toLocaleLowerCase('fr').replace(/[^a-z0-9]/g, '');
  eyebrow.textContent = eyebrowText;
  title.textContent = titleText;
  eyebrow.hidden = !eyebrowText || comparableText(eyebrowText) === comparableText(titleText);
  document.title = titleText;
  document.documentElement.style.setProperty('--group-columns', String(Math.min(4, config.layoutColumns || 3)));
  orderSlots(document.querySelector('#topbar'), config.headerOrder);
  orderSlots(document.querySelector('#footer'), config.footerOrder);
}

function orderSlots(container, order) {
  const elements = new Map([...container.querySelectorAll('[data-slot]')].map((element) => [element.dataset.slot, element]));
  for (const slot of order || []) {
    const element = elements.get(slot);
    if (element) container.append(element);
  }
}

function formatTime(value) {
  if (!value) return 'Heure inconnue';
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
  }).format(new Date(value));
}

function elapsed(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'A l’instant';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ''}`;
}

function severity(priority) {
  if (priority >= 4) return 'critical';
  if (priority === 3) return 'high';
  if (priority === 2) return 'warning';
  return 'info';
}

function formatLatency(value) {
  return value === null || value === undefined ? '--' : `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ms`;
}

function alertsPerPage(group) {
  return group.services?.length ? 2 : ALERTS_PER_PAGE;
}

function renderProblems(group) {
  const problems = group.problems;
  if (!problems.length) return '';
  const pageSize = alertsPerPage(group);
  const pageCount = Math.ceil(problems.length / pageSize);
  const pageIndex = (alertPageByGroup.get(group.id) || 0) % pageCount;
  const pageStart = pageIndex * pageSize;
  const visibleProblems = problems.slice(pageStart, pageStart + pageSize);
  const rotationStatus = pageCount > 1
    ? `<div class="rotation-status"><span class="rotation-pulse"></span>Rotation automatique</div><span>${pageIndex + 1} / ${pageCount}</span>`
    : '';

  return `<div class="equipment-page">
    <ul class="equipment-list">${visibleProblems.map((problem) => `
    <li class="equipment-item ${severity(problem.priority)}${problem.simulated ? ' simulated' : ''}">
      <div class="equipment-name">${escapeHtml(problem.host)}${problem.simulated ? '<span class="test-badge">TEST</span>' : ''}</div>
      <div class="equipment-detail">${escapeHtml(problem.trigger)}</div>
      <div class="equipment-age">${elapsed(problem.lastChange)} · ${formatTime(problem.lastChange)}</div>
    </li>`).join('')}</ul>
    ${rotationStatus ? `<div class="rotation-meta">${rotationStatus}</div>` : ''}
  </div>`;
}

function renderServices(services = []) {
  if (!services.length) return '';
  return `<div class="service-list">${services.map((service) => {
    const unknownLabels = {
      'items-not-found': 'ITEMS ABSENTS',
      'failure-item-stale': 'DONNEES ANCIENNES',
      'response-item-stale': 'DONNEES ANCIENNES',
      'failure-item-unsupported': 'ITEM INACTIF',
      'response-item-unsupported': 'ITEM INACTIF',
      'failure-value-invalid': 'VALEUR INVALIDE',
      'response-code-invalid': 'VALEUR INVALIDE',
    };
    const statusLabel = service.status === 'up' ? 'EN LIGNE'
      : service.status === 'down' ? 'HORS LIGNE'
        : unknownLabels[service.statusReason] || 'ETAT INCONNU';
    const responseCode = service.responseCode === null ? 'HTTP --' : `HTTP ${service.responseCode}`;
    return `<div class="service-monitor ${service.status}">
      <span class="service-signal"><span></span></span>
      <div class="service-copy">
        <small>SERVICE WEB</small>
        <strong>${escapeHtml(service.name)}</strong>
        <span>${responseCode}${service.interval ? ` · Toutes les ${escapeHtml(service.interval)}` : ''} · Controle : ${formatTime(service.lastCheck)}</span>
      </div>
      <b>${statusLabel}</b>
    </div>`;
  }).join('')}</div>`;
}

function renderGroupBody(group) {
  const services = renderServices(group.services);
  const problems = renderProblems(group);
  if (services || problems) return `<div class="group-body-content">${services}${problems}</div>`;
  return `
    <div class="card-ok">
      <span class="health-ring"><span>OK</span></span>
      <div><strong>Tout est stable</strong><span>Aucune perte ICMP detectee</span></div>
    </div>`;
}

function groupState(group) {
  const downServices = (group.services || []).filter((service) => service.status === 'down').length;
  const unknownServices = (group.services || []).filter((service) => service.status === 'unknown').length;
  const alertCount = group.problems.length + downServices;
  return { alertCount, downServices, unknownServices, degraded: alertCount > 0 };
}

function render() {
  if (!allGroups.length) {
    content.innerHTML = '<div class="error-state"><h2>Aucun groupe configure</h2><p>Verifiez la configuration des groupes.</p></div>';
    return;
  }

  content.innerHTML = `
    <div class="group-grid">
      ${allGroups.map((group) => {
        const state = groupState(group);
        const hasServices = Boolean(group.services?.length);
        return `
        <article class="group-card${state.degraded ? ' has-problems' : ''}${!state.degraded && state.unknownServices ? ' has-unknown' : ''}">
          <header class="group-card-header">
            <div>
              <p>${state.degraded ? 'Disponibilite degradee' : state.unknownServices ? 'Surveillance partielle' : 'Disponibilite normale'}</p>
              <h2>${escapeHtml(group.name)}</h2>
            </div>
            <div class="group-status">
              <strong class="group-count">${String(state.alertCount).padStart(2, '0')}</strong>
              <span>${state.alertCount ? 'Alertes' : state.unknownServices ? 'A verifier' : 'Stable'}</span>
            </div>
          </header>
          <div class="card-state">
            <span class="availability"><span class="state-indicator"></span>${state.degraded ? 'Alertes actives' : hasServices ? 'Web et ICMP surveilles' : 'Surveillance ICMP active'}</span>
            <span class="group-latency"><small>LATENCE MOY.</small><strong>${formatLatency(group.averageMs)}</strong></span>
          </div>
          <div class="group-card-body">${renderGroupBody(group)}</div>
        </article>`;
      }).join('')}
    </div>`;
}

function rotateAlertPages() {
  let shouldRender = false;
  for (const group of allGroups) {
    const pageCount = Math.ceil(group.problems.length / alertsPerPage(group));
    if (pageCount <= 1) continue;
    alertPageByGroup.set(group.id, ((alertPageByGroup.get(group.id) || 0) + 1) % pageCount);
    shouldRender = true;
  }
  if (shouldRender) render();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function setConnection(ok, message) {
  dot.classList.toggle('offline', !ok);
  connectionText.textContent = message;
}

async function load() {
  let pollIntervalSeconds = 30;
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json();
    const data = payload.ok ? payload : payload.previousData;
    if (!data) throw new Error(payload.error || 'Aucune donnee disponible.');

    applyDashboardConfig(payload.dashboard);
    pollIntervalSeconds = payload.pollIntervalSeconds || pollIntervalSeconds;
    allGroups = data.groups || [];
    const webServices = allGroups.flatMap((group) => group.services || []);
    count.textContent = data.problems.length + webServices.filter((service) => service.status === 'down').length;
    scope.textContent = `${allGroups.length} groupes · ${webServices.length ? `${webServices.length} services web` : 'aucun service web detecte'}`;
    updatedAt.textContent = `Mise a jour : ${formatTime(data.fetchedAt)}`;
    setConnection(payload.ok, payload.ok ? 'Service connecte' : 'Dernieres donnees affichees');
    render();
  } catch (error) {
    setConnection(false, 'Service inaccessible');
    count.textContent = '--';
    content.innerHTML = `<div class="error-state"><h2>Connexion impossible</h2><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    clearTimeout(pollTimer);
    pollTimer = window.setTimeout(load, Math.max(5, pollIntervalSeconds) * 1000);
  }
}

function tickClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date());
}

window.setInterval(tickClock, 1000);
window.setInterval(rotateAlertPages, ALERT_ROTATION_MS);

tickClock();
load();
