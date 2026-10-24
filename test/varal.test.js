// Varal das Lembranças: validação, envio com foto refeita pelo sharp, fila, aprovação, vela e remoção
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'segredo-de-teste' });
const R = new Map();
const zs = k => R.get(k) || new Map();
const ord = (k, desc) => [...zs(k)].sort((x, y) => desc ? y[1] - x[1] : x[1] - y[1]).map(x => x[0]);
function redis([cmd, k, ...a]) {
  switch (cmd.toUpperCase()) {
    case 'GET': return R.get(k) ?? null;
    case 'MGET': return [k, ...a].map(x => R.get(x) ?? null);
    case 'INCR': R.set(k, String(+(R.get(k) || 0) + 1)); return +R.get(k);
    case 'EXPIRE': return 1;
    case 'DEL': return R.delete(k) ? 1 : 0;
    case 'SET': if (a.includes('NX') && R.has(k)) return null; R.set(k, String(a[0])); return 'OK';
    case 'ZADD': { const m = zs(k); m.set(String(a[1]), +a[0]); R.set(k, m); return 1; }
    case 'ZREM': return zs(k).delete(String(a[0])) ? 1 : 0;
    case 'ZCARD': return zs(k).size;
    case 'ZRANGE': return ord(k).slice(+a[0], +a[1] + 1);
    case 'ZREVRANGE': return ord(k, true).slice(+a[0], +a[1] + 1);
  }
  throw new Error('não simulado: ' + cmd);
}
global.fetch = async (u, o) => ({ ok: true, json: async () => ({ result: redis(JSON.parse(o.body)) }) });
// equipe logada: usuário admin no banco simulado + sessão assinada
const db = require('../lib/db');
R.set('mc:users', JSON.stringify([{ id: 'u1', nome: 'Rodrigo', role: 'admin' }]));
R.set('mc:state', JSON.stringify({ roles: db.ROLES }));
const TK = 'Bearer ' + db.sign('u1');
// Reels de quinta: vídeo e Instagram simulados
const POSTS = [];
require('../lib/varal-post').videoVaral = async () => Buffer.from('mp4');
require('../lib/ig-post').publicarIG = async p => { POSTS.push(p); return { id: 'ig' + POSTS.length, link: 'https://instagram.com/p/x' }; };
require('../lib/avisos').publicado = async () => {};
const varal = require('../api/varal');
const { textos, foto, B, email } = varal.interno;
const EMAILS = [];
email.enviar = async m => { EMAILS.push(m); return { ok: 1 }; };
const SUBIDAS = [], APAGADAS = [];
B.put = async (nome, buf) => { SUBIDAS.push({ nome, buf }); return { url: 'https://blob.test/' + nome }; };
B.del = async url => { APAGADAS.push(url); };
const chamar = (method, body, { ip = '1.2.3.4', query, auth, sessao } = {}) => new Promise(ok => {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); } };
  varal({ method, body, query, headers: { 'x-forwarded-for': ip, ...(auth ? { authorization: auth } : {}), ...(sessao ? { 'x-varal': sessao } : {}) } }, res);
});
const emBrasilia = (iso, f) => { const real = Date.now; Date.now = () => Date.parse(iso); return f().finally(() => { Date.now = real; }); };
// foto de 1600x1200 com EXIF (orientação 6 = girada) e "GPS" nos metadados
const fotoTeste = () => sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#c33' } }).withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'casa-da-vovo' } } }).jpeg().toBuffer();

