// 🔴 Fio Vermelho do Destino: ritual de fim de semana do Instagram.
// Sábado e domingo sai um story com os cinco gatos ligados pelo fio vermelho ("Responda DESTINO").
// Quem responde recebe no direct o guardião da semana (um dos cinco, sempre o mesmo para a pessoa naquele fim de semana)
// e uma profecia escrita pela IA na voz desse gato. Durante a semana o fio "fica quieto" e o bot avisa para voltar sábado.
const path = require('path');
process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || path.join(__dirname, '..', 'fonts');
const crypto = require('crypto');
const { dbGet, dbSet } = require('./db');

const ORDEM = ['naru', 'merlin', 'zelda', 'spark', 'milka'];
const NOMES = { naru: 'Naru', merlin: 'Merlin', zelda: 'Zelda', spark: 'Spark', milka: 'Milka' };
const GATAS = new Set(['naru', 'zelda', 'milka']);
const guarda = g => (GATAS.has(g) ? 'a guardiã' : 'o guardião');
// a imagem de cada um (a IA mistura todas se receber a lista inteira)
const IMAGEM = { naru: 'uma janela acesa à noite', merlin: 'um objeto pequeno deixado no caminho (sininho, chave, bilhete)', zelda: 'um telhado e um perigo pressentido um segundo antes',
  spark: 'uma fotografia antiga', milka: 'colo, casa e comida quentinha' };
const AUTO_ID = 'fiovermelho';
const PALAVRAS = ['destino', 'fio vermelho', 'destiny'];
const RESERVA = {
  naru: 'Tem alguém pensando em você numa janela acesa. Nesta semana, mande a mensagem que você está adiando.',
  merlin: 'Vou deixar uma coisa pequena no seu caminho, um bilhete, uma chave, uma música. Guarde: ela abre outra porta depois.',
  zelda: 'Antes de atravessar a chuva desta semana, olhe duas vezes. A segunda olhada é a que te protege.',
  spark: 'Uma foto antiga ainda guarda um segredo seu. Fique em silêncio um pouco e ele aparece.',
  milka: 'Esta semana pede colo, comida quentinha e gente que te faz bem. Fique perto de quem você ama.'
};

// dia no horário de Brasília (0 domingo ... 6 sábado) e a "semana do fio": a data do sábado daquele fim de semana
const agoraBR = now => new Date(now - 3 * 3600e3);
function semana(now = Date.now()) {
  const d = agoraBR(now), dia = d.getUTCDay();
  if (dia !== 6 && dia !== 0) return null;
  return new Date(d.getTime() - (dia === 0 ? 864e5 : 0)).toISOString().slice(0, 10);
}
const guardiao = (id, sem) => ORDEM[crypto.createHash('sha1').update(String(id) + ':' + sem).digest()[0] % ORDEM.length];
const prim = c => (c.nome || '').trim().split(/\s+/)[0] || c.user || 'você';
function limpar(t, max = 320) {
  const s = String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s"“”'«»—-]+|[\s"“”'«»]+$/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const corte = s.slice(0, max), fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '));
  return fim > 40 ? corte.slice(0, fim + 1) : '';  // frase pela metade não vai: cai na frase pronta do gato
}

const FECHADO = '🔴 O fio vermelho está quieto agora. Ele só se mexe no fim de semana: volta no sábado e responde DESTINO 🐾\n\n' +
  '🇺🇸 The red thread only moves on weekends. Come back on Saturday and reply DESTINO.';

