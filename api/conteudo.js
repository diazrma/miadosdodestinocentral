// Conteúdo do app Miados do Destino.
// GET  /api/conteudo          -> público (o app lê daqui): Gazeta, temporada, enigma e post do dia
// POST /api/conteudo          -> equipe com acesso ao menu "app":
//      { acao: 'salvar', conteudo }                 salva o conteúdo editado no painel
//      { acao: 'push', titulo, texto, topico }      envia para um tópico (todos = 'gazeta', lembrete = 'ep-N')
//      { acao: 'push', titulo, texto, aparelho }    envia só para um aparelho (teste)
//      { acao: 'aparelhos' } / { acao: 'historico' } listas para o painel
// POST /api/conteudo { acao: 'registrar', token, nome } -> público: o app registra o aparelho para testes
const crypto = require('crypto');
const { auth, dbGet, dbSet } = require('../lib/db');

const SITE = 'https://miados-do-destino.vercel.app';
const PADRAO = {
  gazeta: {
    edicao: 'Edição nº 01',
    manchete: {
      kicker: 'Estreia',
      titulo: '“Miados do Destino” abre as portas e apresenta seus personagens',
      linha: 'O dorama feito com inteligência artificial ganha site oficial, com sinopse, elenco e vídeos de apresentação.',
      texto: 'Uma noiva, um marido cheio de segredos e uma gata frajola que parece saber demais. Esse é o ponto de partida de Miados do Destino.\n\nCada personagem ganhou um vídeo de apresentação próprio, na seção Elenco.',
      img: SITE + '/video/noiva-pb-poster.jpg',
      legenda: 'Yoo Nari, a protagonista, em cena da série.'
    },
    materias: [
      { kicker: 'Enigma', titulo: 'O desenho de Haneul guarda um segredo', texto: 'Uma casa, três pessoas e cinco gatos. Quatro estão pintados. O quinto ainda não.', link: '', linkTxt: '' },
      { kicker: 'Produção', titulo: 'Temporada 1 segue em produção', texto: 'Os capítulos estão sendo preparados. Ative o lembrete para saber primeiro.', link: '', linkTxt: '' },
      { kicker: 'Bastidores', titulo: 'Um projeto paralelo que começou em julho', texto: 'A série nasceu de Rodrigo Cardoso, na direção, e Ana Paula Guedes, criadora de conteúdo do Instagram Miados do Destino.', link: '', linkTxt: '' },
      { kicker: 'Elenco felino', titulo: 'Naru, Zelda, Merlin, Spark e Milka roubam a cena', texto: 'Cinco gatos dividem os holofotes com Yoo Nari e Sr. Baek.', link: 'https://www.instagram.com/miadosdodestino/', linkTxt: 'Seguir no Instagram' }
    ]
  },
  temporada: [
    { n: 1, titulo: 'A Casa na Chuva', sinopse: 'Uma mesa posta para um e uma gata na cadeira dela.', status: 'producao' },
    { n: 2, titulo: 'A Promessa', sinopse: 'Um desenho de cinco gatos e uma fotografia antiga.', status: 'producao' },
    { n: 3, titulo: 'Cinco Gatos', sinopse: 'Os gatos que faltavam começam a aparecer.', status: 'producao' },
    { n: 4, titulo: 'O Inverno Depois', sinopse: 'Um diário azul e um guarda-chuva dividido.', status: 'producao' },
    { n: 5, titulo: 'Olhos Conhecidos', sinopse: 'Uma gata que faz coisas que só ela fazia.', status: 'producao' }
  ],
  enigma: { revelado: false },
  postDoDia: { fixo: '' } // vazio = usa o post mais recente do Instagram
};

// ---------- Instagram: post mais recente (cache de 3 horas)
async function ultimoPost() {
  const c = await dbGet('postdia_cache').catch(() => null);
  if (c && Date.now() - c.t < 3 * 3600e3) return c.d;
  if (!process.env.IG_TOKEN) return c ? c.d : null;
  try {
    const u = new URL('https://graph.instagram.com/me/media');
    u.searchParams.set('fields', 'id,caption,media_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count');
    u.searchParams.set('limit', '6');
    u.searchParams.set('access_token', process.env.IG_TOKEN);
    const j = await (await fetch(u)).json();
    if (j.error) throw new Error(j.error.message);
    const d = (j.data || []).map(m => ({
      id: m.id, data: m.timestamp, legenda: m.caption || '', link: m.permalink,
      img: m.media_type === 'VIDEO' ? (m.thumbnail_url || '') : (m.media_url || m.thumbnail_url || ''),
      curtidas: m.like_count || 0, comentarios: m.comments_count || 0
    }));
    await dbSet('postdia_cache', { t: Date.now(), d }).catch(() => {});
    return d;
  } catch (e) { return c ? c.d : null; }
}

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

