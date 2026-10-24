// Milka Cast: datas comemorativas, escolha de tema sem repetir e legenda do reel
const test = require('node:test');
const assert = require('node:assert/strict');
const { comemorativa, pascoa, temaDaLista, tipoDoDia, legenda, json, TEMAS } = require('../api/milka-cast').interno;

test('datas fixas e móveis', () => {
  assert.equal(comemorativa('2026-10-31'), 'Halloween');
  assert.equal(comemorativa('2026-08-08'), 'Dia Internacional do Gato');
  assert.equal(new Date(pascoa(2026)).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(comemorativa('2026-04-05'), 'Páscoa');
  assert.equal(comemorativa('2026-05-10'), 'Dia das Mães');
  assert.equal(comemorativa('2026-08-09'), 'Dia dos Pais');
  assert.equal(comemorativa('2026-10-25'), null);
});

test('sábado é curiosidade, domingo é a série', () => {
  assert.equal(tipoDoDia('2026-10-24'), 'sabado');
  assert.equal(tipoDoDia('2026-10-25'), 'domingo');
});

test('tema nunca repete, mesmo com acento ou maiúscula diferente', () => {
  const h = [{ tema: 'Por que gatos ronronam' }, { tema: 'por que a gente amassa paozinho' }];
  assert.equal(temaDaLista('sabado', h), TEMAS.sabado[2]);
  const todos = TEMAS.domingo.map(tema => ({ tema }));
  assert.equal(temaDaLista('domingo', todos), null);
});

test('legenda do reel com número, PT, EN e hashtags', () => {
  const l = legenda({ numero: 2, titulo: 'A noite da chuva', legenda: 'Oi', legenda_en: 'Hi', hashtags: ['#milkacast', '#milka'] });
  assert.equal(l, '🎙️ Milka Cast #02 · A noite da chuva\n\n🇧🇷Oi\n\n🇺🇸Hi\n\n#milkacast #milka');
});

test('lê o JSON mesmo com texto em volta', () => {
  assert.deepEqual(json('aqui está:\n```json\n{"titulo":"x"}\n```'), { titulo: 'x' });
  assert.throws(() => json('sem nada'));
});
