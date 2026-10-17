const { randomUUID } = require('crypto');
const { rd, PFX, dbGet, dbSet, hash, check, sign, mac, ROLES } = require('../lib/db');
const { emailSenha } = require('../lib/email');
// link de senha nova: assinado, vale 1 h e morre quando a senha muda (leva um pedaço do hash atual)
const HORA = 3600e3, marca = u => mac('h:' + u.hash).slice(0, 16);
const fichaSenha = u => { const p = Buffer.from(JSON.stringify({ id: u.id, exp: Date.now() + HORA, h: marca(u) })).toString('base64url'); return p + '.' + mac('senha:' + p); };
function abreFicha(t, us) {
  try {
    const [p, s] = String(t || '').split('.');
    if (!p || s !== mac('senha:' + p)) return null;
    const o = JSON.parse(Buffer.from(p, 'base64url')), u = us.find(x => x.id === o.id);
    return u && o.exp > Date.now() && o.h === marca(u) ? u : null;
  } catch (e) { return null; }
}
const SITE = () => process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://miadosdodestinocentral.vercel.app');
module.exports = async (req, res) => {
  try {
    if (!process.env.SESSION_SECRET) return res.status(500).json({ erro: 'SESSION_SECRET não configurado na Vercel' });
    if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) return res.status(500).json({ erro: 'Banco de dados (Upstash Redis) não conectado na Vercel' });
    const b = req.body || {}, us = await dbGet('users') || [];
    if (b.acao === 'estado') return res.json({ setup: !us.length });
    const email = String(b.email || '').trim().toLowerCase();
    if (b.acao === 'setup') {
      if (us.length) return res.status(403).json({ erro: 'Já existe administrador' });
      if (!b.nome || !email || String(b.senha || '').length < 8) return res.status(400).json({ erro: 'Preencha nome, e-mail e senha (mín. 8 caracteres)' });
      const st = await dbGet('state') || {}; st.roles = ROLES; await dbSet('state', st);
      const u = { id: randomUUID(), nome: b.nome.trim(), email, funcao: 'Administrador', role: 'admin', meta: 0, foto: '', hash: hash(b.senha) };
      await dbSet('users', [u]);
      return res.json({ token: sign(u.id) });
    }
    if (b.acao === 'login') {
      const u = us.find(x => x.email === email);
      if (!u || !check(String(b.senha || ''), u.hash)) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
      return res.json({ token: sign(u.id) });
    }
    if (b.acao === 'esqueci') {
      // resposta igual exista ou não o e-mail, para ninguém descobrir quem tem conta; 1 pedido por minuto por e-mail
      const u = us.find(x => x.email === email);
      if (u && await rd(['SET', PFX + 'senha:' + email, '1', 'NX', 'EX', 60])) {
        const r = await emailSenha(u.email, u.nome.split(' ')[0], SITE() + '/?senha=' + fichaSenha(u));
        if (r.erro) return res.status(500).json({ erro: r.erro });
      }
      return res.json({ ok: 1 });
    }
    if (b.acao === 'redefinir') {
      const u = abreFicha(b.ficha, us);
      if (!u) return res.status(400).json({ erro: 'Link vencido ou já usado. Peça outro em "Esqueci minha senha".' });
      if (String(b.senha || '').length < 8) return res.status(400).json({ erro: 'Senha com no mínimo 8 caracteres' });
      u.hash = hash(String(b.senha));
      await dbSet('users', us);
      return res.json({ token: sign(u.id) });
    }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
