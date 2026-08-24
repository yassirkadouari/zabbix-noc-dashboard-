import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const apiUrl = process.env.ZABBIX_API_URL || 'https://172.16.132.86/api_jsonrpc.php';
const pollIntervalMs = Math.max(5, Number(process.env.POLL_INTERVAL_SECONDS || 45)) * 1000;
const requestedWebStaleSeconds = Number(process.env.WEB_STATUS_STALE_SECONDS || 180);
const webStatusStaleSeconds = Number.isFinite(requestedWebStaleSeconds) && requestedWebStaleSeconds >= 60
  ? requestedWebStaleSeconds : 180;
const fallbackGroups = (process.env.ZABBIX_HOST_GROUPS || 'Switches,AP')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const dashboardConfigPath = path.join(process.cwd(), 'dashboard.config.json');
const dashboardOverridePath = process.env.NOC_CONFIG_PATH || path.join(process.cwd(), 'dashboard.local.json');

const defaultDashboardConfig = Object.freeze({
  eyebrow: "CENTRE D'OPERATIONS RESEAU",
  title: 'NOC, TC3-TCR',
  headerOrder: ['brand', 'summary', 'connection'],
  footerOrder: ['scope', 'updatedAt', 'clock'],
  layoutColumns: 3,
  panels: [],
});

function orderedSlots(value, permitted) {
  if (!Array.isArray(value)) return permitted;
  const valid = value.filter((slot) => permitted.includes(slot));
  return [...new Set([...valid, ...permitted])];
}

function textSetting(value, fallback, maxLength = 100) {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value.trim() : fallback;
}

function panelSettings(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((panel, index) => {
    const groups = Array.isArray(panel?.groups) ? panel.groups
      .filter((group) => typeof group === 'string' && group.trim() && group.length <= 120)
      .map((group) => group.trim()) : [];
    return {
      id: `panel-${index + 1}`,
      title: textSetting(panel?.title, `Groupe ${index + 1}`),
      groups: [...new Set(groups)].slice(0, 40),
    };
  }).filter((panel) => panel.groups.length);
}

function normalizeDashboardConfig(rawConfig) {
  return {
    eyebrow: textSetting(rawConfig?.eyebrow, defaultDashboardConfig.eyebrow),
    title: textSetting(rawConfig?.title, defaultDashboardConfig.title),
    headerOrder: orderedSlots(rawConfig?.headerOrder, defaultDashboardConfig.headerOrder),
    footerOrder: orderedSlots(rawConfig?.footerOrder, defaultDashboardConfig.footerOrder),
    layoutColumns: [2, 3, 4].includes(Number(rawConfig?.layoutColumns)) ? Number(rawConfig.layoutColumns) : defaultDashboardConfig.layoutColumns,
    panels: panelSettings(rawConfig?.panels),
  };
}

function loadDashboardConfig() {
  try {
    const sourcePath = fs.existsSync(dashboardOverridePath) ? dashboardOverridePath : dashboardConfigPath;
    return normalizeDashboardConfig(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Configuration dashboard invalide; configuration par defaut utilisee.');
    return { ...defaultDashboardConfig };
  }
}

let dashboardConfig = loadDashboardConfig();

function validateRuntimeConfiguration() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT doit etre compris entre 1024 et 65535.');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('HOST doit rester local (127.0.0.1 ou ::1).');
  let parsedUrl;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error('ZABBIX_API_URL est invalide.');
  }
  if (parsedUrl.username || parsedUrl.password || !['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('ZABBIX_API_URL doit etre une URL HTTP(S) sans identifiants integres.');
  }
  if (parsedUrl.protocol === 'http:' && process.env.ZABBIX_ALLOW_INSECURE_HTTP !== 'true') {
    throw new Error('Zabbix doit etre joint en HTTPS. Definissez ZABBIX_ALLOW_INSECURE_HTTP=true uniquement si cela est inevitable.');
  }
}

validateRuntimeConfiguration();

