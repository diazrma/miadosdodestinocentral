// 🔴 Fio Vermelho do Destino (lib/destino.js): story de sábado e de domingo (18h de Brasília) com os cinco gatos.
// Antes de postar, garante a automação "🔴 Fio Vermelho do Destino" (DESTINO → guardião + profecia no direct).
// GET  /api/destino                          -> agendado (Vercel Cron); só sábado e domingo, uma vez por dia; desliga com recursos.destinoStory = false
// POST /api/destino { acao: 'agora' }        -> equipe (menu Publicar): publica o de hoje (fora do fim de semana, usa a arte de sábado)
// POST /api/destino { acao: 'previa' }       -> devolve a arte de hoje em base64, sem publicar
const { auth, dbGet, dbSet } = require('../lib/db');
const { put, del } = require('@vercel/blob');
const { cred } = require('../lib/blob');
const { publicarIG } = require('../lib/ig-post');
const D = require('../lib/destino');

const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const tipoDeHoje = () => (new Date(Date.now() - 3 * 3600e3).getUTCDay() === 0 ? 'domingo' : 'sabado');

async function postar(por, req, { forcar = false } = {}) {
  if (!forcar && !D.semana()) return { foraDoFimDeSemana: true };
  const data = hojeBR(), ult = await dbGet('destino_story').catch(() => null);
  if (ult && ult.data === data) return { ...ult, repetido: true };
  const c = await dbGet('app_conteudo') || {};
  if (!forcar && c.recursos && c.recursos.destinoStory === false) return { desligado: true };
  await D.garantirAutomacao();
  const tipo = tipoDeHoje(), av = require('../lib/avisos');
  let r;
  try {
    const blob = await put(`publicar/destino-${data}.jpg`, await D.arte(tipo), { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, ...cred(req) });
    try { r = await publicarIG({ media_type: 'STORIES', image_url: blob.url }); } finally { await del(blob.url, cred(req)).catch(() => {}); }
  } catch (e) { await av.falhou('Story do Fio Vermelho', e).catch(() => {}); throw e; }
  await av.publicado(`Story do Fio Vermelho (${tipo})`, r).catch(() => {});
  const reg = { data, tipo, ...r, por, quando: new Date().toISOString() };
  await dbSet('destino_story', reg);
  return reg;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      return res.json(await postar('Agendamento', req));
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('publicar')) return res.status(403).json({ erro: 'Sem permissão para publicar' });
    const acao = (req.body || {}).acao;
    if (acao === 'agora') return res.json(await postar(a.u.nome, req, { forcar: true }));
    if (acao === 'previa') return res.json({ tipo: tipoDeHoje(), jpg: (await D.arte(tipoDeHoje())).toString('base64') });
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { postar, tipoDeHoje };
