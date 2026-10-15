// Backup da Central: dados do banco (só as chaves da Central), criptografados com BACKUP_KEY.
// As variáveis secretas da Vercel NÃO entram: só a lista de quais existiam, para saber o que recadastrar.
// GET  (Vercel Cron, Bearer CRON_SECRET)            -> salva uma cópia no Blob (backups/) e mantém as 14 últimas
// GET  ?baixar=1 com header x-backup-key            -> devolve a cópia na hora (o agendador do computador usa isso)
// POST { acao: 'restaurar', backup } + x-backup-key -> grava os dados de volta no banco
// POST { acao: 'arquivos' } (administrador logado)   -> lista o que existe no Blob
const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');
const { rd, PFX, auth } = require('../lib/db');
const { cred } = require('../lib/blob');

// variáveis que a Central usa (só os nomes vão para o backup)
const VARS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'SESSION_SECRET', 'CRON_SECRET', 'BACKUP_KEY', 'DB_PREFIX', 'BLOB_STORE_ID', 'BLOB_READ_WRITE_TOKEN', 'IG_TOKEN', 'IG_APP_ID', 'IG_APP_SECRET', 'FCM_SERVICE_ACCOUNT', 'GROQ_API_KEY', 'GROQ_MODEL',
  'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'POLLINATIONS_KEY', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_PROD_CLIENT_KEY', 'TIKTOK_PROD_CLIENT_SECRET'];
const MANTER = 14;

const chave = () => crypto.createHash('sha256').update(process.env.BACKUP_KEY || '').digest();
const igual = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const temChave = req => !!process.env.BACKUP_KEY && igual(req.headers['x-backup-key'], process.env.BACKUP_KEY);

function cifrar(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return { v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64') };
}
function decifrar(b) {
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(b.iv, 'base64'));
  d.setAuthTag(Buffer.from(b.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b.dados, 'base64')), d.final()]).toString());
}

// várias chamadas ao Redis numa requisição só (Upstash /pipeline)
async function pipe(cmds) {
  const out = [];
  for (let i = 0; i < cmds.length; i += 200) {
    const r = await fetch((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN) }, body: JSON.stringify(cmds.slice(i, i + 200)) });
    out.push(...(await r.json()).map(x => x.result));
  }
  return out;
}
// chaves temporárias das automações (deduplicação de eventos etc.) não entram
const TEMP = /^(ev:|sent:|asn:|tick:)/;
async function montar() {
  const nomes = [];
  let cur = '0';
  do { const [c, ks] = await rd(['SCAN', cur, 'MATCH', PFX + '*', 'COUNT', '500']); cur = c; nomes.push(...ks.filter(k => !TEMP.test(k.slice(PFX.length)))); } while (cur !== '0');
  const vals = [];
  for (let i = 0; i < nomes.length; i += 500) vals.push(...await rd(['MGET', ...nomes.slice(i, i + 500)]));
  const dados = {}, outros = [];
  nomes.forEach((k, i) => vals[i] != null ? dados[k.slice(PFX.length)] = vals[i] : outros.push(k));
  // listas (conversas, avisos), conjuntos ordenados (contatos, fila) e hashes (números) das automações
  const tipos = await pipe(outros.map(k => ['TYPE', k])), LER = { list: k => ['LRANGE', k, 0, -1], zset: k => ['ZRANGE', k, 0, -1, 'WITHSCORES'], hash: k => ['HGETALL', k] };
  const alvo = outros.map((k, i) => [k, tipos[i]]).filter(([, t]) => LER[t]);
  const conteudo = await pipe(alvo.map(([k, t]) => LER[t](k)));
  const estruturas = Object.fromEntries(alvo.map(([k, t], i) => [k.slice(PFX.length), { t, v: conteudo[i] }]));
  const variaveis = VARS.filter(k => process.env[k] != null);
  return { em: new Date().toISOString(), prefixo: PFX, chaves: Object.keys(dados).length + alvo.length, dados, estruturas, variaveis };
}
async function aplicar(d) {
  const pares = Object.entries(d.dados || {}).filter(([, v]) => v != null);
  for (let i = 0; i < pares.length; i += 50) await rd(['MSET', ...pares.slice(i, i + 50).flatMap(([k, v]) => [PFX + k, v])]);
  const cmds = [];
  for (const [k, { t, v }] of Object.entries(d.estruturas || {})) {
    if (!v || !v.length) continue;
    cmds.push(['DEL', PFX + k]);
    if (t === 'list') cmds.push(['RPUSH', PFX + k, ...v]);
    if (t === 'zset') { const a = []; for (let j = 0; j < v.length; j += 2) a.push(v[j + 1], v[j]); cmds.push(['ZADD', PFX + k, ...a]); }
    if (t === 'hash') cmds.push(['HSET', PFX + k, ...v]);
  }
  if (cmds.length) await pipe(cmds);
  return pares.length + Object.keys(d.estruturas || {}).length;
}

async function salvarNoBlob(req) {
  const b = await montar(), c = cred(req);
  const r = await put(`backups/central-${b.em.slice(0, 10)}.json`, JSON.stringify({ ...cifrar(b), em: b.em, chaves: b.chaves }),
    { access: 'public', contentType: 'application/json', addRandomSuffix: true, ...c });
  const { blobs } = await list({ prefix: 'backups/', limit: 1000, ...c });
  const velhos = blobs.sort((x, y) => new Date(y.uploadedAt) - new Date(x.uploadedAt)).slice(MANTER).map(x => x.url);
  if (velhos.length) await del(velhos, c).catch(() => {});
  return { ok: 1, em: b.em, chaves: b.chaves, variaveis: b.variaveis.length, arquivo: r.pathname, apagados: velhos.length };
}

module.exports = async (req, res) => {
  try {
    if (!process.env.BACKUP_KEY) return res.status(500).json({ erro: 'BACKUP_KEY não configurado na Vercel' });
    if (req.method === 'GET') {
      if (req.query?.baixar) {
        if (!temChave(req)) return res.status(401).json({ erro: 'Não autorizado' });
        const b = await montar();
        return res.json({ ...cifrar(b), em: b.em, chaves: b.chaves });
      }
      const seg = process.env.CRON_SECRET;
      if (!seg || req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      return res.json(await salvarNoBlob(req));
    }
    const b = req.body || {};
    if (b.acao === 'restaurar') {
      if (!temChave(req)) return res.status(401).json({ erro: 'Não autorizado' });
      const d = decifrar(b.backup || {});
      return res.json({ ok: 1, restauradas: await aplicar(d), de: d.em });
    }
    const a = await auth(req);
    if (!a || !a.role?.admin) return res.status(403).json({ erro: 'Só administradores' });
    if (b.acao === 'arquivos') {
      const { blobs } = await list({ limit: 1000, ...cred(req) });
      return res.json({ arquivos: blobs.map(x => ({ caminho: x.pathname, tamanho: x.size, em: x.uploadedAt, url: x.url })) });
    }
    if (b.acao === 'agora') return res.json(await salvarNoBlob(req));
    if (b.acao === 'restaurar_arquivo') {
      const u = new URL(String(b.url || ''));
      if (!/\.public\.blob\.vercel-storage\.com$/.test(u.hostname) || !u.pathname.startsWith('/backups/')) return res.status(400).json({ erro: 'Arquivo de backup inválido' });
      const d = decifrar(await (await fetch(u)).json());
      const antes = await salvarNoBlob(req); // cópia do estado atual antes de sobrescrever
      return res.json({ ok: 1, restauradas: await aplicar(d), de: d.em, copiaAntes: antes.arquivo });
    }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { montar, aplicar, cifrar, decifrar };
