// Publicação no Instagram pela Graph API: cria o contêiner, espera ficar pronto e publica.
const { igToken } = require('./ig');

async function ig(p, q, post) {
  const b = new URLSearchParams({ ...q, access_token: await igToken() });
  const r = await fetch('https://graph.instagram.com' + p + (post ? '' : '?' + b), post ? { method: 'POST', body: b } : {});
  const j = await r.json();
  if (j.error) throw new Error('Instagram: ' + (j.error.error_user_msg || j.error.message));
  return j;
}

/** params: { image_url, caption?, media_type? ('STORIES') }. Devolve { id, link }. */
async function publicarIG(params) {
  if (!(await igToken())) throw new Error('Instagram não conectado');
  const uid = (await ig('/me', { fields: 'user_id' })).user_id;
  const { id } = await ig('/' + uid + '/media', params, 1);
  for (let i = 0; i < 15; i++) {  // imagem costuma ficar pronta em poucos segundos
    const st = await ig('/' + id, { fields: 'status_code' });
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error('Instagram recusou a imagem');
    await new Promise(r => setTimeout(r, 2000));
  }
  const pub = await ig('/' + uid + '/media_publish', { creation_id: id }, 1);
  const link = await ig('/' + pub.id, { fields: 'permalink' }).then(j => j.permalink).catch(() => '');
  return { id: pub.id, link };
}

module.exports = { publicarIG };