/** Texto do direct para a conversa c. Guarda o guardião em c (o mesmo o fim de semana inteiro). */
async function profecia(c, { now = Date.now(), perguntar = require('./groq').perguntar } = {}) {
  const sem = semana(now);
  if (!sem) return FECHADO;
  if (c.destino?.semana === sem && c.destino.texto) return c.destino.texto;
  const g = guardiao(c.id, sem), nome = prim(c), N = NOMES[g];
  let frase = '';
  try {
    const desc = require('../api/sussurro').GATOS[g];
    frase = limpar((await perguntar([
      { role: 'system', content: 'Você é a voz dos gatos de Miados do Destino, um dorama coreano sobre cinco gatos que escolhem pessoas e o fio vermelho do destino, que liga quem tem que se encontrar. ' +
        `Escreva a profecia da semana para ${nome}, falando como o guardião: ${desc} ` +
        `No máximo DUAS frases curtas (até 220 caracteres no total), poéticas e acolhedoras: UMA imagem só, ${IMAGEM[g]}, e uma pista prática para a semana. ` +
        'É ficção da série: não prometa dinheiro, cura, amor garantido nem nada que pareça previsão real. ' +
        'Português do Brasil, segunda pessoa, sem emoji, sem aspas, sem hashtag, sem dizer que é IA.' },
      { role: 'user', content: `Profecia de ${N} para ${nome}.` }
    ], { temperatura: 0.9 })).texto);
  } catch (e) { /* sem IA: frase pronta do gato */ }
  if (frase.length < 30) frase = RESERVA[g];
  const texto = `🔴 ${nome}, o fio vermelho se mexeu.\n\n${N} é ${guarda(g)} da sua semana. ${frase}\n\n` +
    `🇺🇸 ${N} is your guardian this week. 🐾\n\nOs gatos escolhem pessoas.`;
  c.destino = { semana: sem, gato: g, texto };
  c.campos = { ...(c.campos || {}), guardiao: N };
  c.tags = [...new Set([...(c.tags || []), 'fio-vermelho'])];
  return texto;
}

/** Garante a automação "🔴 Fio Vermelho" (DESTINO no direct ou na resposta ao story → passo profecia). Pausada pela equipe fica pausada. */
async function garantirAutomacao() {
  const autos = await dbGet('bot:autos') || [], old = autos.find(a => a.id === AUTO_ID);
  if (old) return old;
  const a = {
    id: AUTO_ID, nome: '🔴 Fio Vermelho do Destino', ativo: true, tipo: 'dm', todos: true, posts: [], palavras: PALAVRAS, modo: 'contem',
    publicas: [], umaVez: false, abertura: { ativo: false, texto: '', botao: '' }, seguir: { ativo: false, texto: '', botao: '' },
    passos: [{ t: 'profecia' }], criado: Date.now(), editado: Date.now()
  };
  await dbSet('bot:autos', [...autos, a]);
  return a;
}

// ---- arte do story: os cinco gatos num círculo, ligados pelo fio vermelho
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const CENTRO = { x: 540, y: 860 }, RAIO = 330, FOTO = 250;
const posicoes = () => ORDEM.map((g, i) => {
  const ang = (-90 + i * 72) * Math.PI / 180;
  return { g, x: Math.round(CENTRO.x + RAIO * Math.cos(ang)), y: Math.round(CENTRO.y + RAIO * Math.sin(ang)) };
});
const TEXTOS = {
  sabado: { selo: 'FIO VERMELHO DO DESTINO', t1: 'O fio vermelho se mexeu.', t2: 'Um deles escolheu você.', br: 'Responda DESTINO e conheça seu guardião', us: 'Reply DESTINO to meet your guardian' },
  domingo: { selo: 'ÚLTIMA CHAMADA', t1: 'O destino fecha', t2: 'à meia-noite.', br: 'Responda DESTINO antes que o fio pare', us: 'Reply DESTINO before the thread stops' }
};

