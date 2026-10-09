const { auth, dbGet, dbSet } = require('../lib/db');
const G = 'https://graph.instagram.com';
const TIPO = { IMAGE: 'Foto', VIDEO: 'Vídeo', CAROUSEL_ALBUM: 'Carrossel' };
async function get(p, q = {}) {
  const u = new URL(G + p);
  Object.entries({ ...q, access_token: process.env.IG_TOKEN }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u)).json();
  if (j.error) throw new Error(j.error.message);
  return j;
}
async function ins(id) {
  for (const m of ['views,reach,saved,shares', 'reach,saved,shares', 'reach']) {
    try {
      const j = await get('/' + id + '/insights', { metric: m });
      return Object.fromEntries(j.data.map(x => [x.name, x.values?.[0]?.value ?? x.total_value?.value ?? 0]));
    } catch (e) {}
  }
  return {};
}
module.exports = async (req, res) => {
  if (!(await auth(req))) return res.status(401).json({ erro: 'Faça login' });
  if (!process.env.IG_TOKEN) return res.status(500).json({ erro: 'IG_TOKEN não configurado na Vercel' });
  try {
    const c = await dbGet('cache').catch(() => null);
    // ?cache=1: devolve a última cópia na hora, mesmo antiga (a Central abre com ela e atualiza por trás)
    if (req.query?.cache) return c && c.d ? res.json({ ...c.d, cacheEm: c.t }) : res.status(404).json({ erro: 'Ainda sem cópia' });
    if (!req.query?.force && c && Date.now() - c.t < 30 * 60e3) return res.json(c.d);
    // posts com mais de 30 dias reaproveitam as métricas da última sincronização: assim cabe no limite de 60 s da Vercel
    const antes = new Map(((c && c.d && c.d.posts) || []).map(p => [p.id, p])), corte = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const me = await get('/me', { fields: 'username,followers_count,media_count' });
    let path = '/me/media', q = { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count', limit: 50 }, items = [];
    for (let i = 0; i < 6; i++) {
      const j = await get(path, q);
      items.push(...j.data);
      if (!j.paging?.next) break;
      const nx = new URL(j.paging.next);
      path = nx.pathname; q = Object.fromEntries(nx.searchParams);
    }
    const posts = [];
    for (let i = 0; i < items.length; i += 10) {
      posts.push(...await Promise.all(items.slice(i, i + 10).map(async m => {
        const v = antes.get(m.id), velho = m.timestamp.slice(0, 10) < corte;
        const s = v && velho ? { reach: v.alc, views: v.vis, saved: v.sal, shares: v.comp } : await ins(m.id);
        return { id: m.id, data: m.timestamp.slice(0, 10), tipo: m.media_product_type === 'REELS' ? 'Reels' : TIPO[m.media_type] || 'Foto',
          alc: s.reach || 0, vis: s.views || s.reach || 0, cur: m.like_count || 0, com: m.comments_count || 0, sal: s.saved || 0, comp: s.shares || 0,
          leg: (m.caption || '').split('\n')[0].slice(0, 80), link: m.permalink, img: m.thumbnail_url || m.media_url || '' };
      })));
    }
    const ns = {}, now = new Date();
    for (let k = 0; k < 2; k++) {
      const a = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)), b = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k + 1, 1));
      try {
        const j = await get('/me/insights', { metric: 'views', period: 'day', metric_type: 'total_value', breakdown: 'follower_type', since: Math.floor(a / 1000), until: Math.floor(Math.min(b, now) / 1000) });
        const r = j.data[0].total_value.breakdowns[0].results.find(x => x.dimension_values[0] === 'NON_FOLLOWER');
        if (r) ns[a.toISOString().slice(0, 7)] = r.value;
      } catch (e) {}
    }
    const out = { perfil: me.username, seguidores: me.followers_count, posts, ns };
    await dbSet('cache', { t: Date.now(), d: out }).catch(() => {});
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
