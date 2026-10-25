// YouTube: envio de Shorts com a conta conectada em api/youtube.js (chave de renovação guardada no banco, em "yt_conta").
// Enquanto o projeto do Google Cloud não passa pela auditoria da API, o YouTube deixa todo vídeo enviado por API como
// privado; por isso a privacidade é escolhida na aba Conexões e começa em "private".
const { dbGet } = require('./db');

const PRIVACIDADES = ['private', 'unlisted', 'public'];

async function acesso() {
  const c = await dbGet('yt_conta');
  if (!c || !c.refresh) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: process.env.YT_CLIENT_ID || '', client_secret: process.env.YT_CLIENT_SECRET || '',
    refresh_token: c.refresh, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('YouTube: ' + (j.error_description || j.error || 'não renovou o acesso'));
  return { token: j.access_token, conta: c };
}

// metadados do Short: título até 100 caracteres, #Shorts na descrição, categoria Pets e Animais
function metadados({ titulo, descricao, tags }, privacidade) {
  const desc = String(descricao || '');
  return {
    snippet: {
      title: String(titulo || 'Milka Cast').slice(0, 100),
      description: (/#shorts/i.test(desc) ? desc : desc + '\n\n#Shorts').slice(0, 4900),
      tags: (tags || []).map(t => String(t).replace(/^#/, '')).filter(Boolean).slice(0, 15),
      categoryId: '15', defaultLanguage: 'pt-BR', defaultAudioLanguage: 'pt-BR',
    },
    status: { privacyStatus: PRIVACIDADES.includes(privacidade) ? privacidade : 'private', selfDeclaredMadeForKids: false },
  };
}

/** Envia o vídeo (baixado de video_url) como Short. Devolve null se o canal não está conectado. */
async function enviarShort({ video_url, titulo, descricao, tags }) {
  const a = await acesso();
  if (!a) return null;
  const video = Buffer.from(await (await fetch(video_url)).arrayBuffer());
  const ini = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', body: JSON.stringify(metadados({ titulo, descricao, tags }, a.conta.privacidade)),
    headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(video.length) } });
  const destino = ini.headers.get('location');
  if (!destino) throw new Error('YouTube recusou o envio: ' + (await ini.text()).slice(0, 200));
  const up = await fetch(destino, { method: 'PUT', body: video, headers: { 'Content-Type': 'video/mp4' } });
  const j = await up.json();
  if (!j.id) throw new Error('YouTube: ' + ((j.error && j.error.message) || up.status));
  return { id: j.id, link: 'https://youtube.com/shorts/' + j.id, privacidade: j.status?.privacyStatus || a.conta.privacidade };
}

module.exports = { enviarShort, metadados, PRIVACIDADES };
