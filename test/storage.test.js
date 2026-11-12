const test = require('node:test');
const assert = require('node:assert');

Object.assign(process.env, { SUPABASE_URL: 'https://proj.supabase.co/', SUPABASE_SERVICE_KEY: 'chave-servico' });
delete process.env.SUPABASE_BUCKET;
const st = require('../lib/storage');
const PUB = 'https://proj.supabase.co/storage/v1/object/public/miados/';

// fetch falso: devolve a resposta da fila e guarda cada chamada
function fetchFalso(respostas) {
  const chamadas = [];
  global.fetch = async (url, o) => {
    chamadas.push({ url, metodo: o.method, headers: o.headers, corpo: o.body });
    const [status, corpo] = respostas.shift() || [200, {}];
    return { ok: status < 300, status, text: async () => typeof corpo === 'string' ? corpo : JSON.stringify(corpo) };
  };
  return chamadas;
}

test('put grava com sufixo no bucket e devolve a URL pública', async () => {
  const ch = fetchFalso([[200, { Key: 'ok' }]]);
  const r = await st.put('publicar/sussurro-2026-11-12.jpg', Buffer.from('x'), { contentType: 'image/jpeg', addRandomSuffix: true });
  assert.match(r.pathname, /^publicar\/sussurro-2026-11-12-[0-9a-f]{20}\.jpg$/);
  assert.strictEqual(r.url, PUB + r.pathname);
  assert.strictEqual(ch[0].metodo, 'POST');
  assert.strictEqual(ch[0].url, 'https://proj.supabase.co/storage/v1/object/miados/' + r.pathname);
  assert.strictEqual(ch[0].headers.authorization, 'Bearer chave-servico');
  assert.strictEqual(ch[0].headers['content-type'], 'image/jpeg');
});

test('cria o bucket público quando ele ainda não existe e repete o envio', async () => {
  const ch = fetchFalso([[400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }], [200, { name: 'miados' }], [200, { Key: 'ok' }]]);
  await st.put('app/a.jpg', Buffer.from('x'), { contentType: 'image/jpeg' });
  assert.deepStrictEqual(ch.map(c => [c.metodo, c.url.replace('https://proj.supabase.co/storage/v1', '')]), [
    ['POST', '/object/miados/app/a.jpg'], ['POST', '/bucket'], ['POST', '/object/miados/app/a.jpg']
  ]);
  assert.deepStrictEqual(JSON.parse(ch[1].corpo), { id: 'miados', name: 'miados', public: true });
});

test('recusa arquivo acima de 50 MB antes de enviar', async () => {
  const ch = fetchFalso([]);
  await assert.rejects(st.put('publicar/grande.mp4', Buffer.alloc(st.MAX_BYTES + 1)), /50 MB/);
  assert.strictEqual(ch.length, 0);
});

test('link de envio devolve o PUT assinado e a URL pública final', async () => {
  const ch = fetchFalso([[200, { url: '/object/upload/sign/miados/milka-cast/ep.mp4?token=abc' }]]);
  const r = await st.linkDeEnvio('milka-cast/ep.mp4', { addRandomSuffix: false });
  assert.strictEqual(r.uploadUrl, 'https://proj.supabase.co/storage/v1/object/upload/sign/miados/milka-cast/ep.mp4?token=abc');
  assert.strictEqual(r.url, PUB + 'milka-cast/ep.mp4');
  assert.strictEqual(ch[0].url, 'https://proj.supabase.co/storage/v1/object/upload/sign/miados/milka-cast/ep.mp4');
});

test('reconhece só URLs do próprio bucket, e da pasta pedida', () => {
  assert.ok(st.ehNosso(PUB + 'crono/a.jpg', 'crono/'));
  assert.ok(!st.ehNosso(PUB + 'publicar/a.jpg', 'crono/'));
  assert.ok(!st.ehNosso('https://x.public.blob.vercel-storage.com/crono/a.jpg', 'crono/'));
  assert.ok(!st.ehNosso('https://proj.supabase.co.evil.com/storage/v1/object/public/miados/crono/a.jpg'));
});

test('list devolve os arquivos da pasta e del apaga todos numa chamada só', async () => {
  const ch = fetchFalso([
    [200, [{ id: '1', name: 'a.json', created_at: '2026-11-11T06:00:00Z', metadata: { size: 42 } }, { id: null, name: 'subpasta' }, { id: '2', name: 'b.json', created_at: '2026-11-10T06:00:00Z', metadata: { size: 7 } }]],
    [200, []]
  ]);
  const { blobs } = await st.list({ prefix: 'backups/' });
  assert.deepStrictEqual(blobs.map(b => [b.pathname, b.size]), [['backups/a.json', 42], ['backups/b.json', 7]]);
  assert.strictEqual(JSON.parse(ch[0].corpo).prefix, 'backups');
  await st.del(blobs.map(b => b.url));
  assert.strictEqual(ch[1].metodo, 'DELETE');
  assert.deepStrictEqual(JSON.parse(ch[1].corpo), { prefixes: ['backups/a.json', 'backups/b.json'] });
});

test('sem configuração, o teste explica o que falta e put recusa', async () => {
  const salvo = process.env.SUPABASE_SERVICE_KEY; delete process.env.SUPABASE_SERVICE_KEY;
  try {
    assert.match(await st.teste(), /falta SUPABASE_SERVICE_KEY/);
    await assert.rejects(st.put('a.jpg', 'x'), /falta SUPABASE_SERVICE_KEY/);
  } finally { process.env.SUPABASE_SERVICE_KEY = salvo; }
});
