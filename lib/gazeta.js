// Gazeta do Destino diária: a cada manhã a Central monta uma edição nova com o que está acontecendo na série
// (episódios, post do Instagram, loja, vídeos), escrita pela IA (Groq). Sem IA, monta a edição com textos prontos.
// Toda edição fica guardada no arquivo (uma chave por edição, nunca sobrescrita): ver arquivar().
const { dbGet, dbSet } = require('./db');

const SITE = 'https://miados-do-destino.vercel.app';
const FOTOS = [
  { img: SITE + '/video/noiva-pb-poster.jpg', legenda: 'Yoo Nari, a protagonista, em cena da série.' },
  { img: SITE + '/video/hero-trailer-poster.jpg', legenda: 'Cena do trailer oficial de Miados do Destino.' },
  { img: SITE + '/video/cena-cozinha-poster.jpg', legenda: 'A cozinha da casa, onde a Naru senta na cadeira dela.' }
];
const STATUS = { producao: 'em produção', breve: 'em breve', lancado: 'no ar' };
const hojeBR = (now = Date.now()) => new Date(now - 3 * 3600e3).toISOString().slice(0, 10);
const diaN = d => Math.floor(new Date(d + 'T12:00:00Z').getTime() / 864e5);
const dataLonga = d => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const txt = (v, n) => String(v ?? '').replace(/\s+\n/g, '\n').trim().slice(0, n);
const numDe = ed => +(String(ed || '').match(/(\d+)/) || [0, 0])[1];
const nn = n => String(n).padStart(2, '0');

// a Milka é o segredo do enigma: enquanto não for revelado, nada de quinta gata na Gazeta
const vazaSegredo = (t, revelado) => !revelado && /milka|quinta gata|quinto gato|gata tricolor/i.test(t);

// episódios sempre na Gazeta: a matéria da temporada sai em toda edição, com o status de cada um
function materiaTemporada(temporada) {
  const eps = (temporada || []).filter(e => e && e.titulo);
  if (!eps.length) return null;
  const prox = eps.find(e => e.status !== 'lancado'), no = eps.filter(e => e.status === 'lancado');
  const lista = eps.map(e => `Ep. ${e.n} · ${e.titulo}: ${e.status === 'breve' && e.data ? 'estreia em ' + dataLonga(e.data) : STATUS[e.status] || 'em produção'}`).join('\n');
  return {
    kicker: 'Temporada 1',
    titulo: no.length ? `${no.length} de ${eps.length} episódios já no ar` : `Os ${eps.length} episódios da temporada`,
    texto: (prox ? `Próximo: Ep. ${prox.n}, “${prox.titulo}”. ${prox.sinopse || ''}`.trim() + '\n\n' : '') + lista,
    link: '', linkTxt: ''
  };
}

// os fatos do dia que a IA pode usar (nada inventado fora disto)
function fatos({ conteudo = {}, posts = [], loja = null, data }) {
  const revelado = !!conteudo.enigma?.revelado;
  const eps = (conteudo.temporada || []).map(e => `Ep. ${e.n} "${e.titulo}" (${STATUS[e.status] || 'em produção'}${e.data ? ', estreia ' + e.data : ''}): ${e.sinopse || ''}`);
  const post = posts && posts[0];
  const prods = (loja && loja.produtos || []).filter(p => !p.esgotado).slice(0, 3).map(p => p.nome).filter(Boolean);
  const vids = (conteudo.videos || []).map(v => `${v.tipo}: ${v.titulo}`);
  return [
    `Data de hoje: ${dataLonga(data)}.`,
    'Série: "Miados do Destino", dorama feito com inteligência artificial. Yoo Nari, violinista; Sr. Baek, o marido cheio de segredos; Haneul, o menino que desenhou a casa com cinco gatos; gatos Naru (frajola), Merlin (rajado cinza), Zelda (escaminha) e Spark (siamês). Lema: "O destino não grita. Ele sussurra."',
    'Episódios:\n' + (eps.join('\n') || '(nenhum cadastrado)'),
    post ? `Post mais recente do Instagram @miadosdodestino (${String(post.data || '').slice(0, 10)}): ${txt(post.legenda, 400)}` : '',
    prods.length ? 'Produtos na loja oficial: ' + prods.join(', ') + '.' : '',
    vids.length ? 'Vídeos no app: ' + vids.join('; ') + '.' : '',
    revelado ? 'O enigma do desenho foi revelado: a quinta gata é a Milka, tricolor de olhos verdes.' : 'Enigma: no desenho de Haneul há cinco gatos e só quatro estão pintados. NUNCA diga quem é o quinto.'
  ].filter(Boolean).join('\n\n');
}

