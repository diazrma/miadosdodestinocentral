// node --test test/  (Redis, Instagram e Groq simulados em memória)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Readable } = require('stream');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', IG_TOKEN: 'TOK', IG_APP_SECRET: 'segredo', IG_VERIFY_TOKEN: 'verifica', SESSION_SECRET: 'x'.repeat(32), GROQ_API_KEY: 'g', GROQ_MODEL: 'm', ESPERA_ECO_MS: '5', DB_PREFIX: '' });

// ---- Redis em memória
const R = new Map(), exp = new Map();
const z = k => R.get(k) || new Map(), L = k => R.get(k) || [];
const vivo = k => { if (exp.has(k) && exp.get(k) < Date.now()) { R.delete(k); exp.delete(k); } return R.has(k); };
function redis([cmd, k, ...a]) {
  cmd = cmd.toUpperCase(); vivo(k);
  switch (cmd) {
    case 'GET': return R.has(k) ? R.get(k) : null;
    case 'SET': { const nx = a.includes('NX'), i = a.indexOf('EX'); if (nx && R.has(k)) return null; R.set(k, String(a[0])); if (i > 0) exp.set(k, Date.now() + a[i + 1] * 1e3); return 'OK'; }
    case 'DEL': return +R.delete(k);
    case 'INCR': { const v = +(R.get(k) || 0) + 1; R.set(k, String(v)); return v; }
    case 'EXPIRE': exp.set(k, Date.now() + a[0] * 1e3); return 1;
    case 'LPUSH': { const l = L(k); l.unshift(...a.reverse()); R.set(k, l); return l.length; }
    case 'LTRIM': R.set(k, L(k).slice(a[0], +a[1] + 1)); return 'OK';
    case 'LRANGE': return L(k).slice(a[0], +a[1] < 0 ? undefined : +a[1] + 1);
    case 'ZADD': { const m = z(k); m.set(String(a[1]), +a[0]); R.set(k, m); return 1; }
    case 'ZREM': return +z(k).delete(String(a[0]));
    case 'ZCARD': return z(k).size;
    case 'ZCOUNT': case 'ZRANGEBYSCORE': {
      const lo = a[0] === '-inf' ? -Infinity : +a[0], hi = a[1] === '+inf' ? Infinity : +a[1];
      const r = [...z(k)].filter(([, s]) => s >= lo && s <= hi).sort((x, y) => x[1] - y[1]).map(x => x[0]);
      return cmd === 'ZCOUNT' ? r.length : a[2] === 'LIMIT' ? r.slice(a[3], a[3] + a[4]) : r;
    }
    case 'ZREVRANGE': return [...z(k)].sort((x, y) => y[1] - x[1]).map(x => x[0]).slice(a[0], +a[1] + 1);
    case 'HINCRBY': { const h = R.get(k) || {}; h[a[0]] = (h[a[0]] || 0) + +a[1]; R.set(k, h); return h[a[0]]; }
    case 'HGETALL': return Object.entries(R.get(k) || {}).flat().map(String);
    case 'MGET': return [k, ...a].map(x => (vivo(x), R.has(x) ? R.get(x) : null));
  }
  throw new Error('comando não simulado: ' + cmd);
}
// ---- Instagram / Groq simulados
const IGS = { enviados: [], publicas: [], perfil: { name: 'Ana Souza', username: 'ana.gatos', is_user_follow_business: false }, groq: 'Estreia dia 20 no canal! 😺', falhaTemplate: false };
let mid = 0;
global.fetch = async (u, o = {}) => {
  u = String(u);
  const J = (j, s = 200) => ({ ok: s < 300, status: s, json: async () => j });
  if (u.startsWith('http://redis.test')) return J({ result: redis(JSON.parse(o.body)) });
  if (u.includes('api.groq.com')) return J({ choices: [{ message: { content: IGS.groq } }] });
  const p = new URL(u).pathname;
  if (p === '/me/messages') {
    const b = JSON.parse(o.body);
    if (IGS.falhaTemplate && b.message.attachment) return J({ error: { message: 'Invalid parameter', code: 100 } });
    IGS.enviados.push(b); return J({ recipient_id: b.recipient.id || 'u1', message_id: 'm' + ++mid });
  }
  if (p.endsWith('/replies')) { IGS.publicas.push(JSON.parse(o.body).message); return J({ id: 'r1' }); }
  if (/^\/u\d+$/.test(p)) return J(IGS.perfil);
  if (p === '/refresh_access_token') return J({ access_token: 'NOVO', expires_in: 5184000 });
  return J({ error: { message: 'rota não simulada ' + p } }, 400);
};
const { dbSet, dbGet } = require('../lib/db');
const B = require('../lib/bot');
const webhook = require('../api/webhook');
const ME = '1784000';
const comentario = (id, from, text, media = 'p1') => ({ object: 'instagram', entry: [{ id: ME, changes: [{ field: 'comments', value: { id, text, from: { id: from, username: 'ana.gatos' }, media: { id: media } } }] }] });
const dm = (from, message, extra) => ({ object: 'instagram', entry: [{ id: ME, messaging: [{ sender: { id: from }, recipient: { id: ME }, timestamp: Date.now(), message: { mid: 'in' + ++mid, ...message }, ...extra }] }] });
const postback = (from, payload) => ({ object: 'instagram', entry: [{ id: ME, messaging: [{ sender: { id: from }, recipient: { id: ME }, timestamp: Date.now(), postback: { mid: 'pb' + ++mid, title: 'botão', payload } }] }] });
const hst = k => R.get(k) || {};
const ultimo = () => IGS.enviados[IGS.enviados.length - 1];
const txt = m => m.message.text || m.message.attachment?.payload?.text;

