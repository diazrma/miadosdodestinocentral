const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
// Banco próprio da Central (Redis oficial da Vercel, plano grátis sem limite de requisições): conexão direta.
// Sem CENTRAL_REDIS_URL, tudo continua no Upstash pela API REST, como antes.
const TCP = process.env.CENTRAL_REDIS_URL;
let cli;
const conexao = () => cli || (cli = new (require('ioredis'))(TCP, { maxRetriesPerRequest: 2, connectTimeout: 10000 }));
// Banco grátis da Central no Postgres (Neon), com os mesmos comandos de Redis (lib/pgkv.js). Tem prioridade sobre os outros.
const PG = process.env.CENTRAL_DATABASE_URL;
const temBanco = () => !!(PG || TCP || URL_);
async function rd(cmd) {
  if (PG) return require('./pgkv').rd(cmd);
  if (TCP) { const [c, ...a] = cmd; return conexao().call(c, ...a); }
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
// várias chamadas numa ida só (Upstash /pipeline ou pipeline do Redis); devolve o resultado de cada uma
async function pipe(cmds) {
  const out = [];
  for (let i = 0; i < cmds.length; i += 200) {
    const parte = cmds.slice(i, i + 200);
    if (PG) {
      for (const c of parte) out.push(await rd(c).catch(() => null));
    } else if (TCP) {
      const p = conexao().pipeline();
      parte.forEach(([c, ...a]) => p.call(c, ...a));
      out.push(...(await p.exec()).map(([e, v]) => (e ? null : v)));
    } else {
      const r = await fetch(URL_ + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: JSON.stringify(parte) });
      out.push(...(await r.json()).map(x => x.result));
    }
  }
  return out;
}
// o banco Upstash é dividido com outros projetos: as chaves da Central levam um prefixo próprio
// (DB_PREFIX="" na Vercel volta a usar as chaves sem prefixo, num banco só da Central)
const PFX = process.env.DB_PREFIX ?? 'miados-central:';
const dbGet = async k => { const v = await rd(['GET', PFX + k]); return v ? JSON.parse(v) : null; };
const dbSet = (k, v) => rd(['SET', PFX + k, JSON.stringify(v)]);
const hash = (s, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(s, salt, 32).toString('hex');
const check = (s, h) => { const a = Buffer.from(hash(s, h.split(':')[0])), b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const mac = p => crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(p).digest('base64url');
const sign = id => { const p = Buffer.from(JSON.stringify({ id, exp: Date.now() + 7 * 864e5 })).toString('base64url'); return p + '.' + mac(p); };
const verify = t => { try { const [p, s] = (t || '').split('.'); if (!p || s !== mac(p)) return null; const o = JSON.parse(Buffer.from(p, 'base64url')); return o.exp > Date.now() ? o.id : null; } catch (e) { return null; } };
async function auth(req) {
  const id = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!id) return null;
  const u = (await dbGet('users') || []).find(x => x.id === id);
  if (!u) return null;
  const st = await dbGet('state') || {}, role = (st.roles || []).find(r => r.id === u.role);
  return { u, role, menus: role ? (role.admin ? MENUS : role.menus) : [] };
}
const MENUS = ['painel', 'equipe', 'dados', 'posts', 'cronograma', 'publicar', 'automacoes', 'conversas', 'contatos', 'feed', 'relatorio', 'app', 'acessos', 'loja'];
const ROLES = [
  { id: 'admin', nome: 'Administrador', admin: true, menus: MENUS },
  { id: 'gestor', nome: 'Gestor', menus: ['painel', 'equipe', 'dados', 'posts', 'cronograma', 'publicar', 'automacoes', 'conversas', 'contatos', 'feed', 'relatorio', 'app', 'loja'] },
  { id: 'social', nome: 'Social media', menus: ['painel', 'posts', 'cronograma', 'publicar', 'conversas', 'feed', 'app'] },
  { id: 'viewer', nome: 'Visualizador', menus: ['painel', 'relatorio'] }
];
module.exports = { rd, pipe, temBanco, PFX, dbGet, dbSet, hash, check, sign, mac, auth, MENUS, ROLES };
