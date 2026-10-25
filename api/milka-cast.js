// Milka Cast: a Milka "apresenta um podcast" todo sábado e domingo; sai às 17h como reel (no feed) e story.
// O vídeo é feito no GitHub Actions (.github/workflows/milka-cast.yml: voz edge-tts e ffmpeg, pasta milka-cast/).
// Aqui fica o que precisa do banco: escolher o tema sem nunca repetir, escrever o roteiro (Groq), receber o vídeo
// no Blob e publicar na hora. Sábado é curiosidade de gato; domingo é a série. Data comemorativa entra de leve.
//   POST { acao: 'roteiro' }                     (x-milka-cast: MILKA_CAST_SECRET) -> { ep, pronto } episódio do dia
//   POST type 'blob.generate-presigned-url'      (x-milka-cast)                    -> envio do vídeo direto ao Blob
//   POST { acao: 'pronto', numero, video_url }   (x-milka-cast)                    -> { ok } espera a hora de publicar
//   POST { acao: 'descartar', video_url }       (x-milka-cast)                    -> { ok } apaga o vídeo do teste do Actions
//   POST { acao: 'refazer' }                     (x-milka-cast)                    -> { ok } tira o episódio de hoje do histórico
//                                                     para sair de novo (o post errado é apagado à mão no app)
//   POST { acao: 'publicar' }                    (x-milka-cast)                    -> igual ao cron, mas na hora (usado no refazer)
//   GET ?post=1 (Vercel Cron sáb e dom 20h UTC = 17h, Bearer CRON_SECRET)          -> publica reel + story (e o Short no
//                                                     YouTube, se o canal estiver conectado em api/youtube.js), apaga o vídeo
const { handleUploadPresigned } = require('@vercel/blob/client');
const blob = require('@vercel/blob');
const B = { del: (...a) => blob.del(...a), token: (...a) => blob.issueSignedToken(...a), short: (...a) => yt.enviarShort(...a) }; // trocável nos testes
const { dbGet, dbSet } = require('../lib/db');
const { cred } = require('../lib/blob');
const igPost = require('../lib/ig-post');
const groq = require('../lib/groq');
const yt = require('../lib/yt');

const CHAVE = 'milka_cast'; // { historico: [{ numero, tema, titulo, data, reel, story }], fila: ep | null }
const TEMAS = {
  sabado: [
    'por que gatos ronronam', 'por que a gente amassa pãozinho', 'o mistério da caixa de papelão',
    'gatos tricolores quase sempre são fêmeas', 'por que dormimos tanto', 'o que significa piscar devagar',
    'por que derrubamos coisas da mesa', 'bigodes: o GPS dos gatos', 'por que adoramos lugares altos',
    'o que o rabo de um gato está dizendo', 'por que caímos de pé', 'o nariz de cada gato é único',
    'por que trazemos presentes para os humanos', 'a língua áspera e o banho de gato', 'por que miamos para humanos',
    'o terceiro olho: a pálpebra escondida', 'por que gostamos de sachê e água corrente', 'como enxergamos no escuro',
  ],
  domingo: [
    'a noite de chuva em que cheguei', 'o lugar em branco no desenho do Haneul', 'por que fico na porta do quarto',
    'meus irmãos de casa: Naru, Merlin, Spark e Zelda', 'o que é esperar alguém', 'domingo preguiçoso na casa',
    'coisas que a gente sente e não sabe dizer', 'o cheiro de casa', 'como escolhi meu lugar no sofá',
    'um recado para quem adotou um gato', 'o que a Yoo Nari me ensinou', 'o jeito calado do Sr. Baek',
    'o primeiro dia de sol depois da chuva', 'o que os gatos lembram', 'por que o destino junta a gente',
  ],
};
const PERSONA = `Você escreve falas da Milka, gata tricolor de olhos verdes da série "Miados do Destino" (dorama feito com IA).
Ela é a quinta gata da casa, chegou numa noite de chuva e foi achada pelo menino Haneul, que já tinha deixado
o lugar dela em branco no desenho. Ela costuma ficar na frente da porta do quarto do Haneul, como quem espera alguém.
Os outros gatos são Naru, Merlin, Spark e Zelda; os humanos são Yoo Nari e o Sr. Baek.
No Milka Cast ela fala direto com quem ouve, em primeira pessoa, como apresentadora de podcast:
acolhedora, curiosa, um pouco sapeca, com um toque de saudade. Português do Brasil, frases curtas e fáceis de falar.
O nome dela se escreve Milka (M-i-l-k-a), sempre, em português e em inglês: nunca traduza nem adapte (nada de Milky, Milk, Milma).
O mesmo vale para os outros nomes: Naru, Merlin, Spark, Zelda, Haneul, Yoo Nari, Sr. Baek (Mr. Baek em inglês) e Queijinho. Nada de emoji na fala. Nada de spoiler grande da série. Só fatos verdadeiros sobre gatos.`;

