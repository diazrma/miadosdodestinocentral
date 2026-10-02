process.env.VERCEL_BLOB_RETRIES = process.env.VERCEL_BLOB_RETRIES || '1';
const { randomUUID } = require('crypto');
const { del } = require('@vercel/blob');
const { auth, dbGet, dbSet } = require('../lib/db');
const G = 'https://graph.instagram.com';
const BLOB = u => /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i.test(String(u || ''));
function amigavel(e) {
  const m = e.error_user_msg || e.message || '', c = e.code;
  if (c === 190) return 'O token do Instagram expirou ou é inválido. Gere um novo IG_TOKEN na Meta.';
  if (c === 10 || c === 200 || /permission/i.test(m)) return 'O IG_TOKEN não tem permissão de publicação (instagram_business_content_publish). Gere um token novo com essa permissão.';
  if (c === 4 || c === 9 || /limit/i.test(m)) return 'Limite de publicações do Instagram atingido. Tente de novo mais tarde.';
  if (/aspect ratio/i.test(m)) return 'Proporção não aceita pelo Instagram. Use entre 4:5 (vertical) e 1.91:1 (horizontal).';
  if (/format|media type|unsupported|codec/i.test(m)) return 'Formato não aceito pelo Instagram. Use JPG para fotos e MP4/MOV (H.264) para vídeos.';
  if (/duration|too (long|short)/i.test(m)) return 'Duração do vídeo fora do permitido (Reels: 3 s a 15 min).';
  if (/download|fetch|retriev/i.test(m)) return 'O Instagram não conseguiu baixar o arquivo. Tente de novo.';
  return 'Instagram: ' + m;
}
async function ig(p, q = {}, post) {
  const b = new URLSearchParams({ ...q, access_token: process.env.IG_TOKEN });
  const r = await fetch(G + p + (post ? '' : '?' + b), post ? { method: 'POST', body: b } : {});
  const j = await r.json();
  if (j.error) throw new Error(amigavel(j.error));
  return j;
}
let UID = null;
const uid = async () => UID || (UID = await ig('/me', { fields: 'user_id' }).then(j => j.user_id || j.id));
const limpar = us => (us = (us || []).filter(BLOB)).length ? del(us).catch(() => {}) : null;
const leg = s => String(s || '').slice(0, 2200);
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('publicar')) return res.status(403).json({ erro: 'Sem permissão para publicar' });
    const b = req.body || {}, no = (c, m) => res.status(c).json({ erro: m });
    if (b.acao === 'rascunhos') return res.json({ lista: await dbGet('drafts') || [] });
    if (b.acao === 'salvar_rascunho') {
      const r = b.r || {}, ds = await dbGet('drafts') || [], old = ds.find(d => d.id === r.id);
      const itens = (r.itens || []).filter(x => BLOB(x.url)).slice(0, 10).map(x => ({ url: x.url, vid: !!x.vid, cap: +x.cap || 0 }));
      const n = { id: old ? old.id : randomUUID(), tipo: ['foto', 'carrossel', 'reels'].includes(r.tipo) ? r.tipo : 'foto', ar: String(r.ar || '1'), leg: leg(r.leg), resp: String(r.resp || ''), itens, autor: a.u.nome, t: Date.now() };
      if (old) await limpar(old.itens.map(x => x.url).filter(u => !itens.some(x => x.url === u)));
      await dbSet('drafts', old ? ds.map(d => d.id === n.id ? n : d) : [n, ...ds]); return res.json({ id: n.id });
    }
    if (b.acao === 'apagar_rascunho') {
      const ds = await dbGet('drafts') || [], d = ds.find(x => x.id === b.id);
      if (d) { await limpar(d.itens.map(x => x.url)); await dbSet('drafts', ds.filter(x => x.id !== b.id)); }
      return res.json({ ok: 1 });
    }
    if (b.acao === 'limpar') { await limpar(b.urls); return res.json({ ok: 1 }); }
    if (!process.env.IG_TOKEN) return no(500, 'IG_TOKEN não configurado na Vercel');
    if (b.acao === 'item') {
      if (!BLOB(b.url)) return no(400, 'Arquivo inválido');
      const q = b.carrossel ? { is_carousel_item: 'true' } : { caption: leg(b.legenda) };
      if (b.video) Object.assign(q, { video_url: b.url, media_type: b.carrossel ? 'VIDEO' : 'REELS' }, b.carrossel ? {} : { share_to_feed: 'true', thumb_offset: String(Math.max(0, +b.capa || 0)) });
      else q.image_url = b.url;
      return res.json({ id: (await ig('/' + await uid() + '/media', q, 1)).id });
    }
    if (b.acao === 'status') {
      const out = {};
      for (const id of (b.ids || []).slice(0, 11)) { const j = await ig('/' + encodeURIComponent(id), { fields: 'status_code,status' }); out[id] = { code: j.status_code, msg: j.status || '' }; }
      return res.json({ st: out });
    }
    if (b.acao === 'carrossel') {
      const ch = (b.children || []).slice(0, 10);
      if (ch.length < 2) return no(400, 'O carrossel precisa de 2 a 10 itens');
      return res.json({ id: (await ig('/' + await uid() + '/media', { media_type: 'CAROUSEL', children: ch.join(','), caption: leg(b.legenda) }, 1)).id });
    }
    if (b.acao === 'publicar') {
      const id = (await ig('/' + await uid() + '/media_publish', { creation_id: String(b.id || '') }, 1)).id;
      const link = await ig('/' + id, { fields: 'permalink' }).then(j => j.permalink).catch(() => '');
      const st = await dbGet('state') || {};
      if (b.resp) { st.resp = st.resp || {}; st.resp[id] = String(b.resp); await dbSet('state', st); }
      await dbSet('cache', { t: 0 }).catch(() => {});
      await limpar(b.urls);
      if (b.rascunho) { const ds = await dbGet('drafts') || [], d = ds.find(x => x.id === b.rascunho); if (d) { await limpar(d.itens.map(x => x.url)); await dbSet('drafts', ds.filter(x => x.id !== d.id)); } }
      return res.json({ id, link });
    }
    no(400, 'Ação inválida');
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
