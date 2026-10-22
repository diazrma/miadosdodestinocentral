// 📸 Story do dia da loja: um produto no ar por dia, com "Responda QUERO e receba o link no direct".
// A API do Instagram não põe adesivo de link em story; quem responde QUERO recebe o link pela automação
// "🛒 Story do dia", que o robô troca junto com o produto. Os cliques no link avisam a equipe (api/webhook.js).
// A Vercel não tem fontes no sistema: o fontconfig usa as de fonts/ (Cinzel e DejaVu Sans), por isso a variável vem antes do sharp.
const path = require('path');
process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || path.join(__dirname, '..', 'fonts');
const sharp = require('sharp');
const { put, del } = require('@vercel/blob');
const { cred } = require('./blob');
const { dbGet, dbSet } = require('./db');

const AUTO_ID = 'lojadia';
const PALAVRAS = ['quero', 'eu quero', 'link', 'comprar', 'want', 'i want', 'buy'];
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const brl = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
const usd = v => 'R$ ' + Number(v).toFixed(2);
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const precoStory = p => (p.loja.precoMin ? 'a partir de ' + brl(p.loja.precoMin) : brl(p.loja.preco));
const precoEn = p => (p.loja.precoMin ? 'from ' + usd(p.loja.precoMin) : usd(p.loja.preco));
const { bandeiraBR, bandeiraUS, linhaComBandeira } = require('./bandeiras');

// quebra o nome em até 2 linhas de ~22 letras (Cinzel em 66px cabe isso em 1080 de largura)
function linhas(t, max = 22) {
  const out = [''];
  for (const w of String(t).split(/\s+/)) {
    const cur = out[out.length - 1];
    if ((cur + ' ' + w).trim().length <= max) out[out.length - 1] = (cur + ' ' + w).trim();
    else if (out.length < 2) out.push(w);
    else { out[1] = (out[1] + ' ' + w).slice(0, max - 1) + '…'; break; }
  }
  return out;
}

