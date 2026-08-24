const POLL_MS = 30_000;
const PAGE_MS = 12_000;
const GROUPS_PER_PAGE = 5;

let allGroups = [];
let page = 0;

const content = document.querySelector('#content');
const count = document.querySelector('#problem-count');
const dot = document.querySelector('#connection-dot');
const connectionText = document.querySelector('#connection-text');
const updatedAt = document.querySelector('#updated-at');
const scope = document.querySelector('#scope');

function applyDashboardConfig(config) {
  if (!config) return;
  document.querySelector('#eyebrow').textContent = config.eyebrow;
  document.querySelector('#dashboard-title').textContent = config.title;
  document.title = config.title;
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

function renderProblems(problems) {
  if (!problems.length) return '<div class="card-ok"><span class="card-ok-dot"></span>Aucune panne ICMP</div>';
  return `<ul class="equipment-list">${problems.map((problem) => `
    <li class="equipment-item ${severity(problem.priority)}${problem.simulated ? ' simulated' : ''}">
      <div class="equipment-name">${escapeHtml(problem.host)}${problem.simulated ? '<span class="test-badge">TEST</span>' : ''}</div>
      <div class="equipment-detail">${escapeHtml(problem.trigger)}</div>
      <div class="equipment-age">${elapsed(problem.lastChange)} · ${formatTime(problem.lastChange)}</div>
    </li>`).join('')}</ul>`;
}

function render() {
  const pages = Math.max(1, Math.ceil(allGroups.length / GROUPS_PER_PAGE));
  page %= pages;
  const visibleGroups = allGroups.slice(page * GROUPS_PER_PAGE, (page + 1) * GROUPS_PER_PAGE);

  if (!visibleGroups.length) {
    content.innerHTML = '<div class="error-state"><h2>Aucun groupe configure</h2><p>Definissez ZABBIX_HOST_GROUPS dans le fichier .env.</p></div>';
    return;
  }

  content.innerHTML = `
    <div class="group-grid">
      ${visibleGroups.map((group) => `
        <article class="group-card${group.problems.length ? ' has-problems' : ''}">
          <header class="group-card-header">
            <div>
              <p>Groupe Zabbix</p>
              <h2>${escapeHtml(group.name)}</h2>
            </div>
            <strong class="group-count">${group.problems.length}</strong>
          </header>
          <div class="group-card-body">${renderProblems(group.problems)}</div>
        </article>`).join('')}
    </div>
    ${pages > 1 ? `<div class="pager">Groupes ${page * GROUPS_PER_PAGE + 1}-${Math.min((page + 1) * GROUPS_PER_PAGE, allGroups.length)} / ${allGroups.length}</div>` : ''}`;
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
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const payload = await response.json();
    const data = payload.ok ? payload : payload.previousData;
    if (!data) throw new Error(payload.error || 'Aucune donnee disponible.');

    applyDashboardConfig(payload.dashboard);
    allGroups = data.groups || [];
    count.textContent = data.problems.length;
    scope.textContent = `${allGroups.length} groupes surveilles`;
    updatedAt.textContent = `Mise a jour : ${formatTime(data.fetchedAt)}`;
    setConnection(payload.ok, payload.ok ? 'Zabbix connecte' : 'Dernieres donnees affichees');
    render();
  } catch (error) {
    setConnection(false, 'Zabbix inaccessible');
    count.textContent = '--';
    content.innerHTML = `<div class="error-state"><h2>Connexion impossible</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function tickClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date());
}

window.setInterval(() => {
  page += 1;
  render();
}, PAGE_MS);
window.setInterval(load, POLL_MS);
window.setInterval(tickClock, 1000);

tickClock();
load();
