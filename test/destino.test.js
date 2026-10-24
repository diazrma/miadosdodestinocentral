// node --test test/  (Groq simulado; a arte roda de verdade com o sharp)
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/destino');

const SAB = Date.parse('2026-10-24T18:00:00Z'), DOM = Date.parse('2026-10-25T22:00:00Z'), SEG = Date.parse('2026-10-26T15:00:00Z');
const ia = (texto, chamadas = []) => async msgs => { chamadas.push(msgs); return { texto }; };

test('destino: o fio só se mexe no fim de semana, e sábado e domingo são a mesma semana', () => {
  assert.equal(D.semana(SAB), '2026-10-24');
  assert.equal(D.semana(DOM), '2026-10-24');
  assert.equal(D.semana(SEG), null);
  assert.equal(D.semana(Date.parse('2026-10-25T02:30:00Z')), '2026-10-24', 'sábado 23h30 em Brasília ainda é sábado');
});

test('destino: guardião é um dos cinco e não muda no mesmo fim de semana', () => {
  const g = D.guardiao('123', '2026-10-24');
  assert.ok(D.ORDEM.includes(g));
  assert.equal(D.guardiao('123', '2026-10-24'), g);
  const varios = new Set(Array.from({ length: 60 }, (_, i) => D.guardiao('u' + i, '2026-10-24')));
  assert.equal(varios.size, 5, 'os cinco gatos aparecem');
});

test('destino: profecia com o nome, o guardião e guardada para o domingo', async () => {
  const c = { id: '123', nome: 'Ana Paula' }, chamadas = [];
  const t = await D.profecia(c, { now: SAB, perguntar: ia('Uma janela acesa te espera nesta semana, e alguém vai lembrar de você na chuva.', chamadas) });
  const N = D.NOMES[D.guardiao('123', '2026-10-24')];
  assert.match(t, /^🔴 Ana, o fio vermelho se mexeu\./);
  assert.match(t, new RegExp(`${N} é (o guardião|a guardiã) da sua semana\\. Uma janela acesa`));
  assert.match(t, /🇺🇸/);
  assert.equal(c.campos.guardiao, N);
  assert.ok(c.tags.includes('fio-vermelho'));
  assert.match(chamadas[0][0].content, /Ana/);
  const de = await D.profecia(c, { now: DOM, perguntar: ia('outra coisa', chamadas) });
  assert.equal(de, t, 'domingo repete a de sábado');
  assert.equal(chamadas.length, 1, 'sem chamar a IA de novo');
});

test('destino: semana nova sorteia de novo; IA fora usa a frase pronta do gato', async () => {
  const c = { id: '123', user: 'leitor', destino: { semana: '2026-10-17', gato: 'naru', texto: 'velha' } };
  const t = await D.profecia(c, { now: SAB, perguntar: async () => { throw new Error('429'); } });
  assert.match(t, /^🔴 leitor,/);
  assert.ok(t.includes(D.RESERVA[c.destino.gato]));
  assert.equal(c.destino.semana, '2026-10-24');
});

test('destino: de segunda a sexta manda voltar no sábado, sem gastar IA', async () => {
  let chamou = false;
  const t = await D.profecia({ id: '1' }, { now: SEG, perguntar: async () => { chamou = true; return { texto: 'x' }; } });
  assert.equal(t, D.FECHADO);
  assert.equal(chamou, false);
});

test('destino: arte de sábado e de domingo saem em 1080x1920', async () => {
  const sharp = require('sharp');
  for (const tipo of ['sabado', 'domingo']) {
    const m = await sharp(await D.arte(tipo)).metadata();
    assert.deepEqual([m.format, m.width, m.height], ['jpeg', 1080, 1920]);
  }
});

test('destino: gata é guardiã, gato é guardião; profecia longa corta no fim da frase', async () => {
  const id = g => Array.from({ length: 200 }, (_, i) => 'p' + i).find(x => D.guardiao(x, '2026-10-24') === g);
  const zelda = await D.profecia({ id: id('zelda'), nome: 'Bia' }, { now: SAB, perguntar: ia('Olhe o telhado antes de sair. Seu instinto vai estar certo.') });
  assert.match(zelda, /Zelda é a guardiã da sua semana/);
  const merlin = await D.profecia({ id: id('merlin'), nome: 'Leo' }, { now: SAB, perguntar: ia('Guarde o sininho que vai cair no seu caminho. ' + 'Ele abre uma porta que você nem lembrava '.repeat(12)) });
  assert.match(merlin, /Merlin é o guardião da sua semana\. Guarde o sininho que vai cair no seu caminho\.\n/);
  const semPonto = await D.profecia({ id: id('spark'), nome: 'Cris' }, { now: SAB, perguntar: ia('uma frase enorme sem ponto '.repeat(20)) });
  assert.ok(semPonto.includes(D.RESERVA.spark), 'sem fim de frase usa a frase pronta');
});