async function arte(tipo = 'sabado') {
  const sharp = require('sharp');
  const { bandeiraBR, bandeiraUS, linhaComBandeira } = require('./bandeiras');
  const T = TEXTOS[tipo] || TEXTOS.sabado, ps = posicoes();
  // estrelas fixas (mesma arte sempre) e o fio: passa por todos os gatos e fecha num laço no centro
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const estrelas = Array.from({ length: 140 }, () => `<circle cx="${(rnd() * 1080).toFixed(0)}" cy="${(rnd() * 1920).toFixed(0)}" r="${(rnd() * 2 + 0.6).toFixed(1)}" fill="#fff" opacity="${(rnd() * 0.6 + 0.2).toFixed(2)}"/>`).join('');
  const volta = [...ps, ps[0]];
  let d = `M ${volta[0].x} ${volta[0].y}`;
  for (let i = 1; i < volta.length; i++) {
    const a = volta[i - 1], b = volta[i], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    d += ` Q ${Math.round(mx + (mx - CENTRO.x) * 0.35)} ${Math.round(my + (my - CENTRO.y) * 0.35)} ${b.x} ${b.y}`;
  }
  const fundo = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <defs><radialGradient id="g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#332615"/><stop offset="0.6" stop-color="#21190e"/><stop offset="1" stop-color="#120d0a"/></radialGradient></defs>
    <rect width="1080" height="1920" fill="url(#g)"/>${estrelas}
    <text x="540" y="170" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="52" letter-spacing="8" fill="#e2b23e">MIADOS DO DESTINO</text>
    <rect x="${540 - T.selo.length * 13 - 30}" y="200" width="${T.selo.length * 26 + 60}" height="62" rx="31" fill="none" stroke="#e2b23e" stroke-width="3"/>
    <text x="540" y="242" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="28" fill="#f3e7d3">${esc(T.selo)}</text>
    <path d="${d}" fill="none" stroke="#c61c26" stroke-width="9" stroke-linecap="round" opacity="0.95"/>
    <path d="M ${CENTRO.x - 46} ${CENTRO.y} C ${CENTRO.x - 46} ${CENTRO.y - 60}, ${CENTRO.x + 46} ${CENTRO.y - 60}, ${CENTRO.x + 46} ${CENTRO.y} C ${CENTRO.x + 46} ${CENTRO.y + 50}, ${CENTRO.x - 20} ${CENTRO.y + 70}, ${CENTRO.x - 46} ${CENTRO.y + 110}" fill="none" stroke="#c61c26" stroke-width="9" stroke-linecap="round"/>
    <circle cx="${CENTRO.x - 46}" cy="${CENTRO.y + 150}" r="10" fill="#c61c26"/>
    <path d="M ${ps[0].x} ${ps[0].y} Q ${CENTRO.x + 40} ${CENTRO.y - 170} ${CENTRO.x - 46} ${CENTRO.y}" fill="none" stroke="#c61c26" stroke-width="6" stroke-linecap="round" opacity="0.8"/>
  </svg>`;
  const R = FOTO / 2, mascara = Buffer.from(`<svg width="${FOTO}" height="${FOTO}"><circle cx="${R}" cy="${R}" r="${R}" fill="#fff"/></svg>`);
  const fotos = await Promise.all(ps.map(async p => {
    const img = await sharp(path.join(__dirname, '..', 'sussurro', `fundo_${p.g}.jpg`)).extract({ left: 200, top: 300, width: 680, height: 680 })
      .resize(FOTO, FOTO).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer();
    return { input: img, left: p.x - R, top: p.y - R };
  }));
  const molduras = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    ${ps.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${R + 4}" fill="none" stroke="#e2b23e" stroke-width="7"/>
      <rect x="${p.x - 78}" y="${p.y + R - 6}" width="156" height="46" rx="23" fill="#120d0a" stroke="#e2b23e" stroke-width="3"/>
      <text x="${p.x}" y="${p.y + R + 27}" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="28" fill="#e2b23e">${NOMES[p.g]}</text>`).join('')}
    <text x="540" y="1390" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="68" fill="#f3e7d3">${esc(T.t1)}</text>
    <text x="540" y="1474" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="68" fill="#e2b23e">${esc(T.t2)}</text>
    ${linhaComBandeira(bandeiraBR, T.br, 1590, { bold: true })}
    ${linhaComBandeira(bandeiraUS, T.us, 1648, { bold: true })}
    <text x="540" y="1840" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="34" fill="#e2b23e">@miadosdodestino</text>
  </svg>`);
  return sharp(Buffer.from(fundo)).composite([...fotos, { input: molduras, top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

module.exports = { ORDEM, NOMES, AUTO_ID, PALAVRAS, RESERVA, FECHADO, semana, guardiao, profecia, garantirAutomacao, arte, TEXTOS };
