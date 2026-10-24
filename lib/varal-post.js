// 🧺 Reels semanal do Varal das Lembranças (quinta, 12h de Brasília): 10 s em 1080x1920, molde fixo, sem IA.
// A Milka de exemplo numa polaroid presa no fio vermelho: cai, quica, balança no pregador, passa uma rajada de vento
// e sobem coraçõezinhos; as laterais têm polaroids vazias ("o seu aqui?") convidando a pendurar pelo link da bio.
// O fundo (céu estrelado) é uma imagem só; quadro a quadro o sharp monta fio, fotos, textos e corações e o ffmpeg junta.
const path = require('path');
process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || path.join(__dirname, '..', 'fonts');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { peca } = require('./loja-video');
const { bandeiraUS, linhaComBandeira } = require('./bandeiras');

const W = 1080, H = 1920, FPS = 30, DUR = 10;
const FIXOS = path.join(__dirname, '..', 'varal-post');
const svg = (w, h, corpo) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`);
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const lim = x => Math.min(1, Math.max(0, x));
const suave = x => 1 - (1 - lim(x)) ** 3;
// número "aleatório" fixo (o vídeo sai igual toda semana, só a legenda muda)
const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// fio: preso nas paredes em Y0 e cedendo no meio; a rajada estufa e devolve
const Y0 = 720, CAIDA = 78;
const vento = t => (t > 5.2 && t < 7.6 ? Math.sin((t - 5.2) * Math.PI / 2.4) * Math.sin((t - 5.2) * 7) : 0);
const fioY = (x, t) => { const k = x / W, v = 4 * k * (1 - k); return Y0 + v * (CAIDA + 22 * vento(t)) + v * 6 * Math.sin(t * 1.3); };

/** Polaroid com pregador; a camada é simétrica em volta do pregador para o giro do sharp (pelo centro) girar no pregador. */
async function polaroid(largura, { foto, nome, anos, vazio } = {}) {
  const pad = Math.round(largura * 0.055), fl = largura - 2 * pad, base = Math.round(largura * 0.22), alt = pad + fl + base;
  const mola = 30; // o pregador prende a polaroid a 30 px do topo da camada útil
  const meia = alt + 30, Wc = largura + 60, Hc = meia * 2, x0 = 30, y0 = meia - mola + 14;
  const camadas = [{
    input: svg(Wc, Hc, `<defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#000" flood-opacity="0.6"/></filter></defs>
      <rect x="${x0}" y="${y0}" width="${largura}" height="${alt}" fill="#f4eee2" filter="url(#s)"/>
      ${vazio ? `<rect x="${x0 + pad}" y="${y0 + pad}" width="${fl}" height="${fl}" fill="#ebe2cf" stroke="#c9b28b" stroke-width="4" stroke-dasharray="14 10"/>
        <text x="${Wc / 2}" y="${y0 + pad + fl / 2 - 6}" text-anchor="middle" font-family="Caveat" font-weight="bold" font-size="${Math.round(largura * 0.15)}" fill="#7a6343">${esc(vazio[0])}</text>
        <text x="${Wc / 2}" y="${y0 + pad + fl / 2 + largura * 0.15}" text-anchor="middle" font-family="Caveat" font-weight="bold" font-size="${Math.round(largura * 0.15)}" fill="#7a6343">${esc(vazio[1])}</text>` : ''}
      ${nome ? `<text x="${Wc / 2}" y="${y0 + pad + fl + base * 0.56}" text-anchor="middle" font-family="Caveat" font-weight="bold" font-size="${Math.round(largura * 0.13)}" fill="#2b2118">${esc(nome)}</text>` : ''}
      ${anos ? `<text x="${Wc / 2}" y="${y0 + pad + fl + base * 0.88}" text-anchor="middle" font-family="Caveat" font-size="${Math.round(largura * 0.07)}" fill="#6d5a45">${esc(anos)}</text>` : ''}`),
    top: 0, left: 0,
  }];
  if (foto) {
    const img = await sharp(foto).resize(fl, fl, { fit: 'cover' })
      .composite([{ input: svg(fl, fl, `<defs><radialGradient id="v"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient></defs><rect width="${fl}" height="${fl}" fill="url(#v)"/>`) }])
      .png().toBuffer();
    camadas.push({ input: img, top: y0 + pad, left: x0 + pad });
  }
  // pregador de madeira com mola de metal, centrado no ponto de giro
  const px = Wc / 2, py = meia;
  camadas.push({
    input: svg(Wc, Hc, `<defs><linearGradient id="m" x1="0" x2="1"><stop offset="0" stop-color="#c99b62"/><stop offset="0.55" stop-color="#e2bd86"/><stop offset="1" stop-color="#b5854c"/></linearGradient></defs>
      <g transform="translate(${px - 18} ${py - 34}) scale(2)"><rect x="2" y="0" width="7" height="48" rx="2.5" fill="url(#m)"/><rect x="9" y="0" width="7" height="48" rx="2.5" fill="url(#m)"/>
      <path d="M9 2 V46" stroke="#8a6036" stroke-width="0.8" opacity="0.7"/><rect x="0.5" y="20" width="17" height="6" rx="2" fill="#9ea3a8"/>
      <path d="M3 20.5 v5 M6 20.5 v5 M9 20.5 v5 M12 20.5 v5 M15 20.5 v5" stroke="#6e7378" stroke-width="0.8"/></g>`),
    top: 0, left: 0,
  });
  return sharp({ create: { width: Wc, height: Hc, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(camadas).png().toBuffer();
}

/** Céu estrelado com halo vermelho atrás do varal e brilho de aurora no alto (fixo, vira o fundo do vídeo). */
function fundo() {
  let estrelas = '';
  for (let i = 0; i < 260; i++) {
    const r = rnd(i * 3 + 2) ** 3 * 2.6 + 0.6;
    estrelas += `<circle cx="${(rnd(i) * W).toFixed(1)}" cy="${(rnd(i * 3 + 1) * H).toFixed(1)}" r="${r.toFixed(2)}" fill="${r > 2 ? '#ffe9b8' : '#f4f1ff'}" opacity="${(0.35 + rnd(i * 7) * 0.6).toFixed(2)}"/>`;
  }
  return sharp(svg(W, H, `<defs>
      <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141a3d"/><stop offset="0.55" stop-color="#0b0d22"/><stop offset="1" stop-color="#120e0b"/></linearGradient>
      <radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#b3203a" stop-opacity="0.32"/><stop offset="1" stop-color="#b3203a" stop-opacity="0"/></radialGradient>
      <radialGradient id="a" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2fd6a0" stop-opacity="0.18"/><stop offset="1" stop-color="#2fd6a0" stop-opacity="0"/></radialGradient>
      <radialGradient id="v" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#c)"/><ellipse cx="300" cy="180" rx="700" ry="320" fill="url(#a)"/><ellipse cx="880" cy="260" rx="520" ry="260" fill="url(#a)"/>
    ${estrelas}<ellipse cx="540" cy="1050" rx="760" ry="520" fill="url(#r)"/><rect width="${W}" height="${H}" fill="url(#v)"/>`)).png().toBuffer();
}

async function camadas() {
  return {
    milka: await polaroid(470, { foto: path.join(FIXOS, 'milka.jpg'), nome: 'Milka', anos: 'ao meu lado ✦' }),
    vazioA: await polaroid(280, { vazio: ['o seu', 'aqui?'] }),
    vazioB: await polaroid(280, { vazio: ['pendure', 'o seu ♥'] }),
    topo: await sharp(svg(W, 420, `<defs><linearGradient id="o" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f3d27a"/><stop offset="1" stop-color="#c8902f"/></linearGradient></defs>
      <text x="540" y="70" text-anchor="middle" font-family="DejaVu Sans" font-size="30" letter-spacing="10" fill="#e2b23e">MIADOS DO DESTINO</text>
      <text x="540" y="190" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="104" fill="url(#o)">Varal das</text>
      <text x="540" y="310" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="104" fill="url(#o)">Lembranças</text>
      <text x="540" y="380" text-anchor="middle" font-family="DejaVu Sans" font-size="34" fill="#d9c6a6">toda quinta, um bichinho no fio vermelho</text>`)).png().toBuffer(),
    texto: await sharp(svg(W, 200, `<text x="540" y="70" text-anchor="middle" font-family="DejaVu Sans" font-size="46" fill="#f6ead6">Pendure a foto do seu bichinho</text>
      <text x="540" y="132" text-anchor="middle" font-family="DejaVu Sans" font-size="46" fill="#f6ead6">no fio vermelho do destino.</text>`)).png().toBuffer(),
    cta: await sharp(svg(820, 150, `<rect x="16" y="20" width="788" height="112" rx="56" fill="#000" fill-opacity="0.3"/>
      <rect x="10" y="10" width="788" height="112" rx="56" fill="#e0a93c"/>
      <text x="404" y="84" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="44" fill="#1a120a">LINK NA BIO · É GRÁTIS</text>`)).png().toBuffer(),
    en: await sharp(svg(W, 70, linhaComBandeira(bandeiraUS, "Hang your pet's photo · link in bio", 48, { size: 34, fill: '#d9c6a6' }))).png().toBuffer(),
  };
}

// cai de cima, quica no fio e passa a balançar no pregador; a rajada dá um tranco proporcional ao tamanho
function balanco(t, ini, fase, amp) {
  if (t < ini) return null;
  const x = t - ini, queda = x < 0.55 ? (1 - x / 0.55) ** 2 : 0;
  const quica = x >= 0.55 ? Math.exp(-(x - 0.55) * 3.2) * Math.sin((x - 0.55) * 11) * 9 : 0;
  const giro = (x < 0.55 ? -18 * queda : quica) + amp * Math.sin(t * 1.9 + fase) + 9 * vento(t + fase * 0.05);
  return { dy: -340 * queda, giro, alfa: lim(x / 0.35) };
}

async function quadro(c, t) {
  const L = [];
  const ta = suave((t - 0.15) / 0.8);
  L.push(await peca(c.topo, W / 2, 470 - 30 * (1 - ta), { alfa: ta }));
  // fio vermelho (sombra, linha e brilho) + corações subindo da Milka
  const pts = Array.from({ length: 41 }, (_, i) => `${(i * W / 40).toFixed(1)},${fioY(i * W / 40, t).toFixed(1)}`).join(' ');
  let coracoes = '';
  for (let i = 0; i < 9; i++) {
    const t0 = 3.4 + i * 0.32, x = t - t0;
    if (x < 0 || x > 2.4) continue;
    const a = x < 0.3 ? x / 0.3 : 1 - (x - 0.3) / 2.1;
    coracoes += `<text x="${(540 + (rnd(i + 40) - 0.5) * 380 + Math.sin(x * 4 + i) * 26).toFixed(1)}" y="${(1240 - x * 300).toFixed(1)}" text-anchor="middle" font-family="DejaVu Sans" font-size="${Math.round(52 + rnd(i + 9) * 40)}" fill="#ff4d6a" stroke="#fff" stroke-width="2" opacity="${lim(a).toFixed(2)}">♥</text>`;
  }
  L.push({ input: svg(W, H, `<polyline points="${pts}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="5" transform="translate(0 9)"/>
    <polyline points="${pts}" fill="none" stroke="#c4223e" stroke-width="5" stroke-linecap="round"/>
    <polyline points="${pts}" fill="none" stroke="#ff8aa0" stroke-width="1.6" stroke-dasharray="4 6" opacity="0.7"/>
    <circle cx="6" cy="${Y0}" r="9" fill="#3a2f26" stroke="#7d6a57" stroke-width="2"/><circle cx="${W - 6}" cy="${Y0}" r="9" fill="#3a2f26" stroke="#7d6a57" stroke-width="2"/>`), top: 0, left: 0 });
  // polaroids: laterais primeiro, Milka por cima
  for (const [buf, x, ini, fase, amp] of [[c.vazioA, 128, 0.6, 1.3, 2.2], [c.vazioB, 952, 0.8, 2.6, 2.2], [c.milka, 540, 1.2, 0, 1.6]]) {
    const b = balanco(t, ini, fase, amp);
    if (b) L.push(await peca(buf, x, fioY(x, t) + b.dy, { giro: b.giro, alfa: b.alfa }));
  }
  if (coracoes) L.push({ input: svg(W, H, coracoes), top: 0, left: 0 });
  const tb = suave((t - 2.6) / 0.7);
  L.push(await peca(c.texto, W / 2, 1530 + 40 * (1 - tb), { alfa: tb }));
  const tc = suave((t - 3.3) / 0.5), pulso = t > 3.8 ? 1 + 0.03 * Math.sin((t - 3.8) * 2 * Math.PI * 1.2) : 1;
  L.push(await peca(c.cta, W / 2, 1690, { escala: Math.max(0.02, tc) * pulso, alfa: tc }));
  L.push(await peca(c.en, W / 2, 1800, { alfa: suave((t - 3.9) / 0.6) }));
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(L.filter(Boolean)).raw().toBuffer();
}

/** Gera o MP4 (H.264 + AAC) do Reels do varal. */
async function videoVaral() {
  const ffmpeg = require('ffmpeg-static');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error('ffmpeg não encontrado');
  const c = await camadas();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'varal-'));
  const bg = path.join(tmp, 'fundo.png'), saida = path.join(tmp, 'varal.mp4');
  fs.writeFileSync(bg, await fundo());
  const ff = spawn(ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-i', bg,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-i', path.join(FIXOS, 'trilha.m4a'),
    '-filter_complex', `[0:v][1:v]overlay=0:0:format=auto:shortest=1,fade=t=in:st=0:d=0.4,fade=t=out:st=${DUR - 0.4}:d=0.4[v]`, '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '128k',
    '-t', String(DUR), '-movflags', '+faststart', saida], { stdio: ['pipe', 'ignore', 'pipe'] });
  let erro = '';
  ff.stderr.on('data', d => { erro += d; });
  const fim = new Promise((ok, falha) => ff.on('close', cod => (cod === 0 ? ok() : falha(new Error('ffmpeg: ' + erro.slice(-300))))));
  ff.stdin.on('error', () => {});
  const escrever = buf => new Promise(ok => (ff.stdin.write(buf) ? ok() : ff.stdin.once('drain', ok)));
  const total = DUR * FPS, LOTE = 4;
  for (let n = 0; n < total; n += LOTE) {
    const lote = await Promise.all(Array.from({ length: Math.min(LOTE, total - n) }, (_, i) => quadro(c, (n + i) / FPS)));
    for (const q of lote) await escrever(q);
  }
  ff.stdin.end();
  await fim;
  const buf = fs.readFileSync(saida);
  fs.rmSync(tmp, { recursive: true, force: true });
  return buf;
}

// legenda em rodízio por semana (a mesma só volta depois de 6 quintas)
const LEGENDAS = [
  'Toda quinta tem um bichinho novo no fio vermelho do destino. 🧺❤️\n\nA Milka já está pendurada no Varal das Lembranças. E o seu? Quem já virou estrelinha ou quem ainda divide o sofá com você: pendure a foto no nosso varal, é grátis.\n\n🔗 Link na bio · miados-do-destino.vercel.app/varal',
  'Quinta das Lembranças 🧺\n\nTem gente que passa pela nossa vida e fica presa no coração, igual foto no varal. A Milka mostra como é: uma foto, um nome e um recadinho.\n\nPendure o seu bichinho no fio vermelho do destino pelo link da bio. ❤️',
  'Psiu, sobrou pregador no varal. 👀🧺\n\nA Milka já garantiu o lugar dela. Agora falta o seu gato, cachorro, coelho, calopsita… todo bichinho que cruzou seu caminho cabe no fio vermelho.\n\n🔗 Link na bio para pendurar.',
  'Pra quem virou estrelinha ✦ e pra quem ainda deita no teclado 🐾\n\nO Varal das Lembranças é o cantinho do Miados do Destino para guardar essas histórias. A Milka já está lá, pendurada com carinho.\n\nQuer pendurar o seu? Link na bio. ❤️',
  'Toda quinta a gente lembra: ninguém cruza o nosso caminho por acaso. 🧶\n\nPendure no varal a foto do bichinho que marcou a sua vida. Dá pra curtir as lembranças dos outros e acender uma velinha pra quem já partiu. 🕯️\n\n🔗 Link na bio.',
  'Varal das Lembranças, edição de quinta 🧺✨\n\nA Milka posou pra mostrar como fica: polaroid, pregador e o fio vermelho do destino. A sua foto passa pela equipe e aparece no site no mesmo dia.\n\nPendure pelo link da bio. ❤️',
];
const TAGS = '\n\n#MiadosDoDestino #VaralDasLembrancas #gatos #pets #amorporgatos #petsdoinstagram #saudade';
const legendaDa = data => LEGENDAS[Math.floor(new Date(data + 'T12:00:00Z').getTime() / (7 * 864e5)) % LEGENDAS.length] + TAGS;

module.exports = { videoVaral, legendaDa, quadro, camadas, fundo, LEGENDAS };
