const { handleUpload } = require('@vercel/blob/client');
const { auth } = require('../lib/db');
module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Vercel Blob não conectado (Storage > Blob)' });
  try {
    const j = await handleUpload({
      body: req.body, request: req,
      onBeforeGenerateToken: async (_p, tk) => {
        const a = await auth({ headers: { authorization: 'Bearer ' + (tk || '') } });
        if (!a) throw new Error('Faça login');
        if (!a.menus.includes('publicar')) throw new Error('Sem permissão para publicar');
        return { allowedContentTypes: ['image/jpeg', 'video/mp4', 'video/quicktime'], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: true };
      },
      onUploadCompleted: async () => {}
    });
    res.json(j);
  } catch (e) { res.status(400).json({ error: e.message }); }
};
