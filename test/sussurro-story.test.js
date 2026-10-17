// story do Sussurro: o cartão sai em 1080x1920 para cada gato e não leva o texto do recado
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { cartao } = require('../lib/sussurro-story');
test('cartão 1080x1920 JPEG para os cinco gatos (e um gato desconhecido cai na Naru)', async () => {
  for (const g of ['naru', 'merlin', 'zelda', 'spark', 'milka', 'xpto']) {
    const m = await sharp(await cartao(g)).metadata();
    assert.equal(m.format, 'jpeg'); assert.equal(m.width, 1080); assert.equal(m.height, 1920);
  }
});
test('cartao não recebe nem usa o texto do recado', () => assert.equal(cartao.length, 1));
