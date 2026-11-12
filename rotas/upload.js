// Envio de mídia do painel para o Supabase Storage (lib/storage.js). Até 50 MB por arquivo (plano gratuito).
//   POST { nome, tipo }                 -> { uploadUrl, url } link assinado: o navegador manda o arquivo com PUT direto
//                                          para o Supabase (vídeos não passam pela função da Vercel)
//   POST { acao: 'enviar', nome, dados } -> { url } JPG pequeno em base64, gravado pela própria função
//   POST { acao: 'teste' }               -> { ok } confere se o armazenamento responde
const { put, linkDeEnvio, teste } = require('../lib/storage');
const { auth } = require('../lib/db');
const TIPOS = ['image/jpeg', 'video/mp4', 'video/quicktime'], OK = n => /^(publicar|app|crono)\/[\w.-]+$/.test(n);

module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const b = req.body || {}, nome = String(b.nome || '');
    // papéis de parede do app (pasta app/) valem para quem tem o menu App; o resto exige o menu Publicar
    // imagens do cronograma (pasta crono/) valem para quem tem o menu Cronograma
    const menu = b.acao === 'enviar' && nome.startsWith('app/') ? 'app' : b.acao === 'enviar' && nome.startsWith('crono/') ? 'cronograma' : 'publicar';
    if (!a.menus.includes(menu)) return res.status(403).json({ erro: menu === 'app' ? 'Sem permissão para o menu App' : menu === 'cronograma' ? 'Sem permissão para o cronograma' : 'Sem permissão para publicar' });
    if (b.acao === 'teste') { const m = await teste(); return m === 'ok' ? res.json({ ok: 1 }) : res.status(500).json({ erro: m }); }
    if (!OK(nome)) return res.status(400).json({ erro: 'Nome de arquivo inválido' });
    if (b.acao === 'enviar') {
      const buf = Buffer.from(String(b.dados || ''), 'base64');
      if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ erro: 'Imagem inválida' });
      try { return res.json({ url: (await put(nome, buf, { contentType: 'image/jpeg', addRandomSuffix: true })).url }); }
      catch (e) { return res.status(500).json({ erro: 'Armazenamento: ' + e.message }); }
    }
    if (!TIPOS.includes(b.tipo)) return res.status(400).json({ erro: 'Tipo de arquivo não aceito' });
    const { uploadUrl, url } = await linkDeEnvio(nome);
    res.json({ uploadUrl, url });
  } catch (e) { res.status(500).json({ erro: 'Armazenamento: ' + e.message }); }
};
