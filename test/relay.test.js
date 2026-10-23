// relay de e-mail: chave obrigatória, destinatário só da lista e remetente com o nome pedido
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
Object.assign(process.env, { GMAIL_USER: 'central@gmail.com', GMAIL_APP_PASSWORD: 'x', RELAY_KEY: 'chave-de-teste', RELAY_PARA: 'ana@x.com, outra@x.com' });
const enviados = [];
nodemailer.createTransport = () => ({ sendMail: async m => { enviados.push(m); return { accepted: [m.to] }; } });
const relay = require('../api/relay');
const chamar = (body, chave = 'chave-de-teste', method = 'POST') => new Promise(ok => {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); } };
  relay({ method, body, headers: { 'x-relay-key': chave }, query: {} }, res);
});
const ok = { para: 'Ana@x.com', nome: 'Portfólio', assunto: 'Oi', texto: 'Mensagem', responder: 'quem@escola.com' };

test('sem a chave certa não envia', async () => {
  assert.equal((await chamar(ok, 'errada')).code, 401);
  assert.equal((await chamar(ok, '')).code, 401);
  assert.equal((await chamar(ok, 'chave-de-teste', 'GET')).code, 405);
  assert.equal(enviados.length, 0);
});
test('destinatário fora da lista é recusado', async () => {
  const r = await chamar({ ...ok, para: 'spam@x.com' });
  assert.equal(r.code, 400);
  assert.equal(enviados.length, 0);
});
test('envia para a lista com nome no remetente e responder-para', async () => {
  const r = await chamar(ok);
  assert.deepEqual(r, { code: 200, j: { ok: 1 } });
  const m = enviados.at(-1);
  assert.equal(m.to, 'ana@x.com');
  assert.equal(m.from, 'Portfólio <central@gmail.com>');
  assert.equal(m.replyTo, 'quem@escola.com');
});
test('responder-para inválido é ignorado e nome não injeta cabeçalho', async () => {
  await chamar({ ...ok, responder: 'nao é email', nome: 'X <a@b.c>' });
  const m = enviados.at(-1);
  assert.equal(m.replyTo, undefined);
  assert.equal(m.from, 'X a@b.c <central@gmail.com>');
});
