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
  const K = process.env.APP_KEY;
  if (K && req.headers['x-key'] !== K) return res.status(401).json({ erro: 'Senha incorreta' });
  if (!process.env.IG_TOKEN) return res.status(500).json({ erro: 'IG_TOKEN não configurado na Vercel' });
  try {
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
        const s = await ins(m.id);
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
    res.json({ perfil: me.username, seguidores: me.followers_count, posts, ns });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
