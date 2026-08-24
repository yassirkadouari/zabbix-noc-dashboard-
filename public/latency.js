const content = document.querySelector('#content');
const dot = document.querySelector('#connection-dot');
const connectionText = document.querySelector('#connection-text');
const globalAverage = document.querySelector('#global-average');
const scope = document.querySelector('#scope');
const updatedAt = document.querySelector('#updated-at');
let pollTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function formatMs(value) {
  return value === null || value === undefined ? '--' : `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ms`;
}

function formatTime(value) {
  if (!value) return '--';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(value));
}

function latencyClass(value) {
  if (value === null || value === undefined) return 'unknown';
  if (value >= 100) return 'critical';
  if (value >= 40) return 'warning';
  return 'healthy';
}

function setConnection(ok, message) {
  dot.classList.toggle('offline', !ok);
  connectionText.textContent = message;
}

function applyBrand(config) {
  if (!config) return;
  document.querySelector('#eyebrow').textContent = config.eyebrow;
  document.querySelector('#dashboard-title').textContent = `${config.title} · Latence`;
}

function render(groups) {
  if (!groups.length) {
    content.innerHTML = '<div class="error-state"><h2>Aucun groupe configure</h2><p>Verifiez la configuration des groupes.</p></div>';
    return;
  }

  content.innerHTML = `<div class="latency-grid">${groups.map((group) => {
    const tone = latencyClass(group.averageMs);
    const hostRows = group.hosts.length ? `<ul class="slow-hosts">${group.hosts.map((host) => `
      <li><span>${escapeHtml(host.name)}</span><strong>${formatMs(host.milliseconds)}</strong></li>`).join('')}</ul>` : '<p class="empty-hosts">Aucune mesure ICMP recente</p>';
    return `
      <article class="latency-card ${tone}">
        <header>
          <p>Groupe reseau</p>
          <h2>${escapeHtml(group.name)}</h2>
          <span class="latency-state">${tone === 'healthy' ? 'Normal' : tone === 'warning' ? 'A surveiller' : tone === 'critical' ? 'Elevee' : 'Sans mesure'}</span>
        </header>
        <div class="main-latency"><strong>${group.averageMs === null ? '--' : group.averageMs.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</strong><span>ms moyen</span></div>
        <div class="latency-stats">
          <span><small>MIN</small><strong>${formatMs(group.minMs)}</strong></span>
          <span><small>MAX</small><strong>${formatMs(group.maxMs)}</strong></span>
          <span><small>REPONSES</small><strong>${group.respondingHosts}/${group.totalHosts}</strong></span>
        </div>
        <section class="slowest"><p>Les plus lents</p>${hostRows}</section>
      </article>`;
  }).join('')}</div>`;
}

async function load() {
  let pollIntervalSeconds = 30;
  try {
    const response = await fetch('/api/latency', { cache: 'no-store' });
    const payload = await response.json();
    const data = payload.ok ? payload : payload.previousData;
    if (!data) throw new Error(payload.error || 'Aucune donnee disponible.');

    applyBrand(payload.dashboard);
    pollIntervalSeconds = payload.pollIntervalSeconds || pollIntervalSeconds;
    const averages = data.groups.map((group) => group.averageMs).filter((value) => value !== null);
    const overall = averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
    globalAverage.textContent = overall === null ? '--' : `${overall.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ms`;
    scope.textContent = `${data.groups.length} groupes surveilles`;
    updatedAt.textContent = `Mise a jour : ${formatTime(data.fetchedAt)}`;
    setConnection(payload.ok, payload.ok ? 'Service connecte' : 'Dernieres donnees affichees');
    render(data.groups);
  } catch (error) {
    setConnection(false, 'Service inaccessible');
    globalAverage.textContent = '--';
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
tickClock();
load();
