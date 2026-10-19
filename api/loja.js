// 🛒 Sincronização da loja oficial (Uma Penca) com a aba Loja da Central e a vitrine do site.
// GET  (Vercel Cron, Bearer CRON_SECRET)              -> lê a Uma Penca e atualiza a aba Loja
// POST { acao: 'sincronizar' } (equipe com menu Loja) -> o mesmo, pelo botão "Atualizar da Uma Penca"
// POST { acao: 'status' }      (equipe com menu Loja) -> última sincronização, story do dia e se ele está ligado
// GET  ?story=1 (Vercel Cron, 15h de Brasília)        -> publica o story do produto do dia (1 por dia)
// POST { acao: 'story_agora' } / { acao: 'story_ligar', ligado } -> botão "Postar agora" e o liga/desliga
const { auth, dbGet, dbSet } = require('../lib/db');
const { sincronizar } = require('../lib/umapenca');
const story = require('../lib/loja-story');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      // a Vercel manda "Authorization: Bearer <CRON_SECRET>" quando a variável existe
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      if (req.query?.story) {
        // lê a loja antes, para o story nunca mostrar produto que saiu ou preço velho
        await sincronizar('Robô da loja').catch(() => {});
        try { return res.json(await story.storyDoDia({ req })); }
        catch (e) { await require('../lib/avisos').falhou('Story da loja', e).catch(() => {}); throw e; }
      }
      return res.json(await sincronizar('Robô da loja'));
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('loja')) return res.status(403).json({ erro: 'Sem permissão para o menu Loja' });
    const b = req.body || {};
    if (b.acao === 'sincronizar') return res.json(await sincronizar(a.u.nome));
    if (b.acao === 'status') return res.json({ sync: await dbGet('loja_sync'), story: (await dbGet('loja_story') || { dias: [] }).dias.slice(0, 7), storyLigado: (await story.config()).story });
    if (b.acao === 'story_agora') return res.json(await story.storyDoDia({ req, forcar: true, por: a.u.nome }));
    if (b.acao === 'story_ligar') { await dbSet('loja_cfg', { ...(await dbGet('loja_cfg')), story: !!b.ligado }); return res.json({ ok: 1, storyLigado: !!b.ligado }); }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
