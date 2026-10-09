// Estúdio de memes da Central: gera a imagem com IA grátis (Pollinations) e a IA de texto (Groq) ajuda com prompt e ideias.
// POST /api/meme (equipe com o menu Publicar):
//   { acao: 'gerar', cena, personagem, formato }   -> { img: dataURL, modelo, prompt }
//   { acao: 'ideias', personagem }                 -> { ideias: [{ formato, cena, topo, baixo }] }
//   { acao: 'status' }                             -> { chave: bool }  (se a chave grátis do Pollinations está configurada)
// Ordem: 1) Cloudflare Workers AI, FLUX.2 Klein (grátis, ~59 imagens/dia), com a foto oficial do personagem como referência
//           (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN); 2) Pollinations com chave (POLLINATIONS_KEY, precisa de saldo);
//        3) Pollinations público (sem chave, cota pequena).
const { auth } = require('../lib/db');
const { perguntar } = require('../lib/groq');

const BASE = 'https://gen.pollinations.ai';
const PUBLICO = 'https://image.pollinations.ai/prompt/';
const CENTRAL = 'https://miadosdodestinocentral.vercel.app';
const PERSONAGENS = {
  naru: 'Naru, a black-and-white tuxedo cat with yellow eyes, white chest and white paws',
  zelda: 'Zelda, a tortoiseshell cat with amber eyes',
  merlin: 'Merlin, a grey tabby cat with golden eyes',
  spark: 'Spark, a Siamese cat with bright blue eyes and dark face',
  milka: 'Milka, a fluffy long-haired calico cat (white, orange and black patches) with green eyes, sweet and slightly chubby',
  yoonari: 'Yoo Nari, a young Korean woman in her late 20s with long straight black hair, gentle face',
  baek: 'Sr. Baek, a Korean man in his 50s with short black hair, serious face, beige suit',
};
const FORMATOS = { vertical: '1080x1350', quadrado: '1080x1080', stories: '1080x1920' };
const TAM_CF = { vertical: [1024, 1280], quadrado: [1024, 1024], stories: [864, 1536] };
const ESTILO = 'cinematic K-drama still, warm moody lighting, shallow depth of field, photorealistic, high detail, no text, no letters, no watermark';

async function promptEmIngles(cena, p) {
  try {
    const { texto } = await perguntar([
      { role: 'system', content: 'You write image-generation prompts for memes of the K-drama series "Miados do Destino" (a family, rain, mystery and cats that seem to know too much). Turn the Brazilian Portuguese scene description into ONE vivid English prompt (max 70 words): subject, action/expression, setting, lighting, camera. Make facial expressions exaggerated enough to work as a meme. Never include any text, captions or letters in the image. Answer with the prompt only.' },
      { role: 'user', content: `Character: ${p ? PERSONAGENS[p] : 'none (scene only)'}\nScene: ${cena}` }
    ], { temperatura: 0.6 });
    return texto.replace(/^["'\s]+|["'\s]+$/g, '');
  } catch (e) { return `${p ? PERSONAGENS[p] + ', ' : ''}${cena}`; }
}

async function gerarCloudflare(prompt, p, formato) {
  const conta = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  const [w, h] = TAM_CF[formato] || TAM_CF.vertical, f = new FormData();
  f.append('prompt', (p ? 'Use the character from the reference image (keep the same face, colors and markings). ' : '') + `${prompt}. ${ESTILO}`);
  f.append('width', String(w)); f.append('height', String(h));
  if (p) {
    const ref = await fetch(`${CENTRAL}/ref/${p}.jpg`);
    if (ref.ok) f.append('input_image_0', new Blob([await ref.arrayBuffer()], { type: 'image/jpeg' }), 'ref.jpg');
  }
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: f });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) {
    const m = JSON.stringify(j.errors || j).slice(0, 200);
    throw new Error(/neuron|daily|limit/i.test(m) ? 'Acabou a cota grátis de imagens de hoje (volta às 21h).' : 'Cloudflare: ' + m);
  }
  return { img: 'data:image/jpeg;base64,' + j.result.image, modelo: 'FLUX.2 Klein (Cloudflare)' + (p ? ' com a foto do personagem' : '') };
}

