// 🛒 Sincronização da loja oficial (Uma Penca) com a aba Loja da Central e a vitrine do site.
// GET  (Vercel Cron, Bearer CRON_SECRET)              -> lê a Uma Penca e atualiza a aba Loja
// POST { acao: 'sincronizar' } (equipe com menu Loja) -> o mesmo, pelo botão "Atualizar da Uma Penca"
// POST { acao: 'status' }      (equipe com menu Loja) -> resultado da última sincronização
const { auth, dbGet } = require('../lib/db');
const { sincronizar } = require('../lib/umapenca');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      // a Vercel manda "Authorization: Bearer <CRON_SECRET>" quando a variável existe
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      return res.json(await sincronizar('Robô da loja'));
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('loja')) return res.status(403).json({ erro: 'Sem permissão para o menu Loja' });
    const b = req.body || {};
    if (b.acao === 'sincronizar') return res.json(await sincronizar(a.u.nome));
    if (b.acao === 'status') return res.json({ sync: await dbGet('loja_sync') });
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