test('palavra-chave: acentos, pontuação, exato e emoji', () => {
  assert.ok(B.bate({ palavras: ['link'] }, 'Quero o LINK!!'));
  assert.ok(B.bate({ palavras: ['episódio'] }, 'cadê o episodio novo?'));
  assert.ok(!B.bate({ palavras: ['link'] }, 'linkedin'));
  assert.ok(B.bate({ palavras: ['😺'] }, 'amei😺'));
  assert.ok(B.bate({ modo: 'exato', palavras: ['gato'] }, 'Gato!'));
  assert.ok(!B.bate({ modo: 'exato', palavras: ['gato'] }, 'gato preto'));
  assert.ok(B.bate({ modo: 'qualquer' }, 'qualquer coisa'));
  assert.equal(B.pers('Oi {nome}, {username} {email}', { nome: 'Ana Souza', user: 'ana', campos: { email: 'a@b.c' } }), 'Oi Ana, @ana a@b.c');
});

test('fluxo completo: comentário → abertura → só para quem segue → link rastreado → pergunta → espera', async () => {
  await dbSet('bot:cfg', { ativo: true, base: 'https://central.test' });
  await dbSet('bot:autos', [
    { id: 'link', nome: 'Link do episódio', ativo: true, tipo: 'comentario', todos: true, palavras: ['episodio'], modo: 'contem', umaVez: true, publicas: ['Te mandei no direct, {nome}! 💌'],
      abertura: { ativo: true, texto: 'Oi {nome}! Toca abaixo 👇', botao: 'Quero' }, seguir: { ativo: true, texto: 'Segue a gente e toca em Já sigo', botao: 'Já sigo ✅' },
      passos: [{ t: 'msg', texto: 'Aqui está, {nome}!', botoes: [{ titulo: 'Assistir', url: 'https://youtu.be/abc' }] }, { t: 'pergunta', texto: 'Qual seu e-mail?', campo: 'email', valida: 'email' }, { t: 'tag', add: 'lead' }, { t: 'esperar', min: 60 }, { t: 'msg', texto: 'Lembrete: episódio novo hoje!' }] }
  ]);
  await B.processar(comentario('c1', 'u1', 'Cadê o EPISÓDIO?'));
  assert.equal(IGS.publicas[0], 'Te mandei no direct, ana.gatos! 💌');
  let m = ultimo();
  assert.deepEqual(m.recipient, { comment_id: 'c1' });
  assert.equal(m.message.quick_replies[0].payload, 'g:link');
  assert.deepEqual((await dbGet('ct:u1')).espera, { auto: 'link', i: 0, livre: 1, gate: 1 });
  // mesma pessoa no mesmo post não dispara de novo
  await B.processar(comentario('c2', 'u1', 'episodio'));
  assert.equal(IGS.enviados.length, 1);
  // toca no botão sem seguir → pede para seguir
  await B.processar(postback('u1', 'g:link'));
  assert.match(txt(ultimo()), /Segue a gente/);
  // passa a seguir → recebe o link (rastreado) e a pergunta
  IGS.perfil.is_user_follow_business = true;
  await dbSet('ct:u1', { ...(await dbGet('ct:u1')), pf: 0 });
  await B.processar(postback('u1', 'g:link'));
  const n = IGS.enviados.length;
  const msgLink = IGS.enviados[n - 2].message.text, curta = msgLink.match(/https:\/\/central\.test\/l\/(\S+)/);
  assert.ok(msgLink.startsWith('Aqui está, Ana!\n\nAssistir: https://central.test/l/'), msgLink);
  assert.ok(!IGS.enviados[n - 2].message.attachment);
  assert.equal(txt(IGS.enviados[n - 1]), 'Qual seu e-mail?');
  // e-mail inválido → pede de novo; válido → salva, aplica tag e agenda
  await B.processar(dm('u1', { text: 'não sei' }));
  assert.match(txt(ultimo()), /não parece um e-mail/);
  await B.processar(dm('u1', { text: 'meu email é Ana@Gatos.com' }));
  let c = await dbGet('ct:u1');
  assert.equal(c.campos.email, 'Ana@Gatos.com');
  assert.deepEqual(c.tags, ['lead']);
  assert.equal(redis(['ZCARD', 'fila']), 1);
  // fila: nada antes da hora; depois da hora envia
  assert.equal(await B.tick(), 0);
  const [j] = redis(['ZRANGEBYSCORE', 'fila', '-inf', '+inf']);
  redis(['ZADD', 'fila', Date.now() - 1, j]);
  assert.equal(await B.tick(), 1);
  assert.equal(txt(ultimo()), 'Lembrete: episódio novo hoje!');
  const st = hst('st:link');
  assert.deepEqual([st.disparos, st.abertos, st.leads, st.concluidos], [1, 2, 1, 1]);
  // clique no link rastreado → 302 e conta clique
  const r = await chama({ method: 'GET', query: { l: curta[1] } });
  assert.equal(r.code, 302); assert.equal(r.headers.Location, 'https://youtu.be/abc');
  assert.equal(hst('st:link').cliques, 1);
  assert.equal((await chama({ method: 'GET', query: { l: 'naoexiste.u1' } })).code, 404);
});