const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const diaSemana = d => new Date(d + 'T12:00:00Z').getUTCDay();
const tipoDoDia = d => diaSemana(d) === 0 ? 'domingo' : 'sabado';
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// datas que a Milka pode citar de leve; as móveis (Páscoa, Carnaval, Mães, Pais) são calculadas
const FIXAS = {
  '01-01': 'Ano Novo', '17-02': 'Dia do Gato no Brasil', '08-03': 'Dia Internacional da Mulher', '22-04': 'Dia da Terra',
  '01-05': 'Dia do Trabalho', '12-06': 'Dia dos Namorados', '24-06': 'Dia de São João', '20-07': 'Dia do Amigo',
  '26-07': 'Dia dos Avós', '08-08': 'Dia Internacional do Gato', '07-09': 'Independência do Brasil', '21-09': 'Dia da Árvore',
  '04-10': 'Dia Mundial dos Animais', '12-10': 'Dia das Crianças', '21-10': 'Dia do Podcast no Brasil',
  '29-10': 'Dia Nacional do Gato nos Estados Unidos', '31-10': 'Halloween', '02-11': 'Finados',
  '20-11': 'Dia da Consciência Negra', '24-12': 'Véspera de Natal', '25-12': 'Natal', '31-12': 'Réveillon',
};
function pascoa(ano) { // algoritmo de Meeus
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}
const segundoDomingo = (ano, mes) => { const p = new Date(Date.UTC(ano, mes, 1)).getUTCDay(); return 1 + ((7 - p) % 7) + 7; };
function comemorativa(d) {
  const [ano, mes, dia] = d.split('-').map(Number);
  const t = Date.UTC(ano, mes - 1, dia), p = pascoa(ano), D = 864e5;
  if (t === p) return 'Páscoa';
  if (t === p - 47 * D || t === p - 48 * D) return 'Carnaval';
  if (mes === 5 && dia === segundoDomingo(ano, 4)) return 'Dia das Mães';
  if (mes === 8 && dia === segundoDomingo(ano, 7)) return 'Dia dos Pais';
  return FIXAS[d.slice(8, 10) + '-' + d.slice(5, 7)] || null;
}

