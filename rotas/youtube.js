// Conexão da Central com o canal do YouTube (login do Google; usado pelo Milka Cast para subir os Shorts)
// POST { acao: 'status' }                -> canal conectado e a privacidade dos envios
// POST { acao: 'url' }                   -> link para autorizar (a pessoa volta em /youtube/retorno)
// POST { acao: 'privacidade', valor }    -> private | unlisted | public (public só depois da auditoria da API no Google)
// POST { acao: 'sair' }                  -> desconecta
// GET  ?retorno=1&code&state             -> troca o código pela chave de renovação (fica no banco, em "yt_conta")
// Precisa de YT_CLIENT_ID e YT_CLIENT_SECRET na Vercel (projeto do Google Cloud com a YouTube Data API v3 ligada).
const crypto = require('crypto');
const { auth, dbGet, dbSet } = require('../lib/db');
const { PRIVACIDADES } = require('../lib/yt');
const CENTRAL = 'https://miadosdodestinocentral.vercel.app';
const REDIRECT = CENTRAL + '/youtube/retorno';
const ESCOPOS = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

module.exports = async (req, res) => {
  try {
    const id = process.env.YT_CLIENT_ID, secret = process.env.YT_CLIENT_SECRET;
    const q = req.query || {};
    if (req.method === 'GET' && q.retorno) {
      const est = await dbGet('yt_estado');
      if (!q.code || !est || q.state !== est.state || Date.now() - est.t > 15 * 60e3) return res.redirect(302, '/?youtube=erro');
      const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
        client_id: id, client_secret: secret, code: q.code, grant_type: 'authorization_code', redirect_uri: REDIRECT }) })).json();
      if (!t.refresh_token) return res.redirect(302, '/?youtube=erro');
      const eu = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: 'Bearer ' + t.access_token } })).json().catch(() => ({}));
      const canal = eu.items?.[0];
      const antes = await dbGet('yt_conta');
      await dbSet('yt_conta', { refresh: t.refresh_token, canal: canal?.snippet?.title || '', canalId: canal?.id || '',
        privacidade: antes?.privacidade || 'private', por: est.por, em: new Date().toISOString() });
      await dbSet('yt_estado', null);
      return res.redirect(302, '/?youtube=ok');
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const b = req.body || {};
    if (b.acao === 'status') {
      const c = await dbGet('yt_conta');
      return res.json({ app: !!(id && secret), conectado: !!(c && c.refresh), canal: c?.canal || '', privacidade: c?.privacidade || 'private', por: c?.por || '' });
    }
    if (!a.role?.admin && !(a.menus || []).includes('publicar')) return res.status(403).json({ erro: 'Sem permissão' });
    if (b.acao === 'url') {
      if (!id || !secret) return res.status(400).json({ erro: 'Faltam YT_CLIENT_ID e YT_CLIENT_SECRET na Vercel' });
      const state = crypto.randomBytes(16).toString('hex');
      await dbSet('yt_estado', { state, t: Date.now(), por: a.u.nome });
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      // offline + consent: o Google só manda a chave de renovação assim, e ela é o que deixa os envios automáticos
      Object.entries({ client_id: id, redirect_uri: REDIRECT, response_type: 'code', scope: ESCOPOS, state,
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }).forEach(([k, v]) => u.searchParams.set(k, v));
      return res.json({ url: u.toString() });
    }
    if (b.acao === 'privacidade') {
      if (!PRIVACIDADES.includes(b.valor)) return res.status(400).json({ erro: 'Privacidade inválida' });
      const c = await dbGet('yt_conta');
      if (!c) return res.status(409).json({ erro: 'Conecte o canal primeiro' });
      await dbSet('yt_conta', { ...c, privacidade: b.valor });
      return res.json({ ok: 1 });
    }
    if (b.acao === 'sair') { await dbSet('yt_conta', null); return res.json({ ok: 1 }); }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
