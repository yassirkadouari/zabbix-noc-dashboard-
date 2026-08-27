import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWebScenario, zabbixKeyArguments } from '../lib/web-monitoring.js';

const nowSeconds = 1_800_000_000;
const scenario = { name: 'navis.marsamaroc.co.ma' };

function item(key_, lastvalue, overrides = {}) {
  return {
    key_,
    name: overrides.name || key_,
    lastvalue: String(lastvalue),
    lastclock: String(nowSeconds - 24),
    state: '0',
    status: '0',
    ...overrides,
  };
}

test('analyse les arguments de cles Zabbix cites et contenant des virgules', () => {
  assert.deepEqual(
    zabbixKeyArguments('web.test.rspcode["NAVIS, production","test acces"]', 'web.test.rspcode'),
    ['NAVIS, production', 'test acces'],
  );
});

test('NAVIS recent avec fail=0 et HTTP 200 est en ligne', () => {
  const result = resolveWebScenario({
    scenario,
    nowSeconds,
    staleSeconds: 180,
    items: [
      item('web.test.fail[navis.marsamaroc.co.ma]', 0),
      item('web.test.rspcode[navis.marsamaroc.co.ma,test acces]', 200),
    ],
  });

  assert.equal(result.status, 'up');
  assert.equal(result.statusReason, 'scenario-succeeded');
  assert.equal(result.responseCode, 200);
  assert.equal(result.dataAgeSeconds, 24);
  assert.equal(result.matchedItems, 2);
});

test('la comparaison du nom de scenario tolere casse, espaces et guillemets', () => {
  const result = resolveWebScenario({
    scenario: { name: ' NAVIS.MarsaMaroc.Co.Ma ' },
    nowSeconds,
    items: [item('web.test.fail["navis.marsamaroc.co.ma"]', 0)],
  });

  assert.equal(result.status, 'up');
  assert.equal(result.matches.failure, 'key');
});

test('un numero d etape en echec place le service hors ligne', () => {
  const result = resolveWebScenario({
    scenario,
    nowSeconds,
    items: [item('web.test.fail[navis.marsamaroc.co.ma]', 1)],
  });

  assert.equal(result.status, 'down');
  assert.equal(result.statusReason, 'scenario-failed');
});

test('le code HTTP fournit un repli lorsque l item fail est absent', () => {
  const result = resolveWebScenario({
    scenario,
    nowSeconds,
    items: [item('web.test.rspcode[navis.marsamaroc.co.ma,test acces]', 200)],
  });

  assert.equal(result.status, 'up');
  assert.equal(result.evidence, 'web.test.rspcode');
});

test('le scenario unique tolere une cle issue d une macro non resolue', () => {
  const result = resolveWebScenario({
    scenario,
    nowSeconds,
    allowSingleScenarioFallback: true,
    items: [
      item('web.test.fail[{$NOM_SCENARIO}]', 0),
      item('web.test.rspcode[{$NOM_SCENARIO},test acces]', 200),
    ],
  });

  assert.equal(result.status, 'up');
  assert.equal(result.matches.failure, 'single-scenario');
  assert.equal(result.responseCode, 200);
});

test('une valeur perimee reste inconnue mais conserve son heure de controle', () => {
  const result = resolveWebScenario({
    scenario,
    nowSeconds,
    staleSeconds: 180,
    items: [item('web.test.fail[navis.marsamaroc.co.ma]', 0, { lastclock: String(nowSeconds - 181) })],
  });

  assert.equal(result.status, 'unknown');
  assert.equal(result.statusReason, 'failure-item-stale');
  assert.equal(result.lastClock, nowSeconds - 181);
});

test('un item non supporte ne peut pas produire un faux etat vert', () => {
  const result = resolveWebScenario({
    scenario,
    nowSeconds,
    items: [
      item('web.test.fail[navis.marsamaroc.co.ma]', 0, { state: '1' }),
      item('web.test.rspcode[navis.marsamaroc.co.ma,test acces]', 200),
    ],
  });

  assert.equal(result.status, 'unknown');
  assert.equal(result.statusReason, 'failure-item-unsupported');
});
