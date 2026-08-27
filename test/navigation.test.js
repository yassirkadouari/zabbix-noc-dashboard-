import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('le dashboard donne acces a la configuration', () => {
  const dashboard = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(dashboard, /<a class="settings-link" href="\/settings\.html">Configuration<\/a>/);
});

test('la configuration permet de revenir au dashboard', () => {
  const settings = fs.readFileSync(new URL('../public/settings.html', import.meta.url), 'utf8');
  assert.match(settings, /<a class="dashboard-link" href="\/">Retour au NOC<\/a>/);
});
