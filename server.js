import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const apiUrl = process.env.ZABBIX_API_URL || 'https://172.16.132.86/api_jsonrpc.php';
const pollIntervalMs = Math.max(15, Number(process.env.POLL_INTERVAL_SECONDS || 45)) * 1000;
const configuredGroups = (process.env.ZABBIX_HOST_GROUPS || 'Switches,AP')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const dashboardConfigPath = path.join(process.cwd(), 'dashboard.config.json');

const defaultDashboardConfig = Object.freeze({
  eyebrow: 'NOC · Zabbix · disponibilite reseau',
  title: 'Supervision ICMP',
  headerOrder: ['brand', 'summary', 'connection'],
  footerOrder: ['scope', 'updatedAt', 'clock'],
});

function orderedSlots(value, permitted) {
  if (!Array.isArray(value)) return permitted;
  const valid = value.filter((slot) => permitted.includes(slot));
  return [...new Set([...valid, ...permitted])];
}

function textSetting(value, fallback, maxLength = 100) {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value.trim() : fallback;
}

function loadDashboardConfig() {
  try {
    const rawConfig = JSON.parse(fs.readFileSync(dashboardConfigPath, 'utf8'));
    return {
      eyebrow: textSetting(rawConfig.eyebrow, defaultDashboardConfig.eyebrow),
      title: textSetting(rawConfig.title, defaultDashboardConfig.title),
      headerOrder: orderedSlots(rawConfig.headerOrder, defaultDashboardConfig.headerOrder),
      footerOrder: orderedSlots(rawConfig.footerOrder, defaultDashboardConfig.footerOrder),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Configuration dashboard invalide; configuration par defaut utilisee.');
    return { ...defaultDashboardConfig };
  }
}

const dashboardConfig = loadDashboardConfig();

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

let requestId = 1;
let legacyAuthToken = null;
let cache = {
  data: null,
  updatedAt: null,
  error: null,
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

async function problemResult(triggers, groups) {
  const hostGroups = await loadHostGroups(triggers);
  const problems = triggers.filter(isIcmpProblem).map((trigger) => normalizedProblem(trigger, hostGroups));
  return {
    problems,
    groups: groups.map((group) => ({
      id: group.groupid,
      name: group.name,
      problems: problems.filter((problem) => problem.groupids.includes(group.groupid)),
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
  const targetGroup = result.groups.find((group) => group.name.toLowerCase() === 'test') || result.groups[0];
  const groups = result.groups.map((group) => (
    group.id === targetGroup?.id ? { ...group, problems: [simulatedProblem, ...group.problems] } : group
  ));
  return { ...result, problems: [simulatedProblem, ...result.problems], groups };
}

async function loadProblems() {
  requireCredentials();
  await authenticate();

  let groups = [];
  if (configuredGroups.length) {
    const matchedGroups = await rpc('hostgroup.get', {
      output: ['groupid', 'name'],
      filter: { name: configuredGroups },
    });
    if (!matchedGroups.length) {
      throw new Error(`Aucun groupe Zabbix trouve pour : ${configuredGroups.join(', ')}.`);
    }
    groups = configuredGroups.map((name) => matchedGroups.find((group) => group.name === name)).filter(Boolean);
  }

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

  try {
    const triggers = await rpc('trigger.get', params);
    return problemResult(triggers, groups);
  } catch (error) {
    // Some older Zabbix versions accept only one sort field.
    if (!String(error.message).includes('sortfield')) throw error;
    params.sortfield = 'priority';
    const triggers = await rpc('trigger.get', params);
    return problemResult(triggers, groups);
  }
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
        groupFilter: configuredGroups,
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
      error: 'La connexion securisee a Zabbix est indisponible. Consultez le journal du service NOC.',
      previousData: cache.data,
      dashboard: dashboardConfig,
      pollIntervalSeconds: pollIntervalMs / 1000,
    });
  }
});

app.listen(port, host, () => {
  console.log(`Zabbix ICMP Dashboard: http://${host}:${port}`);
});
