// backup completo: textos, listas, conjuntos ordenados e hashes vão e voltam iguais
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', BACKUP_KEY: 'chave-de-teste', DB_PREFIX: 'mc:' });
const R = new Map();
const tipo = v => v == null ? 'none' : typeof v === 'string' ? 'string' : Array.isArray(v) ? 'list' : v instanceof Map ? 'zset' : 'hash';
function redis([cmd, k, ...a]) {
  switch (cmd.toUpperCase()) {
    case 'SCAN': { const pre = a[1].replace('*', ''); return ['0', [...R.keys()].filter(x => x.startsWith(pre))]; }
    case 'MGET': return [k, ...a].map(x => typeof R.get(x) === 'string' ? R.get(x) : null);
    case 'MSET': { const l = [k, ...a]; for (let i = 0; i < l.length; i += 2) R.set(l[i], String(l[i + 1])); return 'OK'; }
    case 'TYPE': return tipo(R.get(k));
    case 'DEL': return +R.delete(k);
    case 'LRANGE': return [...(R.get(k) || [])];
    case 'RPUSH': { const l = R.get(k) || []; l.push(...a.map(String)); R.set(k, l); return l.length; }
    case 'ZRANGE': return [...(R.get(k) || new Map())].sort((x, y) => x[1] - y[1]).flatMap(([m, s]) => [m, String(s)]);
    case 'ZADD': { const m = R.get(k) || new Map(); for (let i = 0; i < a.length; i += 2) m.set(String(a[i + 1]), +a[i]); R.set(k, m); return 1; }
    case 'HGETALL': return Object.entries(R.get(k) || {}).flat().map(String);
    case 'HSET': { const h = R.get(k) || {}; for (let i = 0; i < a.length; i += 2) h[a[i]] = String(a[i + 1]); R.set(k, h); return 1; }
  }
  throw new Error('não simulado: ' + cmd);
}
global.fetch = async (u, o) => {
  const b = JSON.parse(o.body);
  return { ok: true, json: async () => String(u).endsWith('/pipeline') ? b.map(c => ({ result: redis(c) })) : { result: redis(b) } };
};
const { montar, aplicar, cifrar, decifrar } = require('../api/backup').interno;
test('backup e restauração completos', async () => {
  R.set('mc:bot:autos', JSON.stringify([{ id: 'desenho' }]));
  R.set('mc:ct:u1', JSON.stringify({ id: 'u1', campos: { email: 'a@b.c' } }));
  R.set('mc:cv:u1', ['{"d":"out","x":"oi"}', '{"d":"in","x":"quero"}']);
  R.set('mc:cts', new Map([['u1', 100], ['u2', 200]]));
  R.set('mc:st:desenho', { disparos: '3', cliques: '1' });
  R.set('mc:ev:abc', '1'); // temporária: fica de fora
  R.set('outro-projeto:x', 'nao-mexe');
  const antes = new Map([...R].map(([k, v]) => [k, JSON.stringify(v instanceof Map ? [...v] : v)]));
  const b = await montar();
  assert.equal(b.dados['ev:abc'], undefined);
  assert.equal(b.chaves, 5);
  const volta = decifrar(cifrar(b));
  for (const k of [...R.keys()]) if (k.startsWith('mc:')) R.delete(k);
  assert.equal(await aplicar(volta), 5);
  for (const [k, v] of antes) if (k !== 'mc:ev:abc') assert.equal(JSON.stringify(R.get(k) instanceof Map ? [...R.get(k)] : R.get(k)), v, k);
  assert.equal(R.get('outro-projeto:x'), 'nao-mexe');
});
