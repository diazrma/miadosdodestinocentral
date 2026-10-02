process.env.VERCEL_BLOB_RETRIES = process.env.VERCEL_BLOB_RETRIES || '1';
const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');
const { put } = require('@vercel/blob');
const { auth } = require('../lib/db');
async function teste(req) {
  const token = process.env.BLOB_READ_WRITE_TOKEN, oidc = req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  if (!token && !oidc) return 'Nenhuma credencial do Blob: falta BLOB_READ_WRITE_TOKEN na Vercel';
  const r = await fetch('https://vercel.com/api/blob/?pathname=publicar/teste.txt', { method: 'PUT', body: 'ok', headers: { authorization: 'Bearer ' + (token || oidc), 'x-api-version': '12', 'x-content-type': 'text/plain', 'x-add-random-suffix': '1', 'x-vercel-blob-access': 'public', ...(token ? {} : { 'x-vercel-blob-store-id': String(process.env.BLOB_STORE_ID || '').replace(/^store_/, '') }) } });
  const t = await r.text();
  if (r.ok) return 'ok';
  let m = t; try { m = JSON.parse(t).error.message || t; } catch (e) {}
  if (/private/i.test(m)) m += ' → o Blob store está como PRIVADO; crie um store PÚBLICO (o Instagram precisa baixar o arquivo)';
  return 'Blob respondeu ' + r.status + ': ' + String(m).slice(0, 300);
}
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('publicar')) return res.status(403).json({ erro: 'Sem permissão para publicar' });
    const b = req.body || {}, nome = String(b.nome || '');
    if (b.acao === 'teste') { const m = await teste(req); return m === 'ok' ? res.json({ ok: 1 }) : res.status(500).json({ erro: m }); }
    if (!/^publicar\/[\w.-]+$/.test(nome)) return res.status(400).json({ erro: 'Nome de arquivo inválido' });
    if (b.acao === 'enviar') {
      const buf = Buffer.from(String(b.dados || ''), 'base64');
      if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ erro: 'Imagem inválida' });
      try { return res.json({ url: (await put(nome, buf, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true })).url }); }
      catch (e) { return res.status(500).json({ erro: await teste(req).then(m => m === 'ok' ? 'Vercel Blob: ' + e.message : m) }); }
    }
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ erro: 'Para enviar vídeos falta a variável BLOB_READ_WRITE_TOKEN na Vercel (crie um token no Blob store e faça Redeploy)' });
    const clientToken = await generateClientTokenFromReadWriteToken({ token, pathname: nome, allowedContentTypes: ['image/jpeg', 'video/mp4', 'video/quicktime'], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: true, validUntil: Date.now() + 3600e3 });
    res.json({ clientToken });
  } catch (e) { res.status(500).json({ erro: 'Vercel Blob: ' + e.message }); }
};
