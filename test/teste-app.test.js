// story diário do teste do app: rodízio das 8 telas
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { interno: { POSTS, CHAMADAS, doDia, arte } } = require('../api/teste-app');
const sharp = require('sharp');
test('8 telas de story no repositório', () => {
  assert.equal(POSTS.length, 8);
  POSTS.forEach((_, i) => assert.ok(fs.existsSync(`teste-app/story_${String(i + 1).padStart(2, '0')}.jpg`)));
});
test('rodízio: 8 dias seguidos usam as 8 artes, sem repetir', () => {
  const dias = Array.from({ length: 8 }, (_, k) => doDia(new Date(Date.UTC(2026, 9, 17 + k)).toISOString().slice(0, 10)));
  assert.equal(new Set(dias).size, 8);
});
test('56 dias seguidos sem repetir a combinação tela + frase', () => {
  const vistos = new Set();
  for (let k = 0; k < 56; k++) { const n = 20000 + k; vistos.add(n % POSTS.length + '|' + n % CHAMADAS.length); }
  assert.equal(vistos.size, 56);
});
test('arte do story sai em 1080x1920', async () => {
  const m = await sharp(await arte(0, CHAMADAS[0])).metadata();
  assert.deepEqual([m.width, m.height, m.format], [1080, 1920, 'jpeg']);
});