async function gerarComChave(prompt, p, size) {
  const key = process.env.POLLINATIONS_KEY, H = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const pedido = p
    ? { url: BASE + '/v1/images/edits', modelo: 'black-forest-labs/flux.1-kontext-pro', corpo: { model: 'black-forest-labs/flux.1-kontext-pro', prompt: `Use the character from the reference image (keep the same face, fur colors and markings). ${prompt}. ${ESTILO}`, image: [{ image_url: `${CENTRAL}/ref/${p}.jpg` }], size, response_format: 'b64_json' } }
    : { url: BASE + '/v1/images/generations', modelo: 'black-forest-labs/flux.1.1-pro', corpo: { model: 'black-forest-labs/flux.1.1-pro', prompt: `${prompt}. ${ESTILO}`, size, response_format: 'b64_json' } };
  const r = await fetch(pedido.url, { method: 'POST', headers: H, body: JSON.stringify(pedido.corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Pollinations: ' + (j.error?.message || j.message || r.status));
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error('Pollinations não devolveu a imagem');
  return { img: 'data:image/png;base64,' + b64, modelo: pedido.modelo };
}

async function gerarPublico(prompt, size) {
  const [w, h] = size.split('x');
  const u = PUBLICO + encodeURIComponent(`${prompt}. ${ESTILO}`) + `?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
  const r = await fetch(u);
  if (r.status === 402 || r.status === 429) throw new Error('A cota grátis do modo público acabou por agora. Configure a chave grátis do Pollinations (POLLINATIONS_KEY) para gerar sem limite apertado e com a foto do personagem.');
  if (!r.ok) throw new Error('Gerador público fora do ar (' + r.status + '). Tente de novo em instantes.');
  const buf = Buffer.from(await r.arrayBuffer());
  return { img: 'data:' + (r.headers.get('content-type') || 'image/jpeg') + ';base64,' + buf.toString('base64'), modelo: 'público (sem chave)' };
}

module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('publicar') && !a.menus.includes('posts')) return res.status(403).json({ erro: 'Sem permissão' });
    const b = req.body || {};
    if (b.acao === 'status') return res.json({ chave: !!(process.env.CLOUDFLARE_API_TOKEN || process.env.POLLINATIONS_KEY), modelo: process.env.CLOUDFLARE_API_TOKEN ? 'FLUX.2 Klein (Cloudflare)' : process.env.POLLINATIONS_KEY ? 'Pollinations' : 'público' });
    const p = PERSONAGENS[b.personagem] ? b.personagem : '';
    if (b.acao === 'ideias') {
      const { texto } = await perguntar([
        { role: 'system', content: 'Você é social media de humor do perfil @miadosdodestino (dorama com gatos que sabem demais: a frajola Naru, a escaminha Zelda que sente o perigo, o rajado Merlin que traz objetos, o siamês Spark misterioso, a tricolor Milka, meiga, caseira, gulosa e grudada em quem ama; Yoo Nari, violinista doce; Sr. Baek, marido cheio de segredos que tranca o escritório). Crie 5 ideias de meme em imagem, engraçadas e compartilháveis, que conversem com o dia a dia de quem gosta de gato e de dorama. Responda SÓ com JSON: [{"formato":"ninguem|classico|comparacao|pov","cena":"descrição da imagem em português","topo":"texto de cima","baixo":"texto de baixo (pode ser vazio)"}]. Para "ninguem", topo é o que vem depois de "Ninguém:" (ex.: "A Naru às 3h da manhã:"). Para "comparacao", topo e baixo são os rótulos dos dois quadros.' },
        { role: 'user', content: 'Personagem principal: ' + (p ? PERSONAGENS[p] : 'qualquer um do elenco') }
      ], { temperatura: 0.95 });
      const m = texto.match(/\[[\s\S]*\]/);
      let ideias = []; try { ideias = JSON.parse(m ? m[0] : texto); } catch (e) {}
      ideias = (Array.isArray(ideias) ? ideias : []).filter(x => x && x.cena).slice(0, 5)
        .map(x => ({ formato: ['ninguem', 'classico', 'comparacao', 'pov'].includes(x.formato) ? x.formato : 'classico', cena: String(x.cena).slice(0, 300), topo: String(x.topo || '').slice(0, 120), baixo: String(x.baixo || '').slice(0, 120) }));
      if (!ideias.length) return res.status(502).json({ erro: 'A IA não mandou ideias desta vez. Tente de novo.' });
      return res.json({ ideias });
    }
    if (b.acao === 'gerar') {
      const cena = String(b.cena || '').trim().slice(0, 500);
      if (!cena) return res.status(400).json({ erro: 'Descreva a cena da imagem' });
      const size = FORMATOS[b.formato] || FORMATOS.vertical;
      const prompt = await promptEmIngles(cena, p);
      // tenta cada gerador em ordem e avisa quando precisou cair para um mais simples
      const tentativas = [];
      if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) tentativas.push(() => gerarCloudflare(prompt, p, b.formato));
      if (process.env.POLLINATIONS_KEY) tentativas.push(() => gerarComChave(prompt, p, size));
      tentativas.push(() => gerarPublico(`${p ? PERSONAGENS[p] + ', ' : ''}${prompt}`, size));
      let out, avisos = [];
      for (const t of tentativas) { try { out = await t(); break; } catch (e) { avisos.push(e.message); } }
      if (!out) throw new Error(avisos.join(' · '));
      if (avisos.length) out.aviso = avisos[0] + ' Usei um gerador mais simples.';
      return res.json({ ...out, prompt });
    }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
