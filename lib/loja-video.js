// 🎬 Story da loja em vídeo (8 s, 1080x1920): molde fixo, sem IA. O fundo (marrom do site, halo dourado e pétalas)
// e a vinheta vêm prontos de loja-story/; aqui só a camada do produto é montada quadro a quadro com o sharp
// (mockup subindo e quicando, nome, selo de preço e o adesivo "Manda EU QUERO") e o ffmpeg junta tudo.
const path = require('path');
process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || path.join(__dirname, '..', 'fonts');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { bandeiraUS, linhaComBandeira } = require('./bandeiras');

const W = 1080, H = 1920, FPS = 30, DUR = 8;
const FIXOS = path.join(__dirname, '..', 'loja-story');
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const svg = (w, h, corpo) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`);
const OURO = `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dda73c"/><stop offset="1" stop-color="#a37029"/></linearGradient></defs>`;

// curvas de animação (0 → 1)
const lim = x => Math.min(1, Math.max(0, x));
const suave = x => 1 - (1 - lim(x)) ** 3;
const volta = (x, s = 1.7) => { const v = lim(x) - 1; return 1 + (s + 1) * v ** 3 + s * v ** 2; };

// nome em até 2 linhas de ~22 letras (Cinzel em 68px)
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

/** Camadas do produto (PNG com transparência). Camisetas vêm com zoom na estampa, que no mockup fica pequena. */
async function camadas(p, preco) {
  const MW = 600, MH = 750;
  const zoom = /camiseta/i.test(p.tipo || p.nome) ? '&crop=focalpoint&fp-x=0.5&fp-y=0.36&fp-z=1.6' : '';
  const foto = Buffer.from(await (await fetch(`${p.img}?w=${MW}&h=${MH}&fit=crop${zoom}&fm=jpg&q=88`)).arrayBuffer());
  const card = await sharp(foto).resize(MW, MH, { fit: 'cover' })
    .composite([{ input: svg(MW, MH, `<rect width="${MW}" height="${MH}" rx="44" fill="#fff"/>`), blend: 'dest-in' }]).png().toBuffer();
  const mockup = await sharp({ create: { width: MW + 24, height: MH + 24, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg(MW + 24, MH + 24, `<rect width="${MW + 24}" height="${MH + 24}" rx="54" fill="#d29b2d"/>`) }, { input: card, top: 12, left: 12 }])
    .png().toBuffer();
  const sombra = await sharp(svg(MW + 140, MH + 140, `<rect x="70" y="70" width="${MW + 24}" height="${MH + 24}" rx="54" fill="#000" fill-opacity="0.6"/>`)).blur(26).png().toBuffer();
  const nome = linhas(p.loja.nome || p.nome), en = p.loja.nomeEn || '';
  return {
    mockup, sombra,
    tag: await sharp(svg(W, 140, `${OURO}<line x1="250" y1="42" x2="390" y2="42" stroke="#d29b2d" stroke-opacity="0.7" stroke-width="2"/>
      <line x1="690" y1="42" x2="830" y2="42" stroke="#d29b2d" stroke-opacity="0.7" stroke-width="2"/>
      <text x="540" y="54" text-anchor="middle" font-family="DejaVu Sans" font-size="30" letter-spacing="9" fill="#d29b2d">LOJA OFICIAL</text>
      <rect x="335" y="76" width="410" height="58" rx="29" fill="url(#b)"/>
      <text x="540" y="115" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="28" letter-spacing="3" fill="#171411">NOVIDADE · NEW</text>`)).png().toBuffer(),
    // 1 linha em 68px; 2 linhas em 58px, mais juntas, para o nome em inglês não descer até o adesivo
    nome: await (() => {
      const tam = nome.length > 1 ? 58 : 68, passo = nome.length > 1 ? 66 : 80;
      return sharp(svg(W, 260, `${nome.map((l, i) => `<text x="540" y="${70 + i * passo}" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="${tam}" fill="#f6ead6">${esc(l)}</text>`).join('')}
        ${en ? `<text x="540" y="${70 + (nome.length - 1) * passo + 56}" text-anchor="middle" font-family="DejaVu Sans" font-size="32" fill="#d9c6a6">${esc(en.length > 44 ? en.slice(0, 43) + '…' : en)}</text>` : ''}`)).png().toBuffer();
    })(),
    preco: await sharp(svg(270, 270, `${OURO}<circle cx="135" cy="135" r="128" fill="url(#b)" stroke="#171411" stroke-width="7"/>
      <text x="135" y="${/^a partir/.test(preco) ? 105 : 115}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="${/^a partir/.test(preco) ? 24 : 34}" fill="#1b130d">${/^a partir/.test(preco) ? 'A PARTIR DE' : 'SÓ'}</text>
      <text x="135" y="172" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="${preco.replace(/^a partir de /, '').length > 9 ? 42 : 50}" fill="#1b130d">${esc(preco.replace(/^a partir de /, ''))}</text>`))
      .rotate(12, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
    // adesivo no estilo do Instagram: não é link, pede a resposta (a automação manda o link no direct)
    cta: await sharp(svg(760, 300, `<rect x="20" y="16" width="720" height="190" rx="38" fill="#000" fill-opacity="0.25"/>
      <rect x="12" y="6" width="720" height="190" rx="38" fill="#ffffff"/>
      <text x="372" y="92" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="60" fill="#171411">Manda <tspan fill="#c91d34">EU QUERO</tspan></text>
      <text x="372" y="152" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="34" fill="#8a7a66">que o link chega no direct</text>
      <path d="M372 222 l0 52 M346 252 l26 26 l26 -26" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`)).png().toBuffer(),
    en: await sharp(svg(W, 60, linhaComBandeira(bandeiraUS, 'Reply I WANT for the link', 42, { size: 32, bold: true, fill: '#f6ead6' }))).png().toBuffer(),
  };
}

// camada transformada (escala, giro, transparência) e posicionada pelo centro.
// Depois que o mockup assenta, os mesmos giros e tamanhos se repetem: o resultado fica guardado por camada.
const CACHE = new WeakMap();
async function transformar(buf, escala, giro, alfa) {
  if (!CACHE.has(buf)) CACHE.set(buf, new Map());
  const memo = CACHE.get(buf), chave = `${escala.toFixed(3)}|${giro.toFixed(1)}|${alfa.toFixed(2)}`;
  if (memo.has(chave)) return memo.get(chave);
  let img = sharp(buf);
  if (escala !== 1) { const m = await sharp(buf).metadata(); img = sharp(await img.resize(Math.max(2, Math.round(m.width * escala))).png().toBuffer()); }
  if (giro) img = sharp(await img.rotate(giro, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  if (alfa < 1) img = sharp(await img.ensureAlpha().linear([1, 1, 1, alfa], [0, 0, 0, 0]).png().toBuffer());
  const out = await img.png({ compressionLevel: 0 }).toBuffer();
  const r = { out, meta: await sharp(out).metadata() };
  memo.set(chave, r);
  return r;
}

async function peca(buf, cx, cy, { escala = 1, giro = 0, alfa = 1 } = {}) {
  if (escala < 0.02 || alfa < 0.02) return null;
  // arredonda para o cache acertar (diferença invisível no vídeo)
  const { out, meta: d } = await transformar(buf, Math.round(escala * 200) / 200, Math.round(giro * 10) / 10, Math.round(alfa * 50) / 50);
  const left = Math.round(cx - d.width / 2), top = Math.round(cy - d.height / 2);
  // o sharp não aceita camada saindo da tela: corta o que passar das bordas
  const x0 = Math.max(0, -left), y0 = Math.max(0, -top), x1 = Math.min(d.width, W - left), y1 = Math.min(d.height, H - top);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const input = x0 || y0 || x1 < d.width || y1 < d.height ? await sharp(out).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png({ compressionLevel: 0 }).toBuffer() : out;
  return { input, left: left + x0, top: top + y0 };
}

async function quadro(c, t) {
  const camadas = [await peca(c.tag, W / 2, 262, { escala: volta((t - 0.2) / 0.45, 1.2) })];
  if (t > 1.0) {  // mockup sobe de baixo, quica e flutua
    const cy = 740 + (1 - volta((t - 1.0) / 0.9, 0.45)) * 1300 + (t > 2 ? 3 * Math.sin((t - 2) * 2.4) : 0);
    const giro = -3 + 15 * (1 - suave((t - 1.0) / 1.1));
    camadas.push(await peca(c.sombra, W / 2 + 14, cy + 30, { giro, alfa: Math.min(1, (t - 1.0) / 0.6) }));
    camadas.push(await peca(c.mockup, W / 2, cy, { giro }));
  }
  const a = suave((t - 2.6) / 0.6);
  camadas.push(await peca(c.nome, W / 2, 1275 + 40 * (1 - a), { alfa: a }));
  camadas.push(await peca(c.preco, 850, 405, { escala: volta((t - 3.6) / 0.5, 2.2) }));
  const b = suave((t - 4.6) / 0.5);
  const pulso = t > 5.1 ? 1 + 0.035 * Math.sin((t - 5.1) * 2 * Math.PI * 1.6) : 1;
  camadas.push(await peca(c.cta, W / 2, 1570 + 250 * (1 - b), { escala: volta((t - 4.6) / 0.5, 1.6) * pulso, giro: t > 4.6 ? -3 + 2.5 * Math.sin((t - 4.6) * 3) : -3, alfa: b }));
  camadas.push(await peca(c.en, W / 2, 1778, { alfa: suave((t - 5.4) / 0.6) }));
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(camadas.filter(Boolean)).raw().toBuffer();
}

/** Gera o MP4 do story (H.264 + AAC). `preco` já formatado ("R$ 66,60" ou "a partir de R$ 41,06"). */
async function videoStory(p, preco) {
  const ffmpeg = require('ffmpeg-static');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error('ffmpeg não encontrado');
  const c = await camadas(p, preco);
  const saida = path.join(os.tmpdir(), `story-loja-${Date.now()}.mp4`);
  const ff = spawn(ffmpeg, ['-v', 'error', '-y', '-i', path.join(FIXOS, 'fundo.mp4'),
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-i', path.join(FIXOS, 'trilha.m4a'),
    '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,fade=t=in:st=0:d=0.35[v]', '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'copy',
    '-t', String(DUR), '-movflags', '+faststart', saida], { stdio: ['pipe', 'ignore', 'pipe'] });
  let erro = '';
  ff.stderr.on('data', d => { erro += d; });
  const fim = new Promise((ok, falha) => ff.on('close', cod => (cod === 0 ? ok() : falha(new Error('ffmpeg: ' + erro.slice(-300))))));
  ff.stdin.on('error', () => {});  // se o ffmpeg cair, o erro vem pelo 'close'
  const escrever = buf => new Promise(ok => (ff.stdin.write(buf) ? ok() : ff.stdin.once('drain', ok)));
  // monta alguns quadros em paralelo e escreve na ordem
  const total = DUR * FPS, LOTE = 4;
  for (let n = 0; n < total; n += LOTE) {
    const lote = await Promise.all(Array.from({ length: Math.min(LOTE, total - n) }, (_, i) => quadro(c, (n + i) / FPS)));
    for (const q of lote) await escrever(q);
  }
  ff.stdin.end();
  await fim;
  const buf = fs.readFileSync(saida);
  fs.unlink(saida, () => {});
  return buf;
}

module.exports = { videoStory, camadas, quadro };
