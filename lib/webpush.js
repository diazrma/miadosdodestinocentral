// Web Push da Central: inscrições dos navegadores da equipe (push_web) e envio.
// Variáveis na Vercel: CENTRAL_VAPID_PUBLIC e CENTRAL_VAPID_PRIVATE.
const webpush = require('web-push');
const { dbGet, dbSet } = require('./db');
let pronto = false;
const publica = () => process.env.CENTRAL_VAPID_PUBLIC || '';
function configura() {
  if (pronto) return true;
  if (!publica() || !process.env.CENTRAL_VAPID_PRIVATE) return false;
  webpush.setVapidDetails('https://miadosdodestinocentral.vercel.app', publica(), process.env.CENTRAL_VAPID_PRIVATE);
  return (pronto = true);
}
async function inscrever(sub, u) {
  if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Inscrição inválida');
  const lista = (await dbGet('push_web') || []).filter(s => s.sub.endpoint !== sub.endpoint);
  lista.push({ sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, uid: u.id, nome: u.nome, quando: new Date().toISOString() });
  await dbSet('push_web', lista.slice(-50));
  return lista.length;
}
/** payload: { title, body, url?, tag? }. filtro escolhe as inscrições (padrão: todas). Remove as que o navegador invalidou. */
async function enviarWeb(payload, filtro = () => true) {
  if (!configura()) return 0;
  const subs = await dbGet('push_web') || [], mortos = [];
  let n = 0;
  for (const s of subs.filter(filtro)) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 86400, urgency: 'high' }); n++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) mortos.push(s.sub.endpoint); }
  }
  if (mortos.length) await dbSet('push_web', subs.filter(s => !mortos.includes(s.sub.endpoint)));
  return n;
}
module.exports = { publica, inscrever, enviarWeb };
