// esqueci a senha: link assinado, 1 h, uso único, sem revelar quem tem conta
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'segredo-de-teste', GMAIL_USER: 'central@gmail.com', GMAIL_APP_PASSWORD: 'x', SITE_URL: 'https://central.test' });
const R = new Map();
global.fetch = async (u, o) => ({ ok: true, json: async () => {
  const [cmd, k, v, ...a] = JSON.parse(o.body);
  if (cmd === 'GET') return { result: R.get(k) ?? null };
  if (cmd === 'SET') { if (a.includes('NX') && R.has(k)) return { result: null }; R.set(k, v); return { result: 'OK' }; }
  throw new Error('não simulado ' + cmd);
} });
const emails = [];
nodemailer.createTransport = () => ({ sendMail: async m => { emails.push(m); return {}; } });
const { hash, check, dbGet } = require('../lib/db');
const auth = require('../api/auth');
R.set('mc:users', JSON.stringify([{ id: 'u1', nome: 'Rodrigo Cardoso', email: 'r@x.com', role: 'admin', hash: hash('senha-antiga') }]));
const chamar = body => new Promise(ok => { const res = { code: 200, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); } }; auth({ body }, res); });
const fichaDo = m => decodeURIComponent(m.text.match(/\?senha=([^\s]+)/)[1]);

test('pedido: e-mail com link só para quem tem conta, resposta igual nos dois casos e 1 por minuto', async () => {
  assert.deepEqual((await chamar({ acao: 'esqueci', email: 'ninguem@x.com' })).j, { ok: 1 });
  assert.equal(emails.length, 0);
  assert.deepEqual((await chamar({ acao: 'esqueci', email: ' R@X.com ' })).j, { ok: 1 });
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'r@x.com');
  assert.match(emails[0].text, /^Oi, Rodrigo!.*https:\/\/central\.test\/\?senha=/);
  await chamar({ acao: 'esqueci', email: 'r@x.com' });
  assert.equal(emails.length, 1, 'segundo pedido no mesmo minuto não manda outro e-mail');
});
test('redefinir: troca a senha, devolve login e o link morre depois de usado', async () => {
  const ficha = fichaDo(emails[0]);
  assert.equal((await chamar({ acao: 'redefinir', ficha, senha: 'curta' })).code, 400);
  const r = await chamar({ acao: 'redefinir', ficha, senha: 'senha-nova-123' });
  assert.equal(r.code, 200); assert.ok(r.j.token);
  const u = (await dbGet('users'))[0];
  assert.ok(check('senha-nova-123', u.hash)); assert.ok(!check('senha-antiga', u.hash));
  assert.equal((await chamar({ acao: 'redefinir', ficha, senha: 'outra-senha-456' })).code, 400);
  assert.equal((await chamar({ acao: 'login', email: 'r@x.com', senha: 'senha-nova-123' })).code, 200);
});
test('redefinir: ficha adulterada ou vencida não vale', async () => {
  R.delete('mc:senha:r@x.com');
  await chamar({ acao: 'esqueci', email: 'r@x.com' });
  const ficha = fichaDo(emails.at(-1)), [p, s] = ficha.split('.');
  const o = JSON.parse(Buffer.from(p, 'base64url')); o.id = 'outro';
  assert.equal((await chamar({ acao: 'redefinir', ficha: Buffer.from(JSON.stringify(o)).toString('base64url') + '.' + s, senha: 'qualquer-coisa' })).code, 400);
  const agora = Date.now; Date.now = () => agora() + 2 * 3600e3;
  try { assert.equal((await chamar({ acao: 'redefinir', ficha, senha: 'qualquer-coisa' })).code, 400); } finally { Date.now = agora; }
});
