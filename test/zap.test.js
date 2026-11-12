// Bigode no WhatsApp: fila só com o que foi ligado, só para os grupos, teste no número de teste e a ponte do computador
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'x', ZAP_KEY: 'chave-zap' });
const R = new Map(), L = k => R.get(k) || [];
const redis = ([cmd, k, ...a]) => {
  if (cmd === 'GET') return R.get(k) ?? null;
  if (cmd === 'SET') return R.set(k, a[0]), 'OK';
  if (cmd === 'RPUSH') return R.set(k, [...L(k), ...a]), L(k).length;
  if (cmd === 'LPUSH') return R.set(k, [...a.reverse(), ...L(k)]), L(k).length;
  if (cmd === 'LTRIM') return R.set(k, L(k).slice(+a[0] < 0 ? +a[0] : +a[0], +a[1] === -1 ? undefined : +a[1] + 1)), 'OK';
  if (cmd === 'LPOP') { const l = L(k); if (!l.length) return null; R.set(k, l.slice(+a[0])); return l.slice(0, +a[0]); }
  if (cmd === 'LLEN') return L(k).length;
  return 'OK';
};
let evolution = [];
global.fetch = async (u, o = {}) => {
  if (u === 'http://redis.test') return { ok: true, json: async () => ({ result: redis(JSON.parse(o.body)) }) };
  evolution.push({ u, body: o.body && JSON.parse(o.body), h: o.headers });  // Central falsa e Evolution falsa do worker
  const r = await evoFalsa(u, o.body && JSON.parse(o.body), o.headers);
  return { ok: r.ok !== false, status: r.ok === false ? 500 : 200, json: async () => r.j };
};
let evoFalsa = async () => ({ j: {} });
require.cache[require.resolve('../lib/fcm')] = { exports: { enviarPush: async () => 'id' } };
const Z = require('../lib/zap'), av = require('../lib/avisos'), api = require('../rotas/zap'), { sign } = require('../lib/db');
const set = (k, v) => R.set('mc:' + k, JSON.stringify(v));
const fila = () => L('mc:zap:fila').map(m => JSON.parse(m));
const G1 = { id: '120363000000000001@g.us', nome: 'Equipe Miados' };
const chamar = (req) => new Promise(ok => { const res = { code: 200, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); } }; api({ headers: {}, body: {}, ...req }, res); });
set('users', [{ id: 'u1', nome: 'Rodrigo Cardoso', role: 'admin' }, { id: 'u2', nome: 'Bia', role: 'social' }]);
const base = { roles: [{ id: 'admin', admin: true }, { id: 'social', menus: ['app'] }] };

