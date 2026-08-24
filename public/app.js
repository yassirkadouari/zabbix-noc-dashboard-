const POLL_MS = 30_000;
const PAGE_MS = 12_000;
const PAGE_SIZE = 8;

let allProblems = [];
let page = 0;
let pageTimer;

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
  if (minutes < 60) return `Depuis ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `Depuis ${hours} h${rest ? ` ${rest} min` : ''}`;
}

function severity(priority) {
  if (priority >= 4) return ['critical', 'Critique'];
  if (priority === 3) return ['high', 'Elevee'];
  if (priority === 2) return ['warning', 'Moyenne'];
  return ['info', 'Information'];
}

function render() {
  const pages = Math.max(1, Math.ceil(allProblems.length / PAGE_SIZE));
  page %= pages;
  const visible = allProblems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (!visible.length) {
    content.innerHTML = `
      <div class="healthy-state">
        <div class="healthy-mark" aria-hidden="true">✓</div>
        <h2>Aucune panne ICMP</h2>
        <p>Tous les equipements surveilles repondent actuellement.</p>
      </div>`;
    return;
  }

  const rows = visible.map((problem) => {
    const [className, label] = severity(problem.priority);
    return `
      <article class="problem-row ${className}">
        <div class="severity" aria-label="Gravite ${label}"></div>
        <div class="equipment">
          <h2>${escapeHtml(problem.host)}</h2>
          <p>${escapeHtml(problem.trigger)}</p>
        </div>
        <div class="duration">
          <strong>${elapsed(problem.lastChange)}</strong>
          <span>${formatTime(problem.lastChange)}</span>
        </div>
      </article>`;
  }).join('');

  content.innerHTML = `<div class="problems">${rows}</div>${pages > 1 ? `<div class="pager">Page ${page + 1} / ${pages}</div>` : ''}`;
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
    allProblems = data.problems;
    count.textContent = allProblems.length;
    scope.textContent = `Groupes : ${data.groupFilter.length ? data.groupFilter.join(', ') : 'tous'}`;
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