test('textos: limpa, exige nome e barra link e palavrão', () => {
  const { t } = textos({ nome: '  Naru <b>  ', tipo: 'xx', msg: 'linha\nnova', autor: 'Ana' });
  assert.equal(t.nome, 'Naru b');
  assert.equal(t.tipo, 'estrela', 'tipo inválido vira estrela');
  assert.equal(t.msg, 'linha nova');
  assert.match(textos({ nome: '' }).erro, /nome/);
  assert.match(textos({ nome: 'Zelda', msg: 'veja www.spam.net' }).erro, /links/);
  assert.match(textos({ nome: 'Zelda', msg: 'que m.e.r.d.a' }).erro, /palavrões/);
  assert.equal(textos({ nome: 'x'.repeat(50) }).t.nome.length, 30);
});
test('foto: só aceita imagem de verdade', () => {
  assert.match(foto('').erro, /JPG/);
  assert.match(foto(Buffer.from('<html>' + 'x'.repeat(200)).toString('base64')).erro, /JPG/);
  assert.ok(foto('data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200)]).toString('base64')).buf);
});
test('fluxo: envia, fica na fila, equipe aprova, aparece, vela uma vez, remove', async () => {
  const b64 = (await fotoTeste()).toString('base64');
  const e = await chamar('POST', { acao: 'enviar', nome: 'Merlin', tipo: 'estrela', anos: '2011 – 2025', msg: 'Guardião da casa', autor: 'Rodrigo', foto: b64 });
  assert.equal(e.code, 200, JSON.stringify(e.j));
  const id = e.j.id;
  // foto refeita: girada pelo EXIF (1200x1600 -> cabe em 1000), sem metadados
  const meta = await sharp(SUBIDAS[0].buf).metadata();
  assert.equal(meta.width, 750); assert.equal(meta.height, 1000);
  assert.equal(meta.exif, undefined, 'EXIF removido');
  assert.equal(meta.orientation, undefined);
  // ainda não é público
  assert.equal((await chamar('GET', null, { query: {} })).j.total, 0);
  assert.equal((await chamar('GET', null, { query: { id } })).code, 404);
  assert.equal((await chamar('POST', { acao: 'vela', id })).code, 404);
  // sem login não modera
  assert.equal((await chamar('POST', { acao: 'fila' })).code, 401);
  const f = await chamar('POST', { acao: 'fila' }, { auth: TK });
  assert.equal(f.j.fila.length, 1);
  // aprova corrigindo o texto e trocando o tipo
  const ap = await chamar('POST', { acao: 'aprovar', id, msg: 'Guardião da casa e do sofá', tipo: 'aqui' }, { auth: TK });
  assert.equal(ap.code, 200, JSON.stringify(ap.j));
  const l = await chamar('GET', null, { query: {} });
  assert.equal(l.j.total, 1);
  assert.equal(l.j.itens[0].msg, 'Guardião da casa e do sofá');
  assert.equal(l.j.itens[0].criado, undefined, 'só campos públicos');
  assert.equal((await chamar('GET', null, { query: { tipo: 'aqui' } })).j.total, 1);
  assert.equal((await chamar('GET', null, { query: { tipo: 'estrela' } })).j.total, 0);
  // vela: uma por pessoa
  assert.equal((await chamar('POST', { acao: 'vela', id })).j.velas, 1);
  assert.equal((await chamar('POST', { acao: 'vela', id })).j.velas, 1);
  assert.equal((await chamar('POST', { acao: 'vela', id }, { ip: '9.9.9.9' })).j.velas, 2);
  // remove: some da lista e apaga a foto
  assert.equal((await chamar('POST', { acao: 'remover', id }, { auth: TK })).code, 200);
  assert.equal((await chamar('GET', null, { query: {} })).j.total, 0);
  assert.equal((await chamar('GET', null, { query: { tipo: 'aqui' } })).j.total, 0);
  assert.equal(APAGADAS.length, 1);
});
test('envio: robô (campo escondido) não grava, foto falsa recusa, limite por hora', async () => {
  const antes = SUBIDAS.length;
  assert.equal((await chamar('POST', { acao: 'enviar', nome: 'Spam', foto: 'x', site: 'http://x' })).code, 200);
  assert.equal(SUBIDAS.length, antes);
  const lixo = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 7)]).toString('base64');
  assert.equal((await chamar('POST', { acao: 'enviar', nome: 'Spark', foto: lixo }, { ip: '5.5.5.5' })).code, 400);
  const b64 = (await fotoTeste()).toString('base64');
  const cods = [];
  for (let i = 0; i < 5; i++) cods.push((await chamar('POST', { acao: 'enviar', nome: 'Zelda', foto: b64 }, { ip: '7.7.7.7' })).code);
  assert.deepEqual(cods, [200, 200, 200, 200, 429]);
});

