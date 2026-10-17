// e-mail do cronograma: validação das imagens, montagem e destinatários só da Equipe
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'segredo-de-teste', GMAIL_USER: 'central@gmail.com', GMAIL_APP_PASSWORD: 'x' });
const enviados = [];
nodemailer.createTransport = () => ({ sendMail: async m => { enviados.push(m); return { accepted: [m.to] }; } });
const { roles: R0 } = { roles: [{ id: 'admin', nome: 'Administrador', admin: true }] };
const db = new Map([
  ['mc:users', JSON.stringify([{ id: 'u1', nome: 'Rodrigo', email: 'rodrigo@x.com', role: 'admin' }, { id: 'u2', nome: 'Ana', email: 'ana@x.com', role: 'admin' }])],
  ['mc:state', JSON.stringify({ roles: R0 })],
]);
global.fetch = async (u, o) => ({ ok: true, json: async () => { const [cmd, k] = JSON.parse(o.body); return { result: cmd === 'GET' ? db.get(k) ?? null : 'OK' }; } });
const { sign } = require('../lib/db');
const { interno } = require('../lib/email');
const crono = require('../api/cronograma');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const chamar = body => new Promise(ok => { const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); } }; crono({ method: 'POST', body, headers: { authorization: 'Bearer ' + sign('u1') }, query: {} }, res); });

test('imagens: só jpg com nome limpo, até 10, e recusa acima do limite', () => {
  assert.ok(interno.imagens([{ nome: 'cronograma-2026-10.jpg', dados: jpg }]).anexos);
  assert.equal(interno.imagens([{ nome: '../x.png', dados: jpg }]).erro, 'Sem imagem para enviar');
  assert.match(interno.imagens([{ nome: 'a.jpg', dados: 'A'.repeat(4e6 + 1) }]).erro, /grandes demais/);
  assert.equal(interno.imagens(Array.from({ length: 12 }, (_, i) => ({ nome: i + '.jpg', dados: jpg }))).anexos.length, 10);
});
test('montar: imagens inline por cid, negrito do WhatsApp e texto escapado', () => {
  const { anexos } = interno.imagens([{ nome: 'a.jpg', dados: jpg }]);
  const m = interno.montar({ assunto: 'Cronograma · Outubro', texto: '*Dia 3* <script>', anexos, por: 'Rodrigo' });
  assert.match(m.html, /src="cid:crono0@miados"/);
  assert.match(m.html, /<b>Dia 3<\/b> &lt;script&gt;/);
  assert.equal(m.text, 'Dia 3 <script>');
});
test('acao email: manda só para quem é da Equipe', async () => {
  const r = await chamar({ acao: 'email', para: ['u1', 'u2', 'estranho'], assunto: '🗓️ Cronograma · Outubro', texto: 'oi', imagens: [{ nome: 'c.jpg', dados: jpg }] });
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.para, ['rodrigo@x.com', 'ana@x.com']);
  assert.equal(enviados.at(-1).to, 'rodrigo@x.com, ana@x.com');
  assert.equal(enviados.at(-1).attachments.length, 1);
});
test('acao email: sem destinatário válido não envia', async () => {
  const n = enviados.length;
  const r = await chamar({ acao: 'email', para: ['ninguem'], imagens: [{ nome: 'c.jpg', dados: jpg }] });
  assert.equal(r.code, 400);
  assert.equal(enviados.length, n);
});
