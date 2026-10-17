// Story do Sussurro do dia: escreve o recado sobre o fundo pronto do gato (sussurro/fundo_<gato>.jpg) e publica no Instagram.
// A Vercel não tem fontes no sistema: o fontconfig usa as de fonts/ (Cinzel e DejaVu Sans), por isso a variável vem antes do sharp.
const path = require('path');
process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || path.join(__dirname, '..', 'fonts');
const sharp = require('sharp');
const { put, del } = require('@vercel/blob');
const { cred } = require('./blob');
const { igToken } = require('./ig');

const NOMES = { naru: 'Naru', merlin: 'Merlin', zelda: 'Zelda', spark: 'Spark', milka: 'Milka' };
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** JPEG 1080x1920: o gato do dia com o envelope lacrado. O recado não aparece; ele fica no app (o story é a isca). */
async function cartao(gato) {
  const g = NOMES[gato] ? gato : 'naru', n = esc(NOMES[g]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <text x="540" y="1110" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="70" fill="#e2b23e">${n} deixou</text>
    <text x="540" y="1195" text-anchor="middle" font-family="Cinzel" font-weight="bold" font-size="70" fill="#e2b23e">um sussurro para você</text>
    <g transform="translate(400 1260)">
      <rect x="0" y="0" width="280" height="180" rx="14" fill="#f3e7d3" stroke="#a8761e" stroke-width="4"/>
      <path d="M4 8 L140 108 L276 8" fill="none" stroke="#a8761e" stroke-width="5"/>
      <circle cx="140" cy="108" r="34" fill="#c61c26"/><circle cx="140" cy="108" r="24" fill="none" stroke="#7d0f16" stroke-width="3"/>
    </g>
    <text x="540" y="1540" text-anchor="middle" font-family="DejaVu Sans" font-size="44" fill="#f3e7d3">O envelope de hoje está lacrado.</text>
    <text x="540" y="1612" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="44" fill="#e2b23e">Abra no app · link na bio</text>
  </svg>`;
  return sharp(path.join(__dirname, '..', 'sussurro', `fundo_${g}.jpg`))
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

async function ig(p, q, post) {
  const b = new URLSearchParams({ ...q, access_token: await igToken() });
  const r = await fetch('https://graph.instagram.com' + p + (post ? '' : '?' + b), post ? { method: 'POST', body: b } : {});
  const j = await r.json();
  if (j.error) throw new Error('Instagram: ' + (j.error.error_user_msg || j.error.message));
  return j;
}

/** Publica o cartão como story. Devolve { id, link }. */
async function publicar(s, req) {
  if (!(await igToken())) throw new Error('Instagram não conectado');
  const img = await cartao(s.gato);
  const blob = await put(`publicar/sussurro-${s.data}.jpg`, img, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, ...cred(req) });
  try {
    const uid = (await ig('/me', { fields: 'user_id' })).user_id;
    const { id } = await ig('/' + uid + '/media', { media_type: 'STORIES', image_url: blob.url }, 1);
    for (let i = 0; i < 15; i++) {  // a imagem costuma ficar pronta em poucos segundos
      const st = await ig('/' + id, { fields: 'status_code' });
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR') throw new Error('Instagram recusou a imagem do story');
      await new Promise(r => setTimeout(r, 2000));
    }
    const pub = await ig('/' + uid + '/media_publish', { creation_id: id }, 1);
    const link = await ig('/' + pub.id, { fields: 'permalink' }).then(j => j.permalink).catch(() => '');
    return { id: pub.id, link };
  } finally { await del(blob.url, cred(req)).catch(() => {}); }
}

module.exports = { cartao, publicar };
