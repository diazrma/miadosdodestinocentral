const { randomUUID } = require('crypto');
const { dbGet, dbSet, hash, check, sign, ROLES } = require('../lib/db');
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
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
