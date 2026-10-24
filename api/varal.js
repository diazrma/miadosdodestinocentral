// Varal das Lembranças: fotos de bichinhos presas no fio vermelho do site da série (o site chama /api/varal, repassado para cá).
// Público:
//   GET ?de=0&n=24&tipo=estrela|aqui     -> { itens, total } (só aprovadas, mais novas primeiro)
//   GET ?id=xxx                          -> { item }
//   POST { acao: 'enviar', nome, tipo, anos, msg, autor, foto } -> { ok, id } entra na fila; só aparece depois que a equipe aprova
//   POST { acao: 'vela', id }            -> { velas } uma vela por pessoa (IP) por foto a cada 24h
// Equipe (menu Publicar ou Posts):
//   POST { acao: 'fila' }                -> { fila, total } esperando aprovação
//   POST { acao: 'aprovar', id, ...textos corrigidos } / { acao: 'recusar', id } / { acao: 'remover', id }
// A foto é refeita aqui (sharp): gira pelo EXIF, reduz para 1000px e sai sem metadados (sem GPS da casa de ninguém).
const crypto = require('crypto');
const sharp = require('sharp');
const blob = require('@vercel/blob');
const B = { put: (...a) => blob.put(...a), del: (...a) => blob.del(...a) }; // trocável nos testes
const { rd, PFX, auth } = require('../lib/db');
const { cred } = require('../lib/blob');

const K = { item: id => PFX + 'varal:i:' + id, fila: PFX + 'varal:fila', ok: PFX + 'varal:ok', okTipo: t => PFX + 'varal:ok:' + t };
const TIPOS = ['estrela', 'aqui']; // estrela = já partiu, aqui = ainda ao lado
const MAX_FOTO = 4 * 1024 * 1024, POR_HORA = 4, MAX_FILA = 300;
const PROIB = /(porra|caralho|merda|puta|fdp|buceta|piroca|viado|cuzao|arrombad|pqp|vsf|fuck|shit)/i;
const txt = (s, max) => String(s || '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const ipDe = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
const hashIp = ip => crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);