function lerJSON(t) {
  const m = String(t || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// sem IA (ou se ela errar): uma pauta pronta que gira por dia, mais a matéria da temporada
const PAUTAS = [
  { kicker: 'Enigma', titulo: 'O desenho de Haneul ainda guarda um segredo', linha: 'Cinco gatos, quatro pintados. A Gazeta segue de olho no quinto.', texto: 'Uma casa, três pessoas e cinco gatos. Quatro já ganharam cor no desenho de Haneul. O quinto continua esperando.\n\nQuem resolver o enigma no site vê primeiro.' },
  { kicker: 'Bastidores', titulo: 'A chuva continua caindo na casa de Yoo Nari', linha: 'Os episódios seguem em produção, cena por cena.', texto: 'Cada cena de Miados do Destino é escolhida, cortada e reescrita até soar verdadeira.\n\nAtive o lembrete dos episódios na aba Temporada para saber primeiro.' },
  { kicker: 'Elenco felino', titulo: 'Naru, Merlin, Zelda e Spark seguem vigiando a casa', linha: 'Os gatos da série parecem saber mais do que mostram.', texto: 'A Naru senta na cadeira de Yoo Nari, o Merlin traz coisas na boca, a Zelda vigia o telhado e o Spark observa calado.\n\nFaça o quiz no app e descubra qual gato é você.' },
  { kicker: 'Sussurro do dia', titulo: 'Todo dia um gato deixa um recado no app', linha: 'O envelope de hoje já está esperando na aba Destino.', texto: 'O destino não grita. Ele sussurra. E todo dia um dos gatos da série deixa um recado curto para quem abre o app.\n\nLigue o aviso do Sussurro nos Ajustes para não perder nenhum.' }
];

async function montar({ conteudo = {}, posts = [], loja = null, now = Date.now(), numero, perguntar = require('./groq').perguntar } = {}) {
  const data = hojeBR(now), revelado = !!conteudo.enigma?.revelado, rec = conteudo.recursos || {};
  const foto = FOTOS[diaN(data) % FOTOS.length];
  const temporada = materiaTemporada(conteudo.temporada);
  const insta = { kicker: 'Instagram', titulo: 'Siga a série no Instagram', texto: 'Bastidores, teasers e novidades saem primeiro no @miadosdodestino.', link: 'https://www.instagram.com/miadosdodestino/', linkTxt: 'Seguir no Instagram' };
  let manchete = null, materias = [], origem = 'pronta', modelo = '';
  if (rec.gazetaIA !== false && process.env.GROQ_API_KEY) {
    try {
      const r = await perguntar([
        { role: 'system', content: 'Você é o editor da "Gazeta do Destino", o jornal dentro do app da série "Miados do Destino". Escreva a edição de hoje em português do Brasil, com tom de jornal de cidade pequena e chuvosa: acolhedor, um pouco misterioso, frases curtas. Use SOMENTE os fatos dados: não invente datas, episódios lançados, prêmios, números nem acontecimentos. Sem emojis e sem hashtags. ' + (revelado ? '' : 'Nunca mencione uma quinta gata, gata tricolor nem a Milka. ') + 'Responda só com um JSON: {"manchete":{"kicker":"até 20 caracteres","titulo":"até 90","linha":"até 160","texto":"2 parágrafos separados por linha em branco, até 600 caracteres"},"materias":[{"kicker":"","titulo":"","texto":"até 220"},{"kicker":"","titulo":"","texto":""}]}' },
        { role: 'user', content: fatos({ conteudo, posts, loja, data }) + '\n\nNão repita a manchete de ontem: ' + (conteudo.gazeta?.manchete?.titulo || '(nenhuma)') }
      ], { temperatura: 0.8 });
      const j = lerJSON(r.texto), m = j && j.manchete;
      if (m && m.titulo && m.texto && !vazaSegredo(JSON.stringify(j), revelado)) {
        manchete = { kicker: txt(m.kicker, 24), titulo: txt(m.titulo, 110), linha: txt(m.linha, 200), texto: txt(m.texto, 900) };
        materias = (Array.isArray(j.materias) ? j.materias : []).filter(x => x && x.titulo && x.texto).slice(0, 2)
          .map(x => ({ kicker: txt(x.kicker, 24), titulo: txt(x.titulo, 110), texto: txt(x.texto, 320), link: '', linkTxt: '' }));
        origem = 'ia'; modelo = r.model || '';
      }
    } catch (e) { manchete = null; }
  }
  if (!manchete) {
    const p = PAUTAS[diaN(data) % PAUTAS.length];
    manchete = { kicker: p.kicker, titulo: p.titulo, linha: p.linha, texto: p.texto };
    materias = PAUTAS.filter(x => x !== p).slice(0, 1).map(x => ({ kicker: x.kicker, titulo: x.titulo, texto: x.texto.split('\n')[0], link: '', linkTxt: '' }));
  }
  return {
    edicao: `Edição nº ${nn(numero)} · ${data.slice(8, 10)}/${data.slice(5, 7)}`,
    manchete: { ...manchete, img: foto.img, legenda: foto.legenda },
    materias: [...(temporada ? [temporada] : []), ...materias, insta],
    data, numero, origem, modelo
  };
}

// ---------- arquivo: índice leve em gazeta_edicoes e cada edição inteira na sua própria chave
// (gazeta_ed:<id>); nada é apagado nem sobrescrito, nem quando a equipe gera de novo no mesmo dia
async function arquivar(g, { origem = g.origem || 'painel', por = '' } = {}) {
  const lista = await dbGet('gazeta_edicoes') || [];
  const id = (g.data || hojeBR()) + '-' + Date.now().toString(36) + require('crypto').randomBytes(3).toString('hex');
  const ed = { id, data: g.data || hojeBR(), numero: g.numero || numDe(g.edicao), edicao: g.edicao, manchete: g.manchete, materias: g.materias, origem, por, quando: new Date().toISOString() };
  await dbSet('gazeta_ed:' + id, ed);
  lista.push({ id, data: ed.data, numero: ed.numero, edicao: ed.edicao, titulo: ed.manchete?.titulo || '', origem, por, quando: ed.quando });
  await dbSet('gazeta_edicoes', lista);
  return ed;
}
const edicoes = async () => await dbGet('gazeta_edicoes') || [];
const edicao = id => dbGet('gazeta_ed:' + String(id).replace(/[^\w-]/g, ''));

// próximo número: segue o maior entre o arquivo e a edição que está na capa
async function proximoNumero(atual) {
  const l = await edicoes();
  return Math.max(numDe(atual?.edicao), ...l.map(x => +x.numero || 0), 0) + 1;
}

module.exports = { FOTOS, hojeBR, dataLonga, numDe, vazaSegredo, materiaTemporada, fatos, montar, arquivar, edicoes, edicao, proximoNumero };
