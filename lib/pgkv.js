// Banco da Central no Postgres (Neon grátis, sem limite de requisições), falando os mesmos comandos de Redis
// que o resto do código já usa: rd(['ZADD', k, 10, 'x']) funciona igual ao Upstash.
// Cada chave é uma linha de kv: t = tipo (string, list, hash, zset), v = valor em JSON, exp = expira em (ms).
// Só os comandos que a Central usa estão aqui; um comando novo cai no erro "comando não suportado".
const { Pool } = require('pg');

let pool, pronto;
const conexao = () => pool || (pool = new Pool({ connectionString: process.env.CENTRAL_DATABASE_URL, max: 3, idleTimeoutMillis: 10000, ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(process.env.CENTRAL_DATABASE_URL || '') ? false : { rejectUnauthorized: false } }));
async function tabela() {
  if (!pronto) pronto = conexao().query('CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, t text NOT NULL, v jsonb NOT NULL, exp bigint)')
    .catch(e => { pronto = null; throw e; });
  return pronto;
}

const vivo = row => row && !(row.exp != null && Number(row.exp) <= Date.now()) ? row : null;
const num = x => {
  const s = String(x);
  if (s === '+inf' || s === 'inf') return Infinity;
  if (s === '-inf') return -Infinity;
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error('ERR value is not a valid float');
  return n;
};
const inteiro = x => { const n = Number(x); if (!Number.isInteger(n)) throw new Error('ERR value is not an integer or out of range'); return n; };
const txt = n => (Number.isInteger(n) ? String(n) : n === Infinity ? 'inf' : n === -Infinity ? '-inf' : String(n));
// intervalo de índices no estilo Redis (negativos contam do fim); devolve [início, fim] inclusivo ou null
function faixa(len, a, b) {
  let s = inteiro(a), e = inteiro(b);
  if (s < 0) s = Math.max(len + s, 0);
  if (e < 0) e = len + e;
  if (e >= len) e = len - 1;
  return s > e || s >= len ? null : [s, e];
}
const ordena = z => z.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
// limite de score: "(10" é exclusivo
const limite = x => { const s = String(x); return s[0] === '(' ? { n: num(s.slice(1)), ex: true } : { n: num(s), ex: false }; };
const dentro = (sc, mn, mx) => (mn.ex ? sc > mn.n : sc >= mn.n) && (mx.ex ? sc < mx.n : sc <= mx.n);
const tipoErrado = () => new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
const doTipo = (row, t) => { if (row && row.t !== t) throw tipoErrado(); return row ? row.v : null; };

async function ler(k) {
  const { rows } = await conexao().query('SELECT t, v, exp FROM kv WHERE k = $1', [k]);
  return vivo(rows[0]);
}

/**
 * Lê a chave com trava, aplica fn(linha) e grava o que ela devolver:
 * { r: resposta, novo: { t, v } | null (apaga) | undefined (não mexe), exp: ms | null (sem prazo) | undefined (mantém) }.
 */
async function mudar(k, fn) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const c = await conexao().connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query('SELECT t, v, exp FROM kv WHERE k = $1 FOR UPDATE', [k]);
      const existe = !!rows[0], row = vivo(rows[0]);
      const { r, novo, exp } = fn(row);
      const prazo = exp === undefined ? (row ? row.exp : null) : exp;
      if (novo === null) { if (existe) await c.query('DELETE FROM kv WHERE k = $1', [k]); }
      else if (novo !== undefined) {
        if (existe) await c.query('UPDATE kv SET t = $2, v = $3, exp = $4 WHERE k = $1', [k, novo.t, JSON.stringify(novo.v), prazo]);
        else {
          const ins = await c.query('INSERT INTO kv (k, t, v, exp) VALUES ($1, $2, $3, $4) ON CONFLICT (k) DO NOTHING', [k, novo.t, JSON.stringify(novo.v), prazo]);
          if (!ins.rowCount) { await c.query('ROLLBACK'); continue; } // outra chamada criou a chave ao mesmo tempo: tenta de novo
        }
      } else if (existe && !row) await c.query('DELETE FROM kv WHERE k = $1', [k]); // estava vencida
      else if (row && exp !== undefined) await c.query('UPDATE kv SET exp = $2 WHERE k = $1', [k, prazo]);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }
  throw new Error('Banco ocupado, tente de novo');
}

const lista = (v, novo) => (novo.length ? { t: 'list', v: novo } : null);

