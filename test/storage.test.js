const test = require('node:test');
const assert = require('node:assert');

Object.assign(process.env, {
  R2_ACCOUNT_ID: 'conta123', R2_ACCESS_KEY_ID: 'AKIATESTE', R2_SECRET_ACCESS_KEY: 'segredo',
  R2_BUCKET: 'miados', R2_PUBLIC_URL: 'https://pub-teste.r2.dev/'
});
const st = require('../lib/storage');

test('assinatura confere com o exemplo oficial de URL pré-assinada da AWS', () => {
  const url = st.interno.preAssinar({
    metodo: 'GET', hostname: 'examplebucket.s3.amazonaws.com', caminho: '/test.txt', regiao: 'us-east-1',
    chave: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', segundos: 86400,
    agora: new Date('2013-05-24T00:00:00Z')
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('link de envio aponta para o bucket e devolve a URL pública do arquivo', () => {
  const r = st.linkDeEnvio('publicar/video.mp4');
  assert.match(r.pathname, /^publicar\/video-[A-Za-z0-9]{20}\.mp4$/);
  assert.ok(r.uploadUrl.startsWith('https://conta123.r2.cloudflarestorage.com/miados/' + r.pathname + '?'));
  assert.strictEqual(r.url, 'https://pub-teste.r2.dev/' + r.pathname);
});

test('reconhece só URLs do próprio bucket, e da pasta pedida', () => {
  assert.ok(st.ehNosso('https://pub-teste.r2.dev/crono/a.jpg', 'crono/'));
  assert.ok(!st.ehNosso('https://pub-teste.r2.dev/publicar/a.jpg', 'crono/'));
  assert.ok(!st.ehNosso('https://x.public.blob.vercel-storage.com/crono/a.jpg', 'crono/'));
  assert.ok(!st.ehNosso('https://pub-teste.r2.dev.evil.com/crono/a.jpg'));
});

test('put assina o envio, grava com sufixo e devolve a URL pública', async () => {
  const chamadas = [];
  global.fetch = async (url, o) => { chamadas.push({ url, o }); return { ok: true, status: 200, text: async () => '' }; };
  const r = await st.put('publicar/sussurro-2026-11-12.jpg', Buffer.from('x'), { contentType: 'image/jpeg', addRandomSuffix: true });
  assert.match(r.url, /^https:\/\/pub-teste\.r2\.dev\/publicar\/sussurro-2026-11-12-[A-Za-z0-9]{20}\.jpg$/);
  assert.strictEqual(chamadas[0].o.method, 'PUT');
  assert.strictEqual(chamadas[0].o.headers['content-type'], 'image/jpeg');
  assert.match(chamadas[0].o.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIATESTE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test('list converte o XML do R2 e del apaga cada arquivo pela URL', async () => {
  const chamadas = [];
  global.fetch = async (url, o) => {
    chamadas.push({ url, metodo: o.method });
    const xml = '<ListBucketResult><Contents><Key>backups/a&amp;b.json</Key><LastModified>2026-11-10T06:00:00.000Z</LastModified><Size>42</Size></Contents>'
      + '<Contents><Key>backups/c.json</Key><LastModified>2026-11-11T06:00:00.000Z</LastModified><Size>7</Size></Contents></ListBucketResult>';
    return { ok: true, status: 200, text: async () => xml };
  };
  const { blobs } = await st.list({ prefix: 'backups/' });
  assert.deepStrictEqual(blobs.map(b => [b.pathname, b.size]), [['backups/a&b.json', 42], ['backups/c.json', 7]]);
  assert.match(chamadas[0].url, /\?list-type=2&max-keys=1000&prefix=backups%2F$/);
  await st.del(blobs.map(b => b.url));
  assert.deepStrictEqual(chamadas.slice(1).map(c => [c.metodo, c.url.replace(/^https:\/\/[^/]+/, '')]), [['DELETE', '/miados/backups/a%26b.json'], ['DELETE', '/miados/backups/c.json']]);
});

test('sem configuração, o teste explica o que falta e put recusa', async () => {
  const salvo = process.env.R2_BUCKET; delete process.env.R2_BUCKET;
  try {
    assert.match(await st.teste(), /falta R2_BUCKET/);
    await assert.rejects(st.put('a.jpg', 'x'), /falta R2_BUCKET/);
  } finally { process.env.R2_BUCKET = salvo; }
});
