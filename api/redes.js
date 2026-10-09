// TikTok e Kwai: fila diária com os posts do Instagram, sem repetir o que já foi (ou já existia) em cada rede.
//
// TikTok publica sozinho pela Content Posting API (precisa do app no TikTok for Developers; até a auditoria
// ser aprovada, o TikTok só deixa publicar como privado). Kwai não tem API de publicação: a Central separa o
// post do dia e avisa a equipe no celular para postar com dois toques.
//
// GET  /api/redes?horario=a|b|c               -> agendado (Vercel Cron, 12h/16h/19h): posta no TikTok (1 a 3 por dia) e,
//                                                ao meio-dia, separa o do Kwai
// GET  /tiktok/retorno?code=…                -> volta do login do TikTok (OAuth; rewrite para ?acao=tiktok_retorno)
// GET  /midia/<arquivo>                       -> imagens públicas para o TikTok puxar (prefixo verificado) e o
//                                                arquivo de verificação do TikTok (rewrite em vercel.json)
// POST /api/redes (equipe com o menu Publicar):
//      { acao: 'estado' }                      fila + conexão + configuração
//      { acao: 'atualizar' }                   puxa os posts novos do Instagram e compara com o que já está no TikTok
//      { acao: 'marcar', id, rede, estado }    estado: fila | postado | ja_tinha | pular
//      { acao: 'publicar_agora', id }          publica já no TikTok (fora do horário)
//      { acao: 'mover', id, posicao }          muda a ordem (topo | fim)
//      { acao: 'midia', id }                   arquivos para baixar (Kwai)
//      { acao: 'config', config }              { ativo, kwaiAviso, tiktokPorDia: 1 | 2 | 3 }
//      { acao: 'tiktok_login' }                devolve a URL de login do TikTok
//      { acao: 'tiktok_verificacao', nome, conteudo }  arquivo de verificação do prefixo de URL
//      { acao: 'tiktok_sair' }
const crypto = require('crypto');
const { auth, dbGet, dbSet } = require('../lib/db');
const { enviarPush } = require('../lib/fcm');

const CENTRAL = 'https://miadosdodestinocentral.vercel.app';
const IG = 'https://graph.instagram.com';
const TT = 'https://open.tiktokapis.com';
const REDIRECT = CENTRAL + '/tiktok/retorno'; // o TikTok não aceita ? no Redirect URI: rewrite em vercel.json
const ESCOPOS = 'user.info.basic,video.publish,video.upload,video.list';
// horários do TikTok (Vercel Cron em UTC): a = 12h, b = 16h, c = 19h de Brasília.
// alvo = quantos posts do dia já devem ter saído depois daquele horário, conforme posts por dia (1, 2 ou 3)
const ALVO = { 1: { a: 1 }, 2: { a: 1, c: 2 }, 3: { a: 1, b: 2, c: 3 } };
// chaves do app no TikTok: 'teste' (Sandbox) e 'definitiva' (Production, vale depois da aprovação)
const chaves = tipo => tipo === 'definitiva'
  ? { key: process.env.TIKTOK_PROD_CLIENT_KEY, secret: process.env.TIKTOK_PROD_CLIENT_SECRET }
  : { key: process.env.TIKTOK_CLIENT_KEY, secret: process.env.TIKTOK_CLIENT_SECRET };
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- dados
const ler = async () => (await dbGet('redes')) || { itens: {}, ordem: [], config: { ativo: true, kwaiAviso: true }, log: [] };
const gravar = r => dbSet('redes', { ...r, log: (r.log || []).slice(-60) });
const registrar = (r, rede, texto) => { r.log = [...(r.log || []), { quando: new Date().toISOString(), rede, texto }]; };

