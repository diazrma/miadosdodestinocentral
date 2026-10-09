const crypto = require('crypto');

// ---------- Firebase Cloud Messaging (HTTP v1) com conta de serviço em FCM_SERVICE_ACCOUNT
async function tokenGoogle(sa) {
  const agora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corpo = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600
  });
  const assinatura = crypto.createSign('RSA-SHA256').update(corpo).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: corpo + '.' + assinatura })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Não foi possível autenticar no Firebase: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}

async function enviarPush({ titulo, texto, topico, token, dados }) {
  if (!process.env.FCM_SERVICE_ACCOUNT) throw new Error('FCM_SERVICE_ACCOUNT não configurado na Vercel');
  const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
  const tk = await tokenGoogle(sa);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { ...(token ? { token } : { topic: topico }), notification: { title: titulo, body: texto }, ...(dados ? { data: dados } : {}), android: { priority: 'high', notification: { channel_id: 'gazeta' } } } })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Falha ao enviar (' + r.status + ')');
  return j.name;
}

module.exports = { enviarPush };
