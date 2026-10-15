const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
async function rd(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
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
const MENUS = ['painel', 'equipe', 'dados', 'posts', 'publicar', 'automacoes', 'conversas', 'contatos', 'feed', 'relatorio', 'app', 'acessos'];
const ROLES = [
  { id: 'admin', nome: 'Administrador', admin: true, menus: MENUS },
  { id: 'gestor', nome: 'Gestor', menus: ['painel', 'equipe', 'dados', 'posts', 'publicar', 'automacoes', 'conversas', 'contatos', 'feed', 'relatorio', 'app'] },
  { id: 'social', nome: 'Social media', menus: ['painel', 'posts', 'publicar', 'conversas', 'feed', 'app'] },
  { id: 'viewer', nome: 'Visualizador', menus: ['painel', 'relatorio'] }
];
module.exports = { rd, PFX, dbGet, dbSet, hash, check, sign, mac, auth, MENUS, ROLES };