// texto comparável: sem acento, hashtag, emoji, link e pontuação
const normal = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function parecido(a, b) {
  const A = new Set(normal(a).split(' ').filter(w => w.length > 2)), B = new Set(normal(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return false;
  let comum = 0; for (const w of A) if (B.has(w)) comum++;
  return comum / Math.min(A.size, B.size) >= 0.6;
}

// ---------------------------------------------------------------- Instagram
async function igGet(path, q = {}) {
  const u = new URL(IG + path);
  Object.entries({ ...q, access_token: process.env.IG_TOKEN }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u)).json();
  if (j.error) throw new Error('Instagram: ' + j.error.message);
  return j;
}
async function postsInstagram() {
  let path = '/me/media', q = { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count', limit: 50 }, out = [];
  for (let i = 0; i < 8; i++) {
    const j = await igGet(path, q);
    out.push(...j.data);
    if (!j.paging?.next) break;
    const nx = new URL(j.paging.next); path = nx.pathname; q = Object.fromEntries(nx.searchParams);
  }
  return out;
}
// as URLs do Instagram expiram: busca na hora de publicar
async function midiaInstagram(id) {
  const m = await igGet('/' + id, { fields: 'media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}' });
  if (m.media_type === 'CAROUSEL_ALBUM') {
    const filhos = m.children?.data || [];
    return { tipo: filhos.every(c => c.media_type === 'IMAGE') ? 'fotos' : 'misto', fotos: filhos.filter(c => c.media_type === 'IMAGE').map(c => c.media_url), video: (filhos.find(c => c.media_type === 'VIDEO') || {}).media_url };
  }
  if (m.media_type === 'VIDEO') return { tipo: 'video', video: m.media_url, capa: m.thumbnail_url };
  return { tipo: 'fotos', fotos: [m.media_url] };
}

async function ajustarFoto(buf) {
  const sharp = require('sharp');
  return sharp(buf).rotate().resize({ width: 1080, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}

// ---------------------------------------------------------------- TikTok
async function ttConta(r) {
  const c = await dbGet('tiktok_conta');
  if (!c) return null;
  if (Date.now() < c.expira - 5 * 60e3) return c;
  const k = chaves(c.chaves);
  // renova o token (dura 24 h; o de renovação, 1 ano)
  const j = await (await fetch(TT + '/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: k.key, client_secret: k.secret, grant_type: 'refresh_token', refresh_token: c.refresh }) })).json();
  if (!j.access_token) { if (r) registrar(r, 'tiktok', 'Não consegui renovar o acesso ao TikTok: conecte de novo.'); return null; }
  const n = { ...c, token: j.access_token, refresh: j.refresh_token || c.refresh, expira: Date.now() + j.expires_in * 1000 };
  await dbSet('tiktok_conta', n);
  return n;
}
// erros comuns do TikTok, em português
const TT_ERROS = {
  unaudited_client_can_only_post_to_private_accounts: 'enquanto o app não for aprovado na revisão, o TikTok só publica direto em conta privada',
  spam_risk_too_many_posts: 'limite de posts do dia atingido no TikTok',
  spam_risk_too_many_pending_share: 'já há 5 rascunhos esperando na caixa de entrada do TikTok: publique ou apague algum',
  reached_active_user_cap: 'limite diário de usuários do app atingido',
  privacy_level_option_mismatch: 'opção de privacidade não permitida para essa conta',
  url_ownership_unverified: 'o endereço /midia/ ainda não foi verificado no TikTok for Developers (URL properties)',
  scope_not_authorized: 'falta permissão: conecte o TikTok de novo'
};
async function tt(c, path, body, q = '') {
  const r = await fetch(TT + path + q, { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (j.error && j.error.code !== 'ok') throw Object.assign(new Error('TikTok: ' + (TT_ERROS[j.error.code] || j.error.message || j.error.code)), { codigo: j.error.code });
  return j.data || {};
}
async function videosTikTok(c) {
  const out = []; let cursor;
  for (let i = 0; i < 10; i++) {
    const d = await tt(c, '/v2/video/list/', { max_count: 20, ...(cursor ? { cursor } : {}) }, '?fields=id,title,video_description,create_time,share_url,cover_image_url,view_count,like_count,comment_count,share_count');
    out.push(...(d.videos || []));
    if (!d.has_more) break; cursor = d.cursor;
  }
  return out;
}
// título até 90 caracteres, descrição até 4000; marca como conteúdo de IA
function textos(legenda) {
  const l = String(legenda || '').trim();
  const titulo = (l.split('\n').find(x => x.trim()) || 'Miados do Destino').slice(0, 89);
  return { titulo, descricao: l.slice(0, 3990) };
}
// opções de publicação escolhidas pela equipe na Central (exigência das regras do TikTok para Direct Post)
const ttOpcoes = r => ({ privacidade: '', comentarios: true, dueto: true, costura: true, marcaPropria: false, rascunho: false, ...(r.config?.tt || {}) });
async function publicarTikTok(c, item, op) {
  if (!op.privacidade) throw new Error('escolha a privacidade nas opções de publicação do TikTok');
  // tenta publicar direto. Enquanto o app não for aprovado, o TikTok recusa: a Central espera a aprovação
  // (ou, se a equipe ligou essa opção, manda como rascunho para a caixa de entrada)
  try { return await enviarTikTok(c, item, 'direto', op); }
  catch (e) {
    if (e.codigo !== 'unaudited_client_can_only_post_to_private_accounts') throw e;
    if (!op.rascunho || !(c.escopos || '').includes('video.upload')) throw Object.assign(new Error('aguardando a aprovação do app no TikTok'), { aguardando: true });
    return await enviarTikTok(c, item, 'rascunho', op);
  }
}
async function enviarTikTok(c, item, modo, op) {
  const m = await midiaInstagram(item.id), { titulo, descricao } = textos(item.legenda);
  let privacidade = 'RASCUNHO', comum = {};
  if (modo === 'direto') {
    const info = await tt(c, '/v2/post/publish/creator_info/query/');
    if (!(info.privacy_level_options || []).includes(op.privacidade)) throw new Error('a privacidade escolhida não está disponível para esta conta: escolha de novo nas opções');
    privacidade = op.privacidade;
    comum = { privacy_level: privacidade, disable_comment: !op.comentarios || !!info.comment_disabled, brand_organic_toggle: !!op.marcaPropria, brand_content_toggle: false };
  }
  if (m.tipo === 'video' || (m.tipo === 'misto' && !m.fotos.length)) {
    // vídeo: baixa do Instagram e envia em um pedaço só (FILE_UPLOAD)
    const buf = Buffer.from(await (await fetch(m.video)).arrayBuffer());
    const source_info = { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: buf.length, total_chunk_count: 1 };
    const d = modo === 'direto'
      ? await tt(c, '/v2/post/publish/video/init/', { post_info: { ...comum, title: descricao.slice(0, 2190), is_aigc: true, disable_duet: !op.dueto, disable_stitch: !op.costura }, source_info })
      : await tt(c, '/v2/post/publish/inbox/video/init/', { source_info });
    const up = await fetch(d.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes 0-${buf.length - 1}/${buf.length}` }, body: buf });
    if (!up.ok) throw new Error('TikTok recusou o envio do vídeo (' + up.status + ')');
    return { publish_id: d.publish_id, privacidade, formato: 'vídeo' };
  }
  // fotos: o TikTok puxa de um endereço verificado (/midia/ na Central)
  const fotos = m.fotos.slice(0, 35).map((_, i) => `${CENTRAL}/midia/${item.id}_${i}.jpg`);
  const d = await tt(c, '/v2/post/publish/content/init/', { media_type: 'PHOTO', post_mode: modo === 'direto' ? 'DIRECT_POST' : 'MEDIA_UPLOAD', ...(modo === 'direto' ? { is_aigc: true } : {}),
    post_info: { ...comum, title: titulo, description: descricao, ...(modo === 'direto' ? { auto_add_music: true } : {}) }, source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: fotos } });
  return { publish_id: d.publish_id, privacidade, formato: fotos.length > 1 ? `carrossel (${fotos.length} fotos)` : 'foto' };
}

// ---------------------------------------------------------------- fila
function proximo(r, rede) {
  return r.ordem.map(id => r.itens[id]).find(x => x && (x[rede]?.estado || 'fila') === 'fila');
}
async function atualizar(r) {
  const posts = await postsInstagram();
  const novos = [];
  for (const p of posts) {
    const antigo = r.itens[p.id];
    const base = { id: p.id, data: p.timestamp, tipo: p.media_product_type === 'REELS' ? 'reels' : p.media_type === 'CAROUSEL_ALBUM' ? 'carrossel' : p.media_type === 'VIDEO' ? 'video' : 'foto',
      legenda: p.caption || '', link: p.permalink, engaj: (p.like_count || 0) + 2 * (p.comments_count || 0) };
    r.itens[p.id] = { ...base, tiktok: antigo?.tiktok || { estado: 'fila' }, kwai: antigo?.kwai || { estado: 'fila' } };
    if (!antigo) novos.push(p.id);
  }
  // posts novos entram no fim da fila, os mais engajados primeiro; a ordem que a equipe já mexeu fica como está
  novos.sort((x, y) => r.itens[y].engaj - r.itens[x].engaj);
  r.ordem = [...new Set([...r.ordem, ...novos])].filter(id => r.itens[id]);
  // compara com o que já existe no TikTok
  let jaTinha = 0;
  const c = await ttConta(r).catch(() => null);
  if (c && (c.escopos || '').includes('video.list')) {
    const vids = await videosTikTok(c).catch(() => []);
    for (const id of r.ordem) {
      const it = r.itens[id];
      if (it.tiktok.estado !== 'fila') continue;
      const v = vids.find(v => parecido(it.legenda, `${v.title || ''} ${v.video_description || ''}`));
      if (v) { it.tiktok = { estado: 'ja_tinha', quando: v.create_time ? new Date(v.create_time * 1000).toISOString() : null, link: v.share_url || '' }; jaTinha++; }
    }
  }
  r.atualizado = new Date().toISOString();
  return { novos: novos.length, jaTinha, total: r.ordem.length };
}
// confere no TikTok o que aconteceu com os envios recentes (publicado, na caixa de entrada ou falhou)
const STATUS_FINAL = ['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX', 'FAILED'];
async function conferirStatus(r, c) {
  if (!c) return 0;
  const pend = r.ordem.map(id => r.itens[id]).filter(x => x?.tiktok?.publish_id && !STATUS_FINAL.includes(x.tiktok.status) && Date.now() - new Date(x.tiktok.quando) < 3 * 864e5).slice(0, 6);
  for (const it of pend) {
    try {
      const d = await tt(c, '/v2/post/publish/status/fetch/', { publish_id: it.tiktok.publish_id });
      it.tiktok.status = d.status;
      if (d.status === 'FAILED') {
        it.tiktok = { ...it.tiktok, estado: 'pular', erro: d.fail_reason || 'motivo não informado' };
        registrar(r, 'tiktok', `O TikTok recusou depois do envio (${d.fail_reason || 'sem motivo'}): ${textos(it.legenda).titulo}. Ficou como "Pular"; volte para a fila quando quiser tentar de novo.`);
      } else if (d.status === 'PUBLISH_COMPLETE') registrar(r, 'tiktok', 'Confirmado no TikTok: ' + textos(it.legenda).titulo);
      else if (d.status === 'SEND_TO_USER_INBOX') registrar(r, 'tiktok', 'Chegou na caixa de entrada do TikTok (falta tocar em publicar): ' + textos(it.legenda).titulo);
    } catch (e) { it.tiktok.statusErro = e.message; }
  }
  return pend.length;
}
// números do Kwai: lê a página pública do perfil (os 15 vídeos mais recentes). O Kwai não tem API;
// os dados vêm num bloco do site (window.__NUXT__), avaliado num contexto isolado, sem acesso ao servidor
async function numerosKwai(usuario) {
  const h = await (await fetch('https://www.kwai.com/@' + encodeURIComponent(usuario), { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'pt-BR' } })).text();
  const i = h.indexOf('window.__NUXT__='), j = h.indexOf('</script>', i);
  if (i < 0 || j < 0) throw new Error('não consegui ler o perfil do Kwai');
  const d = require('vm').runInNewContext('(' + h.slice(i + 16, j).trim().replace(/;$/, '') + ')', Object.create(null), { timeout: 500 });
  const feeds = (d?.data || []).map(x => x?.feedsData?.feeds).find(Array.isArray) || [];
  const txt = s => String(s || '').replace(/&([a-z]+|#\d+);/gi, (m, e) => ({ amp: '&', quot: '"', ccedil: 'ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à' })[e.toLowerCase()] || (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : m));
  return feeds.filter(v => !v.kwai_id || String(v.kwai_id).toLowerCase() === usuario.toLowerCase() || v.user_name).map(v => ({
    id: String(v.photo_id_str || v.photo_id), titulo: txt(v.caption).slice(0, 160), data: v.timestamp ? new Date(+v.timestamp).toISOString() : null,
    link: `https://www.kwai.com/@${usuario}/video/${v.photo_id_str || v.photo_id}`, capa: (v.cover_thumbnail_urls || [])[0]?.url || '',
    views: +v.view_count || 0, curtidas: +v.like_count || 0, comentarios: +v.comment_count || 0, compart: +v.forward_count || 0 }));
}
const avisarKwai = () => avisarEquipe('📲 Kwai: o post de hoje está pronto', 'Abra a Central › TikTok e Kwai: baixe a imagem, copie a legenda e poste. Depois toque em "Postei".');
async function avisarEquipe(titulo, texto) {
  const ap = (await dbGet('push_aparelhos')) || [];
  let ok = 0;
  // só os celulares marcados como da equipe (Central › App › Aparelhos), nunca o público do app
  for (const a of ap.filter(x => x.equipe).slice(-10)) { try { await enviarPush({ titulo, texto, token: a.token }); ok++; } catch (e) {} }
  return ok;
}
async function diario(r, forcarId, horario = 'a') {
  const out = {};
  // TikTok
  const c = await ttConta(r);
  const itT = forcarId ? r.itens[forcarId] : proximo(r, 'tiktok');
  if (!c) out.tiktok = 'não conectado';
  else if (!itT) out.tiktok = 'fila vazia';
  else if (!forcarId && !ALVO[r.config?.tiktokPorDia || 1][horario]) out.tiktok = 'horário desligado';
  else if (!forcarId && r.ordem.filter(id => r.itens[id]?.tiktok?.dia === hojeBR()).length >= ALVO[r.config?.tiktokPorDia || 1][horario]) out.tiktok = 'já postou neste horário';
  else {
    try {
      const p = await publicarTikTok(c, itT, ttOpcoes(r));
      if (p.privacidade !== 'RASCUNHO') {
        r.aguardando = false;
        // primeiro post público depois da aprovação: avisa a equipe uma vez
        if (p.privacidade !== 'SELF_ONLY' && !r.liberado) { r.liberado = true; registrar(r, 'tiktok', '🎉 O TikTok liberou o app: a partir de agora os posts saem públicos e sozinhos.'); await avisarEquipe('🎉 TikTok liberado', 'O primeiro post automático saiu público no TikTok. A partir de agora é tudo sozinho.'); }
      }
      itT.tiktok = { estado: 'postado', quando: new Date().toISOString(), dia: hojeBR(), publish_id: p.publish_id, privacidade: p.privacidade };
      registrar(r, 'tiktok', p.privacidade === 'RASCUNHO' ? `Enviado como rascunho (${p.formato}): abra o TikTok, toque na notificação da caixa de entrada e publique. ${textos(itT.legenda).titulo}` : `Publicado (${p.formato}, ${p.privacidade === 'SELF_ONLY' ? 'privado até a auditoria' : 'público'}): ${textos(itT.legenda).titulo}`);
      if (p.privacidade === 'RASCUNHO') await avisarEquipe('🎵 TikTok: rascunho pronto', 'Abra o TikTok e toque na notificação da caixa de entrada para publicar o post de hoje.');
      out.tiktok = 'ok';
    } catch (e) {
      out.tiktok = (e.aguardando ? '' : 'erro: ') + e.message;
      if (e.aguardando) r.aguardando = true;
      // aguardando aprovação: registra uma vez por dia, sem gastar a fila
      if (!e.aguardando || !(r.log || []).some(l => l.texto.startsWith('Aguardando') && l.quando.slice(0, 10) === new Date().toISOString().slice(0, 10)))
        registrar(r, 'tiktok', e.aguardando ? 'Aguardando a aprovação do app no TikTok: nada foi publicado e a fila continua igual.' : 'Falhou: ' + e.message);
    }
  }
  // Kwai: sem publicação (o Kwai não tem API); a Central só lê os números do perfil público
  if (false) {
    const ja = r.ordem.find(id => r.itens[id]?.kwai?.dia === hojeBR());
    const itK = ja ? r.itens[ja] : proximo(r, 'kwai');
    if (itK && !ja) {
      itK.kwai = { ...itK.kwai, dia: hojeBR() };
      if (r.config?.kwaiAviso !== false) out.kwaiAvisos = await avisarKwai(itK);
      registrar(r, 'kwai', 'Separado para hoje: ' + textos(itK.legenda).titulo);
    }
    out.kwai = itK ? itK.id : 'fila vazia';
  }
  return out;
}

// ---------------------------------------------------------------- rotas
module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    // arquivos públicos em /midia/ (fotos para o TikTok e o arquivo de verificação)
    if (q.arquivo) {
      const nome = String(q.arquivo);
      const ver = await dbGet('tiktok_verificacao');
      if (ver && ver.nome === nome) { res.setHeader('Content-Type', 'text/plain'); return res.end(ver.conteudo); }
      const m = nome.match(/^(\d+)_(\d+)\.jpg$/);
      if (!m) return res.status(404).end('não encontrado');
      const r = await ler();
      if (!r.itens[m[1]]) return res.status(404).end('não encontrado');
      const md = await midiaInstagram(m[1]);
      const url = (md.fotos || [])[+m[2]] || md.capa;
      if (!url) return res.status(404).end('sem foto');
      // o TikTok recusa fotos acima de 1080p (picture_size_check_failed): reduz para caber em 1080 x 1920
      const img = Buffer.from(await (await fetch(url)).arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(await ajustarFoto(img));
    }
    if (req.method === 'GET' && q.acao === 'tiktok_retorno') {
      const est = await dbGet('tiktok_estado');
      if (!q.code || !est || q.state !== est.state || Date.now() - est.t > 15 * 60e3) return res.redirect(302, '/?tiktok=erro');
      const j = await (await fetch(TT + '/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: chaves(est.chaves).key, client_secret: chaves(est.chaves).secret, code: String(q.code), grant_type: 'authorization_code', redirect_uri: REDIRECT }) })).json();
      if (!j.access_token) return res.redirect(302, '/?tiktok=erro');
      const conta = { token: j.access_token, refresh: j.refresh_token, expira: Date.now() + j.expires_in * 1000, open_id: j.open_id, escopos: j.scope, por: est.por, chaves: est.chaves || 'teste' };
      try { const info = await tt(conta, '/v2/post/publish/creator_info/query/'); conta.nome = info.creator_nickname; conta.usuario = info.creator_username; conta.privacidades = info.privacy_level_options; } catch (e) {}
      await dbSet('tiktok_conta', conta);
      return res.redirect(302, '/?tiktok=ok');
    }
    // agendamento (Vercel Cron chama /api/redes sem parâmetros) ou ?acao=diario
    if (req.method === 'GET' && (q.acao === 'diario' || q.horario || !Object.keys(q).length)) {
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      const r = await ler();
      if (r.config?.ativo === false) return res.json({ ok: 1, pausado: true });
      await atualizar(r).catch(e => registrar(r, 'fila', 'Não consegui atualizar: ' + e.message));
      await conferirStatus(r, await ttConta(r).catch(() => null)).catch(() => {});
      const out = await diario(r, null, ['a', 'b', 'c'].includes(q.horario) ? q.horario : 'a');
      await gravar(r);
      return res.json({ ok: 1, ...out });
    }

    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    // os números (TikTok e Kwai) também aparecem no Relatório e no Feedback
    const soNumeros = req.body?.acao === 'numeros' && !req.body?.atualizar && ['relatorio', 'feed'].some(m => a.menus.includes(m));
    if (!a.menus.includes('publicar') && !soNumeros) return res.status(403).json({ erro: 'Sem permissão (menu Publicar)' });
    const b = req.body || {}, r = await ler();

    if (b.acao === 'estado') {
      const c = await dbGet('tiktok_conta');
      if (c && await conferirStatus(r, await ttConta(r).catch(() => null)).catch(() => 0)) await gravar(r);
      return res.json({ fila: r.ordem.map(id => r.itens[id]).filter(Boolean), config: r.config || {}, aguardando: !!r.aguardando, log: (r.log || []).slice().reverse(), atualizado: r.atualizado || null,
        tiktok: c ? { nome: c.nome || '', usuario: c.usuario || '', escopos: c.escopos || '', privacidades: c.privacidades || [] } : null,
        app: !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET), definitiva: !!(chaves('definitiva').key && chaves('definitiva').secret), liberado: !!r.liberado, verificacao: ((await dbGet('tiktok_verificacao')) || {}).nome || '' });
    }
    if (b.acao === 'atualizar') { const o = await atualizar(r); await gravar(r); return res.json(o); }
    if (b.acao === 'marcar') {
      const it = r.itens[b.id];
      if (!it || !['tiktok', 'kwai'].includes(b.rede) || !['fila', 'postado', 'ja_tinha', 'pular'].includes(b.estado)) return res.status(400).json({ erro: 'Pedido inválido' });
      it[b.rede] = { ...it[b.rede], estado: b.estado, quando: new Date().toISOString(), por: a.u.nome };
      registrar(r, b.rede, `${a.u.nome} marcou como ${{ fila: 'na fila', postado: 'postado', ja_tinha: 'já estava lá', pular: 'pular' }[b.estado]}: ${textos(it.legenda).titulo}`);
      await gravar(r); return res.json({ ok: 1 });
    }
    if (b.acao === 'mover') {
      if (!r.itens[b.id]) return res.status(404).json({ erro: 'Post não encontrado' });
      r.ordem = r.ordem.filter(x => x !== b.id); b.posicao === 'fim' ? r.ordem.push(b.id) : r.ordem.unshift(b.id);
      await gravar(r); return res.json({ ok: 1 });
    }
    if (b.acao === 'publicar_agora') {
      if (!r.itens[b.id]) return res.status(404).json({ erro: 'Post não encontrado' });
      if (r.itens[b.id].tiktok?.estado === 'postado') return res.status(400).json({ erro: 'Esse post já foi para o TikTok' });
      const o = await diario(r, b.id); await gravar(r);
      return o.tiktok === 'ok' ? res.json({ ok: 1 }) : res.status(400).json({ erro: String(o.tiktok).replace(/^erro: /, '') });
    }
    // Kwai: arquivos do post para baixar (fotos pela /midia/, vídeo pelo link do Instagram, que vale por algumas horas)
    if (b.acao === 'midia') {
      if (!r.itens[b.id]) return res.status(404).json({ erro: 'Post não encontrado' });
      const m = await midiaInstagram(b.id);
      return res.json({ fotos: (m.fotos || []).map((_, i) => `/midia/${b.id}_${i}.jpg`), video: m.video || '' });
    }
    // números: TikTok vem da API (video.list, guardado por 1 hora); Kwai é anotado pela equipe
    if (b.acao === 'numeros') {
      let st = r.ttStats;
      if (b.atualizar || !st || Date.now() - new Date(st.quando) > 3600e3) {
        const c = await ttConta(r);
        if (c) {
          try {
            const vids = await videosTikTok(c);
            st = r.ttStats = { quando: new Date().toISOString(), videos: vids.map(v => ({ id: v.id, titulo: (v.title || v.video_description || '').slice(0, 120), data: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
              link: v.share_url || '', capa: v.cover_image_url || '', views: v.view_count || 0, curtidas: v.like_count || 0, comentarios: v.comment_count || 0, compart: v.share_count || 0 })) };
            await gravar(r);
          } catch (e) { st = { ...(st || {}), erro: e.message }; }
        }
      }
      let kw = r.kwStats;
      if (b.atualizar || !kw || Date.now() - new Date(kw.quando) > 3600e3) {
        const usuario = r.config?.kwaiUsuario || 'miadosdodestino';
        try { kw = r.kwStats = { quando: new Date().toISOString(), usuario, videos: await numerosKwai(usuario) }; await gravar(r); }
        catch (e) { kw = { ...(kw || {}), erro: e.message }; }
      }
      return res.json({ tiktok: st || null, kwai: kw || null, revisao: r.config?.revisao || { enviada: '2026-10-09' } });
    }
    if (b.acao === 'limpar_log') { r.log = []; await gravar(r); return res.json({ ok: 1 }); }
    if (b.acao === 'config') { const t = b.config?.tt || {};
      r.config = { ativo: b.config?.ativo !== false, kwaiAviso: b.config?.kwaiAviso !== false, tiktokPorDia: [1, 2, 3].includes(+b.config?.tiktokPorDia) ? +b.config.tiktokPorDia : 1,
        tt: { privacidade: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(t.privacidade) ? t.privacidade : '', comentarios: t.comentarios !== false, dueto: t.dueto !== false, costura: t.costura !== false, marcaPropria: !!t.marcaPropria, rascunho: !!t.rascunho } }; await gravar(r); return res.json({ ok: 1 }); }
    if (b.acao === 'tiktok_login') {
      const tipo = b.definitiva ? 'definitiva' : 'teste', k = chaves(tipo);
      if (!k.key || !k.secret) return res.status(400).json({ erro: 'Faltam as chaves do TikTok na Vercel' });
      const state = crypto.randomBytes(16).toString('hex');
      await dbSet('tiktok_estado', { state, t: Date.now(), por: a.u.nome, chaves: tipo });
      const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
      Object.entries({ client_key: k.key, scope: ESCOPOS, response_type: 'code', redirect_uri: REDIRECT, state }).forEach(([k, v]) => u.searchParams.set(k, v));
      return res.json({ url: u.toString() });
    }
    if (b.acao === 'tiktok_verificacao') {
      const nome = String(b.nome || '').trim(), conteudo = String(b.conteudo || '').trim();
      if (!/^[\w.-]{3,80}$/.test(nome) || !conteudo || conteudo.length > 500) return res.status(400).json({ erro: 'Confira o nome e o conteúdo do arquivo' });
      await dbSet('tiktok_verificacao', { nome, conteudo }); return res.json({ ok: 1, url: `${CENTRAL}/midia/${nome}` });
    }
    if (b.acao === 'tiktok_sair') { await dbSet('tiktok_conta', null); return res.json({ ok: 1 }); }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
// exportado para testes
module.exports.parecido = parecido;
module.exports.textos = textos;
module.exports.numerosKwai = numerosKwai;
module.exports.ajustarFoto = ajustarFoto;
