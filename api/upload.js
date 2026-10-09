const { generateClientTokenFromReadWriteToken, handleUploadPresigned } = require('@vercel/blob/client');
const { put, del, issueSignedToken } = require('@vercel/blob');
const { auth } = require('../lib/db');
const { SID, RW, cred } = require('../lib/blob');
const TIPOS = ['image/jpeg', 'video/mp4', 'video/quicktime'], MAX = 300 * 1024 * 1024, OK = n => /^(publicar|app)\/[\w.-]+$/.test(n);
function explica(e) {
  const m = String(e.message || e);
  if (/private/i.test(m)) return m + ' → o Blob store está como PRIVADO; crie um store PÚBLICO (o Instagram precisa baixar o arquivo)';
  if (/store.*not found|store_not_found/i.test(m)) return m + ` → o BLOB_STORE_ID (${SID() || 'vazio'}) não é de um store existente. Copie o ID do store em Storage > Blob, ajuste a variável e faça Redeploy`;
  if (/No blob credentials|oidc/i.test(m)) return m + ' → conecte o Blob store ao projeto (Storage > Blob > Connect) e faça Redeploy';
  return m;
}
async function teste(req) {
  if (!SID() && !RW()) return 'Falta BLOB_STORE_ID: conecte o Blob store ao projeto (Storage > Blob > Connect) e faça Redeploy';
  try { const r = await put('publicar/teste.txt', 'ok', { access: 'public', contentType: 'text/plain', addRandomSuffix: true, ...cred(req) }); await del(r.url, cred(req)).catch(() => {}); return 'ok'; }
  catch (e) { return 'Vercel Blob: ' + explica(e); }
}
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const b = req.body || {}, nome = String(b.nome || '');
    // papéis de parede do app (pasta app/) valem para quem tem o menu App; o resto exige o menu Publicar
    const menu = nome.startsWith('app/') && b.acao === 'enviar' ? 'app' : 'publicar';
    if (!a.menus.includes(menu)) return res.status(403).json({ erro: menu === 'app' ? 'Sem permissão para o menu App' : 'Sem permissão para publicar' });
    if (b.type === 'blob.generate-presigned-url') {
      return res.json(await handleUploadPresigned({ body: b, request: req, getSignedToken: async pathname => {
        if (!OK(pathname)) throw new Error('Nome de arquivo inválido');
        const lim = { allowedContentTypes: TIPOS, maximumSizeInBytes: MAX };
        return { token: await issueSignedToken({ pathname, operations: ['put'], validUntil: Date.now() + 3600e3, ...lim, ...cred(req) }), urlOptions: { ...lim, addRandomSuffix: true } };
      } }));
    }
    if (b.acao === 'teste') { const m = await teste(req); return m === 'ok' ? res.json({ ok: 1 }) : res.status(500).json({ erro: m }); }
    if (!OK(nome)) return res.status(400).json({ erro: 'Nome de arquivo inválido' });
    if (b.acao === 'enviar') {
      const buf = Buffer.from(String(b.dados || ''), 'base64');
      if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ erro: 'Imagem inválida' });
      try { return res.json({ url: (await put(nome, buf, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, ...cred(req) })).url }); }
      catch (e) { return res.status(500).json({ erro: 'Vercel Blob: ' + explica(e) }); }
    }
    const t = RW();
    if (t) return res.json({ clientToken: await generateClientTokenFromReadWriteToken({ token: t, pathname: nome, allowedContentTypes: TIPOS, maximumSizeInBytes: MAX, addRandomSuffix: true, validUntil: Date.now() + 3600e3 }) });
    if (!SID()) return res.status(500).json({ erro: 'Falta BLOB_STORE_ID: conecte o Blob store ao projeto e faça Redeploy' });
    res.json({ presign: 1 });
  } catch (e) { res.status(500).json({ erro: 'Vercel Blob: ' + explica(e) }); }
};
