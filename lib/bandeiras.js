// Bandeiras do Brasil e dos EUA em SVG para as artes geradas com o sharp (stories da loja, Sussurro e teste do app).
// A Vercel não tem fonte de emoji, então 🇧🇷 e 🇺🇸 viram desenho; nas mensagens de texto o emoji funciona normal.
const bandeiraBR = (x, y, w = 54) => { const h = w * 0.7; return `<g transform="translate(${x} ${y})"><rect width="${w}" height="${h}" rx="4" fill="#009c3b"/><path d="M${w / 2} ${h * 0.1} L${w * 0.92} ${h / 2} L${w / 2} ${h * 0.9} L${w * 0.08} ${h / 2}Z" fill="#ffdf00"/><circle cx="${w / 2}" cy="${h / 2}" r="${h * 0.24}" fill="#002776"/></g>`; };
const bandeiraUS = (x, y, w = 54) => { const h = w * 0.7, f = h / 7; return `<g transform="translate(${x} ${y})"><rect width="${w}" height="${h}" rx="4" fill="#fff"/>${[0, 2, 4, 6].map(i => `<rect y="${i * f}" width="${w}" height="${f}" fill="#b22234"/>`).join('')}<rect width="${w * 0.42}" height="${f * 4}" fill="#3c3b6e"/></g>`; };
module.exports = { bandeiraBR, bandeiraUS };

// Linha "bandeira + texto" centralizada como um bloco: estima a largura do texto (DejaVu Sans ≈ 0,6 em por letra)
// e diminui a fonte quando a frase não cabe em `max` px, para a bandeira nunca encostar no texto.
const escTxt = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function linhaComBandeira(bandeira, texto, y, { size = 40, max = 960, fill = '#f3e7d3', bold = false, cx = 540 } = {}) {
  const fator = bold ? 0.64 : 0.6, fw = Math.round(size * 1.2), gap = Math.round(size * 0.4);
  let s = size;
  while (s > 26 && fw + gap + String(texto).length * s * fator > max) s -= 2;
  const larg = String(texto).length * s * fator, x0 = Math.round(cx - (fw + gap + larg) / 2);
  return `${bandeira(x0, Math.round(y - s * 0.78), fw)}<text x="${x0 + fw + gap}" y="${y}" font-family="DejaVu Sans"${bold ? ' font-weight="bold"' : ''} font-size="${s}" fill="${fill}">${escTxt(texto)}</text>`;
}
module.exports.linhaComBandeira = linhaComBandeira;
