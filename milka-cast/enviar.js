// Manda o vídeo do Milka Cast direto para o armazenamento (Cloudflare R2), com o link assinado que a Central gera
// (api/milka-cast.js, acao 'link_envio').
//   node enviar.js arquivo.mp4 milka-cast/milka-cast-07.mp4  -> imprime a URL pública
const fs = require('fs');
const CENTRAL = process.env.CENTRAL_URL || 'https://miadosdodestinocentral.vercel.app';

async function enviar(arq, nome) {
  const r = await fetch(CENTRAL + '/api/milka-cast', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-milka-cast': process.env.MILKA_CAST_SECRET || '' },
    body: JSON.stringify({ acao: 'link_envio', nome })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.uploadUrl) throw new Error('Central: ' + (j.erro || r.status));
  const up = await fetch(j.uploadUrl, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: fs.readFileSync(arq) });
  if (!up.ok) throw new Error('Armazenamento respondeu ' + up.status + ': ' + (await up.text()).slice(0, 200));
  return j.url;
}

const [arq, nome] = process.argv.slice(2);
enviar(arq, nome).then(u => console.log(u)).catch(e => { console.error(e.message); process.exit(1); });
