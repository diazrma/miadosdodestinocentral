// Manda o vídeo do Milka Cast direto para o Blob, com o link assinado que a Central gera (api/milka-cast.js).
//   node enviar.js arquivo.mp4 milka-cast/milka-cast-07.mp4  -> imprime a URL pública
const fs = require('fs');
const { uploadPresigned } = require('@vercel/blob/client');
const CENTRAL = process.env.CENTRAL_URL || 'https://miadosdodestinocentral.vercel.app';

const [arq, nome] = process.argv.slice(2);
uploadPresigned(nome, fs.readFileSync(arq), {
  access: 'public', contentType: 'video/mp4', handleUploadUrl: CENTRAL + '/api/milka-cast',
  headers: { 'x-milka-cast': process.env.MILKA_CAST_SECRET || '' },
}).then(r => console.log(r.url)).catch(e => { console.error(e.message); process.exit(1); });
