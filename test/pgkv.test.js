// Compara lib/pgkv.js com um Redis de verdade: os mesmos comandos nos dois bancos têm que dar a mesma resposta.
// Só roda com PG_TEST_URL e REDIS_TEST_URL (ex.: um Postgres e um redis-server locais); sem eles os testes são pulados.
const test = require('node:test');
const assert = require('node:assert');

const PGU = process.env.PG_TEST_URL, RU = process.env.REDIS_TEST_URL;
const pula = !PGU || !RU ? 'defina PG_TEST_URL e REDIS_TEST_URL' : false;

const SCRIPT = [
  ['SET', 'a', 'um'], ['GET', 'a'], ['GET', 'nada'], ['SET', 'a', 'dois', 'NX'], ['SET', 'b', '1', 'NX', 'EX', 60], ['GET', 'b'],
  ['SET', 'b', 'x', 'XX'], ['GET', 'b'], ['MGET', 'a', 'nada', 'b'], ['MSET', 'c', '3', 'd', '{"x":1}'], ['MGET', 'c', 'd'],
  ['INCR', 'cont'], ['INCR', 'cont'], ['INCR', 'c'], ['EXPIRE', 'cont', 100], ['EXPIRE', 'nada', 100], ['TYPE', 'a'], ['TYPE', 'nada'],
  ['DEL', 'a', 'nada', 'c'], ['GET', 'a'],
  ['RPUSH', 'l', 'a', 'b', 'c'], ['LPUSH', 'l', 'x', 'y'], ['LRANGE', 'l', 0, -1], ['LLEN', 'l'], ['LRANGE', 'l', 1, 2], ['LRANGE', 'l', -2, 100],
  ['LRANGE', 'l', 10, 20], ['LTRIM', 'l', 0, 2], ['LRANGE', 'l', 0, -1], ['LPOP', 'l'], ['LPOP', 'l'], ['LPOP', 'l'], ['LLEN', 'l'], ['TYPE', 'l'], ['LPOP', 'l'],
  ['RPUSH', 'f', '1', '2', '3', '4', '5'], ['LTRIM', 'f', -3, -1], ['LRANGE', 'f', 0, -1], ['LTRIM', 'f', 5, 10], ['TYPE', 'f'],
  ['HSET', 'h', 'a', '1', 'b', '2'], ['HINCRBY', 'h', 'a', 5], ['HINCRBY', 'h', 'z', 1], ['HGETALL', 'h'], ['HGETALL', 'nada'], ['HSET', 'h', 'a', '9', 'c', '3'], ['HGETALL', 'h'],
  ['ZADD', 'z', 10, 'dez', 5, 'cinco', 20, 'vinte'], ['ZADD', 'z', 5, 'cinco2', 7, 'dez'], ['ZCARD', 'z'], ['ZRANGE', 'z', 0, -1], ['ZRANGE', 'z', 0, -1, 'WITHSCORES'],
  ['ZREVRANGE', 'z', 0, 1], ['ZREVRANGE', 'z', 0, -1, 'WITHSCORES'], ['ZREVRANK', 'z', 'vinte'], ['ZREVRANK', 'z', 'cinco'], ['ZREVRANK', 'z', 'nada'],
  ['ZCOUNT', 'z', 6, '+inf'], ['ZCOUNT', 'z', '(5', 20], ['ZCOUNT', 'z', '-inf', '(7'], ['ZRANGEBYSCORE', 'z', '-inf', 7], ['ZRANGEBYSCORE', 'z', 5, '+inf', 'LIMIT', 1, 2],
  ['ZRANGEBYSCORE', 'z', '(5', '+inf'], ['ZREM', 'z', 'dez', 'nada'], ['ZRANGE', 'z', 0, -1], ['ZADD', 'z', 1, 'a', 2, 'b', 3, 'c'], ['ZREMRANGEBYRANK', 'z', 0, -4],
  ['ZRANGE', 'z', 0, -1, 'WITHSCORES'], ['ZADD', 'z', 1731450000000, 'grande'], ['ZREVRANGE', 'z', 0, 0, 'WITHSCORES'], ['ZREM', 'z', 'b', 'c', 'grande'], ['ZCARD', 'z'], ['TYPE', 'z'],
  ['ZREMRANGEBYRANK', 'z', 0, -1], ['TYPE', 'z'], ['ZCARD', 'z'], ['ZRANGE', 'nada', 0, -1]
];

