let adminToken = sessionStorage.getItem('noc-admin-token') || '';
let hostGroups = [];
let config;
let draggedIndex = null;

const unlockPanel = document.querySelector('#unlock-panel');
const settingsForm = document.querySelector('#settings-form');
const unlockError = document.querySelector('#unlock-error');
const saveStatus = document.querySelector('#save-status');
const connectionState = document.querySelector('#connection-state');
const panels = document.querySelector('#panels');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { 'x-noc-admin-token': adminToken, ...(options.headers || {}) },
  });
}

function movePanel(from, to) {
  if (to < 0 || to >= config.panels.length || from === to) return;
  const [panel] = config.panels.splice(from, 1);
  config.panels.splice(to, 0, panel);
  renderPanels();
}

function renderPanels() {
  if (!config.panels.length) {
    panels.innerHTML = '<div class="empty-panels">Ajoutez un panneau puis choisissez les host groups qui doivent y apparaitre.</div>';
    return;
  }

  panels.innerHTML = config.panels.map((panel, index) => `
    <article class="panel-editor" draggable="true" data-index="${index}">
      <header>
        <span class="drag-handle" title="Glisser pour deplacer" aria-hidden="true">::</span>
        <label class="panel-title">Nom du panneau<input data-title="${index}" value="${escapeHtml(panel.title)}" maxlength="100" /></label>
        <div class="panel-actions">
          <button type="button" data-move-up="${index}" title="Monter" aria-label="Monter">↑</button>
          <button type="button" data-move-down="${index}" title="Descendre" aria-label="Descendre">↓</button>
          <button type="button" data-remove="${index}" title="Supprimer" aria-label="Supprimer">×</button>
        </div>
      </header>
      <div class="group-picker">
        ${hostGroups.map((group) => `<label><input type="checkbox" data-group="${index}" value="${escapeHtml(group)}"${panel.groups.includes(group) ? ' checked' : ''} /><span>${escapeHtml(group)}</span></label>`).join('')}
      </div>
      <footer>${panel.groups.length} host group${panel.groups.length > 1 ? 's' : ''} selectionne${panel.groups.length > 1 ? 's' : ''}</footer>
    </article>`).join('');
}

async function unlock() {
  const [configResponse, groupsResponse] = await Promise.all([request('/api/configuration'), request('/api/host-groups')]);
  if (!configResponse.ok || !groupsResponse.ok) throw new Error('Secret incorrect ou groupes indisponibles.');
  const configPayload = await configResponse.json();
  const groupsPayload = await groupsResponse.json();
  config = configPayload.dashboard;
  hostGroups = groupsPayload.groups;
  document.querySelector('#title').value = config.title;
  document.querySelector('#eyebrow').value = config.eyebrow;
  document.querySelector('#layout-columns').value = String(config.layoutColumns);
  unlockPanel.hidden = true;
  settingsForm.hidden = false;
  connectionState.textContent = 'Configuration ouverte';
  connectionState.classList.add('open');
  renderPanels();
}

document.querySelector('#unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  adminToken = document.querySelector('#admin-token').value;
  unlockError.textContent = '';
  try {
    await unlock();
    sessionStorage.setItem('noc-admin-token', adminToken);
  } catch (error) {
    adminToken = '';
    sessionStorage.removeItem('noc-admin-token');
    unlockError.textContent = error.message;
  }
});

document.querySelector('#add-panel').addEventListener('click', () => {
  config.panels.push({ id: `panel-${Date.now()}`, title: `Panneau ${config.panels.length + 1}`, groups: [] });
  renderPanels();
});

panels.addEventListener('input', (event) => {
  const index = Number(event.target.dataset.title);
  if (Number.isInteger(index)) config.panels[index].title = event.target.value;
});

panels.addEventListener('change', (event) => {
  const index = Number(event.target.dataset.group);
  if (!Number.isInteger(index)) return;
  const selected = new Set(config.panels[index].groups);
  if (event.target.checked) selected.add(event.target.value);
  else selected.delete(event.target.value);
  config.panels[index].groups = [...selected];
  renderPanels();
});

panels.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.moveUp !== undefined) movePanel(Number(button.dataset.moveUp), Number(button.dataset.moveUp) - 1);
  if (button.dataset.moveDown !== undefined) movePanel(Number(button.dataset.moveDown), Number(button.dataset.moveDown) + 1);
  if (button.dataset.remove !== undefined) {
    config.panels.splice(Number(button.dataset.remove), 1);
    renderPanels();
  }
});

panels.addEventListener('dragstart', (event) => {
  const panel = event.target.closest('.panel-editor');
  draggedIndex = panel ? Number(panel.dataset.index) : null;
  panel?.classList.add('dragging');
});
panels.addEventListener('dragend', (event) => event.target.closest('.panel-editor')?.classList.remove('dragging'));
panels.addEventListener('dragover', (event) => event.preventDefault());
panels.addEventListener('drop', (event) => {
  event.preventDefault();
  const panel = event.target.closest('.panel-editor');
  if (panel && draggedIndex !== null) movePanel(draggedIndex, Number(panel.dataset.index));
  draggedIndex = null;
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const emptyPanel = config.panels.find((panel) => !panel.title.trim() || !panel.groups.length);
  if (emptyPanel) {
    saveStatus.textContent = 'Chaque panneau doit avoir un nom et au moins un host group.';
    return;
  }
  const nextConfig = {
    ...config,
    title: document.querySelector('#title').value,
    eyebrow: document.querySelector('#eyebrow').value,
    layoutColumns: Number(document.querySelector('#layout-columns').value),
  };
  saveStatus.textContent = 'Enregistrement...';
  try {
    const response = await request('/api/configuration', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextConfig),
    });
    if (!response.ok) throw new Error('Enregistrement impossible.');
    config = (await response.json()).dashboard;
    saveStatus.textContent = 'Configuration enregistree. Le mur NOC sera mis a jour au prochain rafraichissement.';
    renderPanels();
  } catch (error) {
    saveStatus.textContent = error.message;
  }
});

if (adminToken) unlock().catch(() => sessionStorage.removeItem('noc-admin-token'));
