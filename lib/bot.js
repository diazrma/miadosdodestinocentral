// Motor das automações de DM/comentário (estilo ManyChat) sobre a Instagram API com login do Instagram.
const { randomUUID } = require('crypto');
const { rd, PFX, dbGet, dbSet, mac } = require('./db');
const IG = require('./igbot');
const { perguntar } = require('./groq');
// o Redis é compartilhado: toda chave leva o prefixo da Central (MGET recebe várias chaves)
const rk = c => rd(c[0] === 'MGET' ? [c[0], ...c.slice(1).map(x => PFX + x)] : [c[0], PFX + c[1], ...c.slice(2)]);
const H = 3600e3, DIA = 24 * H, ESPERA_ECO = +process.env.ESPERA_ECO_MS || 2500;
// lbase: domínio que aparece nos links das mensagens (o site repassa /l/ para a Central)
const CFG0 = { ativo: true, base: '', lbase: 'https://miados-do-destino.vercel.app', boas: '', padrao: '', padraoH: 12, pausaH: 2, ib: [], assist: { ativo: false, info: '', limite: 20, humano: 'Vou chamar alguém da equipe pra te responder, tá? 💛' } };
const cfg = async () => { const c = await dbGet('bot:cfg'); return { ...CFG0, ...c, assist: { ...CFG0.assist, ...(c || {}).assist } }; };
const autos = async () => await dbGet('bot:autos') || [];
const hoje = () => new Date(Date.now() - 3 * H).toISOString().slice(0, 10);
const stat = (k, f, n = 1) => rk(['HINCRBY', k, f, n]).catch(() => {});
const dia = (f, n) => stat('std:' + hoje(), f, n);
async function log(msg, extra) {
  await rk(['LPUSH', 'bot:log', JSON.stringify({ t: Date.now(), msg: String(msg).slice(0, 300), ...extra })]).catch(() => {});
  await rk(['LTRIM', 'bot:log', 0, 49]).catch(() => {});
}
// ---- contatos e conversas
const novo = id => ({ id, nome: '', user: '', foto: '', tags: [], campos: {}, n: 0, criado: Date.now(), ultimo: Date.now() });
const getC = async id => await dbGet('ct:' + id) || novo(id);
async function putC(c) {
  await dbSet('ct:' + c.id, c);
  await rk(['ZADD', 'cts', c.ultimo || Date.now(), c.id]);
  if (c.janela) await rk(['ZADD', 'ctj', c.janela, c.id]);
}
async function logMsg(c, d, x, p) {
  x = String(x || '').slice(0, 1000);
  await rk(['LPUSH', 'cv:' + c.id, JSON.stringify({ d, t: Date.now(), x, p })]);
  await rk(['LTRIM', 'cv:' + c.id, 0, 299]);
  Object.assign(c, { prev: x.slice(0, 80), prevD: d, ultimo: Date.now() });
}
const naJanela = c => c.janela && Date.now() - c.janela < DIA - 60e3;
// ---- texto
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function bate(a, txt) {
  if (a.modo === 'qualquer') return true;
  const t = norm(txt), ks = (a.palavras || []).map(norm).filter(Boolean);
  return a.modo === 'exato' ? ks.includes(t) : ks.some(k => /[\p{L}\p{N}]/u.test(k) ? (' ' + t + ' ').includes(' ' + k + ' ') : t.includes(k));
}
const prim = c => (c.nome || '').trim().split(/\s+/)[0] || c.user || 'você';
const pers = (s, c) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => k === 'nome' ? prim(c) : k === 'username' ? (c.user ? '@' + c.user : '') : c.campos?.[k] ?? '');
const VALIDA = {
  email: s => (s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0],
  telefone: s => { const d = s.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 ? d : null; },
  texto: s => s.trim() || null
};
// ---- links rastreados: /api/webhook?r=<dados>.<assinatura>
function link(url, c, a, base) {
  if (!base || !/^https?:\/\//i.test(url)) return url;
  const p = Buffer.from(JSON.stringify({ u: url, a: a.id, c: c.id })).toString('base64url');
  return base.replace(/\/$/, '') + '/api/webhook?r=' + p + '.' + mac(p);
}
function abreLink(r) {
  const [p, s] = String(r || '').split('.');
  if (!p || s !== mac(p)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url')); return /^https?:\/\//i.test(o.u) ? o : null; } catch (e) { return null; }
}
// ---- envio
// links vão escritos no texto (o Instagram web não mostra botões); botões de automação viram respostas rápidas
const curto = (u, a) => require('crypto').createHash('sha256').update(a.id + '|' + u).digest('base64url').slice(0, 8);
function montar(p, c, a, base, reg) {
  const bs = (p.botoes || []).filter(b => b.titulo && (b.url || b.auto)).slice(0, 3), ls = bs.filter(b => b.url), as = bs.filter(b => !b.url);
  const url = b => { if (!base || !/^https?:\/\//i.test(b.url)) return b.url; const id = curto(b.url, a); reg?.push({ id, u: b.url, a: a.id }); return base.replace(/\/$/, '') + '/l/' + id + '.' + c.id; };
  const t = [pers(p.texto, c), ls.map(b => b.titulo + ': ' + url(b)).join('\n')].filter(Boolean).join('\n\n');
  return { text: t.slice(0, 1000) || '👇', ...(as.length ? { quick_replies: as.map(b => ({ content_type: 'text', title: b.titulo.slice(0, 20), payload: 'a:' + b.auto })) } : {}) };
}
async function abreCurto(k) {
  const [id, cid] = String(k || '').split('.'), o = id && await dbGet('lnk:' + id);
  return o && /^https?:\/\//i.test(o.u) ? { ...o, c: cid } : null;
}
const rotulo = m => m.text || m.attachment?.payload?.text || (m.attachment?.type === 'image' ? '[imagem]' : '[mensagem]');
const sem = m => { const p = m.attachment?.payload; return p?.buttons ? { text: (p.text + '\n' + p.buttons.map(b => b.url ? b.title + ': ' + b.url : '').filter(Boolean).join('\n')).slice(0, 1000) } : null; };
async function mandar(ctx, m) {
  const c = ctx.c;
  if (ctx.dry) { ctx.out.push(m); if (ctx.via) { ctx.via = null; ctx.out.push({ nota: 'Resposta privada enviada. As próximas mensagens saem quando a pessoa responder ou tocar num botão.' }); } return; }
  if (ctx.bloq) throw new Error('aguardando resposta');
  let r;
  try { r = await IG.enviar(ctx.via || { id: c.id }, m, ctx.tag); }
  catch (e) { const s = sem(m); if (!s || !/Instagram:/.test(e.message)) throw e; r = await IG.enviar(ctx.via || { id: c.id }, s, ctx.tag); }
  if (r.message_id) await rk(['SET', 'sent:' + r.message_id, '1', 'EX', 86400]).catch(() => {});
  if (ctx.via) { ctx.via = null; ctx.bloq = true; }
  await logMsg(c, 'out', rotulo(m), ctx.por || 'bot'); dia('out');
}
async function msg(ctx, p, a) {
  if (p.img && /^https:\/\//.test(p.img)) await mandar(ctx, { attachment: { type: 'image', payload: { url: p.img } } });
  if (!(p.texto || (p.botoes || []).length)) return;
  const reg = [], m = montar(p, ctx.c, a, ctx.cfg.lbase || ctx.cfg.base, reg);
  if (!ctx.dry) for (const x of reg) await dbSet('lnk:' + x.id, { u: x.u, a: x.a });
  await mandar(ctx, m);
}
// ---- fila (passo "esperar")
async function agendar(ctx, a, i, min) {
  const due = Date.now() + Math.max(1, +min || 1) * 60e3;
  await rk(['ZADD', 'fila', due, JSON.stringify({ c: ctx.c.id, a: a.id, i, k: randomUUID().slice(0, 6) })]);
  const q = process.env.QSTASH_TOKEN, base = ctx.cfg.base;
  if (q && base) await fetch('https://qstash.upstash.io/v2/publish/' + base.replace(/\/$/, '') + '/api/webhook?tick=1', { method: 'POST', headers: { Authorization: 'Bearer ' + q, 'Upstash-Delay': Math.ceil((due - Date.now()) / 1e3) + 's' } }).catch(e => log('QStash: ' + e.message));
}
// ---- execução dos passos
async function rodar(ctx, a, i = 0, prof = 0) {
  const ps = a.passos || [], c = ctx.c;
  if (prof > 5) return;
  for (; i < ps.length; i++) {
    const p = ps[i];
    if (ctx.bloq) { c.espera = { auto: a.id, i, livre: 1 }; return; }
    if (p.t === 'msg') await msg(ctx, p, a);
    else if (p.t === 'pergunta') {
      await msg(ctx, p, a);
      if (ctx.dry) { ctx.out.push({ nota: 'Espera a resposta e salva em "' + (p.campo || 'resposta') + '"' }); continue; }
      c.espera = { auto: a.id, i: i + 1, campo: p.campo || 'resposta', valida: p.valida || 'texto', tent: 0 }; return;
    } else if (p.t === 'esperar') {
      if (ctx.dry) { ctx.out.push({ nota: '⏳ Espera ' + tempo(p.min) }); continue; }
      await agendar(ctx, a, i + 1, p.min); return;
    } else if (p.t === 'tag') {
      const s = new Set(c.tags || []);
      if (p.add) s.add(p.add); if (p.rem) s.delete(p.rem);
      c.tags = [...s]; if (ctx.dry) ctx.out.push({ nota: '🏷️ ' + (p.add ? '+' + p.add : '') + (p.rem ? ' −' + p.rem : '') });
    } else if (p.t === 'se') {
      const tem = (c.tags || []).includes(p.tag), b = (ctx.autos || []).find(x => x.id === p.auto);
      if (ctx.dry) ctx.out.push({ nota: 'Se ' + (p.neg ? 'NÃO ' : '') + 'tiver a tag "' + p.tag + '" → ' + (b ? b.nome : '?') });
      if (tem !== !!p.neg && b && !ctx.dry) return rodar(ctx, b, 0, prof + 1);
    } else if (p.t === 'humano') {
      if (p.texto) await msg(ctx, p, a);
      if (ctx.dry) { ctx.out.push({ nota: '🙋 Passa para a equipe (o bot pausa)' }); return; }
      Object.assign(c, { humano: 1, pausa: Date.now() + (ctx.cfg.pausaH || 2) * H }); return;
    }
  }
  if (!ctx.dry) { c.espera = null; stat('st:' + a.id, 'concluidos'); }
}
const tempo = m => (m = +m || 0) >= 1440 ? (m / 1440).toFixed(m % 1440 ? 1 : 0) + ' dia(s)' : m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0) + ' h' : m + ' min';
// abertura e "só para quem segue": na resposta privada só cabe 1 mensagem, então vai um botão que abre a conversa
const botao = (texto, titulo, payload, c) => ({ text: pers(texto, c).slice(0, 1000), quick_replies: [{ content_type: 'text', title: titulo.slice(0, 20), payload }] });
async function disparar(ctx, a, aberto) {
  if (!ctx.dry && !aberto) { stat('st:' + a.id, 'disparos'); dia('disparos'); }
  if (ctx.via && (a.abertura?.ativo || a.seguir?.ativo)) {
    await mandar(ctx, botao(a.abertura?.texto || 'Oi {nome}! me responde qualquer coisa aqui que eu te mando 👇', a.abertura?.botao || 'Quero receber', 'g:' + a.id, ctx.c));
    // se o botão não aparecer (Instagram web), qualquer resposta da pessoa continua o fluxo
    if (!ctx.dry) { ctx.c.espera = { auto: a.id, i: 0, livre: 1, gate: 1 }; return; }
    ctx.out.push({ nota: 'Quando a pessoa tocar no botão ou responder qualquer coisa:' });
  }
  if (a.seguir?.ativo && !(await segue(ctx))) {
    stat('st:' + a.id, 'barrados');
    await mandar(ctx, botao(a.seguir.texto || 'Pra liberar, é só seguir o perfil e me responder "já sigo" 😺', a.seguir.botao || 'Já sigo ✅', 'g:' + a.id, ctx.c));
    if (!ctx.dry) ctx.c.espera = { auto: a.id, i: 0, livre: 1, gate: 1 };
    return;
  }
  await rodar(ctx, a, 0);
}
async function segue(ctx) {
  if (ctx.dry) { ctx.out.push({ nota: 'Confere se a pessoa segue o perfil (se não seguir, pede para seguir e tocar em "Já sigo")' }); return true; }
  try { const p = await IG.perfil(ctx.c.id); ctx.c.segue = !!p.is_user_follow_business; return ctx.c.segue; } catch (e) { return true; }
}
async function assistente(ctx, txt) {
  const c = ctx.c, A = ctx.cfg.assist, k = 'asn:' + hoje() + ':' + c.id;
  if (+(await rk(['INCR', k])) > (A.limite || 20)) return false;
  await rk(['EXPIRE', k, 86400]);
  const hist = (await rk(['LRANGE', 'cv:' + c.id, 0, 11]) || []).map(x => JSON.parse(x)).reverse().filter(x => x.d !== 'com');
  const sys = `Você responde as mensagens diretas do Instagram do perfil "Miados do Destino" (um dorama sobre gatos, amor e destino). Responda em português do Brasil, curto (no máximo 3 frases), simpático, no máximo 1 emoji, sem markdown. Use SOMENTE as informações abaixo. Nunca invente datas, preços, links ou fatos. Se não souber a resposta, ou se for parceria, reclamação, problema ou pedido para falar com uma pessoa, responda exatamente: [HUMANO]\n\nInformações:\n${A.info || '(nenhuma)'}`;
  const r = (await perguntar([{ role: 'system', content: sys }, ...hist.map(x => ({ role: x.d === 'in' ? 'user' : 'assistant', content: x.x })), ...(hist.length && hist[hist.length - 1].d === 'in' ? [] : [{ role: 'user', content: txt }])], { temperatura: 0.4 })).texto;
  if (/\[HUMANO\]/.test(r)) {
    Object.assign(c, { humano: 1, pausa: Date.now() + (ctx.cfg.pausaH || 2) * H });
    if (A.humano) await mandar(ctx, { text: pers(A.humano, c) });
    return true;
  }
  ctx.por = 'assistente'; await mandar(ctx, { text: r.slice(0, 1000) }); dia('assist'); return true;
}
// ---- eventos do webhook
const porPost = (lista, media) => lista.filter(a => a.todos || (a.posts || []).includes(media)).sort((x, y) => !!x.todos - !!y.todos);
async function comentario(v, igId, E) {
  const from = v.from || {};
  if (!from.id || from.id === igId || !v.id) return;
  if (!(await rk(['SET', 'ev:c:' + v.id, '1', 'NX', 'EX', 7 * 86400]))) return;
  dia('com');
  const c = await getC(from.id);
  if (from.username) c.user = from.username;
  await logMsg(c, 'com', v.text || '', v.media?.id || '');
  const ctx = { c, cfg: E.cfg, autos: E.autos, via: { comment_id: v.id } };
  const a = E.cfg.ativo && porPost(E.autos.filter(x => x.ativo && x.tipo === 'comentario' && bate(x, v.text)), v.media?.id)[0];
  try {
    if (a && (!a.umaVez || await rk(['SET', 'uma:' + a.id + ':' + c.id + ':' + (v.media?.id || ''), '1', 'NX', 'EX', 90 * 86400]))) {
      const pub = (a.publicas || []).filter(Boolean);
      if (pub.length) await IG.responderComentario(v.id, pers(pub[Math.random() * pub.length | 0], c)).catch(e => log('Resposta pública: ' + e.message, { auto: a.nome }));
      await disparar(ctx, a);
    }
  } catch (e) { await log(e.message, { auto: a?.nome, user: c.user }); }
  await putC(c);
}
async function mensagem(m, igId, E) {
  const M = m.message || {}, me = m.sender?.id === igId;
  if (M.is_echo || me) {
    if (!M.mid || await rk(['GET', 'sent:' + M.mid])) return;
    if (M.attachments?.some(x => x.type === 'template')) return;
    await new Promise(r => setTimeout(r, ESPERA_ECO));
    if (await rk(['GET', 'sent:' + M.mid])) return;
    if (!(await rk(['SET', 'ev:' + M.mid, '1', 'NX', 'EX', 86400]))) return;
    const c = await getC(m.recipient.id);
    await logMsg(c, 'out', M.text || '[mensagem pelo app]', 'app');
    Object.assign(c, { humano: 0, pausa: Date.now() + (E.cfg.pausaH || 2) * H });
    return putC(c);
  }
  if (!M.mid && !m.postback) return;
  const mid = M.mid || m.postback.mid || (m.sender.id + ':' + m.timestamp);
  if (!(await rk(['SET', 'ev:' + mid, '1', 'NX', 'EX', 86400]))) return;
  const c = await getC(m.sender.id), primeira = !c.n, now = Date.now();
  Object.assign(c, { n: (c.n || 0) + 1, janela: now, novo: 1 });
  const at = (M.attachments || [])[0], txt = M.text || '';
  await logMsg(c, 'in', m.postback ? '🔘 ' + (m.postback.title || '') : txt || (at ? '[' + ({ story_mention: 'menção no story', image: 'imagem', video: 'vídeo', audio: 'áudio', share: 'post compartilhado', ig_reel: 'reel' }[at.type] || at.type) + ']' : M.reply_to?.story ? '[resposta ao story]' : ''), M.reply_to?.story ? 'story' : '');
  dia('in');
  if (!c.pf || now - c.pf > 7 * DIA) {
    try { const p = await IG.perfil(c.id); Object.assign(c, { nome: p.name || c.nome, user: p.username || c.user, foto: p.profile_pic || c.foto, segue: !!p.is_user_follow_business, seg: p.follower_count, pf: now }); }
    catch (e) { c.pf = now - 6 * DIA; }
  }
  const ctx = { c, cfg: E.cfg, autos: E.autos }, ach = (t, f) => E.autos.find(x => x.ativo && x.tipo === t && (!f || f(x)));
  try {
    if (!E.cfg.ativo) return;
    const pl = m.postback?.payload || M.quick_reply?.payload;
    if (pl) {
      const [k, id] = pl.split(':'), a = E.autos.find(x => x.id === id);
      c.espera = null;
      if (a && k === 'a') { stat('st:' + a.id, 'cliques'); return await disparar(ctx, a); }
      if (a && k === 'g') { stat('st:' + a.id, 'abertos'); return await disparar(ctx, a, 1); }
    }
    if (c.pausa > now) return;
    const es = c.espera;
    if (es?.campo && txt) {
      const a = E.autos.find(x => x.id === es.auto), v = (VALIDA[es.valida] || VALIDA.texto)(txt);
      if (v) { c.campos = { ...c.campos, [es.campo]: v }; c.espera = null; stat('st:' + es.auto, 'leads'); dia('leads'); if (a) return await rodar(ctx, a, es.i); return; }
      if (es.tent < 1) { es.tent++; return await mandar(ctx, { text: es.valida === 'email' ? 'Hmm, não parece um e-mail. Pode mandar de novo? 😺' : es.valida === 'telefone' ? 'Hmm, não parece um telefone com DDD. Pode mandar de novo? 😺' : 'Pode mandar de novo? 😺' } ); }
      c.espera = null;
    }
    if (at?.type === 'story_mention') { const a = ach('mencao'); if (a) return await disparar(ctx, a); }
    if (M.reply_to?.story) { const a = ach('story', x => bate(x, txt)); if (a) return await disparar(ctx, a); }
    const a = txt && ach('dm', x => bate(x, txt));
    if (a) return await disparar(ctx, a);
    if (es?.livre) { const b = E.autos.find(x => x.id === es.auto); c.espera = null; if (b) { if (es.gate) { stat('st:' + b.id, 'abertos'); return await disparar(ctx, b, 1); } return await rodar(ctx, b, es.i); } }
    const boas = primeira && E.autos.find(x => x.id === E.cfg.boas && x.ativo);
    if (boas) return await disparar(ctx, boas);
    if (E.cfg.assist.ativo && txt && process.env.GROQ_API_KEY && !c.humano && await assistente(ctx, txt)) return;
    const pd = E.autos.find(x => x.id === E.cfg.padrao && x.ativo);
    if (pd && (!c.padraoT || now - c.padraoT > (E.cfg.padraoH || 12) * H)) { c.padraoT = now; return await disparar(ctx, pd); }
  } catch (e) { await log(e.message, { user: c.user || c.id }); }
  finally { await putC(c); }
}
async function processar(body) {
  if (body.object && body.object !== 'instagram') return;
  const E = { cfg: await cfg(), autos: await autos() };
  for (const en of body.entry || []) {
    for (const ch of en.changes || []) if (ch.field === 'comments' || ch.field === 'live_comments') await comentario(ch.value || {}, en.id, E);
    for (const m of en.messaging || []) if (m.message || m.postback) await mensagem(m, en.id, E);
  }
}
// ---- fila, token e disparos
async function tick() {
  const js = await rk(['ZRANGEBYSCORE', 'fila', '-inf', Date.now(), 'LIMIT', 0, 25]) || [];
  if (!js.length) return 0;
  const E = { cfg: await cfg(), autos: await autos() };
  let n = 0;
  for (const j of js) {
    if (!(await rk(['ZREM', 'fila', j]))) continue;
    const o = JSON.parse(j), a = E.autos.find(x => x.id === o.a), c = await getC(o.c);
    if (!a || !E.cfg.ativo || c.pausa > Date.now()) continue;
    if (!naJanela(c)) { await log('Espera concluída fora da janela de 24 h; mensagem não enviada', { auto: a.nome, user: c.user }); continue; }
    try { await rodar({ c, cfg: E.cfg, autos: E.autos }, a, o.i); n++; } catch (e) { await log(e.message, { auto: a.nome, user: c.user }); }
    await putC(c);
  }
  return n;
}
async function disparo(autoId, tag) {
  const E = { cfg: await cfg(), autos: await autos() }, a = E.autos.find(x => x.id === autoId);
  if (!a) throw new Error('Automação não encontrada');
  const ids = await rk(['ZRANGEBYSCORE', 'ctj', Date.now() - DIA + 120e3, '+inf']) || [];
  let ok = 0, falha = 0, fora = 0;
  for (let i = 0; i < ids.length && i < 150; i += 5) {
    const cs = (await rk(['MGET', ...ids.slice(i, i + 5).map(x => 'ct:' + x)])).map(x => x && JSON.parse(x)).filter(Boolean);
    await Promise.all(cs.map(async c => {
      if (tag && !(c.tags || []).includes(tag)) return fora++;
      try { await rodar({ c, cfg: E.cfg, autos: E.autos }, a, 0); await putC(c); ok++; } catch (e) { falha++; await log('Disparo: ' + e.message, { auto: a.nome, user: c.user }); }
    }));
  }
  stat('st:' + a.id, 'disparos', ok);
  return { ok, falha, total: ids.length - fora };
}
async function enviarManual(id, texto, por) {
  const c = await getC(id), m = { text: String(texto).slice(0, 1000) };
  if (!m.text.trim()) throw new Error('Mensagem vazia');
  let r;
  try { r = await IG.enviar({ id }, m, naJanela(c) ? null : 'HUMAN_AGENT'); }
  catch (e) { if (/janela/.test(e.message) || naJanela(c)) throw e; throw new Error(e.message + ' (passou de 24 h desde a última mensagem da pessoa)'); }
  if (r.message_id) await rk(['SET', 'sent:' + r.message_id, '1', 'EX', 86400]);
  await logMsg(c, 'out', m.text, por);
  const C = await cfg();
  Object.assign(c, { humano: 0, pausa: Date.now() + (C.pausaH || 2) * H });
  await putC(c); dia('out'); return c;
}
async function rodarPara(c, a) {
  await rodar({ c, cfg: await cfg(), autos: await autos() }, a, 0);
  await putC(c);
}
async function simular(tipo, texto, media) {
  const E = { cfg: await cfg(), autos: await autos() }, c = { id: 'teste', nome: 'Maria Gatinha', user: 'maria.gatos', tags: [], campos: { email: 'maria@exemplo.com' } };
  const out = [], ctx = { c, cfg: E.cfg, autos: E.autos, dry: 1, out, via: tipo === 'comentario' ? { comment_id: 'x' } : null };
  const L = E.autos.filter(x => x.ativo && x.tipo === tipo && bate(x, texto)), a = tipo === 'comentario' ? porPost(L, media)[0] : L[0];
  if (!a) return { auto: null, out };
  const pub = (a.publicas || []).filter(Boolean);
  if (tipo === 'comentario' && pub.length) out.push({ publica: pers(pub[0], c) + (pub.length > 1 ? ' (sorteia entre ' + pub.length + ')' : '') });
  await disparar(ctx, a);
  return { auto: a.nome, out };
}
module.exports = { rk, abreCurto, processar, tick, disparo, enviarManual, rodarPara, simular, abreLink, cfg, autos, getC, putC, log, stat, dia, hoje, bate, norm, pers, montar, naJanela, CFG0 };
