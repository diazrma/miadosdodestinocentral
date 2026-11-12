// Painel da placa ES3C28P: números do Instagram para mostrar na tela.
// GET com o cabeçalho x-painel-key (PAINEL_KEY na Vercel) ->
//   { conta, seguidores, seguindo, posts, topMes: { legenda, curtidas, comentarios, views, data, link }, avisos: [] }
// A cada 50 seguidores novos entra um aviso (a base fica no banco, em "painel_seguidores").
// GET ?img=1 -> capa do top do mês em RGB565 (96x96, big-endian), pronta para a tela da placa.
const crypto = require('crypto');
const { dbGet, dbSet } = require('../lib/db');
const { igToken } = require('../lib/ig');
const sharp = require('sharp');

const IG = 'https://graph.instagram.com';
const PASSO = 50;

async function igGet(path, q = {}) {
  const u = new URL(IG + path);
  Object.entries({ ...q, access_token: await igToken() }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u)).json();
  if (j.error) throw new Error('Instagram: ' + j.error.message);
  return j;
}

function autorizado(req) {
  const esperado = process.env.PAINEL_KEY || '';
  const dado = String(req.headers['x-painel-key'] || '');
  return esperado.length > 0 && dado.length === esperado.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(esperado));
}

async function postsDoMes() {
  const inicio = new Date();
  inicio.setDate(1);
  inicio.setHours(0, 0, 0, 0);
  const j = await igGet('/me/media', { fields: 'id,caption,timestamp,permalink,like_count,comments_count,media_type,media_url,thumbnail_url', limit: 50 });
  return (j.data || []).filter((p) => new Date(p.timestamp) >= inicio);
}

async function views(id) {
  try {
    const j = await igGet(`/${id}/insights`, { metric: 'views' });
    return j.data?.[0]?.values?.[0]?.value ?? j.data?.[0]?.total_value?.value ?? null;
  } catch (e) {
    return null;
  }
}

async function capa(post) {
  const url = post.thumbnail_url || post.media_url;
  if (!url) return null;
  const foto = Buffer.from(await (await fetch(url)).arrayBuffer());
  const { data } = await sharp(foto).resize(96, 96, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(96 * 96 * 2);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 2) {
    const v = ((data[i] & 0xf8) << 8) | ((data[i + 1] & 0xfc) << 3) | (data[i + 2] >> 3);
    out[o] = v >> 8;
    out[o + 1] = v & 0xff;
  }
  return out;
}

module.exports = async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'Chave inválida' });
  try {
    if (req.query?.img) {
      const top = (await postsDoMes()).sort((a, b) => (b.like_count || 0) - (a.like_count || 0))[0];
      const img = top && (await capa(top));
      if (!img) return res.status(404).json({ erro: 'Sem imagem' });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(img);
    }
    const me = await igGet('/me', { fields: 'username,followers_count,follows_count,media_count' });
    const posts = await postsDoMes();
    const top = posts.sort((a, b) => (b.like_count || 0) - (a.like_count || 0))[0];

    const avisos = [];
    const base = (await dbGet('painel_seguidores').catch(() => null)) || { base: me.followers_count };
    if (me.followers_count >= base.base + PASSO) {
      const passos = Math.floor((me.followers_count - base.base) / PASSO);
      avisos.push(`+${passos * PASSO} seguidores! Agora são ${me.followers_count}.`);
      base.base += passos * PASSO;
    }
    await dbSet('painel_seguidores', base).catch(() => {});

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      conta: me.username,
      seguidores: me.followers_count,
      seguindo: me.follows_count,
      posts: me.media_count,
      topMes: top
        ? { legenda: (top.caption || '').slice(0, 120), curtidas: top.like_count || 0, comentarios: top.comments_count || 0, views: await views(top.id), data: top.timestamp, link: top.permalink }
        : null,
      postsNoMes: posts.length,
      avisos,
    });
  } catch (e) {
    return res.status(502).json({ erro: e.message });
  }
};