// primeiro tema da lista do dia que ainda não saiu; acabou a lista, a Groq inventa um novo (sem repetir)
function temaDaLista(tipo, historico) {
  const usados = new Set(historico.map(h => semAcento(h.tema)));
  return TEMAS[tipo].find(t => !usados.has(semAcento(t))) || null;
}
async function temaNovo(tipo, historico) {
  const usados = historico.map(h => h.tema);
  const pedido = tipo === 'sabado' ? 'uma curiosidade verdadeira sobre gatos' : 'um momento afetivo da Milka na casa da série';
  const { texto } = await groq.perguntar([{ role: 'system', content: PERSONA }, { role: 'user', content:
    `Sugira ${pedido} para o próximo Milka Cast. Não pode repetir nem parecer com estes: ${usados.join('; ')}. Responda só o tema, em até 8 palavras, sem aspas.` }], { temperatura: 0.9 });
  const t = texto.split('\n')[0].replace(/["“”.]/g, '').trim();
  if (!t || usados.some(u => semAcento(u) === semAcento(t))) throw new Error('A Groq repetiu um tema: ' + t);
  return t;
}

// as fixas primeiro; a Groq às vezes repete as mesmas com maiúscula (#MilkaCast), então compara em minúsculas
const hashtags = extras => ['#milkacast', '#miadosdodestino', '#milka', ...(extras || [])]
  .filter((t, i, a) => /^#\w/.test(t) && a.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 11);

// a Groq às vezes erra uma letra dos nomes (saiu "Milma" no episódio 2): palavra com maiúscula a uma letra de
// distância de um nome da série vira o nome certo. Nomes curtos (Naru, Baek, Nari, Spark) ficam de fora: dão falso positivo.
const NOMES = ['Milka', 'Merlin', 'Zelda', 'Haneul', 'Queijinho'];
const NAO_SAO_NOMES = new Set(['milk', 'mila', 'marlin']); // "Milky" não está aqui: em inglês também vira Milka
function umaLetra(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}
const nomeCerto = p => NAO_SAO_NOMES.has(p.toLowerCase()) ? null : NOMES.find(n => umaLetra(p.toLowerCase(), n.toLowerCase()));
// na hashtag o nome vem sozinho ou grudado no "cast" (#milmacast); outras (#zeldinha) não mexe
function hashtagCerta(corpo) {
  const [, nome, cast] = corpo.match(/^(.*?)(cast)?$/i);
  const certo = nomeCerto(nome);
  if (!certo) return corpo;
  return (nome[0] === nome[0].toUpperCase() ? certo : certo.toLowerCase()) + (cast || '');
}
const corrigirNomes = s => String(s || '').replace(/(#?)(\p{L}+)/gu, (tudo, h, p) => {
  if (h) return h + hashtagCerta(p);
  return p[0] === p[0].toUpperCase() && p[0] !== p[0].toLowerCase() ? nomeCerto(p) || p : p;
});

function json(texto) {
  const m = String(texto).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Roteiro sem JSON');
  return JSON.parse(m[0]);
}
async function escrever(ep, historico) {
  const data = ep.comemorativa ? `Hoje é ${ep.comemorativa}: pode citar isso em uma frase, mas o assunto principal continua sendo o tema.` : '';
  const ja = historico.slice(-20).map(h => h.titulo).join('; ');
  const { texto } = await groq.perguntar([{ role: 'system', content: PERSONA }, { role: 'user', content:
    `Episódio ${ep.numero} do Milka Cast (${ep.tipo === 'sabado' ? 'curiosidade de gato' : 'história da série'}). Tema: ${ep.tema}. ${data}
Episódios que já saíram (não repita o conteúdo): ${ja || 'nenhum'}.
Escreva entre 85 e 110 palavras de fala (uns 40 segundos). Comece com "Oi, aqui é a Milka, e este é o Milka Cast" ou uma variação,
${ep.tipo === 'sabado' ? 'explique o tema com um fato verdadeiro e simples e ligue com a vida dela na casa' : 'conte o momento como lembrança dela, com carinho'},
e termine chamando para o próximo fim de semana.
Responda só JSON: {"titulo": "...", "fala": "...", "legenda": "legenda do post em PT, 2 a 3 frases, pode ter 1 ou 2 emojis",
"legenda_en": "a mesma legenda em inglês, com os nomes iguais (Milka continua Milka)", "hashtags": ["#...", até 8]}` }], { temperatura: 0.8 });
  const r = json(texto);
  if (!r.titulo || !r.fala || !r.legenda) throw new Error('Roteiro incompleto');
  const tags = hashtags((r.hashtags || []).map(corrigirNomes));
  return { ...ep, titulo: corrigirNomes(r.titulo), fala: corrigirNomes(r.fala), legenda: corrigirNomes(r.legenda),
    legenda_en: corrigirNomes(r.legenda_en || ''), hashtags: tags };
}

const legenda = ep => `🎙️ Milka Cast #${String(ep.numero).padStart(2, '0')} · ${ep.titulo}\n\n🇧🇷${ep.legenda}\n\n` +
  (ep.legenda_en ? `🇺🇸${ep.legenda_en}\n\n` : '') + ep.hashtags.join(' ');

const estado = async () => ({ historico: [], fila: null, ...(await dbGet(CHAVE) || {}) });

async function roteiro() {
  const st = await estado(), data = hojeBR();
  if (![0, 6].includes(diaSemana(data))) return { code: 400, erro: 'O Milka Cast só sai no sábado e no domingo' };
  if (st.historico.some(h => h.data === data)) return { code: 409, erro: 'O episódio de hoje já saiu' };
  // o Actions rodou de novo: mesmo roteiro e mesmo número; se o vídeo já chegou, não precisa refazer
  if (st.fila && st.fila.data === data) return { ep: st.fila, pronto: st.fila.estado === 'pronto' };
  const tipo = tipoDoDia(data);
  const numero = Math.max(0, ...st.historico.map(h => h.numero)) + 1;
  const tema = temaDaLista(tipo, st.historico) || await temaNovo(tipo, st.historico);
  const ep = await escrever({ numero, data, tipo, tema, comemorativa: comemorativa(data) }, st.historico);
  await dbSet(CHAVE, { ...st, fila: { ...ep, estado: 'roteiro' } });
  return { ep };
}

async function pronto(b) {
  const st = await estado();
  if (!st.fila || st.fila.numero !== Number(b.numero)) return { code: 409, erro: 'Esse episódio não está na fila' };
  if (!/^https:\/\/[\w.-]+\.blob\.vercel-storage\.com\/milka-cast\//.test(String(b.video_url || ''))) return { code: 400, erro: 'Vídeo inválido' };
  await dbSet(CHAVE, { ...st, fila: { ...st.fila, video_url: b.video_url, estado: 'pronto' } });
  return { ok: 1 };
}

// teste do Actions (workflow_dispatch com teste): o vídeo sobe com nome teste-... e é apagado em seguida
async function descartar(req, b) {
  if (!/^https:\/\/[\w.-]+\.blob\.vercel-storage\.com\/milka-cast\/teste-/.test(String(b.video_url || ''))) return { code: 400, erro: 'Só apaga vídeo de teste' };
  await B.del(b.video_url, cred(req));
  return { ok: 1 };
}

// episódio de hoje saiu errado: guarda o registro em "refeitos" e libera o dia para sair de novo com o mesmo número
async function refazer() {
  const st = await estado(), data = hojeBR();
  const velho = st.historico.find(h => h.data === data);
  if (!velho && !st.fila) return { code: 409, erro: 'Não tem episódio de hoje para refazer' };
  await dbSet(CHAVE, { ...st, historico: st.historico.filter(h => h.data !== data), fila: null,
    refeitos: [...(st.refeitos || []), { ...(velho || st.fila), refeito_em: new Date().toISOString() }] });
  return { ok: 1, numero: velho ? velho.numero : st.fila.numero };
}

async function publicar(req) {
  const st = await estado(), ep = st.fila, data = hojeBR();
  if (!ep || ep.estado !== 'pronto' || ep.data !== data) return { nada: true, data, fila: ep && ep.estado };
  // o reel vai primeiro e fica gravado: se o story falhar, uma nova chamada não posta o reel de novo
  if (!ep.reel) {
    ep.reel = (await igPost.publicarIG({ media_type: 'REELS', video_url: ep.video_url, caption: legenda(ep), share_to_feed: 'true', thumb_offset: '16000' })).link || 'ok';
    await dbSet(CHAVE, { ...st, fila: ep });
  }
  let erro = null;
  try { ep.story = (await igPost.publicarIG({ media_type: 'STORIES', video_url: ep.video_url })).id; }
  catch (e) { erro = e.message; }
  if (erro) { await dbSet(CHAVE, { ...st, fila: ep }); return { reel: ep.reel, erro: 'Story: ' + erro }; }
  // YouTube Shorts: só quando o canal está conectado na aba Conexões; se falhar, o Instagram já saiu e fica registrado
  let youtube = null, ytErro = null;
  try {
    youtube = await B.short({ video_url: ep.video_url, titulo: `Milka Cast #${String(ep.numero).padStart(2, '0')} · ${ep.titulo}`,
      descricao: legenda(ep), tags: ep.hashtags });
  } catch (e) { ytErro = e.message; }
  await B.del(ep.video_url, cred(req)).catch(() => {}); // o Instagram (e o YouTube) já copiaram o vídeo
  const { numero, tema, titulo, tipo, reel, story } = ep;
  const reg = { numero, tema, titulo, tipo, data, reel, story, ...(youtube ? { youtube: youtube.link } : {}), ...(ytErro ? { ytErro } : {}) };
  await dbSet(CHAVE, { historico: [...st.historico, reg], fila: null });
  return { reel, story, youtube: youtube && youtube.link, ...(ytErro ? { erro: 'YouTube: ' + ytErro } : {}) };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && (req.query || {}).post) {
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      return res.json(await publicar(req));
    }
    const seg = process.env.MILKA_CAST_SECRET;
    if (!seg || req.headers['x-milka-cast'] !== seg) return res.status(401).json({ erro: 'Não autorizado' });
    const b = req.body || {};
    if (b.type === 'blob.generate-presigned-url') {
      return res.json(await handleUploadPresigned({ body: b, request: req, webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || 'sem-callback', getSignedToken: async pathname => {
        if (!/^milka-cast\/[\w.-]+\.mp4$/.test(pathname)) throw new Error('Nome de arquivo inválido');
        const lim = { allowedContentTypes: ['video/mp4'], maximumSizeInBytes: 60 * 1024 * 1024 };
        return { token: await B.token({ pathname, operations: ['put'], validUntil: Date.now() + 3600e3, ...lim, ...cred(req) }), urlOptions: { ...lim, addRandomSuffix: true } };
      } }));
    }
    const acoes = { roteiro, pronto: () => pronto(b), descartar: () => descartar(req, b), refazer, publicar: () => publicar(req) };
    if (!acoes[b.acao]) return res.status(400).json({ erro: 'Ação desconhecida' });
    const { code, ...j } = await acoes[b.acao]();
    res.status(code || 200).json(j);
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { corrigirNomes, hashtags, comemorativa, pascoa, temaDaLista, tipoDoDia, legenda, json, TEMAS, B };