/** JPEG 1080x1920: foto do produto num cartão branco, nome, preço e a chamada para responder QUERO. */
async function cartao(p) {
  // o Instagram cobre ~250px no topo (progresso e perfil) e ~250px embaixo (caixa de resposta): tudo fica entre 270 e 1670
  const W = 1080, H = 1920, FW = 608, FH = 760, FX = (W - FW) / 2, FY = 380;
  const original = Buffer.from(await (await fetch(`${p.img}?w=${FW * 2}&h=${FH * 2}&fit=crop&fm=jpg&q=85`)).arrayBuffer());
  const foto = await sharp(original).resize(FW, FH, { fit: 'cover' })
    .composite([{ input: Buffer.from(`<svg width="${FW}" height="${FH}"><rect width="${FW}" height="${FH}" rx="36" fill="#fff"/></svg>`), blend: 'dest-in' }])
    .png().toBuffer();
  const nome = linhas(p.loja.nome || p.nome), yNome = FY + FH + 95, en = p.loja.nomeEn || '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b130d"/><stop offset="1" stop-color="#0d0907"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <text x="540" y="305" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="38" letter-spacing="5" fill="#e2b23e">LOJA OFICIAL · OFFICIAL STORE</text>
    <text x="540" y="348" text-anchor="middle" font-family="DejaVu Sans" font-size="28" letter-spacing="4" fill="#bfa98a">MIADOS DO DESTINO</text>
    <rect x="${FX - 6}" y="${FY - 6}" width="${FW + 12}" height="${FH + 12}" rx="40" fill="none" stroke="#e2b23e" stroke-opacity="0.5" stroke-width="3"/>
    ${nome.map((l, i) => `<text x="540" y="${yNome + i * 76}" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="64" fill="#f3e7d3">${esc(l)}</text>`).join('')}
    ${en ? `<text x="540" y="${yNome + nome.length * 76 - 18}" text-anchor="middle" font-family="DejaVu Sans" font-size="34" fill="#bfa98a">${esc(en.length > 44 ? en.slice(0, 43) + '…' : en)}</text>` : ''}
    <text x="540" y="${yNome + nome.length * 76 + (en ? 50 : 6)}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="50" fill="#e2b23e">${esc(precoStory(p))}</text>
    <rect x="140" y="1515" width="800" height="150" rx="75" fill="#e2b23e"/>
    ${linhaComBandeira(bandeiraBR, 'Responda QUERO no direct', 1581, { bold: true, fill: '#1b130d', max: 740 })}
    ${linhaComBandeira(bandeiraUS, 'Reply WANT for the link', 1638, { bold: true, fill: '#1b130d', max: 740 })}
  </svg>`;
  return sharp(Buffer.from(svg)).composite([{ input: foto, top: FY, left: FX }]).jpeg({ quality: 90 }).toBuffer();
}

// Produto do dia: o que está há mais tempo sem aparecer (nunca apareceu vem primeiro),
// evitando o mesmo tipo de ontem; empate fica com a ordem da loja.
function escolher(lista, dias) {
  const ok = lista.filter(p => p.status === 'no_ar' && p.url && p.img && p.loja && !p.loja.esgotado);
  if (!ok.length) return null;
  const ultimo = up => { const d = dias.find(x => x.up === up); return d ? d.data : ''; };
  const ontem = dias[0] && lista.find(p => p.up === dias[0].up);
  const ordena = ps => ps.slice().sort((a, b) => ultimo(a.up).localeCompare(ultimo(b.up)) || (a.loja.ordem ?? 999) - (b.loja.ordem ?? 999));
  const semRepetirTipo = ok.filter(p => !ontem || p.tipo !== ontem.tipo);
  return ordena(semRepetirTipo.length ? semRepetirTipo : ok)[0];
}

// A automação de resposta ao story leva sempre o produto de hoje (uma mensagem só: texto, preço e botão).
async function trocarAutomacao(p, storyId) {
  const autos = await dbGet('bot:autos') || [], old = autos.find(a => a.id === AUTO_ID);
  // pausada pelo robô (o produto de ontem saiu da loja) volta a rodar com o produto novo; pausada pela equipe fica pausada
  const { pausadaPelaLoja, ...base } = old || { criado: Date.now(), ativo: true };
  const a = {
    ...base, ativo: pausadaPelaLoja ? true : base.ativo !== false, id: AUTO_ID, nome: '🛒 Story do dia', tipo: 'story', todos: true, posts: [],
    palavras: [...new Set([...(old?.palavras || []), ...PALAVRAS])], modo: old?.modo || 'contem', publicas: [], umaVez: false,
    abertura: { ativo: false, texto: '', botao: '' }, seguir: old?.seguir || { ativo: false, texto: '', botao: '' },
    passos: [{ t: 'msg', texto: `🇧🇷 Oi {nome}! 😺 O destaque de hoje na loja oficial é ${p.loja.nome || p.nome}, ${precoStory(p)}. Produção sob demanda pela Uma Penca, com entrega para todo o Brasil.\n\n🇺🇸 Hi {nome}! Today's pick at the official store is ${p.loja.nomeEn || p.loja.nome || p.nome}, ${precoEn(p)} (Brazilian reais). Made to order by Uma Penca, a Brazilian print shop.`, img: '', botoes: [{ titulo: '🛒 Comprar / Buy', url: p.url, auto: '' }] }],
    // só responde a quem respondeu ao story da loja (o de hoje e o de ontem, que ainda pode estar no ar)
    stories: [storyId, ...(old?.stories || [])].filter(Boolean).slice(0, 2),
    criadaPelaLoja: 'story', produtoDoDia: p.up, editado: Date.now()
  };
  await dbSet('bot:autos', old ? autos.map(x => x.id === AUTO_ID ? a : x) : [...autos, a]);
  return a;
}