test('abertura: responder qualquer coisa continua o fluxo (botão não aparece no Instagram web)', async () => {
  await dbSet('bot:cfg', { ativo: true });
  await dbSet('bot:autos', [{ id: 'ab', nome: 'Ab', ativo: true, tipo: 'comentario', todos: true, palavras: ['link'], modo: 'contem', umaVez: true, abertura: { ativo: true, texto: 'Toca ou responde', botao: 'Quero' }, passos: [{ t: 'msg', texto: 'Aqui o link' }] }]);
  await B.processar(comentario('c9', 'u9', 'link'));
  assert.equal(txt(ultimo()), 'Toca ou responde');
  await B.processar(dm('u9', { text: 'quero' }));
  assert.equal(txt(ultimo()), 'Aqui o link');
  assert.equal(hst('st:ab').abertos, 1);
});

test('eco: mensagem nossa é ignorada; resposta pelo app pausa o bot', async () => {
  await dbSet('bot:cfg', { ativo: true, pausaH: 2 });
  await dbSet('bot:autos', [{ id: 'oi', nome: 'Oi', ativo: true, tipo: 'dm', palavras: ['preco'], modo: 'contem', passos: [{ t: 'msg', texto: 'R$ 10' }] }]);
  await B.processar(dm('u2', { text: 'qual o preço?' }));
  const nosso = 'm' + mid, total = IGS.enviados.length;
  assert.equal(txt(ultimo()), 'R$ 10');
  await B.processar({ object: 'instagram', entry: [{ id: ME, messaging: [{ sender: { id: ME }, recipient: { id: 'u2' }, timestamp: Date.now(), message: { mid: nosso, text: 'R$ 10', is_echo: true } }] }] });
  assert.ok(!((await dbGet('ct:u2')).pausa > Date.now()));
  await B.processar({ object: 'instagram', entry: [{ id: ME, messaging: [{ sender: { id: ME }, recipient: { id: 'u2' }, timestamp: Date.now(), message: { mid: 'app1', text: 'oi, sou da equipe', is_echo: true } }] }] });
  assert.ok((await dbGet('ct:u2')).pausa > Date.now());
  await B.processar(dm('u2', { text: 'e o preço?' }));
  assert.equal(IGS.enviados.length, total);
  // retomar: tira a pausa
  await dbSet('ct:u2', { ...(await dbGet('ct:u2')), pausa: 0 });
  await B.processar(dm('u2', { text: 'preço!' }));
  assert.equal(IGS.enviados.length, total + 1);
});

