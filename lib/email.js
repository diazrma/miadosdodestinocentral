// E-mail do cronograma, no mesmo esquema da Ilha: SMTP do Gmail com senha de app (ou outro provedor).
// Vercel: GMAIL_USER e GMAIL_APP_PASSWORD (opcional SMTP_HOST para não-Gmail).
const nodemailer = require('nodemailer');
const MAX = 4e6; // a Vercel recusa corpo acima de ~4,5 MB
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// *negrito* do WhatsApp vira <b>
const html = t => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

function imagens(lista) {
  const ok = (Array.isArray(lista) ? lista : []).slice(0, 10).filter(i => /^[\w.-]{1,80}\.jpe?g$/i.test(i?.nome || '') && typeof i.dados === 'string');
  const total = ok.reduce((n, i) => n + i.dados.length, 0);
  if (!ok.length) return { erro: 'Sem imagem para enviar' };
  if (total > MAX) return { erro: 'Imagens grandes demais para o e-mail. Mande a semana ou o calendário.' };
  return { anexos: ok.map((i, k) => ({ filename: i.nome, content: Buffer.from(i.dados, 'base64'), contentType: 'image/jpeg', cid: `crono${k}@miados` })) };
}

function montar({ assunto, texto, anexos, por }) {
  const corpo = `<div style="background:#100c08;padding:24px 12px;font-family:Georgia,serif;color:#f3e7d3">
  <div style="max-width:640px;margin:0 auto">
    <p style="letter-spacing:4px;color:#d9b46a;font-size:13px;margin:0 0 6px">MIADOS DO DESTINO</p>
    <h1 style="font-weight:normal;font-size:26px;margin:0 0 18px">${esc(assunto)}</h1>
    ${anexos.map(a => `<img src="cid:${a.cid}" alt="${esc(a.filename)}" style="width:100%;max-width:640px;border-radius:14px;display:block;margin:0 0 14px">`).join('')}
    <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#e8dcc8">${html(texto)}</p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#9a8b74;margin-top:22px">Enviado por ${esc(por)} pela Miados Central.</p>
  </div></div>`;
  return { subject: assunto, text: texto.replace(/\*([^*\n]+)\*/g, '$1'), html: corpo, attachments: anexos };
}

async function enviarCronograma({ para, assunto, texto, imagens: lista, por }) {
  const user = process.env.GMAIL_USER || '', pass = process.env.GMAIL_APP_PASSWORD || '';
  if (!user || !pass) return { erro: 'E-mail não configurado na Vercel (GMAIL_USER e GMAIL_APP_PASSWORD)' };
  const im = imagens(lista);
  if (im.erro) return im;
  const transport = nodemailer.createTransport(user.endsWith('@gmail.com')
    ? { service: 'gmail', auth: { user, pass } }
    : { host: process.env.SMTP_HOST || 'smtp-relay.brevo.com', port: 587, auth: { user, pass } });
  await transport.sendMail({ from: `Miados Central <${user}>`, to: para.join(', '), ...montar({ assunto: assunto || 'Cronograma', texto, anexos: im.anexos, por }) });
  return { ok: 1 };
}

module.exports = { enviarCronograma, interno: { imagens, montar } };
