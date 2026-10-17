// Post diário do teste do app (feed, 12h de Brasília): rodízio das 8 artes de teste-app/ (telas da Play Store),
// uma por dia, cada uma com a sua legenda. Quem comenta APP recebe o link pela automação "Comentou APP".
// GET  /api/teste-app             -> agendado (Vercel Cron); uma vez por dia; desliga com recursos.postTesteApp = false
// POST /api/teste-app { acao: 'agora' } -> equipe (menu Publicar): publica o de hoje fora do horário
const { auth, dbGet, dbSet } = require('../lib/db');
const { publicarIG } = require('../lib/ig-post');

const SITE = () => process.env.SITE_URL || 'https://' + (process.env.VERCEL_PROJECT_PRODUCTION_URL || 'miadosdodestinocentral.vercel.app');
const RODAPE = '\n\n📲 O app de Miados do Destino está em teste na Google Play: é grátis e leva 2 minutinhos pra entrar. Comente APP que a gente te manda o link no direct (ou pega no link da bio). Ficar 14 dias com ele ajuda a lançar pra todo mundo 💛\n\n#miadosdodestino #dorama #kdrama #gatos #app';
const POSTS = [
  'Os gatos sabem o seu destino 🐾 Sussurros, jogo, quiz e um enigma esperando por você no app.',
  'Toque a canção da Yoo Nari 🎻 No Chuva de notas, cada gota vira uma nota no violino. Qual é o seu recorde?',
  'Todo dia um gato escolhe você e deixa um recado lacrado 🔮 O envelope de hoje está no app.',
  'Qual gato do destino combina com você? 🐱 Faça o quiz no app e mostra o resultado nos Stories.',
  'O elenco na sua tela de bloqueio 📱 Papéis de parede da Yoo Nari, do Sr. Baek e dos gatos (e um secreto pra quem jogar).',
  'Revele o segredo à luz de vela 🕯️ Vire o desenho do Haneul e descubra o quinto gato.',
  'Tudo sobre a série em primeira mão 📰 A Gazeta do Destino traz notícias, vídeos e avisos de cada estreia.',
  'Yoo Nari, Sr. Baek e os gatos 🐾 Conheça quem vive essa história de chuva e destino.'
];
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const doDia = data => Math.floor(new Date(data + 'T12:00:00Z').getTime() / 864e5) % POSTS.length;

async function postar(por) {
  const data = hojeBR(), ult = await dbGet('teste_app_post').catch(() => null);
  if (ult && ult.data === data) return { ...ult, repetido: true };
  const c = await dbGet('app_conteudo') || {};
  if (c.recursos && c.recursos.postTesteApp === false) return { desligado: true };
  const i = doDia(data), arte = String(i + 1).padStart(2, '0');
  const r = await publicarIG({ image_url: `${SITE()}/teste-app/${arte}.jpg`, caption: POSTS[i] + RODAPE });
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