// valida e limpa os textos do envio (testável, sem banco)
function textos(b) {
  const t = { nome: txt(b.nome, 30), tipo: TIPOS.includes(b.tipo) ? b.tipo : 'estrela', anos: txt(b.anos, 24), msg: txt(b.msg, 280), autor: txt(b.autor, 30) };
  if (t.nome.length < 1) return { erro: 'Qual o nome do bichinho?' };
  const tudo = [t.nome, t.anos, t.msg, t.autor].join(' ');
  if (/https?:|www\.|\.com\b/i.test(tudo)) return { erro: 'Sem links, por favor.' };
  if (PROIB.test(tudo.replace(/[^a-z\s]/gi, ''))) return { erro: 'Escreva com carinho, sem palavrões.' };
  return { t };
}
// confere que é imagem de verdade pelos primeiros bytes (jpeg, png, webp, heic do iPhone já convertido pelo navegador)
function foto(b64) {
  const buf = Buffer.from(String(b64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length > MAX_FOTO) return { erro: 'Foto grande demais (máx. 4 MB).' };
  const jpg = buf[0] === 0xff && buf[1] === 0xd8, png = buf.slice(0, 4).toString('hex') === '89504e47', webp = buf.slice(8, 12).toString() === 'WEBP';
  if (buf.length < 100 || !(jpg || png || webp)) return { erro: 'Envie uma foto (JPG, PNG ou WEBP).' };
  return { buf };
}
const publico = i => ({ id: i.id, nome: i.nome, tipo: i.tipo, anos: i.anos, msg: i.msg, autor: i.autor, img: i.img, w: i.w, h: i.h, velas: i.velas || 0, em: i.aprovadoEm || i.criado });
async function pega(ids) {
  if (!ids.length) return [];
  const v = await rd(['MGET', ...ids.map(K.item)]) || [];
  return v.map(x => x && JSON.parse(x)).filter(Boolean);
}
const grava = i => rd(['SET', K.item(i.id), JSON.stringify(i)]);

async function enviar(req, b) {
  if (b.site) return { ok: 1, id: 'x' }; // campo escondido preenchido = robô; finge que deu certo
  const v = textos(b); if (v.erro) return { code: 400, erro: v.erro };
  const f = foto(b.foto); if (f.erro) return { code: 400, erro: f.erro };
  const kip = PFX + 'varal:ip:' + hashIp(ipDe(req));
  const n = +(await rd(['INCR', kip])); if (n === 1) await rd(['EXPIRE', kip, 3600]);
  if (n > POR_HORA) return { code: 429, erro: 'Você já pendurou várias lembranças agora. Tente de novo daqui a pouco.' };
  if (+(await rd(['ZCARD', K.fila])) >= MAX_FILA) return { code: 503, erro: 'O varal está cheio de fotos esperando a equipe. Tente amanhã.' };
  let img;
  try { img = await sharp(f.buf, { failOn: 'error' }).rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true }); }
  catch (e) { return { code: 400, erro: 'Não consegui abrir essa foto. Tente outra.' }; }
  const id = crypto.randomBytes(5).toString('hex');
  const up = await B.put('varal/' + id + '.jpg', img.data, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, ...cred(req) });
  const i = { id, ...v.t, img: up.url, w: img.info.width, h: img.info.height, velas: 0, criado: Date.now(), status: 'fila' };
  await grava(i);
  await rd(['ZADD', K.fila, i.criado, id]);
  await require('../lib/avisos').avisar('varal_novo', '🧺 Lembrança nova no varal', `${i.nome}${i.autor ? ' (de ' + i.autor + ')' : ''} espera aprovação em Conteúdo › Varal.`).catch(() => {});
  return { ok: 1, id };
}
async function vela(req, id) {
  const [i] = await pega([String(id || '')]);
  if (!i || i.status !== 'ok') return { code: 404, erro: 'Lembrança não encontrada' };
  if (!(await rd(['SET', PFX + 'varal:vela:' + i.id + ':' + hashIp(ipDe(req)), '1', 'NX', 'EX', 86400]))) return { velas: i.velas || 0, ja: 1 };
  i.velas = (i.velas || 0) + 1; await grava(i);
  return { velas: i.velas };
}
async function lista(q) {
  const de = Math.max(0, Math.floor(+q.de || 0)), n = Math.min(60, Math.max(1, Math.floor(+q.n || 24)));
  const k = TIPOS.includes(q.tipo) ? K.okTipo(q.tipo) : K.ok;
  const [ids, total] = await Promise.all([rd(['ZREVRANGE', k, de, de + n - 1]), rd(['ZCARD', k])]);
  return { itens: (await pega(ids || [])).filter(i => i.status === 'ok').map(publico), total: +total || 0 };
}
async function equipe(req, b) {
  const a = await auth(req);
  if (!a) return { code: 401, erro: 'Faça login' };
  if (!a.menus.includes('publicar') && !a.menus.includes('posts')) return { code: 403, erro: 'Sem permissão para o varal' };
  if (b.acao === 'fila') {
    const ids = await rd(['ZRANGE', K.fila, 0, 99]) || [];
    const ok = await rd(['ZREVRANGE', K.ok, 0, 59]) || [];
    return { fila: await pega(ids), aprovadas: (await pega(ok)).map(publico), total: +(await rd(['ZCARD', K.ok])) || 0 };
  }
  const [i] = await pega([String(b.id || '')]);
  if (!i) return { code: 404, erro: 'Lembrança não encontrada' };
  if (b.acao === 'aprovar') {
    const v = textos({ ...i, ...b }); if (v.erro) return { code: 400, erro: v.erro };
    Object.assign(i, v.t, { status: 'ok', aprovadoEm: Date.now(), por: a.u.nome || a.u.email || '' });
    await grava(i);
    await rd(['ZREM', K.fila, i.id]);
    await rd(['ZADD', K.ok, i.aprovadoEm, i.id]);
    await rd(['ZREM', K.okTipo(i.tipo === 'aqui' ? 'estrela' : 'aqui'), i.id]);
    await rd(['ZADD', K.okTipo(i.tipo), i.aprovadoEm, i.id]);
    return { ok: 1, item: publico(i) };
  }
  if (b.acao === 'recusar' || b.acao === 'remover') {
    await B.del(i.img, cred(req)).catch(() => {});
    await rd(['DEL', K.item(i.id)]);
    for (const k of [K.fila, K.ok, ...TIPOS.map(K.okTipo)]) await rd(['ZREM', k, i.id]);
    return { ok: 1 };
  }
  return { code: 400, erro: 'Ação inválida' };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
      const q = req.query || {};
      if (q.id) { const [i] = await pega([String(q.id)]); return i && i.status === 'ok' ? res.json({ item: publico(i) }) : res.status(404).json({ erro: 'Lembrança não encontrada' }); }
      return res.json(await lista(q));
    }
    res.setHeader('Cache-Control', 'no-store');
    const b = req.body || {};
    const r = b.acao === 'enviar' ? await enviar(req, b) : b.acao === 'vela' ? await vela(req, b.id) : await equipe(req, b);
    const { code, ...j } = r;
    res.status(code || 200).json(j);
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { textos, foto, publico, B, TIPOS };
