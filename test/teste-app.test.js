// story diário do teste do app: rodízio das 8 telas
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { interno: { POSTS, doDia } } = require('../api/teste-app');
test('8 telas de story no repositório', () => {
  assert.equal(POSTS.length, 8);
  POSTS.forEach((_, i) => assert.ok(fs.existsSync(`teste-app/story_${String(i + 1).padStart(2, '0')}.jpg`)));
});
test('rodízio: 8 dias seguidos usam as 8 artes, sem repetir', () => {
  const dias = Array.from({ length: 8 }, (_, k) => doDia(new Date(Date.UTC(2026, 9, 17 + k)).toISOString().slice(0, 10)));
  assert.equal(new Set(dias).size, 8);
});
