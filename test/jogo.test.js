// ranking do jogo: ficha assinada, validação da partida e gravação no ranking
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'segredo-de-teste' });
const R = new Map();
function redis([cmd, k, ...a]) {
  switch (cmd.toUpperCase()) {
    case 'INCR': R.set(k, String(+(R.get(k) || 0) + 1)); return +R.get(k);
    case 'EXPIRE': return 1;
    case 'SET': if (a.includes('NX') && R.has(k)) return null; R.set(k, String(a[0])); return 'OK';
    case 'ZADD': { const m = R.get(k) || new Map(); m.set(String(a[1]), +a[0]); R.set(k, m); return 1; }
    case 'ZREMRANGEBYRANK': return 0;
    case 'ZREVRANGE': { const l = [...(R.get(k) || new Map())].sort((x, y) => y[1] - x[1]).slice(+a[0], +a[1] + 1); return l.flatMap(([m, s]) => [m, String(s)]); }
    case 'ZREVRANK': { const l = [...(R.get(k) || new Map())].sort((x, y) => y[1] - x[1]).map(x => x[0]); const i = l.indexOf(a[0]); return i < 0 ? null : i; }
  }
  throw new Error('não simulado: ' + cmd);
}
global.fetch = async (u, o) => ({ ok: true, json: async () => ({ result: redis(JSON.parse(o.body)) }) });
const jogo = require('../api/jogo');
const { token, abre, confere, limpa, MAX_FASE } = jogo.interno;
const chamar = (method, body, ip = '1.2.3.4') => new Promise(ok => { const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); } }; jogo({ method, body, headers: { 'x-forwarded-for': ip } }, res); });

test('ficha: assinada abre, adulterada não', () => {
  const t = token(); assert.ok(abre(t).t);
  assert.equal(abre(t.replace(/.$/, c => c === 'A' ? 'B' : 'A')), null);
  assert.equal(abre('lixo'), null);
});
test('confere: tempo mínimo, teto de pontos e nome', () => {
  const ini = { t: 1_000_000, n: 'x' };
  assert.equal(confere(ini, { fases: 3, pontos: 500, nome: 'Naru' }, ini.t + 60_000), null);
  assert.match(confere(ini, { fases: 3, pontos: 500, nome: 'Naru' }, ini.t + 5_000), /não confere/); // rápido demais
  assert.match(confere(ini, { fases: 1, pontos: MAX_FASE + 1, nome: 'Naru' }, ini.t + 60_000), /não confere/); // acima do teto
  assert.match(confere(ini, { fases: 4, pontos: 10, nome: 'Naru' }, ini.t + 60_000), /não confere/); // fases a mais
  assert.match(confere(ini, { fases: 1, pontos: 10, nome: 'a' }, ini.t + 60_000), /outro nome/);
  assert.match(confere(ini, { fases: 1, pontos: 10, nome: 'p.o.r.r.a' }, ini.t + 60_000), /outro nome/);
  assert.equal(limpa('  Zé <script>  da Silva!!  '), 'Zé script da S');
});
test('fluxo: inicio, pontos (uma vez só), ranking ordenado', async () => {
  const velha = token(Date.now() - 60_000);
  const r1 = await chamar('POST', { acao: 'pontos', token: velha, nome: 'Rodrigo', pontos: 420, fases: 2 });
  assert.equal(r1.code, 200); assert.equal(r1.j.posicao, 1);
  const r2 = await chamar('POST', { acao: 'pontos', token: velha, nome: 'Rodrigo', pontos: 420, fases: 2 });
  assert.equal(r2.code, 400); assert.match(r2.j.erro, /já foi enviada/);
  const r3 = await chamar('POST', { acao: 'pontos', token: token(Date.now() - 60_000), nome: 'Ana', pontos: 900, fases: 3 });
  assert.equal(r3.j.posicao, 1);
  const g = await chamar('GET');
  assert.deepEqual(g.j.top.map(x => x.nome), ['Ana', 'Rodrigo']);
  const ini = await chamar('POST', { acao: 'inicio' }); assert.ok(abre(ini.j.token));
});
test('limite por IP', async () => {
  let ultimo; for (let i = 0; i < 31; i++) ultimo = await chamar('POST', { acao: 'pontos', token: 'x', nome: 'Spam', pontos: 1, fases: 1 }, '9.9.9.9');
  assert.equal(ultimo.code, 429);
});
