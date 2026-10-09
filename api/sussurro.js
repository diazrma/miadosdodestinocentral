// Sussurro do dia: um gato por dia deixa um recado no app, escrito pela IA da Central (Groq).
// GET  /api/sussurro                      -> agendado (Vercel Cron, 9h de Brasília): gera o de hoje e avisa quem quer receber
// POST /api/sussurro { acao: 'gerar' }     -> equipe (menu App): gera de novo o de hoje
//      { acao: 'notificar' }               -> envia agora a notificação do sussurro de hoje
//      { acao: 'historico' }               -> últimos sussurros
// Sem GROQ_API_KEY (ou com a IA desligada no painel), usa a lista de frases da Central.
const { auth, dbGet, dbSet } = require('../lib/db');
const { enviarPush } = require('../lib/fcm');
const { perguntar } = require('../lib/groq');

const GATOS = {
  naru: 'Naru, gata frajola de olhos amarelos. Apareceu na janela do hospital na noite em que Haneul nasceu; senta muito ereta na cadeira de Yoo Nari e lembra de coisas que um gato não deveria lembrar. Fala com ternura e intuição.',
  merlin: 'Merlin, gato rajado cinza que mora no templo abandonado da colina. Sempre traz algo na boca (um sininho de bronze, uma chave de ferro) e espera que a pessoa entenda. Fala como um guia paciente.',
  zelda: 'Zelda, gata escaminha de olhos âmbar, sentinela no telhado do galpão. Pressente o perigo um segundo antes. Fala com calma estratégica e cuidado.',
  spark: 'Spark, siamês de olhos azuis cujo nome está numa fotografia antiga. Observa em silêncio e sabe mais do que mostra. Fala pouco, com mistério.',
  milka: 'Milka, gata tricolor de olhos verdes que chegou filhote numa noite de chuva. Meiga, caseira, gulosa e companheira: fala de colo, de casa, de comida quentinha e de ficar perto de quem a gente ama.'
};
const NOMES = { naru: 'Naru', merlin: 'Merlin', zelda: 'Zelda', spark: 'Spark', milka: 'Milka' };
const RESERVA = [
  ['naru', 'Nem toda porta fechada é um fim. Algumas só esperam a chuva passar.'],
  ['merlin', 'Leve hoje o que parece pequeno. Amanhã você vai entender por quê.'],
  ['zelda', 'Olhe duas vezes antes de atravessar a água. A segunda olhada é a que salva.'],
  ['spark', 'Quem observa em silêncio ouve o que os outros não dizem.']
];
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const diaN = d => Math.floor(new Date(d + 'T12:00:00Z').getTime() / 864e5);
const limpar = t => String(t || '').replace(/^[\s"“”'«»—-]+|[\s"“”'«»]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 170);

async function gerar(forcar) {
  const data = hojeBR(), atual = await dbGet('sussurro_dia').catch(() => null);
  if (atual && atual.data === data && !forcar) return { s: atual, novo: false };
  const c = await dbGet('app_conteudo') || {}, rec = c.recursos || {};
  const revelado = !!(c.enigma && c.enigma.revelado);
  const gatos = ['naru', 'merlin', 'zelda', 'spark', ...(revelado ? ['milka'] : [])];
  const gato = gatos[(diaN(data) + (forcar ? Date.now() % gatos.length : 0)) % gatos.length];
  const hist = await dbGet('sussurro_hist') || [];
  let texto = '', origem = 'lista', modelo = '';
  if (rec.sussurroIA !== false && process.env.GROQ_API_KEY) {
    try {
      const recentes = hist.slice(-12).map(h => '- ' + h.texto).join('\n') || '(nenhum)';
      const r = await perguntar([
        { role: 'system', content: 'Você escreve o "Sussurro do dia" do app da série "Miados do Destino", um dorama sobre uma violinista (Yoo Nari), um marido cheio de segredos (Sr. Baek), chuva, promessas e gatos que parecem saber demais. O lema da série é "O destino não grita. Ele sussurra." Escreva UM recado curto que o gato do dia deixa para quem abre o app: português do Brasil, segunda pessoa (você), poético, acolhedor e um pouco misterioso, como um conselho para o dia. Regras: no máximo 140 caracteres; uma ou duas frases; sem emojis, sem aspas, sem hashtags, sem citar o nome do gato; não conte segredos da história' + (revelado ? '' : '; nunca mencione uma quinta gata nem a Milka') + '. Responda só com o texto do recado.' },
        { role: 'user', content: `Gato do dia: ${GATOS[gato]}\nNão repita nem imite de perto estes recados recentes:\n${recentes}` }
      ], { temperatura: 0.95 });
      texto = limpar(r.texto); modelo = r.model;
      if (texto.length >= 20 && !(/milka|quinta gata/i.test(texto) && !revelado)) origem = 'ia'; else texto = '';
    } catch (e) { texto = ''; }
  }
  if (!texto) {
    const lista = (c.sussurros && c.sussurros.length ? c.sussurros.map(x => [x.gato, x.texto]) : RESERVA).filter(([g]) => g !== 'milka' || revelado);
    const [g2, t2] = lista[diaN(data) % lista.length];
    return salvar({ data, gato: g2, texto: t2, origem, modelo, notificado: false }, hist);
  }
  return salvar({ data, gato, texto, origem, modelo, notificado: false }, hist);
}
async function salvar(s, hist) {
  await dbSet('sussurro_dia', s);
  await dbSet('sussurro_hist', [...hist.filter(h => h.data !== s.data), { data: s.data, gato: s.gato, texto: s.texto, origem: s.origem }].slice(-60));
  return { s, novo: true };
}
async function notificar(s, por) {
  const c = await dbGet('app_conteudo') || {};
  if (c.recursos && (c.recursos.sussurro === false || c.recursos.sussurroAviso === false)) return null;
  const titulo = `🔮 ${NOMES[s.gato] || 'Um gato'} deixou um sussurro para você`, texto = 'Abra o envelope de hoje no app Miados do Destino.';
  const id = await enviarPush({ titulo, texto, topico: 'sussurro', dados: { tela: 'sussurro' } });
  await dbSet('sussurro_dia', { ...s, notificado: true });
  const log = (await dbGet('push_log') || []).slice(-49);
  log.push({ quando: new Date().toISOString(), por, titulo, texto, destino: 'Sussurro do dia (automático)', id });
  await dbSet('push_log', log);
  return id;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      // a Vercel manda "Authorization: Bearer <CRON_SECRET>" quando a variável existe
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      const { s, novo } = await gerar(false);
      let aviso = null;
      if (!s.notificado) aviso = await notificar(s, 'Agendamento').catch(e => 'erro: ' + e.message);
      return res.json({ ok: 1, novo, data: s.data, gato: s.gato, origem: s.origem, aviso });
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('app')) return res.status(403).json({ erro: 'Sem permissão para o menu App' });
    const b = req.body || {};
    if (b.acao === 'historico') return res.json({ hoje: await dbGet('sussurro_dia'), lista: (await dbGet('sussurro_hist') || []).slice().reverse() });
    if (b.acao === 'gerar') { const { s } = await gerar(true); return res.json({ hoje: s }); }
    if (b.acao === 'notificar') {
      const s = await dbGet('sussurro_dia');
      if (!s || s.data !== hojeBR()) return res.status(400).json({ erro: 'Ainda não há sussurro de hoje. Gere primeiro.' });
      return res.json({ id: await notificar(s, a.u.nome) });
    }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
