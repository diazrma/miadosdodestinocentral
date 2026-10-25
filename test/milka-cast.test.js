// Milka Cast: datas comemorativas, escolha de tema sem repetir e legenda do reel
const test = require('node:test');
const assert = require('node:assert/strict');
const { corrigirNomes, hashtags, comemorativa, pascoa, temaDaLista, tipoDoDia, legenda, json, TEMAS } = require('../api/milka-cast').interno;

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

test('hashtag repetida com maiúscula sai uma vez só', () => {
  assert.deepEqual(hashtags(['#MilkaCast', '#MiadosDoDestino', '#Gatos', 'semcerquilha']), ['#milkacast', '#miadosdodestino', '#milka', '#Gatos']);
});

test('nome errado pela Groq volta a ser o nome certo', () => {
  assert.equal(corrigirNomes('Oi, aqui é a Milma, e este é o Milma Cast.'), 'Oi, aqui é a Milka, e este é o Milka Cast.');
  assert.equal(corrigirNomes('#milmacast #Milma #MilmaCast'), '#milkacast #Milka #MilkaCast');
  assert.equal(corrigirNomes('Merlim e Zeldá com o Queijino'), 'Merlin e Zelda com o Queijinho');
  assert.equal(corrigirNomes('Hi, I am Milky and this is Milma Cast'), 'Hi, I am Milka and this is Milka Cast');
  // palavras de verdade e nomes curtos não mexem
  const ok = 'Mil gatos, milho, Milk, Mila, Malha, Naru, Baek, Spark, Nari, #zeldinha, #podcast, Milka';
  assert.equal(corrigirNomes(ok), ok);
});
