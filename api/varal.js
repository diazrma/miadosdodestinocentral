// Varal das Lembranças: fotos de bichinhos presas no fio vermelho do site da série (o site chama /api/varal, repassado para cá).
// Público:
//   GET ?de=0&n=24&tipo=estrela|aqui&ordem=recentes|curtidas&q=nome -> { itens, total } (só aprovadas)
//   GET ?id=xxx                          -> { item }
//   POST { acao: 'enviar', nome, tipo, anos, msg, autor, foto } -> { ok, id } entra na fila; só aparece depois que a equipe aprova
//   POST { acao: 'vela', id }            -> { velas } uma vela por pessoa (IP) por foto a cada 24h
//   POST { acao: 'curtir', id, sim }     -> { curtidas, curti } uma curtida por pessoa (conta logada ou IP), dá para desfazer
// Conta de quem pendura (login por link no e-mail, sessão no cabeçalho x-varal):
//   POST { acao: 'entrar', email, idioma } -> { ok } manda o link (vale 30 min, uma vez)
//   POST { acao: 'confirmar', t }        -> { sessao, email } sessão de 30 dias
//   POST { acao: 'minhas' }              -> { itens } as da pessoa, com status fila|ok
//   POST { acao: 'apagar', id }          -> { ok } a pessoa tira a própria foto
// Equipe (menu Publicar ou Posts):
//   POST { acao: 'fila' }                -> { fila, total } esperando aprovação
//   POST { acao: 'aprovar', id, ...textos corrigidos } / { acao: 'recusar', id } / { acao: 'remover', id }
// Reels semanal (lib/varal-post.js, a Milka de exemplo balançando no fio):
//   GET ?post=1 (Vercel Cron às quintas, Bearer CRON_SECRET) -> publica uma vez por quinta se estiver ligado
//   POST { acao: 'post_status' | 'post_ligar', ativo | 'post_previa' | 'post_agora' } (equipe com menu Publicar)
// A foto é refeita aqui (sharp): gira pelo EXIF, reduz para 1000px e sai sem metadados (sem GPS da casa de ninguém).
const crypto = require('crypto');
const sharp = require('sharp');
const blob = require('@vercel/blob');
const B = { put: (...a) => blob.put(...a), del: (...a) => blob.del(...a) }; // trocável nos testes
const { rd, PFX, auth, dbGet, dbSet } = require('../lib/db');
const igPost = require('../lib/ig-post');
const { cred } = require('../lib/blob');
const email = require('../lib/email');