test('conta: link no e-mail, sessão, minhas lembranças e apagar a própria', async () => {
  assert.equal((await chamar('POST', { acao: 'entrar', email: 'nao-e-email' })).code, 400);
  const e = await chamar('POST', { acao: 'entrar', email: ' Ana@Exemplo.com ', idioma: 'pt' }, { ip: '3.3.3.3' });
  assert.equal(e.code, 200, JSON.stringify(e.j));
  assert.equal(EMAILS.at(-1).to, 'ana@exemplo.com');
  const t = EMAILS.at(-1).text.match(/\/varal\/entrar\?t=([\w-]+)/)[1];
  const c = await chamar('POST', { acao: 'confirmar', t });
  assert.equal(c.j.email, 'ana@exemplo.com');
  assert.equal((await chamar('POST', { acao: 'confirmar', t })).code, 400, 'link vale uma vez');
  const S = c.j.sessao;
  // sessão falsa ou de equipe não vale
  assert.equal((await chamar('POST', { acao: 'minhas' }, { sessao: S.replace(/.$/, 'x') })).code, 401);
  assert.equal((await chamar('POST', { acao: 'minhas' }, { sessao: TK.slice(7) })).code, 401);
  // pendura logada: aparece em minhas com status
  const b64 = (await fotoTeste()).toString('base64');
  const id = (await chamar('POST', { acao: 'enviar', nome: 'Naru', foto: b64 }, { ip: '3.3.3.3', sessao: S })).j.id;
  const outra = (await chamar('POST', { acao: 'enviar', nome: 'Spark', foto: b64 }, { ip: '3.3.3.4' })).j.id;
  const m = await chamar('POST', { acao: 'minhas' }, { sessao: S });
  assert.deepEqual(m.j.itens.map(i => [i.nome, i.status]), [['Naru', 'fila']]);
  assert.equal(m.j.itens[0].dono, undefined, 'não expõe o dono');
  // não apaga a de outra pessoa
  assert.equal((await chamar('POST', { acao: 'apagar', id: outra }, { sessao: S })).code, 404);
  assert.equal((await chamar('POST', { acao: 'apagar', id }, { sessao: S })).code, 200);
  assert.equal((await chamar('POST', { acao: 'minhas' }, { sessao: S })).j.itens.length, 0);
  assert.equal((await chamar('POST', { acao: 'fila' }, { auth: TK })).j.fila.some(i => i.id === id), false);
  // limite de links por e-mail
  const cods = [];
  for (let i = 0; i < 4; i++) cods.push((await chamar('POST', { acao: 'entrar', email: 'ana@exemplo.com' }, { ip: '3.3.3.' + (10 + i) })).code);
  assert.deepEqual(cods, [200, 200, 200, 429]);
});
test('curtidas, busca e ordem por mais curtidas', async () => {
  const b64 = (await fotoTeste()).toString('base64');
  const ids = {};
  for (const [nome, tipo] of [['Mimi', 'estrela'], ['Bolota', 'aqui'], ['Méli', 'aqui']]) {
    ids[nome] = (await chamar('POST', { acao: 'enviar', nome, tipo, autor: 'Ana', foto: b64 }, { ip: '8.8.8.' + nome.length })).j.id;
    await chamar('POST', { acao: 'aprovar', id: ids[nome] }, { auth: TK });
  }
  // curte, repete (não conta de novo), desfaz
  assert.deepEqual((await chamar('POST', { acao: 'curtir', id: ids.Bolota, sim: true })).j, { curtidas: 1, curti: true });
  assert.equal((await chamar('POST', { acao: 'curtir', id: ids.Bolota, sim: true })).j.curtidas, 1);
  assert.equal((await chamar('POST', { acao: 'curtir', id: ids.Bolota, sim: true }, { ip: '6.6.6.6' })).j.curtidas, 2);
  assert.equal((await chamar('POST', { acao: 'curtir', id: ids.Bolota, sim: false })).j.curtidas, 1);
  assert.equal((await chamar('POST', { acao: 'curtir', id: ids.Bolota, sim: false })).j.curtidas, 1, 'desfazer duas vezes não tira de novo');
  await chamar('POST', { acao: 'curtir', id: ids.Mimi, sim: true }, { ip: '6.6.6.7' });
  await chamar('POST', { acao: 'curtir', id: ids.Mimi, sim: true }, { ip: '6.6.6.8' });
  assert.equal((await chamar('POST', { acao: 'curtir', id: 'nada' })).code, 404);
  const top = await chamar('GET', null, { query: { ordem: 'curtidas' } });
  assert.deepEqual(top.j.itens.slice(0, 2).map(i => [i.nome, i.curtidas]), [['Mimi', 2], ['Bolota', 1]]);
  assert.deepEqual((await chamar('GET', null, { query: { ordem: 'curtidas', tipo: 'aqui' } })).j.itens.map(i => i.nome), ['Bolota', 'Méli']);
  // busca sem acento e sem diferenciar maiúscula
  const b = await chamar('GET', null, { query: { q: 'MELI' } });
  assert.deepEqual([b.j.total, b.j.itens[0].nome], [1, 'Méli']);
  assert.equal((await chamar('GET', null, { query: { q: 'xyz' } })).j.total, 0);
  // removida some do ranking
  await chamar('POST', { acao: 'remover', id: ids.Mimi }, { auth: TK });
  assert.equal((await chamar('GET', null, { query: { ordem: 'curtidas' } })).j.itens[0].nome, 'Bolota');
});

