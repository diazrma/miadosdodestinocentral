// Chamadas do Instagram usadas pelas automações de direct e comentários (token de lib/ig.js)
const crypto = require('crypto');
const { igToken } = require('./ig');
const { mac } = require('./db');
const G = 'https://graph.instagram.com';
const env = (...k) => k.map(x => process.env[x]).find(Boolean) || '';
const SECRET = () => env('IG_APP_SECRET', 'INSTAGRAM_APP_SECRET', 'META_APP_SECRET', 'APP_SECRET');
// token de verificação do webhook: IG_VERIFY_TOKEN ou, se não existir, um derivado do SESSION_SECRET (aparece na aba Automações)
const VERIFY = () => env('IG_VERIFY_TOKEN', 'WEBHOOK_VERIFY_TOKEN', 'META_VERIFY_TOKEN', 'VERIFY_TOKEN') || (process.env.SESSION_SECRET ? 'miados-' + mac('ig-webhook').slice(0, 20) : '');
function amigavel(e) {
  const m = e.error_user_msg || e.message || '', c = e.code, s = e.error_subcode;
  if (c === 190) return 'Acesso ao Instagram expirado ou inválido: reconecte na aba Dados';
  if ((c === 10 && s === 2534022) || /outside of allowed window|24 hour/i.test(m)) return 'Fora da janela de 24 h: a pessoa precisa mandar mensagem antes';
  if (c === 10 || c === 200 || /permission/i.test(m)) return 'Sem permissão de mensagens/comentários: reconecte o Instagram na aba Dados (Conectar Instagram)';
  if (c === 4 || c === 613 || /limit/i.test(m)) return 'Limite de envios do Instagram atingido. Tente mais tarde';
  if (/already been replied|private repl/i.test(m)) return 'Este comentário já recebeu resposta privada';
  return 'Instagram: ' + m;
}
async function ig(p, { q = {}, body, method } = {}) {
  const t = await igToken();
  if (!t) throw new Error('Instagram não conectado: na aba Dados, clique em Conectar Instagram');
  const u = new URL(G + p);
  Object.entries({ ...q, access_token: t }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (j.error) { const e = new Error(amigavel(j.error)); e.ig = j.error; throw e; }
  return j;
}
// recipient: { id } para conversa aberta ou { comment_id } para resposta privada a comentário
const enviar = (recipient, message, tag) => ig('/me/messages', { body: { recipient, message, ...(tag ? { messaging_type: 'MESSAGE_TAG', tag } : {}) } });
const responderComentario = (id, message) => ig('/' + encodeURIComponent(id) + '/replies', { body: { message } });
const perfil = id => ig('/' + encodeURIComponent(id), { q: { fields: 'name,username,profile_pic,is_user_follow_business,follower_count' } });
const iceBreakers = lista => lista.length
  ? ig('/me/messenger_profile', { body: { platform: 'instagram', ice_breakers: [{ locale: 'default', call_to_actions: lista.map(x => ({ question: x.q.slice(0, 80), payload: 'a:' + x.auto })) }] } })
  : ig('/me/messenger_profile', { method: 'DELETE', body: { platform: 'instagram', fields: ['ice_breakers'] } });
// liga o envio de eventos da conta conectada para o webhook do app
const CAMPOS = 'comments,messages,messaging_postbacks,messaging_seen';
const assinar = () => ig('/me/subscribed_apps', { q: { subscribed_fields: CAMPOS }, method: 'POST' });
const assinatura = () => ig('/me/subscribed_apps').then(j => (j.data || [])[0]?.subscribed_fields || []);
const assinaturaOk = (raw, sig) => {
  const s = SECRET(); if (!s || !sig) return false;
  const a = Buffer.from('sha256=' + crypto.createHmac('sha256', s).update(raw).digest('hex')), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
module.exports = { ig, enviar, responderComentario, perfil, iceBreakers, assinar, assinatura, assinaturaOk, SECRET, VERIFY };
