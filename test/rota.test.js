const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const router = require('../api/[rota].js');

test('toda rota em rotas/ está no roteador, e nada a mais', () => {
  const arquivos = fs.readdirSync(path.join(__dirname, '..', 'rotas')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();
  assert.deepStrictEqual(Object.keys(router.ROTAS).sort(), arquivos);
});

test('cada entrada do roteador carrega o arquivo de mesmo nome', () => {
  for (const [nome, carregar] of Object.entries(router.ROTAS)) assert.strictEqual(carregar(), require('../rotas/' + nome), nome);
});

test('acha a rota pelo parâmetro da Vercel ou pela URL', () => {
  assert.strictEqual(router.nomeDaRota({ query: { rota: 'sussurro' }, url: '/api/sussurro' }), 'sussurro');
  assert.strictEqual(router.nomeDaRota({ query: {}, url: '/api/webhook?tick=1' }), 'webhook');
  assert.strictEqual(router.nomeDaRota({ url: '/api/milka-cast' }), 'milka-cast');
});

test('rota desconhecida responde 404 sem chamar nenhum handler', async () => {
  let status, corpo;
  const res = { status: s => (status = s, res), json: j => (corpo = j, res) };
  await router({ query: { rota: 'nao-existe' }, url: '/api/nao-existe' }, res);
  assert.strictEqual(status, 404);
  assert.deepStrictEqual(corpo, { erro: 'Rota não encontrada' });
});

test('repassa a requisição sem o parâmetro interno "rota"', async () => {
  const nome = 'relay', original = router.ROTAS[nome];
  let recebido;
  router.ROTAS[nome] = () => async req => { recebido = req.query; };
  try { await router({ query: { rota: nome, x: '1' }, url: '/api/relay?x=1' }, {}); }
  finally { router.ROTAS[nome] = original; }
  assert.deepStrictEqual(recebido, { x: '1' });
});
