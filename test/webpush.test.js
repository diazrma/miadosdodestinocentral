// push do navegador: valida a inscrição, envia só para quem o filtro escolhe e limpa inscrições vencidas
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'x', CENTRAL_VAPID_PUBLIC: 'pub', CENTRAL_VAPID_PRIVATE: 'priv' });
const R = new Map();
global.fetch = async (u, o) => ({ ok: true, json: async () => { const [cmd, k, v] = JSON.parse(o.body); if (cmd === 'GET') return { result: R.get(k) ?? null }; R.set(k, v); return { result: 'OK' }; } });
const enviados = [];
require.cache[require.resolve('web-push')] = { exports: { setVapidDetails() {}, sendNotification: async (s, p) => { if (s.endpoint.includes('vencido')) { const e = new Error('gone'); e.statusCode = 410; throw e; } enviados.push([s.endpoint, JSON.parse(p)]); } } };
const wp = require('../lib/webpush');
const sub = ep => ({ endpoint: 'https://push.test/' + ep, keys: { p256dh: 'p', auth: 'a' } });
test('inscrição: recusa inválida e não duplica o mesmo navegador', async () => {
  await assert.rejects(wp.inscrever({ endpoint: 'http://x' }, { id: 'u1', nome: 'R' }), /inválida/);
  await wp.inscrever(sub('pc'), { id: 'u1', nome: 'Rodrigo' });
  assert.equal(await wp.inscrever(sub('pc'), { id: 'u1', nome: 'Rodrigo' }), 1);
  await wp.inscrever(sub('cel-ana'), { id: 'u2', nome: 'Ana' });
  await wp.inscrever(sub('vencido'), { id: 'u1', nome: 'Rodrigo' });
});
test('teste vai só para os aparelhos do usuário e remove o vencido', async () => {
  const n = await wp.enviarWeb({ title: 'oi' }, s => s.uid === 'u1');
  assert.equal(n, 1);
  assert.deepEqual(enviados.map(e => e[0]), ['https://push.test/pc']);
  assert.equal(JSON.parse(R.get('mc:push_web')).length, 2);
});