test('pgkv responde igual ao Redis', { skip: pula }, async () => {
  process.env.CENTRAL_DATABASE_URL = PGU;
  const pg = require('../lib/pgkv'), Redis = require('ioredis'), r = new Redis(RU);
  const { Pool } = require('pg'), p = new Pool({ connectionString: PGU });
  await r.flushdb(); await pg.rd(['DBSIZE']); await p.query('TRUNCATE kv');
  try {
    for (const c of SCRIPT) {
      const esperado = await r.call(c[0], ...c.slice(1).map(String)).catch(e => 'ERRO');
      const obtido = await pg.rd(c).catch(e => 'ERRO');
      // a ordem dos campos de um hash não importa (a Central monta um objeto com eles)
      const norm = v => (c[0] === 'HGETALL' && Array.isArray(v) ? Object.fromEntries(Array.from({ length: v.length / 2 }, (_, i) => [v[2 * i], v[2 * i + 1]])) : v);
      assert.deepStrictEqual(norm(obtido), norm(esperado), JSON.stringify(c));
    }
    // SCAN: o cursor é diferente, mas o conjunto de chaves tem que ser o mesmo
    const varre = async f => { const ks = []; let cur = '0'; do { const [c, k] = await f(['SCAN', cur, 'MATCH', '*', 'COUNT', '2']); cur = c; ks.push(...k); } while (cur !== '0'); return ks.sort(); };
    assert.deepStrictEqual(await varre(c => pg.rd(c)), await varre(c => r.call(...c.map(String))));
    assert.strictEqual(await pg.rd(['DBSIZE']), await r.dbsize());
  } finally { r.disconnect(); await p.end(); await pg.fechar(); }
});

// LPOP com quantidade (Redis 6.2+; o zap usa) fica fora da comparação porque o redis-server local pode ser mais antigo
test('LPOP com quantidade', { skip: pula }, async () => {
  process.env.CENTRAL_DATABASE_URL = PGU;
  const pg = require('../lib/pgkv');
  await pg.rd(['DEL', 'q']);
  await pg.rd(['RPUSH', 'q', 'a', 'b', 'c']);
  assert.deepStrictEqual(await pg.rd(['LPOP', 'q', 2]), ['a', 'b']);
  assert.deepStrictEqual(await pg.rd(['LPOP', 'q', 10]), ['c']);
  assert.strictEqual(await pg.rd(['LPOP', 'q', 10]), null);
  assert.strictEqual(await pg.rd(['TYPE', 'q']), 'none');
  await pg.fechar();
});

test('SET NX ao mesmo tempo: só uma chamada ganha', { skip: pula }, async () => {
  process.env.CENTRAL_DATABASE_URL = PGU;
  const pg = require('../lib/pgkv');
  await pg.rd(['DEL', 'trava']);
  const r = await Promise.all(Array.from({ length: 8 }, () => pg.rd(['SET', 'trava', '1', 'NX', 'EX', 60])));
  assert.strictEqual(r.filter(x => x === 'OK').length, 1);
  const n = await Promise.all(Array.from({ length: 20 }, () => pg.rd(['INCR', 'conta_junto'])));
  assert.strictEqual(Math.max(...n), 20);
  await pg.fechar();
});

test('chave vencida some', { skip: pula }, async () => {
  process.env.CENTRAL_DATABASE_URL = PGU;
  const pg = require('../lib/pgkv'), { Pool } = require('pg'), p = new Pool({ connectionString: PGU });
  await pg.rd(['SET', 'velha', '1', 'EX', 60]);
  await p.query('UPDATE kv SET exp = $1 WHERE k = $2', [Date.now() - 1000, 'velha']);
  assert.strictEqual(await pg.rd(['GET', 'velha']), null);
  assert.strictEqual(await pg.rd(['SET', 'velha', '2', 'NX']), 'OK');
  assert.strictEqual(await pg.rd(['GET', 'velha']), '2');
  await p.end(); await pg.fechar();
});

test('faixa de índices no estilo Redis', () => {
  const { faixa } = require('../lib/pgkv').interno;
  assert.deepStrictEqual(faixa(5, 0, -1), [0, 4]);
  assert.deepStrictEqual(faixa(5, -2, 100), [3, 4]);
  assert.strictEqual(faixa(5, 6, 10), null);
  assert.strictEqual(faixa(0, 0, -1), null);
});
