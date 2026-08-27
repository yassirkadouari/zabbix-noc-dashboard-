function normalizedName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr');
}

export function webItemQuery(hostids) {
  return {
    output: ['itemid', 'hostid', 'name', 'key_', 'lastvalue', 'lastclock', 'state', 'status'],
    hostids,
    webitems: true,
    monitored: true,
  };
}

export function zabbixKeyArguments(key, prefix) {
  if (typeof key !== 'string' || !key.startsWith(`${prefix}[`) || !key.endsWith(']')) return [];
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

function latestItem(items) {
  return [...items].sort((first, second) => Number(second.lastclock || 0) - Number(first.lastclock || 0))[0] || null;
}

function scenarioItems(items, prefix, scenarioName, allowSingleScenarioFallback) {
  const candidates = items.filter((item) => item.key_?.startsWith(`${prefix}[`));
  const expectedName = normalizedName(scenarioName);
  const exact = candidates.filter((item) => normalizedName(zabbixKeyArguments(item.key_, prefix)[0]) === expectedName);
  if (exact.length) return { items: exact, match: 'key' };

  const named = candidates.filter((item) => normalizedName(item.name).includes(expectedName));
  if (named.length) return { items: named, match: 'item-name' };

  if (allowSingleScenarioFallback && candidates.length) return { items: candidates, match: 'single-scenario' };
  return { items: [], match: 'none' };
}

function itemClock(item) {
  const value = Number(item?.lastclock || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function numericValue(item) {
  if (!item || item.lastvalue === '' || item.lastvalue === null || item.lastvalue === undefined) return null;
  const value = Number(item.lastvalue);
  return Number.isFinite(value) ? value : null;
}

function itemIsSupported(item) {
  return Boolean(item) && Number(item.status || 0) === 0 && Number(item.state || 0) === 0;
}

function isFresh(item, nowSeconds, staleSeconds) {
  const clock = itemClock(item);
  return clock > 0 && nowSeconds - clock <= staleSeconds;
}

export function resolveWebScenario({
  scenario,
  items,
  nowSeconds = Date.now() / 1000,
  staleSeconds = 180,
  allowSingleScenarioFallback = false,
}) {
  const failureMatch = scenarioItems(items, 'web.test.fail', scenario.name, allowSingleScenarioFallback);
  const responseMatch = scenarioItems(items, 'web.test.rspcode', scenario.name, allowSingleScenarioFallback);
  const failureItem = latestItem(failureMatch.items);
  const responseItem = latestItem(responseMatch.items);
  const failureValue = numericValue(failureItem);
  const responseCode = numericValue(responseItem);
  const latestClock = Math.max(itemClock(failureItem), itemClock(responseItem));
  const matchedItems = failureMatch.items.length + responseMatch.items.length;
  let status = 'unknown';
  let statusReason = 'items-not-found';
  let evidence = null;

  if (failureItem) {
    if (!itemIsSupported(failureItem)) {
      statusReason = 'failure-item-unsupported';
    } else if (!isFresh(failureItem, nowSeconds, staleSeconds)) {
      statusReason = 'failure-item-stale';
    } else if (failureValue === null) {
      statusReason = 'failure-value-invalid';
    } else {
      status = failureValue === 0 ? 'up' : 'down';
      statusReason = failureValue === 0 ? 'scenario-succeeded' : 'scenario-failed';
      evidence = 'web.test.fail';
    }
  } else if (responseItem) {
    if (!itemIsSupported(responseItem)) {
      statusReason = 'response-item-unsupported';
    } else if (!isFresh(responseItem, nowSeconds, staleSeconds)) {
      statusReason = 'response-item-stale';
    } else if (responseCode === null) {
      statusReason = 'response-code-invalid';
    } else {
      status = responseCode >= 200 && responseCode < 400 ? 'up' : 'down';
      statusReason = status === 'up' ? 'http-response-succeeded' : 'http-response-failed';
      evidence = 'web.test.rspcode';
    }
  }

  return {
    status,
    statusReason,
    evidence,
    responseCode,
    lastClock: latestClock,
    dataAgeSeconds: latestClock ? Math.max(0, Math.floor(nowSeconds - latestClock)) : null,
    matchedItems,
    matches: {
      failure: failureMatch.match,
      response: responseMatch.match,
    },
  };
}