test('Reels de quinta: só na quinta, uma vez, respeita o desligar; equipe publica e gera prévia', async () => {
  process.env.CRON_SECRET = 'cron-teste';
  const cron = { query: { post: '1' }, auth: 'Bearer cron-teste' };
  assert.equal((await chamar('GET', null, { query: { post: '1' } })).code, 401, 'sem a chave do cron');
  // quarta 29/10/2026 15h UTC = 12h de Brasília: não posta
  assert.equal((await emBrasilia('2026-10-28T15:00:00Z', () => chamar('GET', null, cron))).j.fora, true);
  const q = await emBrasilia('2026-10-29T15:00:00Z', () => chamar('GET', null, cron));
  assert.equal(q.j.data, '2026-10-29', JSON.stringify(q.j));
  assert.equal(POSTS.length, 1);
  assert.equal(POSTS[0].media_type, 'REELS');
  assert.match(POSTS[0].caption, /varal|Varal/);
  assert.match(POSTS[0].caption, /#MiadosDoDestino/);
  assert.ok(APAGADAS.some(u => /publicar\/varal-2026-10-29/.test(u)), 'vídeo sai do Blob depois de publicar');
  assert.equal((await emBrasilia('2026-10-29T18:00:00Z', () => chamar('GET', null, cron))).j.repetido, true);
  assert.equal(POSTS.length, 1, 'não repete na mesma quinta');
  // desligado na Central: a quinta seguinte passa em branco
  assert.equal((await chamar('POST', { acao: 'post_ligar', ativo: false }, { auth: TK })).j.cfg.ativo, false);
  assert.equal((await emBrasilia('2026-11-05T15:00:00Z', () => chamar('GET', null, cron))).j.desligado, true);
  assert.equal(POSTS.length, 1);
  // publicar agora vale mesmo desligado e fora da quinta; legenda muda de semana para semana
  const ag = await emBrasilia('2026-10-30T15:00:00Z', () => chamar('POST', { acao: 'post_agora' }, { auth: TK }));
  assert.equal(ag.j.ultimo.data, '2026-10-30');
  assert.equal(POSTS.length, 2);
  const { legendaDa, LEGENDAS } = require('../lib/varal-post');
  const seis = ['2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03'].map(legendaDa);
  assert.equal(new Set(seis).size, LEGENDAS.length, 'seis quintas seguidas, seis legendas diferentes');
  const pv = await chamar('POST', { acao: 'post_previa' }, { auth: TK });
  assert.match(pv.j.previa.url, /varal-previa/);
  assert.equal((await chamar('POST', { acao: 'post_status' })).code, 401);
});
