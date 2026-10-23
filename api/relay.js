// Envio de e-mail para outros sites do Rodrigo (ex.: portfólio da Ana) pelo Gmail da Central.
// Só com a chave RELAY_KEY e só para os endereços de RELAY_PARA (separados por vírgula).
const { timingSafeEqual } = require('crypto');
const { enviar } = require('../lib/email');
const igual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
module.exports = async (req, res) => {
  try {
    const chave = process.env.RELAY_KEY || '';
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
    if (!chave || !igual(req.headers['x-relay-key'] || '', chave)) return res.status(401).json({ erro: 'Chave inválida' });
    const b = req.body || {}, S = (v, n) => String(v || '').slice(0, n);
    const para = S(b.para, 200).trim().toLowerCase();
    const permitidos = (process.env.RELAY_PARA || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (!permitidos.includes(para)) return res.status(400).json({ erro: 'Destinatário não permitido' });
    if (!S(b.assunto, 150).trim() || !S(b.texto, 20000).trim()) return res.status(400).json({ erro: 'Falta assunto ou texto' });
    const responder = S(b.responder, 200).trim();
    const r = await enviar({
      from: `${S(b.nome, 60).replace(/[<>"]/g, '') || 'Aviso'} <${process.env.GMAIL_USER}>`,
      to: para, subject: S(b.assunto, 150), text: S(b.texto, 20000),
      ...(b.html ? { html: S(b.html, 100000) } : {}),
      ...(EMAIL.test(responder) ? { replyTo: responder } : {}),
    });
    return r.erro ? res.status(400).json(r) : res.json({ ok: 1 });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