async function enviarPush({ titulo, texto, topico, token }) {
  if (!process.env.FCM_SERVICE_ACCOUNT) throw new Error('FCM_SERVICE_ACCOUNT não configurado na Vercel');
  const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
  const tk = await tokenGoogle(sa);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { ...(token ? { token } : { topic: topico }), notification: { title: titulo, body: texto }, android: { priority: 'high', notification: { channel_id: 'gazeta' } } } })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Falha ao enviar (' + r.status + ')');
  return j.name;
}

const TOPICOS = /^(gazeta|ep-\d{1,2})$/;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const salvo = await dbGet('app_conteudo') || {};
    const conteudo = { ...PADRAO, ...salvo };

    if (req.method === 'GET') {
      const posts = await ultimoPost();
      const fixo = conteudo.postDoDia?.fixo;
      const post = posts && (posts.find(p => p.id === fixo) || posts[0]) || null;
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      return res.json({ ...conteudo, postDoDia: { ...conteudo.postDoDia, post, recentes: (posts || []).slice(0, 6) }, atualizado: salvo.atualizado || null });
    }

    const b = req.body || {};
    // o app registra o aparelho (público): token do Firebase + apelido para escolher no painel
    if (b.acao === 'registrar') {
      const token = String(b.token || ''), nome = String(b.nome || '').trim().slice(0, 40) || 'Aparelho sem nome';
      if (token.length < 100 || token.length > 400) return res.status(400).json({ erro: 'Token inválido' });
      const ap = (await dbGet('push_aparelhos') || []).filter(x => x.token !== token);
      ap.push({ token, nome, modelo: String(b.modelo || '').slice(0, 60), visto: new Date().toISOString() });
      await dbSet('push_aparelhos', ap.slice(-500));
      return res.json({ ok: 1 });
    }

    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('app')) return res.status(403).json({ erro: 'Sem permissão para o menu App' });

    if (b.acao === 'salvar') {
      const c = b.conteudo || {};
      const limpo = {
        gazeta: c.gazeta || PADRAO.gazeta,
        temporada: (c.temporada || []).filter(e => e && e.titulo).map((e, i) => ({ n: +e.n || i + 1, titulo: String(e.titulo).slice(0, 80), sinopse: String(e.sinopse || '').slice(0, 200), status: ['producao', 'breve', 'lancado'].includes(e.status) ? e.status : 'producao', data: e.data || '', link: e.link || '' })),
        enigma: { revelado: !!c.enigma?.revelado },
        postDoDia: { fixo: String(c.postDoDia?.fixo || '') },
        atualizado: new Date().toISOString(), por: a.u.nome
      };
      if (JSON.stringify(limpo).length > 200000) return res.status(400).json({ erro: 'Conteúdo grande demais' });
      await dbSet('app_conteudo', limpo);
      return res.json({ ok: 1, atualizado: limpo.atualizado });
    }

    if (b.acao === 'push') {
      const titulo = String(b.titulo || '').trim().slice(0, 65), texto = String(b.texto || '').trim().slice(0, 180);
      if (!titulo || !texto) return res.status(400).json({ erro: 'Preencha título e texto da notificação' });
      let destino, envio;
      if (b.aparelho) {
        const ap = (await dbGet('push_aparelhos') || []).find(x => x.token === b.aparelho);
        if (!ap) return res.status(404).json({ erro: 'Aparelho não encontrado. Abra o app nele para registrar de novo.' });
        envio = { titulo, texto, token: ap.token }; destino = 'Teste: ' + ap.nome;
      } else {
        const topico = String(b.topico || 'gazeta');
        if (!TOPICOS.test(topico)) return res.status(400).json({ erro: 'Destino inválido' });
        envio = { titulo, texto, topico }; destino = topico === 'gazeta' ? 'Todos' : 'Lembrete do episódio ' + topico.slice(3);
      }
      const id = await enviarPush(envio);
      const log = (await dbGet('push_log') || []).slice(-49);
      log.push({ quando: new Date().toISOString(), por: a.u.nome, titulo, texto, destino, id });
      await dbSet('push_log', log);
      return res.json({ ok: 1, id });
    }

    if (b.acao === 'aparelhos') return res.json({ aparelhos: (await dbGet('push_aparelhos') || []).map(({ token, nome, modelo, visto }) => ({ token, nome, modelo, visto })).reverse() });
    if (b.acao === 'remover_aparelho') { await dbSet('push_aparelhos', (await dbGet('push_aparelhos') || []).filter(x => x.token !== b.aparelho)); return res.json({ ok: 1 }); }
    if (b.acao === 'historico') return res.json({ log: (await dbGet('push_log') || []).slice().reverse() });

    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