const config = async () => ({ story: true, ...(await dbGet('loja_cfg')) });

// o vídeo tem um teto de tempo para sobrar folga para a imagem dentro do limite da função
function comPrazo(promessa, ms, msg) {
  let timer;
  const prazo = new Promise((_, falha) => { timer = setTimeout(() => falha(new Error(msg)), ms); });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer));
}

/** Gera o arquivo do story ('video' ou 'imagem'), sobe no Blob, publica e apaga o arquivo. */
async function publicar(p, tipo, hoje, req) {
  const { publicarIG } = require('./ig-post');
  const video = tipo === 'video';
  const arquivo = video
    ? await comPrazo(require('./loja-video').videoStory(p, precoStory(p)), 150e3, 'o vídeo demorou demais para ficar pronto')
    : await cartao(p);
  const blob = await put(`publicar/loja-${hoje}.${video ? 'mp4' : 'jpg'}`, arquivo, { access: 'public', contentType: video ? 'video/mp4' : 'image/jpeg', addRandomSuffix: true, ...cred(req) });
  try { return await publicarIG({ media_type: 'STORIES', [video ? 'video_url' : 'image_url']: blob.url }); }
  finally { await del(blob.url, cred(req)).catch(() => {}); }
}

/** Prévia do vídeo do produto do dia, sem publicar: sobe no Blob e devolve o link (o arquivo fica 1 dia). */
async function previaVideo({ req } = {}) {
  const hist = await dbGet('loja_story') || { dias: [] };
  const p = escolher(await dbGet('loja') || [], hist.dias);
  if (!p) throw new Error('Nenhum produto no ar na aba Loja para o story');
  const t = Date.now();
  const arquivo = await require('./loja-video').videoStory(p, precoStory(p));
  const blob = await put(`publicar/previa-loja-${hojeBR()}.mp4`, arquivo, { access: 'public', contentType: 'video/mp4', addRandomSuffix: true, ...cred(req) });
  return { produto: p.loja.nome || p.nome, video: blob.url, segundos: Math.round((Date.now() - t) / 1000), tamanho: arquivo.length };
}

/** Publica o story do dia (uma vez por dia; `forcar` publica de novo). Devolve o registro do dia. */
async function storyDoDia({ req, forcar = false, por = 'Robô da loja' } = {}) {
  if (!forcar && !(await config()).story) return { pulado: 'Story do dia desligado na aba Loja' };
  const hist = await dbGet('loja_story') || { dias: [] }, hoje = hojeBR();
  if (!forcar && hist.dias[0]?.data === hoje) return { pulado: 'O story de hoje já foi publicado', dia: hist.dias[0] };
  const p = escolher(await dbGet('loja') || [], hist.dias);
  if (!p) throw new Error('Nenhum produto no ar na aba Loja para o story');
  // vídeo primeiro; se o vídeo falhar antes de publicar, sai a imagem (o dia nunca fica sem story)
  let r, formato = 'vídeo', erroVideo;
  try { r = await publicar(p, 'video', hoje, req); }
  catch (e) {
    formato = 'imagem'; erroVideo = e.message;
    r = await publicar(p, 'imagem', hoje, req);
  }
  await trocarAutomacao(p, r.id);
  const dia = { data: hoje, up: p.up, nome: p.loja.nome || p.nome, tipo: p.tipo, preco: precoStory(p), url: p.url, img: p.img, story: r.id, link: r.link, formato, ...(erroVideo ? { erroVideo } : {}), quando: new Date().toISOString(), por };
  await dbSet('loja_story', { dias: [dia, ...hist.dias].slice(0, 60) });
  await require('./avisos').publicado('Story da loja: ' + dia.nome, r).catch(() => {});
  return dia;
}

module.exports = { cartao, escolher, storyDoDia, previaVideo, trocarAutomacao, config, AUTO_ID };