const K = {
  item: id => PFX + 'varal:i:' + id, fila: PFX + 'varal:fila', ok: PFX + 'varal:ok', okTipo: t => PFX + 'varal:ok:' + t,
  top: PFX + 'varal:top', topTipo: t => PFX + 'varal:top:' + t, // aprovadas por número de curtidas
  dono: h => PFX + 'varal:dono:' + h, link: t => PFX + 'varal:link:' + t, curt: (id, quem) => PFX + 'varal:curt:' + id + ':' + quem,
};
const SITE = process.env.VARAL_SITE || 'https://miados-do-destino.vercel.app';
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const TIPOS = ['estrela', 'aqui']; // estrela = já partiu, aqui = ainda ao lado
const MAX_FOTO = 4 * 1024 * 1024, POR_HORA = 4, MAX_FILA = 300;
const PROIB = /(porra|caralho|merda|puta|fdp|buceta|piroca|viado|cuzao|arrombad|pqp|vsf|fuck|shit)/i;
const txt = (s, max) => String(s || '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const ipDe = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
const hashIp = ip => crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
const hashEmail = e => hashIp('varal-email:' + e);
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// sessão de quem pendura: só o hash do e-mail, assinada com o mesmo segredo da Central (prefixo próprio, não vale como login da equipe)
const assina = p => crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update('varal|' + p).digest('base64url');
const sessao = e => { const p = Buffer.from(JSON.stringify({ h: hashEmail(e), e, exp: Date.now() + 30 * 864e5 })).toString('base64url'); return p + '.' + assina(p); };
function dono(req) {
  try {
    const [p, s] = String(req.headers['x-varal'] || '').split('.');
    if (!p || !s || s !== assina(p)) return null;
    const o = JSON.parse(Buffer.from(p, 'base64url'));
    return o.exp > Date.now() ? o : null;
  } catch (e) { return null; }
}

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
const publico = i => ({ id: i.id, nome: i.nome, tipo: i.tipo, anos: i.anos, msg: i.msg, autor: i.autor, img: i.img, w: i.w, h: i.h, velas: i.velas || 0, curtidas: i.curtidas || 0, em: i.aprovadoEm || i.criado });
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
  const d = dono(req);
  const i = { id, ...v.t, img: up.url, w: img.info.width, h: img.info.height, velas: 0, curtidas: 0, criado: Date.now(), status: 'fila', ...(d ? { dono: d.h } : {}) };
  await grava(i);
  await rd(['ZADD', K.fila, i.criado, id]);
  if (d) await rd(['ZADD', K.dono(d.h), i.criado, id]);
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
async function curtir(req, b) {
  const [i] = await pega([String(b.id || '')]);
  if (!i || i.status !== 'ok') return { code: 404, erro: 'Lembrança não encontrada' };
  const d = dono(req), k = K.curt(i.id, d ? 'e' + d.h : 'ip' + hashIp(ipDe(req)));
  const mudou = b.sim === false ? +(await rd(['DEL', k])) : await rd(['SET', k, '1', 'NX']);
  if (!mudou) return { curtidas: i.curtidas || 0, curti: b.sim !== false };
  i.curtidas = Math.max(0, (i.curtidas || 0) + (b.sim === false ? -1 : 1));
  await grava(i);
  await rd(['ZADD', K.top, i.curtidas, i.id]);
  await rd(['ZADD', K.topTipo(i.tipo), i.curtidas, i.id]);
  return { curtidas: i.curtidas, curti: b.sim !== false };
}
async function lista(q) {
  const de = Math.max(0, Math.floor(+q.de || 0)), n = Math.min(60, Math.max(1, Math.floor(+q.n || 24)));
  const tipo = TIPOS.includes(q.tipo) ? q.tipo : '';
  const k = q.ordem === 'curtidas' ? (tipo ? K.topTipo(tipo) : K.top) : (tipo ? K.okTipo(tipo) : K.ok);
  const busca = semAcento(q.q).trim().slice(0, 30);
  if (busca) { // poucas centenas de fotos: filtra aqui mesmo
    const todas = (await pega(await rd(['ZREVRANGE', k, 0, 499]) || [])).filter(i => i.status === 'ok' && semAcento(i.nome + ' ' + i.autor).includes(busca));
    return { itens: todas.slice(de, de + n).map(publico), total: todas.length };
  }
  const [ids, total] = await Promise.all([rd(['ZREVRANGE', k, de, de + n - 1]), rd(['ZCARD', k])]);
  return { itens: (await pega(ids || [])).filter(i => i.status === 'ok').map(publico), total: +total || 0 };
}
const tira = async (req, i) => {
  await B.del(i.img, cred(req)).catch(() => {});
  await rd(['DEL', K.item(i.id)]);
  for (const k of [K.fila, K.ok, K.top, ...TIPOS.map(K.okTipo), ...TIPOS.map(K.topTipo), ...(i.dono ? [K.dono(i.dono)] : [])]) await rd(['ZREM', k, i.id]);
};

// conta de quem pendura
const MAIL = {
  pt: { assunto: 'Seu link para entrar no Varal das Lembranças', titulo: 'Varal das Lembranças', texto: 'Toque no botão para entrar e ver as lembranças que você pendurou. O link vale por 30 minutos e só funciona uma vez.', botao: 'Entrar no varal', ignore: 'Não pediu? É só ignorar este e-mail.' },
  en: { assunto: 'Your link to the Memory Line', titulo: 'The Memory Line', texto: 'Tap the button to sign in and see the memories you hung. The link works for 30 minutes and only once.', botao: 'Open the line', ignore: "Didn't ask for it? Just ignore this email." },
};
async function entrar(req, b) {
  const e = String(b.email || '').trim().toLowerCase().slice(0, 120);
  if (!EMAIL.test(e)) return { code: 400, erro: b.idioma === 'en' ? 'Check your email address.' : 'Confira o e-mail.' };
  for (const k of [PFX + 'varal:entrar:ip:' + hashIp(ipDe(req)), PFX + 'varal:entrar:e:' + hashEmail(e)]) {
    const n = +(await rd(['INCR', k])); if (n === 1) await rd(['EXPIRE', k, 3600]);
    if (n > (k.includes(':ip:') ? 8 : 4)) return { code: 429, erro: b.idioma === 'en' ? 'Too many links. Try again later.' : 'Muitos links pedidos. Tente daqui a pouco.' };
  }
  const t = crypto.randomBytes(24).toString('base64url');
  await rd(['SET', K.link(t), e, 'EX', 1800]);
  const m = MAIL[b.idioma === 'en' ? 'en' : 'pt'], url = SITE + '/varal/entrar?t=' + t;
  const r = await email.enviar({
    from: `Miados do Destino <${process.env.GMAIL_USER}>`, to: e, subject: m.assunto,
    text: `${m.texto}\n\n${url}\n\n${m.ignore}`,
    html: `<div style="background:#100c08;padding:28px 14px;font-family:Georgia,serif;color:#f3e7d3"><div style="max-width:520px;margin:0 auto;text-align:center">
<p style="letter-spacing:4px;color:#d9b46a;font-size:12px;margin:0 0 8px">MIADOS DO DESTINO</p>
<h1 style="font-weight:normal;font-size:28px;margin:0 0 16px">${m.titulo}</h1>
<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#e8dcc8">${m.texto}</p>
<p style="margin:26px 0"><a href="${url}" style="background:#d9a43a;color:#1a120a;text-decoration:none;padding:13px 26px;border-radius:999px;font-family:Arial,sans-serif;font-weight:bold">${m.botao}</a></p>
<p style="font-family:Arial,sans-serif;font-size:12px;color:#9a8b74">${m.ignore}</p></div></div>`,
  });
  return r.erro ? { code: 500, erro: r.erro } : { ok: 1 };
}
async function confirmar(b) {
  const t = String(b.t || '').slice(0, 64), e = t && await rd(['GET', K.link(t)]);
  if (!e) return { code: 400, erro: 'Esse link já foi usado ou venceu. Peça outro.' };
  await rd(['DEL', K.link(t)]);
  return { sessao: sessao(e), email: e };
}
async function daPessoa(req, b) {
  const d = dono(req);
  if (!d) return { code: 401, erro: 'Entre de novo com seu e-mail.' };
  if (b.acao === 'minhas') {
    const ids = await rd(['ZREVRANGE', K.dono(d.h), 0, 99]) || [];
    return { itens: (await pega(ids)).map(i => ({ ...publico(i), status: i.status })) };
  }
  const [i] = await pega([String(b.id || '')]);
  if (!i || i.dono !== d.h) return { code: 404, erro: 'Lembrança não encontrada' };
  await tira(req, i);
  return { ok: 1 };
}
// Reels de quinta
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const quinta = d => new Date(d + 'T12:00:00Z').getUTCDay() === 4;
const cfgPost = async () => ({ ativo: true, ...(await dbGet('varal_post_cfg').catch(() => null) || {}) });
async function videoNoBlob(req, nome) {
  const { videoVaral } = require('../lib/varal-post');
  return B.put(`publicar/${nome}.mp4`, await videoVaral(), { access: 'public', contentType: 'video/mp4', addRandomSuffix: true, ...cred(req) });
}
async function postSemanal(req, por, forcar) {
  const data = hojeBR();
  if (!forcar && !quinta(data)) return { fora: true, data };
  if (!forcar && !(await cfgPost()).ativo) return { desligado: true };
  const ult = await dbGet('varal_post').catch(() => null);
  if (!forcar && ult && ult.data === data) return { ...ult, repetido: true };
  const av = require('../lib/avisos'), { legendaDa } = require('../lib/varal-post');
  let r;
  try {
    const up = await videoNoBlob(req, 'varal-' + data);
    try { r = await igPost.publicarIG({ media_type: 'REELS', video_url: up.url, caption: legendaDa(data), share_to_feed: 'true', thumb_offset: '4500' }); }
    finally { await B.del(up.url, cred(req)).catch(() => {}); }
  } catch (e) { await av.falhou('Reels do Varal das Lembranças', e).catch(() => {}); throw e; }
  await av.publicado('Reels do Varal das Lembranças (Milka)', r).catch(() => {});
  const reg = { data, ...r, por, quando: new Date().toISOString() };
  await dbSet('varal_post', reg);
  return reg;
}
async function postEquipe(req, b, a) {
  if (!a.menus.includes('publicar')) return { code: 403, erro: 'Sem permissão para publicar' };
  if (b.acao === 'post_ligar') await dbSet('varal_post_cfg', { ...(await cfgPost()), ativo: !!b.ativo });
  if (b.acao === 'post_previa') {
    const ant = await dbGet('varal_post_previa').catch(() => null);
    if (ant && ant.url) await B.del(ant.url, cred(req)).catch(() => {});
    const up = await videoNoBlob(req, 'varal-previa');
    await dbSet('varal_post_previa', { url: up.url, quando: new Date().toISOString() });
  }
  if (b.acao === 'post_agora') await postSemanal(req, a.u.nome || a.u.email || 'Equipe', true);
  const { legendaDa } = require('../lib/varal-post');
  return { cfg: await cfgPost(), ultimo: await dbGet('varal_post').catch(() => null), previa: await dbGet('varal_post_previa').catch(() => null), legenda: legendaDa(hojeBR()) };
}

async function equipe(req, b) {
  const a = await auth(req);
  if (!a) return { code: 401, erro: 'Faça login' };
  if (/^post_/.test(b.acao || '')) return postEquipe(req, b, a);
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
    await rd(['ZREM', K.topTipo(i.tipo === 'aqui' ? 'estrela' : 'aqui'), i.id]);
    await rd(['ZADD', K.top, i.curtidas || 0, i.id]);
    await rd(['ZADD', K.topTipo(i.tipo), i.curtidas || 0, i.id]);
    return { ok: 1, item: publico(i) };
  }
  if (b.acao === 'recusar' || b.acao === 'remover') {
    await tira(req, i);
    return { ok: 1 };
  }
  return { code: 400, erro: 'Ação inválida' };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET' && (req.query || {}).post) {
      res.setHeader('Cache-Control', 'no-store');
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      return res.json(await postSemanal(req, 'Agendamento'));
    }
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
      const q = req.query || {};
      if (q.id) { const [i] = await pega([String(q.id)]); return i && i.status === 'ok' ? res.json({ item: publico(i) }) : res.status(404).json({ erro: 'Lembrança não encontrada' }); }
      return res.json(await lista(q));
    }
    res.setHeader('Cache-Control', 'no-store');
    const b = req.body || {};
    const pub = { enviar: () => enviar(req, b), vela: () => vela(req, b.id), curtir: () => curtir(req, b), entrar: () => entrar(req, b), confirmar: () => confirmar(b), minhas: () => daPessoa(req, b), apagar: () => daPessoa(req, b) };
    const r = await (pub[b.acao] || (() => equipe(req, b)))();
    const { code, ...j } = r;
    res.status(code || 200).json(j);
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { textos, foto, publico, B, TIPOS, email };
