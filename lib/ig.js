// Token do Instagram. Vem do botão "Conectar Instagram" (guardado no banco, entra no backup e se renova sozinho);
// se não houver conexão, usa o IG_TOKEN da Vercel, como antes.
const { dbGet, dbSet } = require('./db');
const RENOVAR = 7 * 864e5; // o token longo vale 60 dias; renova a cada 7
let memo = null;

async function igToken() {
  if (memo && memo.ate > Date.now()) return memo.token;
  const c = await dbGet('ig_conta').catch(() => null);
  if (!c || !c.token) return process.env.IG_TOKEN || null;
  if (Date.now() - (c.renovado || 0) > RENOVAR) {
    try {
      const j = await (await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(c.token))).json();
      if (j.access_token) Object.assign(c, { token: j.access_token, renovado: Date.now(), expira: Date.now() + (j.expires_in || 5184000) * 1000 });
      else c.erroRenovar = (j.error && j.error.message) || 'sem resposta';
      await dbSet('ig_conta', c);
    } catch (e) {}
  }
  memo = { token: c.token, ate: Date.now() + 60e3 };
  return c.token;
}

module.exports = { igToken };
