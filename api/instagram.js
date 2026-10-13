// Conexão da Central com o Instagram (login do Instagram, sem token manual)
// POST { acao: 'url' }     -> link para autorizar (a pessoa volta em /instagram/retorno)
// POST { acao: 'status' }  -> conta conectada e quando o acesso vence
// POST { acao: 'sair' }    -> desconecta
// GET  ?retorno=1&code&state -> troca o código por um token longo (60 dias, renovado sozinho em lib/ig.js)
const crypto = require('crypto');
const { auth, dbGet, dbSet } = require('../lib/db');
const CENTRAL = 'https://miadosdodestinocentral.vercel.app';
const REDIRECT = CENTRAL + '/instagram/retorno';
const ESCOPOS = 'instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish';

module.exports = async (req, res) => {
  try {
    const id = process.env.IG_APP_ID, secret = process.env.IG_APP_SECRET;
    const q = req.query || {};
    if (req.method === 'GET' && q.retorno) {
      const est = await dbGet('ig_estado');
      const code = String(q.code || '').replace(/#_$/, '');
      if (!code || !est || q.state !== est.state || Date.now() - est.t > 15 * 60e3) return res.redirect(302, '/?instagram=erro');
      const curto = await (await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST',
        body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: REDIRECT, code }) })).json();
      if (!curto.access_token) return res.redirect(302, '/?instagram=erro');
      const longo = await (await fetch('https://graph.instagram.com/access_token?' + new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: curto.access_token }))).json();
      const token = longo.access_token || curto.access_token;
      const eu = await (await fetch('https://graph.instagram.com/me?fields=username&access_token=' + encodeURIComponent(token))).json().catch(() => ({}));
      await dbSet('ig_conta', { token, usuario: eu.username || '', renovado: Date.now(), expira: Date.now() + (longo.expires_in || 3600) * 1000, por: est.por, em: new Date().toISOString() });
      await dbSet('ig_estado', null);
      await dbSet('cache', null).catch(() => {}); // a próxima sincronização busca tudo de novo com a conta nova
      return res.redirect(302, '/?instagram=ok');
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const b = req.body || {};
    if (b.acao === 'status') {
      const c = await dbGet('ig_conta');
      return res.json({ app: !!(id && secret), conectado: !!(c && c.token), usuario: c?.usuario || '', expira: c?.expira || null, renovado: c?.renovado || null, por: c?.por || '', tokenVercel: !!process.env.IG_TOKEN });
    }
    if (!a.role?.admin && !(a.menus || []).includes('dados')) return res.status(403).json({ erro: 'Sem permissão' });
    if (b.acao === 'url') {
      if (!id || !secret) return res.status(400).json({ erro: 'Faltam IG_APP_ID e IG_APP_SECRET na Vercel' });
      const state = crypto.randomBytes(16).toString('hex');
      await dbSet('ig_estado', { state, t: Date.now(), por: a.u.nome });
      const u = new URL('https://www.instagram.com/oauth/authorize');
      Object.entries({ client_id: id, redirect_uri: REDIRECT, response_type: 'code', scope: ESCOPOS, state, enable_fb_login: '0', force_authentication: '1' }).forEach(([k, v]) => u.searchParams.set(k, v));
      return res.json({ url: u.toString() });
    }
    if (b.acao === 'sair') { await dbSet('ig_conta', null); return res.json({ ok: 1 }); }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