test('assistente responde e passa para humano quando não sabe', async () => {
  await dbSet('bot:cfg', { ativo: true, assist: { ativo: true, info: 'Estreia dia 20.', limite: 5 } });
  await dbSet('bot:autos', []);
  await B.processar(dm('u3', { text: 'quando estreia?' }));
  assert.equal(txt(ultimo()), 'Estreia dia 20 no canal! 😺');
  IGS.groq = '[HUMANO]';
  await B.processar(dm('u3', { text: 'quero fazer uma parceria' }));
  assert.match(txt(ultimo()), /chamar alguém da equipe/);
  const c = await dbGet('ct:u3');
  assert.equal(c.humano, 1); assert.ok(c.pausa > Date.now());
  IGS.groq = 'Estreia dia 20 no canal! 😺';
});

test('boas-vindas na primeira mensagem, menção no story e fallback sem botão', async () => {
  await dbSet('bot:cfg', { ativo: true, boas: 'bv' });
  await dbSet('bot:autos', [
    { id: 'bv', nome: 'Boas-vindas', ativo: true, tipo: 'manual', passos: [{ t: 'msg', texto: 'Bem-vinda, {nome}!' }] },
    { id: 'mn', nome: 'Menção', ativo: true, tipo: 'mencao', passos: [{ t: 'msg', texto: 'Obrigada pela menção!', botoes: [{ titulo: 'Site', url: 'https://miados.test' }] }] }
  ]);
  await B.processar(dm('u4', { text: 'oi' }));
  assert.equal(txt(ultimo()), 'Bem-vinda, Ana!');
  await B.processar(dm('u4', { text: 'oi de novo' }));
  assert.equal(txt(ultimo()), 'Bem-vinda, Ana!');
  IGS.falhaTemplate = true;
  await B.processar(dm('u4', { attachments: [{ type: 'story_mention', payload: { url: 'x' } }] }));
  IGS.falhaTemplate = false;
  assert.equal(txt(ultimo()), 'Obrigada pela menção!\n\nSite: https://miados.test');
});

test('simulador não envia nada e mostra o fluxo', async () => {
  await dbSet('bot:autos', [{ id: 's', nome: 'Sorteio', ativo: true, tipo: 'comentario', todos: true, palavras: ['eu'], modo: 'contem', publicas: ['Boa sorte!'], abertura: { ativo: true }, passos: [{ t: 'msg', texto: 'Você está participando, {nome}!' }, { t: 'esperar', min: 1440 }, { t: 'tag', add: 'sorteio' }] }]);
  const antes = IGS.enviados.length, r = await B.simular('comentario', 'Eu quero!', 'p9');
  assert.equal(IGS.enviados.length, antes);
  assert.equal(r.auto, 'Sorteio');
  assert.equal(r.out[0].publica, 'Boa sorte!');
  assert.ok(r.out.some(o => o.text === 'Você está participando, Maria!'));
  assert.ok(r.out.some(o => o.nota === '⏳ Espera 1 dia(s)'));
  assert.equal((await B.simular('comentario', 'nada a ver')).auto, null);
});

