// Uma única função da Vercel para todas as rotas /api/* (o plano Hobby aceita no máximo 12 funções por deploy).
// Cada rota continua no seu arquivo em rotas/, com a mesma URL de antes (/api/sussurro, /api/webhook, ...).
// Os require ficam escritos um a um para a Vercel saber quais arquivos empacotar.
const ROTAS = {
  app: () => require('../rotas/app'),
  auth: () => require('../rotas/auth'),
  backup: () => require('../rotas/backup'),
  bot: () => require('../rotas/bot'),
  conteudo: () => require('../rotas/conteudo'),
  cronograma: () => require('../rotas/cronograma'),
  gazeta: () => require('../rotas/gazeta'),
  ia: () => require('../rotas/ia'),
  instagram: () => require('../rotas/instagram'),
  jogo: () => require('../rotas/jogo'),
  loja: () => require('../rotas/loja'),
  meme: () => require('../rotas/meme'),
  'milka-cast': () => require('../rotas/milka-cast'),
  painel: () => require('../rotas/painel'),
  publicar: () => require('../rotas/publicar'),
  redes: () => require('../rotas/redes'),
  relay: () => require('../rotas/relay'),
  sussurro: () => require('../rotas/sussurro'),
  sync: () => require('../rotas/sync'),
  'teste-app': () => require('../rotas/teste-app'),
  upload: () => require('../rotas/upload'),
  varal: () => require('../rotas/varal'),
  webhook: () => require('../rotas/webhook'),
  youtube: () => require('../rotas/youtube'),
  zap: () => require('../rotas/zap')
};

/** Nome da rota: o parâmetro [rota] da Vercel ou, sem ele, o primeiro trecho depois de /api/. */
function nomeDaRota(req) {
  const q = req.query || {};
  if (typeof q.rota === 'string' && q.rota) return q.rota;
  return String(req.url || '').split('?')[0].replace(/^\/api\//, '').split('/')[0];
}

module.exports = async (req, res) => {
  const rota = ROTAS[nomeDaRota(req)];
  if (!rota) return res.status(404).json({ erro: 'Rota não encontrada' });
  if (req.query && typeof req.query.rota === 'string') delete req.query.rota;
  return rota()(req, res);
};
module.exports.ROTAS = ROTAS;
module.exports.nomeDaRota = nomeDaRota;
