// node --test test/  (Groq simulado; o banco é um Map no lugar do Upstash)
const test = require('node:test');
const assert = require('node:assert/strict');

const banco = new Map();
process.env.UPSTASH_REDIS_REST_URL = 'https://banco.teste';
process.env.UPSTASH_REDIS_REST_TOKEN = 'x';
global.fetch = async (url, o) => {
  const [cmd, k, v] = JSON.parse(o.body);
  if (cmd === 'SET') banco.set(k, v);
  return { json: async () => ({ result: cmd === 'GET' ? banco.get(k) ?? null : 'OK' }) };
};
const G = require('../lib/gazeta');

const DIA = Date.parse('2026-10-25T12:00:00Z');
const TEMPORADA = [
  { n: 1, titulo: 'A Casa na Chuva', sinopse: 'Uma mesa posta para um.', status: 'lancado' },
  { n: 2, titulo: 'A Promessa', sinopse: 'Um desenho de cinco gatos.', status: 'breve', data: '2026-11-01' },
  { n: 3, titulo: 'Cinco Gatos', sinopse: '', status: 'producao' }
];
const ia = (texto, chamadas = []) => async msgs => { chamadas.push(msgs); return { texto, model: 'teste' }; };
const RESPOSTA = JSON.stringify({
  manchete: { kicker: 'Temporada', titulo: 'A Promessa chega em novembro', linha: 'O segundo episódio tem data.', texto: 'A chuva não parou.\n\nE o desenho de Haneul segue com um gato sem cor.' },
  materias: [{ kicker: 'Bastidores', titulo: 'Cena por cena', texto: 'A equipe segue montando os capítulos.' }, { kicker: 'Elenco', titulo: 'A Naru na cadeira', texto: 'De novo.' }]
});

test('gazeta: episódios entram em toda edição, com status e próxima estreia', () => {
  const m = G.materiaTemporada(TEMPORADA);
  assert.equal(m.titulo, '1 de 3 episódios já no ar');
  assert.match(m.texto, /^Próximo: Ep\. 2, “A Promessa”/);
  assert.match(m.texto, /Ep\. 1 · A Casa na Chuva: no ar/);
  assert.match(m.texto, /Ep\. 2 · A Promessa: estreia em 1 de novembro/);
  assert.match(m.texto, /Ep\. 3 · Cinco Gatos: em produção/);
  assert.equal(G.materiaTemporada([]), null);
});

test('gazeta: edição com IA tem número, data, manchete com foto e a temporada em primeiro', async () => {
  process.env.GROQ_API_KEY = 'k';
  const chamadas = [];
  const g = await G.montar({ conteudo: { temporada: TEMPORADA, gazeta: { manchete: { titulo: 'Manchete de ontem' } } }, posts: [{ legenda: 'Bastidores da cozinha', data: '2026-10-24T10:00:00Z' }], loja: { produtos: [{ nome: 'Caneca da Naru' }] }, now: DIA, numero: 7, perguntar: ia('```json\n' + RESPOSTA + '\n```', chamadas) });
  assert.equal(g.edicao, 'Edição nº 07 · 25/10');
  assert.equal(g.origem, 'ia');
  assert.equal(g.manchete.titulo, 'A Promessa chega em novembro');
  assert.ok(G.FOTOS.some(f => f.img === g.manchete.img));
  assert.equal(g.materias[0].kicker, 'Temporada 1');
  assert.equal(g.materias.length, 4, 'temporada + 2 da IA + Instagram');
  assert.equal(g.materias.at(-1).link, 'https://www.instagram.com/miadosdodestino/');
  const fatos = chamadas[0][1].content;
  assert.match(fatos, /Caneca da Naru/);
  assert.match(fatos, /Bastidores da cozinha/);
  assert.match(fatos, /Manchete de ontem/, 'pede para não repetir a de ontem');
  assert.match(chamadas[0][0].content, /Nunca mencione .* Milka/);
});

test('gazeta: IA que vaza a Milka, devolve lixo ou cai usa a pauta pronta', async () => {
  process.env.GROQ_API_KEY = 'k';
  const vaza = RESPOSTA.replace('um gato sem cor', 'a Milka, a quinta gata');
  for (const perguntar of [ia(vaza), ia('não sei'), async () => { throw new Error('fora do ar'); }]) {
    const g = await G.montar({ conteudo: { temporada: TEMPORADA }, now: DIA, numero: 2, perguntar });
    assert.equal(g.origem, 'pronta');
    assert.ok(g.manchete.titulo && g.manchete.texto);
    assert.equal(g.materias[0].kicker, 'Temporada 1');
    assert.ok(!G.vazaSegredo(JSON.stringify(g), false), 'pauta pronta não conta o segredo');
  }
});

test('gazeta: com o enigma revelado a Milka pode aparecer; IA desligada no painel não é chamada', async () => {
  process.env.GROQ_API_KEY = 'k';
  const vaza = RESPOSTA.replace('um gato sem cor', 'a Milka');
  const g = await G.montar({ conteudo: { enigma: { revelado: true } }, now: DIA, numero: 3, perguntar: ia(vaza) });
  assert.equal(g.origem, 'ia');
  const chamadas = [];
  const h = await G.montar({ conteudo: { recursos: { gazetaIA: false } }, now: DIA, numero: 3, perguntar: ia(RESPOSTA, chamadas) });
  assert.equal(h.origem, 'pronta');
  assert.equal(chamadas.length, 0);
});

test('gazeta: arquivo guarda toda edição na própria chave, nada é sobrescrito, e o número continua', async () => {
  banco.clear();
  assert.equal(await G.proximoNumero({ edicao: 'Edição nº 01' }), 2, 'segue a da capa quando o arquivo está vazio');
  const a = await G.arquivar({ data: '2026-10-25', numero: 2, edicao: 'Edição nº 02 · 25/10', manchete: { titulo: 'Primeira' }, materias: [] }, { origem: 'ia', por: 'Agendamento' });
  const b = await G.arquivar({ data: '2026-10-25', numero: 2, edicao: 'Edição nº 02 · 25/10', manchete: { titulo: 'Gerada de novo' }, materias: [] }, { origem: 'ia', por: 'Rodrigo' });
  assert.notEqual(a.id, b.id);
  assert.equal((await G.edicao(a.id)).manchete.titulo, 'Primeira', 'a primeira continua guardada');
  assert.equal((await G.edicao(b.id)).manchete.titulo, 'Gerada de novo');
  const l = await G.edicoes();
  assert.deepEqual(l.map(x => x.titulo), ['Primeira', 'Gerada de novo']);
  assert.ok(!('manchete' in l[0]), 'o índice é leve; a edição inteira fica na chave dela');
  assert.equal(await G.proximoNumero({ edicao: 'Edição nº 02 · 25/10' }), 3);
  assert.ok([...banco.keys()].every(k => k.startsWith('miados-central:')), 'usa o prefixo da Central no banco');
});
