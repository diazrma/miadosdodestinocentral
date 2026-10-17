// avisos da equipe: respeitam a configuração, só vão para aparelhos da equipe, meta e 14 dias avisam uma vez
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'x' });
const R = new Map();
global.fetch = async (u, o) => ({ ok: true, json: async () => { const [cmd, k, v] = JSON.parse(o.body); if (cmd === 'GET') return { result: R.get(k) ?? null }; R.set(k, v); return { result: 'OK' }; } });
const enviados = [];
require.cache[require.resolve('../lib/fcm')] = { exports: { enviarPush: async m => { enviados.push(m); return 'id'; } } };
const av = require('../lib/avisos');
const set = (k, v) => R.set('mc:' + k, JSON.stringify(v));
set('push_aparelhos', [{ token: 'equipe1', equipe: true }, { token: 'publico' }]);

test('só aparelhos da equipe recebem, e o tipo desligado não sai', async () => {
  assert.equal(await av.avisar('kwai', 't', 'x'), 1);
  assert.equal(enviados.at(-1).token, 'equipe1');
  set('state', { avisos: { kwai: false } });
  assert.equal(await av.avisar('kwai', 't', 'x'), 0);
  set('state', {});
});
test('testador novo avisa com a contagem; a meta de 14 avisa uma vez só', async () => {
  enviados.length = 0;
  await av.testador('Ana', 13, true);
  assert.match(enviados.at(-1).texto, /Ana entrou no teste do app \(13\/14\)/);
  await av.testador('Bia', 14, true);
  assert.equal(enviados.length, 3);  // testador novo + meta
  assert.match(enviados.at(-1).titulo, /14 testadores/);
  await av.testador('Caio', 15, true);
  assert.equal(enviados.length, 4);  // só o testador novo
  await av.testador('Caio', 15, false);  // reinscrição não avisa
  assert.equal(enviados.length, 4);
});
test('14 dias: só depois do prazo e uma vez', async () => {
  enviados.length = 0;
  assert.equal(await av.diario(), null);
  set('teste_meta', { data: new Date(Date.now() - 15 * 864e5).toISOString() });
  assert.equal(await av.diario(), 1);
  assert.equal(await av.diario(), null);
  assert.match(enviados[0].titulo, /14 dias/);
});
test('publicação automática: sucesso com link e falha com o motivo', async () => {
  enviados.length = 0;
  await av.publicado('Story do Sussurro', { link: 'https://instagram.com/x' });
  await av.falhou('Story do Sussurro', new Error('Instagram não conectado'));
  assert.deepEqual(enviados.map(e => e.titulo), ['✅ Story do Sussurro publicado', '⚠️ Falhou: Story do Sussurro']);
  assert.equal(enviados[1].texto, 'Instagram não conectado');
});