const CMD = {
  async GET([k]) { const row = await ler(k); return doTipo(row, 'string'); },
  async MGET(ks) {
    const { rows } = await conexao().query('SELECT k, t, v, exp FROM kv WHERE k = ANY($1)', [ks]);
    const m = new Map(rows.filter(vivo).filter(r => r.t === 'string').map(r => [r.k, r.v]));
    return ks.map(k => (m.has(k) ? m.get(k) : null));
  },
  async SET([k, v, ...op]) {
    const o = op.map(x => String(x).toUpperCase());
    let exp = null;
    const iEx = o.indexOf('EX'), iPx = o.indexOf('PX');
    if (iEx >= 0) exp = Date.now() + inteiro(op[iEx + 1]) * 1000;
    if (iPx >= 0) exp = Date.now() + inteiro(op[iPx + 1]);
    const nx = o.includes('NX'), xx = o.includes('XX');
    return mudar(k, row => {
      if ((nx && row) || (xx && !row)) return { r: null };
      return { r: 'OK', novo: { t: 'string', v: String(v) }, exp };
    });
  },
  async MSET(a) {
    const c = await conexao().connect();
    try {
      await c.query('BEGIN');
      for (let i = 0; i < a.length; i += 2) {
        await c.query("INSERT INTO kv (k, t, v, exp) VALUES ($1, 'string', $2, NULL) ON CONFLICT (k) DO UPDATE SET t = 'string', v = EXCLUDED.v, exp = NULL", [String(a[i]), JSON.stringify(String(a[i + 1]))]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return 'OK';
  },
  async DEL(ks) {
    const { rows } = await conexao().query('DELETE FROM kv WHERE k = ANY($1) RETURNING exp', [ks.map(String)]);
    return rows.filter(vivo).length;
  },
  INCR: ([k]) => CMD.INCRBY([k, 1]),
  INCRBY: ([k, n]) => mudar(k, row => {
    const v = inteiro(doTipo(row, 'string') ?? 0) + inteiro(n);
    return { r: v, novo: { t: 'string', v: String(v) } };
  }),
  EXPIRE: ([k, s]) => mudar(k, row => (row ? { r: 1, exp: Date.now() + inteiro(s) * 1000 } : { r: 0 })),
  async TTL([k]) { const row = await ler(k); return !row ? -2 : row.exp == null ? -1 : Math.ceil((Number(row.exp) - Date.now()) / 1000); },
  async TYPE([k]) { const row = await ler(k); return row ? row.t : 'none'; },
  async EXISTS(ks) { let n = 0; for (const k of ks) if (await ler(k)) n++; return n; },
  async DBSIZE() { const { rows } = await conexao().query('SELECT count(*)::int AS n FROM kv WHERE exp IS NULL OR exp > $1', [Date.now()]); return rows[0].n; },
  // o cursor é só um deslocamento na lista de chaves em ordem alfabética
  async SCAN([cur, ...op]) {
    const o = op.map(x => String(x).toUpperCase());
    const iM = o.indexOf('MATCH'), iC = o.indexOf('COUNT');
    const pad = iM >= 0 ? String(op[iM + 1]) : '*', n = iC >= 0 ? inteiro(op[iC + 1]) : 10, de = inteiro(cur);
    const like = pad.replace(/[\\%_]/g, x => '\\' + x).replace(/\*/g, '%').replace(/\?/g, '_');
    const { rows } = await conexao().query('SELECT k, exp FROM kv WHERE k LIKE $1 ORDER BY k OFFSET $2 LIMIT $3', [like, de, n]);
    return [rows.length < n ? '0' : String(de + rows.length), rows.filter(vivo).map(r => r.k)];
  },

  // listas
  LPUSH: ([k, ...vs]) => mudar(k, row => { const l = [...vs.map(String).reverse(), ...(doTipo(row, 'list') || [])]; return { r: l.length, novo: { t: 'list', v: l } }; }),
  RPUSH: ([k, ...vs]) => mudar(k, row => { const l = [...(doTipo(row, 'list') || []), ...vs.map(String)]; return { r: l.length, novo: { t: 'list', v: l } }; }),
  LPOP: ([k, n]) => mudar(k, row => {
    const l = doTipo(row, 'list');
    if (!l) return { r: null };
    const q = n === undefined ? 1 : inteiro(n), saiu = l.slice(0, q);
    return { r: n === undefined ? saiu[0] : saiu, novo: lista(l, l.slice(q)) };
  }),
  async LLEN([k]) { return (doTipo(await ler(k), 'list') || []).length; },
  async LRANGE([k, a, b]) { const l = doTipo(await ler(k), 'list') || [], f = faixa(l.length, a, b); return f ? l.slice(f[0], f[1] + 1) : []; },
  LTRIM: ([k, a, b]) => mudar(k, row => {
    const l = doTipo(row, 'list');
    if (!l) return { r: 'OK' };
    const f = faixa(l.length, a, b);
    return { r: 'OK', novo: lista(l, f ? l.slice(f[0], f[1] + 1) : []) };
  }),

  // hashes
  async HGETALL([k]) { const h = doTipo(await ler(k), 'hash') || {}; return Object.entries(h).flat(); },
  HSET: ([k, ...a]) => mudar(k, row => {
    const h = { ...(doTipo(row, 'hash') || {}) };
    let novos = 0;
    for (let i = 0; i < a.length; i += 2) { if (!(String(a[i]) in h)) novos++; h[String(a[i])] = String(a[i + 1]); }
    return { r: novos, novo: { t: 'hash', v: h } };
  }),
  HINCRBY: ([k, f, n]) => mudar(k, row => {
    const h = { ...(doTipo(row, 'hash') || {}) }, v = inteiro(h[f] ?? 0) + inteiro(n);
    h[String(f)] = String(v);
    return { r: v, novo: { t: 'hash', v: h } };
  }),

  // conjuntos ordenados: v = [[score, membro], ...] sempre em ordem crescente
  ZADD: ([k, ...a]) => mudar(k, row => {
    const z = (doTipo(row, 'zset') || []).map(x => [...x]), idx = new Map(z.map((x, i) => [x[1], i]));
    let novos = 0;
    for (let i = 0; i < a.length; i += 2) {
      const sc = num(a[i]), m = String(a[i + 1]);
      if (idx.has(m)) z[idx.get(m)][0] = sc; else { idx.set(m, z.length); z.push([sc, m]); novos++; }
    }
    return { r: novos, novo: { t: 'zset', v: ordena(z) } };
  }),
  ZREM: ([k, ...ms]) => mudar(k, row => {
    const z = doTipo(row, 'zset');
    if (!z) return { r: 0 };
    const tira = new Set(ms.map(String)), fica = z.filter(x => !tira.has(x[1]));
    return { r: z.length - fica.length, novo: fica.length ? { t: 'zset', v: fica } : null };
  }),
  async ZCARD([k]) { return (doTipo(await ler(k), 'zset') || []).length; },
  async ZCOUNT([k, a, b]) { const mn = limite(a), mx = limite(b); return (doTipo(await ler(k), 'zset') || []).filter(x => dentro(x[0], mn, mx)).length; },
  ZRANGE: ([k, a, b, ...op]) => zfaixa(k, a, b, op, false),
  ZREVRANGE: ([k, a, b, ...op]) => zfaixa(k, a, b, op, true),
  async ZREVRANK([k, m]) { const z = doTipo(await ler(k), 'zset') || [], i = z.findIndex(x => x[1] === String(m)); return i < 0 ? null : z.length - 1 - i; },
  async ZRANK([k, m]) { const i = (doTipo(await ler(k), 'zset') || []).findIndex(x => x[1] === String(m)); return i < 0 ? null : i; },
  async ZSCORE([k, m]) { const x = (doTipo(await ler(k), 'zset') || []).find(y => y[1] === String(m)); return x ? txt(x[0]) : null; },
  async ZRANGEBYSCORE([k, a, b, ...op]) {
    const mn = limite(a), mx = limite(b), o = op.map(x => String(x).toUpperCase());
    let z = (doTipo(await ler(k), 'zset') || []).filter(x => dentro(x[0], mn, mx));
    const iL = o.indexOf('LIMIT');
    if (iL >= 0) { const de = inteiro(op[iL + 1]), n = inteiro(op[iL + 2]); z = z.slice(de, n < 0 ? undefined : de + n); }
    return o.includes('WITHSCORES') ? z.flatMap(x => [x[1], txt(x[0])]) : z.map(x => x[1]);
  },
  ZREMRANGEBYRANK: ([k, a, b]) => mudar(k, row => {
    const z = doTipo(row, 'zset');
    if (!z) return { r: 0 };
    const f = faixa(z.length, a, b);
    if (!f) return { r: 0 };
    const fica = [...z.slice(0, f[0]), ...z.slice(f[1] + 1)];
    return { r: z.length - fica.length, novo: fica.length ? { t: 'zset', v: fica } : null };
  })
};
async function zfaixa(k, a, b, op, rev) {
  let z = doTipo(await ler(k), 'zset') || [];
  if (rev) z = [...z].reverse();
  const f = faixa(z.length, a, b), sel = f ? z.slice(f[0], f[1] + 1) : [];
  return op.some(x => String(x).toUpperCase() === 'WITHSCORES') ? sel.flatMap(x => [x[1], txt(x[0])]) : sel.map(x => x[1]);
}

/** Mesmo formato do rd() do Upstash: rd(['COMANDO', ...args]) devolve o resultado do Redis. */
async function rd(cmd) {
  await tabela();
  const [c, ...a] = cmd, f = CMD[String(c).toUpperCase()];
  if (!f) throw new Error('Comando não suportado no banco da Central: ' + c);
  // de vez em quando apaga as chaves vencidas (deduplicação de eventos etc.)
  if (Math.random() < 0.02) conexao().query('DELETE FROM kv WHERE exp IS NOT NULL AND exp <= $1', [Date.now()]).catch(() => {});
  return f(a.map(x => (typeof x === 'number' ? String(x) : x)));
}
const fechar = () => (pool ? pool.end().then(() => { pool = null; pronto = null; }) : Promise.resolve());

module.exports = { rd, fechar, interno: { faixa, limite } };