test('nunca automatizar: amigo marcado não recebe nada (DM, comentário, espera e disparo)', async () => {
  await dbSet('bot:cfg', { ativo: true, boas: 'bv', padrao: 'pd', assist: { ativo: true, info: 'x' } });
  await dbSet('bot:autos', [
    { id: 'bv', nome: 'Boas-vindas', ativo: true, tipo: 'manual', passos: [{ t: 'msg', texto: 'Bem-vinda!' }] },
    { id: 'pd', nome: 'Padrão', ativo: true, tipo: 'manual', passos: [{ t: 'msg', texto: 'Resposta padrão' }] },
    { id: 'kw', nome: 'Link', ativo: true, tipo: 'dm', palavras: ['link'], modo: 'contem', passos: [{ t: 'msg', texto: 'Aqui o link' }] },
    { id: 'cm', nome: 'Comentário', ativo: true, tipo: 'comentario', todos: true, palavras: ['eu'], modo: 'contem', publicas: ['Oba!'], passos: [{ t: 'msg', texto: 'Te mandei!' }] }
  ]);
  await dbSet('ct:u9', { id: 'u9', semBot: 1 });
  const env = IGS.enviados.length, pubs = IGS.publicas.length;
  await B.processar(dm('u9', { text: 'oi amigo, me manda o link' }));
  await B.processar(comentario('c-u9', 'u9', 'eu quero'));
  assert.equal(IGS.enviados.length, env);
  assert.equal(IGS.publicas.length, pubs);
  const c = await dbGet('ct:u9');
  assert.equal(c.n, 1); assert.equal(c.semBot, 1);
  assert.ok((R.get('cv:u9') || []).length >= 2, 'a conversa continua registrada');
  // espera agendada também não sai
  R.set('fila', new Map([[JSON.stringify({ a: 'kw', c: 'u9', i: 0 }), Date.now() - 1]]));
  assert.equal(await B.tick(), 0);
  assert.equal(IGS.enviados.length, env);
  // voltando a automatizar, o robô responde de novo
  await dbSet('ct:u9', { ...(await dbGet('ct:u9')), semBot: 0 });
  await B.processar(dm('u9', { text: 'me manda o link' }));
  assert.equal(txt(ultimo()), 'Aqui o link');
});

// ---- webhook HTTP
function chama({ method = 'POST', query = {}, body, headers = {}, parsed }) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method, query, headers });
  if (parsed) { req.resume(); req.body = parsed; }
  return new Promise(ok => {
    const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(b) { this.body = b; ok(this); }, json(b) { this.body = b; ok(this); }, end() { ok(this); } };
    webhook(req, res);
  });
}
const assina = b => 'sha256=' + crypto.createHmac('sha256', 'segredo').update(b).digest('hex');
test('webhook: verificação, assinatura (corpo cru e já lido pela Vercel)', async () => {
  assert.equal((await chama({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verifica', 'hub.challenge': '42' } })).body, '42');
  assert.equal((await chama({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '42' } })).code, 403);
  await dbSet('bot:cfg', { ativo: true });
  await dbSet('bot:autos', [{ id: 'w', nome: 'W', ativo: true, tipo: 'dm', palavras: ['miau'], modo: 'contem', passos: [{ t: 'msg', texto: 'Miau de volta!' }] }]);
  const body = JSON.stringify(dm('u5', { text: 'miau ção/' }));
  assert.equal((await chama({ body, headers: { 'x-hub-signature-256': assina(body) } })).code, 200);
  assert.equal(txt(ultimo()), 'Miau de volta!');
  assert.equal((await chama({ body, headers: { 'x-hub-signature-256': 'sha256=00' } })).code, 403);
  // corpo já convertido em objeto: remonta no formato da Meta (ç e \/)
  const ev = dm('u6', { text: 'miau ção/' }), meta = JSON.stringify(ev).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).replace(/\//g, '\\/');
  assert.equal((await chama({ parsed: ev, headers: { 'x-hub-signature-256': assina(meta) } })).code, 200);
  assert.equal(ultimo().recipient.id, 'u6');
  assert.match(JSON.parse(R.get('bot:log').at(-1) || '{}').msg || '', /assinatura inválida/);
});
