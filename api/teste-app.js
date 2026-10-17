// Story diário do teste do app (12h de Brasília): rodízio das 8 telas da Play Store (teste-app/story_NN.jpg), uma por dia,
// sem repetir até passar por todas. A chamada "Responda APP" aciona a automação "Story pede o app".
// GET  /api/teste-app             -> agendado (Vercel Cron); uma vez por dia; desliga com recursos.postTesteApp = false
// POST /api/teste-app { acao: 'agora' } -> equipe (menu Publicar): publica o de hoje fora do horário
const { auth, dbGet, dbSet } = require('../lib/db');
const { publicarIG } = require('../lib/ig-post');

const SITE = () => process.env.SITE_URL || 'https://' + (process.env.VERCEL_PROJECT_PRODUCTION_URL || 'miadosdodestinocentral.vercel.app');
// telas, na ordem do rodízio (para os avisos e o registro)
const POSTS = ['Destino', 'Chuva de notas', 'Sussurro do dia', 'Quiz', 'Papéis de parede', 'Enigma', 'Gazeta do Destino', 'Elenco'];
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const doDia = data => Math.floor(new Date(data + 'T12:00:00Z').getTime() / 864e5) % POSTS.length;

async function postar(por) {
  const data = hojeBR(), ult = await dbGet('teste_app_post').catch(() => null);
  if (ult && ult.data === data) return { ...ult, repetido: true };
  const c = await dbGet('app_conteudo') || {};
  if (c.recursos && c.recursos.postTesteApp === false) return { desligado: true };
  const i = doDia(data), arte = 'story_' + String(i + 1).padStart(2, '0');
  const av = require('../lib/avisos');
  let r;
  try { r = await publicarIG({ media_type: 'STORIES', image_url: `${SITE()}/teste-app/${arte}.jpg` }); }
  catch (e) { await av.falhou('Story do teste do app', e).catch(() => {}); throw e; }
  await av.publicado(`Story do teste do app (${POSTS[i]})`, r).catch(() => {});
  const reg = { data, arte, ...r, por, quando: new Date().toISOString() };
  await dbSet('teste_app_post', reg);
  return reg;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      return res.json(await postar('Agendamento'));
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('publicar')) return res.status(403).json({ erro: 'Sem permissão para publicar' });
    if ((req.body || {}).acao === 'agora') return res.json(await postar(a.u.nome));
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { POSTS, doDia };
