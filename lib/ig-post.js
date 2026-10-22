// Publicação no Instagram pela Graph API: cria o contêiner, espera ficar pronto e publica.
const { igToken } = require('./ig');
const { dbGet, dbSet } = require('./db');

// tudo o que sai por aqui é automático: na Central o "quem postou" fica com o usuário Robo (e-mail +robo ou nome Robo)
async function marcarRobo(id) {
  const r = (await dbGet('users') || []).find(u => /\+robo@/i.test(u.email || '') || /^robo$/i.test(u.nome || ''));
  if (!r) return;
  const st = await dbGet('state') || {};
  st.resp = { ...(st.resp || {}), [id]: r.id };
  await dbSet('state', st);
}

async function ig(p, q, post) {
  const b = new URLSearchParams({ ...q, access_token: await igToken() });
  const r = await fetch('https://graph.instagram.com' + p + (post ? '' : '?' + b), post ? { method: 'POST', body: b } : {});
  const j = await r.json();
  if (j.error) throw new Error('Instagram: ' + (j.error.error_user_msg || j.error.message));
  return j;
}

/** params: { image_url | video_url, caption?, media_type? ('STORIES') }. Devolve { id, link }. */
async function publicarIG(params) {
  if (!(await igToken())) throw new Error('Instagram não conectado');
  const uid = (await ig('/me', { fields: 'user_id' })).user_id;
  const { id } = await ig('/' + uid + '/media', params, 1);
  // imagem costuma ficar pronta em poucos segundos; vídeo o Instagram processa antes (até ~2 min)
  const video = !!params.video_url, voltas = video ? 40 : 15, espera = video ? 3000 : 2000;
  let pronto = false;
  for (let i = 0; i < voltas && !pronto; i++) {
    const st = await ig('/' + id, { fields: 'status_code' });
    if (st.status_code === 'ERROR') throw new Error(`Instagram recusou ${video ? 'o vídeo' : 'a imagem'}`);
    pronto = st.status_code === 'FINISHED';
    if (!pronto) await new Promise(r => setTimeout(r, espera));
  }
  if (video && !pronto) throw new Error('O Instagram não terminou de processar o vídeo a tempo');
  const pub = await ig('/' + uid + '/media_publish', { creation_id: id }, 1);
  // daqui em diante já foi publicado: nada pode falhar (quem chama pode tentar de novo de outro jeito)
  const link = await ig('/' + pub.id, { fields: 'permalink' }).then(j => j.permalink).catch(() => '');
  await marcarRobo(pub.id).catch(() => {});
  await require('./bot').dia('pub').catch(() => {});  // publicações automáticas no relatório do Robo
  return { id: pub.id, link };
}

module.exports = { publicarIG, ig };