function isAdminRequest(request) {
  const expected = process.env.NOC_ADMIN_TOKEN;
  const supplied = request.get('x-noc-admin-token');
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function requireAdmin(request, response, next) {
  if (isAdminRequest(request)) return next();
  return response.status(401).json({ ok: false, error: 'Acces administrateur requis.' });
}

function saveDashboardConfig(rawConfig) {
  const nextConfig = normalizeDashboardConfig(rawConfig);
  const temporaryPath = `${dashboardOverridePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, dashboardOverridePath);
  dashboardConfig = nextConfig;
  cache.data = null;
  cache.updatedAt = null;
  latencyCache.data = null;
  latencyCache.updatedAt = null;
  return dashboardConfig;
}

let requestId = 1;
let legacyAuthToken = null;
let cache = {
  data: null,
  updatedAt: null,
  error: null,
  fetching: null,
};
let latencyCache = {
  data: null,
  updatedAt: null,
  fetching: null,
};

function requireCredentials() {
  if (process.env.ZABBIX_API_TOKEN) return;
  if (process.env.ZABBIX_USERNAME && process.env.ZABBIX_PASSWORD) return;
  throw new Error('Configurez ZABBIX_API_TOKEN ou ZABBIX_USERNAME et ZABBIX_PASSWORD dans .env.');
}

async function rpc(method, params = {}, auth = legacyAuthToken) {
  const headers = { 'Content-Type': 'application/json-rpc' };
  if (process.env.ZABBIX_API_TOKEN) headers.Authorization = `Bearer ${process.env.ZABBIX_API_TOKEN}`;

  const body = {
    jsonrpc: '2.0',
    method,
    params,
    id: requestId++,
  };
  if (auth && !process.env.ZABBIX_API_TOKEN) body.auth = auth;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });

  if (!response.ok) throw new Error(`Zabbix a repondu HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Zabbix: ${payload.error.data || payload.error.message}`);
  return payload.result;
}

async function authenticate() {
  if (process.env.ZABBIX_API_TOKEN) return;
  if (legacyAuthToken) return;
  const password = process.env.ZABBIX_PASSWORD;

  try {
    legacyAuthToken = await rpc('user.login', { username: process.env.ZABBIX_USERNAME, password }, null);
  } catch (firstError) {
    try {
      legacyAuthToken = await rpc('user.login', { user: process.env.ZABBIX_USERNAME, password }, null);
    } catch {
      throw firstError;
    }
  }
}

function isIcmpProblem(trigger) {
  return trigger.items?.some((item) => /(^|[.])icmpping(?:$|[.[])/i.test(item.key_));
}

function normalizedProblem(trigger, hostGroups) {
  const host = trigger.hosts?.[0] || {};
  const lastChange = Number(trigger.lastchange) * 1000;
  return {
    id: trigger.triggerid,
    hostid: host.hostid,
    host: host.name || host.host || 'Equipement inconnu',
    trigger: trigger.description,
    priority: Number(trigger.priority),
    lastChange: Number.isFinite(lastChange) ? new Date(lastChange).toISOString() : null,
    groupids: hostGroups.get(host.hostid) || [],
  };
}

async function loadHostGroups(triggers) {
  const hostids = [...new Set(triggers.flatMap((trigger) => trigger.hosts?.map((host) => host.hostid) || []))];
  if (!hostids.length) return new Map();

  const hosts = await rpc('host.get', {
    output: ['hostid'],
    hostids,
    selectGroups: ['groupid'],
  });
  return new Map(hosts.map((host) => [host.hostid, host.groups?.map((group) => group.groupid) || []]));
}

async function problemResult(triggers, panels) {
  const hostGroups = await loadHostGroups(triggers);
  const uniqueByHost = new Map();
  for (const trigger of triggers.filter(isIcmpProblem)) {
    const problem = normalizedProblem(trigger, hostGroups);
    const existing = uniqueByHost.get(problem.hostid);
    if (!existing || problem.priority > existing.priority || problem.lastChange > existing.lastChange) {
      uniqueByHost.set(problem.hostid, problem);
    }
  }
  const problems = [...uniqueByHost.values()].sort((first, second) => (
    second.priority - first.priority || String(second.lastChange).localeCompare(String(first.lastChange))
  ));
  const problemsByPanel = new Map(panels.map((panel) => [panel.id, []]));
  for (const problem of problems) {
    // The configured panel order is the deterministic tie-breaker for multi-group hosts.
    const selectedPanel = panels.find((panel) => panel.groupids.some((groupid) => problem.groupids.includes(groupid)));
    if (selectedPanel) problemsByPanel.get(selectedPanel.id).push(problem);
  }
  return {
    problems,
    groups: panels.map((panel) => ({
      id: panel.id,
      name: panel.title,
      sourceGroups: panel.groups,
      problems: problemsByPanel.get(panel.id),
    })),
    diagnostics: {
      activeTriggers: triggers.length,
      activeIcmpTriggers: problems.length,
    },
  };
}

function addSimulation(result) {
  if (process.env.NOC_TEST_MODE !== 'true') return result;
  const simulatedProblem = {
    id: 'noc-simulation-icmp',
    host: 'NOC-TEST-ICMP',
    trigger: 'SIMULATION - Equipement injoignable par ICMP',
    priority: 4,
    lastChange: new Date().toISOString(),
    simulated: true,
  };
  const targetGroup = result.groups.find((group) => group.sourceGroups?.some((name) => name.toLowerCase() === 'test')) || result.groups[0];
  const groups = result.groups.map((group) => (
    group.id === targetGroup?.id ? { ...group, problems: [simulatedProblem, ...group.problems] } : group
  ));
  return { ...result, problems: [simulatedProblem, ...result.problems], groups };
}

async function loadConfiguredGroups() {
  const groupNames = dashboardConfig.panels.length
    ? dashboardConfig.panels.flatMap((panel) => panel.groups)
    : fallbackGroups;
  const uniqueNames = [...new Set(groupNames)];
  if (!uniqueNames.length) return [];
  const matchedGroups = await rpc('hostgroup.get', {
    output: ['groupid', 'name'],
    filter: { name: uniqueNames },
  });
  if (!matchedGroups.length) {
    throw new Error(`Aucun groupe Zabbix trouve pour : ${uniqueNames.join(', ')}.`);
  }
  return uniqueNames.map((name) => matchedGroups.find((group) => group.name === name)).filter(Boolean);
}

function resolvePanels(groups) {
  const rawPanels = dashboardConfig.panels.length ? dashboardConfig.panels : groups.map((group, index) => ({
    id: `group-${index + 1}`,
    title: group.name,
    groups: [group.name],
  }));
  return rawPanels.map((panel) => ({
    ...panel,
    groupids: groups.filter((group) => panel.groups.includes(group.name)).map((group) => group.groupid),
  })).filter((panel) => panel.groupids.length);
}

async function loadProblems() {
  requireCredentials();
  await authenticate();

  const groups = await loadConfiguredGroups();
  const panels = resolvePanels(groups);

  const params = {
    output: ['triggerid', 'description', 'priority', 'lastchange'],
    selectHosts: ['hostid', 'host', 'name'],
    selectItems: ['itemid', 'key_'],
    only_true: true,
    skipDependent: true,
    monitored: true,
    sortfield: ['priority', 'lastchange'],
    sortorder: 'DESC',
  };
  if (groups.length) params.groupids = groups.map((group) => group.groupid);

  let triggers;
  try {
    triggers = await rpc('trigger.get', params);
  } catch (error) {
    // Some older Zabbix versions accept only one sort field.
    if (!String(error.message).includes('sortfield')) throw error;
    params.sortfield = 'priority';
    triggers = await rpc('trigger.get', params);
  }

  const result = await problemResult(triggers, panels);
  try {
    const latency = await loadLatencyForGroups(groups, panels);
    const latencyByGroup = new Map(latency.groups.map((group) => [group.id, group]));
    result.groups = result.groups.map((group) => ({ ...group, ...latencyByGroup.get(group.id) }));
  } catch (error) {
    console.error(`Lecture de latence indisponible pour la vue incidents: ${error.message}`);
    result.groups = result.groups.map((group) => ({ ...group, averageMs: null, respondingHosts: null, totalHosts: null }));
  }
  try {
    const webServices = await loadWebServicesForGroups(groups, panels);
    const servicesByGroup = new Map(webServices.groups.map((group) => [group.id, group.services]));
    result.groups = result.groups.map((group) => ({ ...group, services: servicesByGroup.get(group.id) || [] }));
    result.diagnostics.monitoredWebServices = webServices.total;
    result.diagnostics.downWebServices = webServices.down;
    result.diagnostics.resolvedWebServices = webServices.resolved;
    result.diagnostics.webMonitoringItems = webServices.items;
    result.diagnostics.webMonitoringAvailable = true;
  } catch (error) {
    console.error(`Lecture des services web indisponible: ${error.message}`);
    result.groups = result.groups.map((group) => ({ ...group, services: [] }));
    result.diagnostics.monitoredWebServices = 0;
    result.diagnostics.downWebServices = 0;
    result.diagnostics.resolvedWebServices = 0;
    result.diagnostics.webMonitoringItems = 0;
    result.diagnostics.webMonitoringAvailable = false;
  }
  return result;
}

function roundMilliseconds(value) {
  return Math.round(value * 10) / 10;
}

function zabbixKeyArguments(key, prefix) {
  if (!key.startsWith(`${prefix}[`) || !key.endsWith(']')) return [];
  const source = key.slice(prefix.length + 1, -1);
  const values = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\' && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

async function loadWebServicesForGroups(groups, panels) {
  const groupids = groups.map((group) => group.groupid);
  const hosts = await rpc('host.get', {
    output: ['hostid', 'name', 'host'],
    groupids,
    filter: { status: 0 },
    selectGroups: ['groupid'],
  });
  const hostById = new Map(hosts.map((host) => [host.hostid, host]));
  const panelByHost = new Map();
  for (const currentHost of hosts) {
    const panel = panels.find((candidate) => currentHost.groups?.some((hostGroup) => candidate.groupids.includes(hostGroup.groupid)));
    if (panel) panelByHost.set(currentHost.hostid, panel.id);
  }

  const scenarios = await rpc('httptest.get', {
    output: ['httptestid', 'hostid', 'name', 'delay', 'status'],
    groupids,
    monitored: true,
    selectHosts: ['hostid', 'host', 'name'],
    selectSteps: ['httpstepid', 'name', 'no'],
    sortfield: 'name',
    sortorder: 'ASC',
  });
  const scenarioHostids = [...new Set(scenarios.map((scenario) => scenario.hostid || scenario.hosts?.[0]?.hostid).filter(Boolean))];
  const items = scenarioHostids.length ? await rpc('item.get', {
    output: ['itemid', 'hostid', 'name', 'key_', 'lastvalue', 'lastclock', 'state', 'status'],
    hostids: scenarioHostids,
    monitored: true,
    search: { key_: 'web.test.' },
    searchWildcardsEnabled: false,
  }) : [];

  const servicesByPanel = new Map(panels.map((panel) => [panel.id, []]));
  for (const scenario of scenarios) {
    const hostid = scenario.hostid || scenario.hosts?.[0]?.hostid;
    const panelId = panelByHost.get(hostid);
    const currentHost = hostById.get(hostid) || scenario.hosts?.[0];
    if (!hostid || !panelId || !currentHost) continue;
    const hostItems = items.filter((item) => item.hostid === hostid);
    const failureItem = hostItems.find((item) => zabbixKeyArguments(item.key_, 'web.test.fail')[0] === scenario.name)
      || (scenarios.filter((candidate) => (candidate.hostid || candidate.hosts?.[0]?.hostid) === hostid).length === 1
        ? hostItems.find((item) => item.key_.startsWith('web.test.fail[')) : null);
    const responseItems = hostItems.filter((item) => zabbixKeyArguments(item.key_, 'web.test.rspcode')[0] === scenario.name)
      .sort((first, second) => Number(second.lastclock) - Number(first.lastclock));
    const responseItem = responseItems[0] || null;
    const lastClockSeconds = Math.max(Number(failureItem?.lastclock || 0), Number(responseItem?.lastclock || 0));
    const fresh = Number.isFinite(lastClockSeconds) && lastClockSeconds > 0
      && (Date.now() / 1000) - lastClockSeconds <= webStatusStaleSeconds;
    const itemSupported = failureItem ? Number(failureItem.state) === 0 : responseItem && Number(responseItem.state) === 0;
    const supported = Boolean(itemSupported && fresh);
    const responseCode = responseItem && Number(responseItem.lastclock) > 0 ? Number(responseItem.lastvalue) : null;
    let status = 'unknown';
    if (supported && failureItem) status = Number(failureItem.lastvalue) === 0 ? 'up' : 'down';
    else if (supported && Number.isFinite(responseCode)) status = responseCode === 200 ? 'up' : 'down';
    servicesByPanel.get(panelId).push({
      id: scenario.httptestid,
      name: scenario.name,
      host: currentHost.name || currentHost.host,
      status,
      responseCode: Number.isFinite(responseCode) ? responseCode : null,
      lastCheck: supported ? new Date(lastClockSeconds * 1000).toISOString() : null,
      interval: scenario.delay,
    });
  }

  const panelGroups = panels.map((panel) => ({
    id: panel.id,
    services: servicesByPanel.get(panel.id).sort((first, second) => first.name.localeCompare(second.name, 'fr')),
  }));
  const services = panelGroups.flatMap((group) => group.services);
  return {
    groups: panelGroups,
    total: services.length,
    down: services.filter((service) => service.status === 'down').length,
    resolved: services.filter((service) => service.status !== 'unknown').length,
    items: items.length,
  };
}

async function loadLatencyForGroups(groups, panels) {
  const groupids = groups.map((group) => group.groupid);
  const hosts = await rpc('host.get', {
    output: ['hostid', 'name', 'host'],
    groupids,
    filter: { status: 0 },
    selectGroups: ['groupid'],
  });
  const hostsById = new Map(hosts.map((host) => [host.hostid, host]));
  const hostsByPanel = new Map(panels.map((panel) => [panel.id, []]));

  for (const host of hosts) {
    const targetPanel = panels.find((panel) => host.groups?.some((hostGroup) => panel.groupids.includes(hostGroup.groupid)));
    if (targetPanel) hostsByPanel.get(targetPanel.id).push(host.hostid);
  }

  const items = hosts.length ? await rpc('item.get', {
    output: ['itemid', 'hostid', 'key_', 'lastvalue', 'lastclock', 'state', 'status'],
    hostids: hosts.map((host) => host.hostid),
    monitored: true,
    search: { key_: 'icmppingsec' },
    searchWildcardsEnabled: false,
  }) : [];
  const latestByHost = new Map();

  for (const item of items) {
    if (!/^icmppingsec(?:\[.*\])?$/i.test(item.key_)) continue;
    const milliseconds = Number(item.lastvalue) * 1000;
    if (!Number.isFinite(milliseconds) || !hostsById.has(item.hostid)) continue;
    const existing = latestByHost.get(item.hostid);
    if (!existing || Number(item.lastclock) > Number(existing.lastclock)) {
      latestByHost.set(item.hostid, { milliseconds: roundMilliseconds(milliseconds), lastclock: item.lastclock });
    }
  }

  return {
    groups: panels.map((panel) => {
      const hostids = hostsByPanel.get(panel.id);
      const measurements = hostids.map((hostid) => ({ host: hostsById.get(hostid), ...latestByHost.get(hostid) })).filter((item) => item.milliseconds !== undefined);
      const values = measurements.map((item) => item.milliseconds);
      const averageMs = values.length ? roundMilliseconds(values.reduce((total, value) => total + value, 0) / values.length) : null;
      return {
        id: panel.id,
        name: panel.title,
        sourceGroups: panel.groups,
        totalHosts: hostids.length,
        respondingHosts: measurements.length,
        averageMs,
        minMs: values.length ? Math.min(...values) : null,
        maxMs: values.length ? Math.max(...values) : null,
        slowHosts: measurements.filter((item) => item.milliseconds >= 100).length,
        hosts: measurements
          .sort((first, second) => second.milliseconds - first.milliseconds)
          .slice(0, 5)
          .map((item) => ({
            name: item.host.name || item.host.host,
            milliseconds: item.milliseconds,
            lastClock: Number(item.lastclock) * 1000,
          })),
      };
    }),
    fetchedAt: new Date().toISOString(),
  };
}

async function loadLatency() {
  requireCredentials();
  await authenticate();
  const groups = await loadConfiguredGroups();
  return loadLatencyForGroups(groups, resolvePanels(groups));
}

async function refresh() {
  if (cache.fetching) return cache.fetching;
  cache.fetching = loadProblems()
    .then((result) => {
      const { problems, groups, diagnostics } = addSimulation(result);
      cache.data = {
        problems,
        groups,
        diagnostics: { ...diagnostics, simulationEnabled: process.env.NOC_TEST_MODE === 'true' },
        groupFilter: dashboardConfig.panels.length ? dashboardConfig.panels.flatMap((panel) => panel.groups) : fallbackGroups,
        fetchedAt: new Date().toISOString(),
      };
      cache.updatedAt = Date.now();
      cache.error = null;
      return cache.data;
    })
    .catch((error) => {
      legacyAuthToken = null;
      cache.error = true;
      console.error(`Echec de rafraichissement Zabbix: ${error.message}`);
      throw error;
    })
    .finally(() => {
      cache.fetching = null;
    });
  return cache.fetching;
}

async function refreshLatency() {
  if (latencyCache.fetching) return latencyCache.fetching;
  latencyCache.fetching = loadLatency()
    .then((data) => {
      latencyCache.data = data;
      latencyCache.updatedAt = Date.now();
      return data;
    })
    .catch((error) => {
      legacyAuthToken = null;
      console.error(`Echec de lecture de la latence Zabbix: ${error.message}`);
      throw error;
    })
    .finally(() => {
      latencyCache.fetching = null;
    });
  return latencyCache.fetching;
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  frameguard: { action: 'deny' },
  hsts: process.env.NOC_ENABLE_HSTS === 'true' ? undefined : false,
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(express.json({ limit: '16kb', type: 'application/json' }));
app.use(express.static('public', {
  extensions: ['html'],
  setHeaders: (response) => response.setHeader('Cache-Control', 'no-cache'),
}));

const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Trop de requetes.' },
});

app.get('/api/configuration', apiRateLimit, requireAdmin, (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ ok: true, dashboard: dashboardConfig });
});

app.get('/api/host-groups', apiRateLimit, requireAdmin, async (_request, response) => {
  try {
    requireCredentials();
    await authenticate();
    const groups = await rpc('hostgroup.get', { output: ['groupid', 'name'], sortfield: 'name', sortorder: 'ASC' });
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true, groups: groups.map((group) => group.name) });
  } catch (error) {
    legacyAuthToken = null;
    console.error(`Lecture des groupes impossible: ${error.message}`);
    response.status(503).json({ ok: false, error: 'Impossible de lire les groupes.' });
  }
});

app.put('/api/configuration', apiRateLimit, requireAdmin, (request, response) => {
  try {
    const config = saveDashboardConfig(request.body);
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true, dashboard: config });
  } catch (error) {
    console.error(`Enregistrement de configuration impossible: ${error.message}`);
    response.status(500).json({ ok: false, error: 'Impossible d enregistrer la configuration.' });
  }
});

app.get('/api/status', apiRateLimit, async (_request, response) => {
  const stale = !cache.updatedAt || Date.now() - cache.updatedAt >= pollIntervalMs;
  try {
    const data = stale ? await refresh() : cache.data;
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true, ...data, dashboard: dashboardConfig, pollIntervalSeconds: pollIntervalMs / 1000 });
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    response.status(503).json({
      ok: false,
      error: 'La source de supervision est indisponible. Consultez le journal du service NOC.',
      previousData: cache.data,
      dashboard: dashboardConfig,
      pollIntervalSeconds: pollIntervalMs / 1000,
    });
  }
});

app.get('/api/latency', apiRateLimit, async (_request, response) => {
  const stale = !latencyCache.updatedAt || Date.now() - latencyCache.updatedAt >= pollIntervalMs;
  try {
    const data = stale ? await refreshLatency() : latencyCache.data;
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true, ...data, dashboard: dashboardConfig, pollIntervalSeconds: pollIntervalMs / 1000 });
  } catch {
    response.setHeader('Cache-Control', 'no-store');
    response.status(503).json({
      ok: false,
      error: 'La lecture de la latence est indisponible. Consultez le journal du service NOC.',
      previousData: latencyCache.data,
      dashboard: dashboardConfig,
      pollIntervalSeconds: pollIntervalMs / 1000,
    });
  }
});

app.listen(port, host, () => {
  console.log(`Zabbix ICMP Dashboard: http://${host}:${port}`);
});
