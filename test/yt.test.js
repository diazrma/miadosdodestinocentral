// YouTube Shorts do Milka Cast: título, #Shorts na descrição, tags sem cerquilha e privacidade segura
const test = require('node:test');
const assert = require('node:assert/strict');
const { metadados } = require('../lib/yt');

test('Short com #Shorts, tags sem # e categoria Pets e Animais', () => {
  const m = metadados({ titulo: 'Milka Cast #02 · A Chuva', descricao: 'Oi\n\n#milkacast', tags: ['#milkacast', '#gatos'] }, 'unlisted');
  assert.equal(m.snippet.title, 'Milka Cast #02 · A Chuva');
  assert.match(m.snippet.description, /#Shorts$/);
  assert.deepEqual(m.snippet.tags, ['milkacast', 'gatos']);
  assert.equal(m.snippet.categoryId, '15');
  assert.equal(m.status.privacyStatus, 'unlisted');
  assert.equal(m.status.selfDeclaredMadeForKids, false);
});

test('não repete #Shorts, corta título longo e privacidade desconhecida vira privado', () => {
  const m = metadados({ titulo: 'x'.repeat(150), descricao: 'Oi #shorts' }, 'qualquer');
  assert.equal(m.snippet.title.length, 100);
  assert.equal(m.snippet.description, 'Oi #shorts');
  assert.equal(m.status.privacyStatus, 'private');
});