test('limpa: número ganha o 55, grupo precisa ser @g.us, nome e tipos têm padrão', () => {
  const z = Z.limpa({ teste: '(47) 99999-0000', grupos: [G1, G1, { id: '5547999990000@s.whatsapp.net' }], tipos: { gazeta: 1, inventado: true } });
  assert.equal(z.teste, '5547999990000');
  assert.deepEqual(z.grupos, [G1]);
  assert.equal(z.nome, 'Bigode');
  assert.equal(z.tipos.gazeta, true);
  assert.equal(z.tipos.inventado, undefined);
  assert.equal(Z.limpa({ teste: '1234' }).teste, '');
});
test('aviso só entra na fila com o bot ligado, o tipo marcado e para os grupos (nunca para o número de teste)', async () => {
  set('state', { ...base, zap: { ativo: false, grupos: [G1], teste: '47999990000', tipos: { varal_novo: true } } });
  await av.avisar('varal_novo', '🧺 Lembrança nova', 'Naru');
  assert.equal(fila().length, 0);
  set('state', { ...base, zap: { ativo: true, grupos: [G1], teste: '47999990000', tipos: { varal_novo: true } } });
  await av.avisar('kwai', '📲 Kwai', 'x');
  assert.equal(fila().length, 0);
  await av.avisar('varal_novo', '🧺 Lembrança nova', 'Naru espera aprovação');
  assert.deepEqual(fila().map(m => [m.tipo, m.para, m.texto]), [['varal_novo', [G1.id], 'Bigode: *🧺 Lembrança nova*\nNaru espera aprovação']]);
});
test('push desligado não impede o zap (listas separadas)', async () => {
  R.delete('mc:zap:fila');
  set('state', { ...base, avisos: { post_erro: false }, zap: { ativo: true, grupos: [G1], tipos: { post_erro: true } } });
  await av.falhou('Story da loja', new Error('caiu'));
  assert.equal(fila().length, 1);
});
test('fila guarda só as 50 mais novas', async () => {
  R.delete('mc:zap:fila');
  for (let i = 0; i < 55; i++) await Z.enfileirar('post_erro', 'n' + i, '');
  assert.equal(fila().length, 50);
  assert.equal(fila()[0].texto, 'Bigode: *n5*');
  R.delete('mc:zap:fila');
});
test('worker: sem chave ou com chave errada não lê a fila', async () => {
  assert.equal((await chamar({ method: 'GET' })).code, 401);
  assert.equal((await chamar({ method: 'GET', headers: { 'x-zap-key': 'errada' } })).code, 401);
});
test('worker: leva até 10, devolve as falhas até 3 tentativas e grava o status', async () => {
  for (let i = 0; i < 12; i++) await Z.enfileirar('post_erro', 'm' + i, '');
  const k = { 'x-zap-key': 'chave-zap' };
  const { j } = await chamar({ method: 'GET', headers: k });
  assert.equal(j.msgs.length, 10);
  assert.equal(fila().length, 2);
  await chamar({ method: 'POST', headers: k, body: { acao: 'devolver', msgs: [{ ...j.msgs[0], n: 0 }, { ...j.msgs[1], n: 2 }] } });
  assert.deepEqual(fila().map(m => [m.texto, m.n]), [['Bigode: *m0*', 1], ['Bigode: *m10*', 0], ['Bigode: *m11*', 0]]);  // a da 3ª tentativa some
  const r = await chamar({ method: 'POST', headers: k, body: { acao: 'status', estado: 'open', numero: '5547900001111', grupos: [{ id: G1.id, nome: G1.nome }, { id: 'x@s.whatsapp.net' }] } });
  assert.equal(r.j.nome, 'Bigode');
  const st = JSON.parse(R.get('mc:zap:status'));
  assert.deepEqual([st.estado, st.grupos], ['open', [G1]]);
  R.delete('mc:zap:fila');
});
test('Central: só administrador; teste vai para o número de teste mesmo desligado', async () => {
  set('state', { ...base, zap: { ativo: false, grupos: [G1], teste: '47999990000' } });
  assert.equal((await chamar({ method: 'POST', headers: { authorization: 'Bearer ' + sign('u2') }, body: { acao: 'ver' } })).code, 403);
  const adm = { authorization: 'Bearer ' + sign('u1') };
  const t = await chamar({ method: 'POST', headers: adm, body: { acao: 'teste' } });
  assert.equal(t.code, 200);
  assert.deepEqual(fila()[0].para, ['5547999990000']);
  assert.match(fila()[0].texto, /Teste mandado por Rodrigo/);
  const s = await chamar({ method: 'POST', headers: adm, body: { acao: 'salvar', zap: { ativo: true, nome: 'Bigode', grupos: [G1], tipos: { gazeta: true } } } });
  assert.deepEqual([s.j.zap.ativo, s.j.zap.nome, s.j.zap.teste], [true, 'Bigode', '']);
  R.delete('mc:zap:fila');
});
test('ponte do computador: manda para cada destino, devolve só quem falhou', async () => {
  Object.assign(process.env, { CENTRAL_URL: 'https://central.test', EVO_URL: 'http://evo.test', EVO_KEY: 'k', ZAP_INTERVALO_MS: '0' });
  delete require.cache[require.resolve('../zap/worker')];
  const W = require('../zap/worker');
  const msgs = [{ id: 'a', tipo: 'gazeta', para: [G1.id, '5547999990000'], texto: '*Gazeta*', n: 0 }];
  evolution = [];
  evoFalsa = async (u, b) => u === 'https://central.test/api/zap' ? { j: b ? { voltaram: 1 } : { msgs } } : b.number === G1.id ? { j: {} } : { ok: false, j: { message: 'número sem WhatsApp' } };
  assert.deepEqual(await W.ciclo(), { enviadas: 0, falhas: 1 });
  const env = evolution.filter(e => e.u.includes('/message/sendText/'));
  assert.deepEqual(env.map(e => e.body.number), [G1.id, '5547999990000']);
  assert.equal(env[0].h.apikey, 'k');
  const dev = evolution.find(e => e.body?.acao === 'devolver');
  assert.deepEqual(dev.body.msgs[0].para, ['5547999990000']);
  assert.equal(dev.h['x-zap-key'], 'chave-zap');
});
