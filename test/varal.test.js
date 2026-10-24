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
const varal = require('../api/varal');
const { textos, foto, B } = varal.interno;
const SUBIDAS = [], APAGADAS = [];
B.put = async (nome, buf) => { SUBIDAS.push({ nome, buf }); return { url: 'https://blob.test/' + nome }; };
B.del = async url => { APAGADAS.push(url); };
const chamar = (method, body, { ip = '1.2.3.4', query, auth } = {}) => new Promise(ok => {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); } };
  varal({ method, body, query, headers: { 'x-forwarded-for': ip, ...(auth ? { authorization: auth } : {}) } }, res);
});
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
