// story da loja: sai em vídeo; se o vídeo falhar antes de publicar, sai a imagem (o dia nunca fica sem story)
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', DB_PREFIX: 'mc:', SESSION_SECRET: 'x' });
const R = new Map();
let foto;
global.fetch = async (u, o) => {
  if (String(u).startsWith('http://redis.test')) return { ok: true, json: async () => { const [cmd, k, v] = JSON.parse(o.body); if (cmd === 'GET') return { result: R.get(k) ?? null }; R.set(k, v); return { result: 'OK' }; } };
  return { ok: true, arrayBuffer: async () => foto };  // foto do produto na Uma Penca
};
const subidos = [], apagados = [], publicados = [];
let videoFalha = null, igFalhaVideo = null;
require.cache[require.resolve('@vercel/blob')] = { exports: { put: async (nome, buf, o) => { subidos.push({ nome, tipo: o.contentType }); return { url: 'https://blob.test/' + nome }; }, del: async u => { apagados.push(u); } } };
require.cache[require.resolve('../lib/loja-video')] = { exports: { videoStory: async () => { if (videoFalha) throw new Error(videoFalha); return Buffer.from('mp4'); } } };
require.cache[require.resolve('../lib/ig-post')] = { exports: { publicarIG: async params => {
  if (params.video_url && igFalhaVideo) throw new Error(igFalhaVideo);
  publicados.push(params); return { id: 'st' + publicados.length, link: 'https://ig.test/' + publicados.length };
} } };
require.cache[require.resolve('../lib/avisos')] = { exports: { publicado: async () => {}, falhou: async () => {} } };
const story = require('../lib/loja-story');
const set = (k, v) => R.set('mc:' + k, JSON.stringify(v));
const get = k => JSON.parse(R.get('mc:' + k) || 'null');
const produto = { up: '440097', nome: 'Caneca Spark na Chuva', tipo: 'Caneca', status: 'no_ar', url: 'https://umapenca.com/x-440097.html', img: 'https://img.test/440097.jpg', loja: { nome: 'Caneca Spark na Chuva', nomeEn: 'Spark Rain Mug', preco: 66.6, ordem: 0 } };

test.before(async () => { foto = await sharp({ create: { width: 60, height: 80, channels: 3, background: '#fff' } }).jpeg().toBuffer(); });
test.beforeEach(() => { R.clear(); subidos.length = apagados.length = publicados.length = 0; videoFalha = igFalhaVideo = null; set('loja', [produto]); set('bot:autos', []); });

test('publica o story em vídeo e registra o formato', async () => {
  const dia = await story.storyDoDia({ forcar: true });
  assert.equal(dia.formato, 'vídeo');
  assert.equal(publicados.length, 1);
  assert.match(publicados[0].video_url, /\.mp4$/);
  assert.equal(publicados[0].media_type, 'STORIES');
  assert.equal(subidos[0].tipo, 'video/mp4');
  assert.deepEqual(apagados, ['https://blob.test/' + subidos[0].nome]);  // o arquivo some do Blob depois de publicar
  assert.equal(get('loja_story').dias[0].formato, 'vídeo');
});

test('vídeo que falha ao gerar vira imagem, com o motivo guardado', async () => {
  videoFalha = 'ffmpeg não encontrado';
  const dia = await story.storyDoDia({ forcar: true });
  assert.equal(dia.formato, 'imagem');
  assert.equal(dia.erroVideo, 'ffmpeg não encontrado');
  assert.equal(publicados.length, 1);
  assert.match(publicados[0].image_url, /\.jpg$/);
});

test('vídeo recusado pelo Instagram vira imagem e apaga os dois arquivos', async () => {
  igFalhaVideo = 'Instagram recusou o vídeo';
  const dia = await story.storyDoDia({ forcar: true });
  assert.equal(dia.formato, 'imagem');
  assert.equal(publicados.length, 1);
  assert.deepEqual(subidos.map(s => s.tipo), ['video/mp4', 'image/jpeg']);
  assert.equal(apagados.length, 2);
});

test('a prévia gera o vídeo do produto do dia sem publicar nada', async () => {
  const r = await story.previaVideo();
  assert.equal(r.produto, 'Caneca Spark na Chuva');
  assert.match(r.video, /previa-loja-.*\.mp4$/);
  assert.equal(publicados.length, 0);
  assert.equal(get('loja_story'), null);
});
