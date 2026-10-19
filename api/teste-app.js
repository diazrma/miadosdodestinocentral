// Story diário do teste do app (12h de Brasília): rodízio das 8 telas da Play Store (teste-app/story_NN.jpg), uma por dia,
// sem repetir até passar por todas. A chamada "Responda APP" aciona a automação "Story pede o app".
// GET  /api/teste-app             -> agendado (Vercel Cron); uma vez por dia; desliga com recursos.postTesteApp = false
// POST /api/teste-app { acao: 'agora' } -> equipe (menu Publicar): publica o de hoje fora do horário
const { auth, dbGet, dbSet } = require('../lib/db');
const path = require('path');
process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || path.join(__dirname, '..', 'fonts');  // fontes do texto (a Vercel não tem)
const sharp = require('sharp');
const { put, del } = require('@vercel/blob');
const { cred } = require('../lib/blob');
const { publicarIG } = require('../lib/ig-post');
const { bandeiraBR, bandeiraUS, linhaComBandeira } = require('../lib/bandeiras');

// telas, na ordem do rodízio (para os avisos e o registro)
const POSTS = ['Destino', 'Chuva de notas', 'Sussurro do dia', 'Quiz', 'Papéis de parede', 'Enigma', 'Gazeta do Destino', 'Elenco'];
// chamada escrita por cima da tela; 7 frases x 8 telas: a mesma combinação só volta depois de 56 dias
const CHAMADAS = [
  'Responda APP que eu te mando o link',
  'Quer testar antes de todo mundo? Responda APP',
  'É grátis: responda APP e receba o convite',
  'Responda APP e entre no teste em 2 minutinhos',
  'Os gatos te esperam no app. Responda APP',
  'Ajude a lançar o app: responda APP',
  'Responda APP e ganhe acesso ao teste'
];
const esc = t => String(t).replace(/[&<>']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;' })[c]);
async function arte(i, frase) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    ${linhaComBandeira(bandeiraBR, frase, 1770, { bold: true })}
    ${linhaComBandeira(bandeiraUS, "Reply APP and I'll send you the link", 1824, { bold: true })}
    <text x="540" y="1878" text-anchor="middle" font-family="DejaVu Sans" font-size="34" fill="#e2b23e">ou pegue no link da bio · or tap the link in bio</text></svg>`;
  return sharp(path.join(__dirname, '..', 'teste-app', `story_${String(i + 1).padStart(2, '0')}.jpg`))
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
}
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const doDia = data => Math.floor(new Date(data + 'T12:00:00Z').getTime() / 864e5) % POSTS.length;

async function postar(por, req) {
  const data = hojeBR(), ult = await dbGet('teste_app_post').catch(() => null);
  if (ult && ult.data === data) return { ...ult, repetido: true };
  const c = await dbGet('app_conteudo') || {};
  if (c.recursos && c.recursos.postTesteApp === false) return { desligado: true };
  const n = Math.floor(new Date(data + 'T12:00:00Z').getTime() / 864e5), i = doDia(data), frase = CHAMADAS[n % CHAMADAS.length];
  const av = require('../lib/avisos');
  let r;
  try {
    const blob = await put(`publicar/teste-app-${data}.jpg`, await arte(i, frase), { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, ...cred(req) });
    try { r = await publicarIG({ media_type: 'STORIES', image_url: blob.url }); } finally { await del(blob.url, cred(req)).catch(() => {}); }
  } catch (e) { await av.falhou('Story do teste do app', e).catch(() => {}); throw e; }
  await av.publicado(`Story do teste do app (${POSTS[i]})`, r).catch(() => {});
  const reg = { data, tela: POSTS[i], frase, ...r, por, quando: new Date().toISOString() };
  await dbSet('teste_app_post', reg);
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
    if ((req.body || {}).acao === 'agora') return res.json(await postar(a.u.nome, req));
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { POSTS, CHAMADAS, doDia, arte };
