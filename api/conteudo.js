// Conteúdo do app Miados do Destino.
// GET  /api/conteudo          -> público (o app lê daqui): Gazeta, temporada, enigma e post do dia
// POST /api/conteudo          -> equipe com acesso ao menu "app":
//      { acao: 'salvar', conteudo }                 salva o conteúdo editado no painel
//      { acao: 'push', titulo, texto, topico }      envia para um tópico (todos = 'gazeta', lembrete = 'ep-N', vídeo da Milka = 'milka')
//      { acao: 'push', titulo, texto, aparelho }    envia só para um aparelho (teste)
//      { acao: 'aparelhos' } / { acao: 'historico' } listas para o painel
// POST /api/conteudo { acao: 'registrar', token, nome } -> público: o app registra o aparelho para testes
const { auth, dbGet, dbSet } = require('../lib/db');
const { enviarPush } = require('../lib/fcm');

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
      { kicker: 'Elenco felino', titulo: 'Naru, Zelda, Merlin e Spark roubam a cena', texto: 'Quatro gatos dividem os holofotes com Yoo Nari e Sr. Baek. E o desenho de Haneul diz que falta um.', link: 'https://www.instagram.com/miadosdodestino/', linkTxt: 'Seguir no Instagram' }
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
  postDoDia: { fixo: '' }, // vazio = usa o post mais recente do Instagram
  // vídeos do YouTube na Gazeta ("Na tela") e no topo do site: trailer, teasers
  videos: [
    { tipo: 'Trailer', titulo: 'Trailer oficial', yt: 'uYPZM0cPVrI', legenda: 'A noiva, a chuva e os gatos que parecem saber demais.' },
    { tipo: 'Teaser', titulo: 'O primeiro vislumbre', yt: '_fp2-Pvxm-Q', legenda: 'Os primeiros segundos de Miados do Destino.' }
  ],
  // vídeo de apresentação de cada personagem (app e site); vazio = "em breve"
  elenco: { yoonari: { video: 'y41wpQ1wWwc' }, baek: { video: '3hAGMUp8Tns' }, naru: { video: 'dNYaDa8nmfU' }, spark: { video: 'fHOSMOLgbvQ' }, zelda: { video: 'xSp4gPlOcLY' }, merlin: { video: 'p5K0jrwZx-4' }, milka: { video: '' } },
  papeis: [],     // papéis de parede extras enviados pela Central (os do app já vêm dentro dele)
  sussurros: [],  // frases do Sussurro do dia; vazio = as frases que vêm no app
  recursos: { sussurro: true, quiz: true, papeis: true, sussurroIA: true, sussurroAviso: true },
  // créditos: as fotos vêm do cadastro da Equipe (pessoa ligada pelo id ou pelo primeiro nome)
  creditos: {
    pessoas: [
      { busca: 'rodrigo', nome: 'Rodrigo Cardoso', cargo: 'Direção', texto: 'Criou Miados do Destino, escreveu a história de Yoo Nari, do Sr. Baek e dos cinco gatos, e dirige cada cena, da chuva na primeira noite ao último miado.' },
      { busca: 'ana', nome: 'Ana Paula Guedes', cargo: 'Criadora de conteúdo do Instagram', arroba: '@miadosdodestino', texto: 'Obrigado, Ana, por dar voz à série todos os dias. Cada post, cada story e cada resposta fizeram o Instagram virar a casa dos fãs antes mesmo da estreia. Sem você, os gatos ainda estariam miando sozinhos.' }
    ],
    carta: '', agradecimentos: ''
  },
  site: { apk: '' } // link para baixar o app (botão no site)
};
const ELENCO_IDS = ['yoonari', 'baek', 'naru', 'spark', 'zelda', 'merlin', 'milka'];
const GATOS = ['naru', 'merlin', 'zelda', 'spark', 'milka'];
const ytId = v => { const t = String(v || '').trim(), m = t.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/); return m ? m[1] : (/^[\w-]{11}$/.test(t) ? t : ''); };
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const txt = (v, n) => String(v ?? '').slice(0, n);
const https = v => /^https:\/\//.test(String(v || '')) ? String(v).slice(0, 500) : '';
// troca a referência da pessoa pela foto do cadastro da Equipe (só nome, cargo, texto e foto vão para o público)
async function creditosPublicos(cr) {
  const us = await dbGet('users').catch(() => null) || [];
  const acha = p => us.find(u => p.usuario && u.id === p.usuario) || (p.busca && us.find(u => String(u.nome || '').toLowerCase().split(' ')[0] === p.busca));
  return { ...cr, pessoas: (cr.pessoas || []).map(p => { const u = acha(p); return { ...p, foto: p.fotoPropria || (u && u.foto) || '' }; }) };
}

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

const TOPICOS = /^(gazeta|milka|sussurro|ep-\d{1,2})$/;

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
      const creditos = await creditosPublicos(conteudo.creditos || PADRAO.creditos);
      const sh = await dbGet('sussurro_dia').catch(() => null);
      const sussurroHoje = sh && sh.data === hojeBR() && (sh.gato !== 'milka' || conteudo.enigma?.revelado) ? { data: sh.data, gato: sh.gato, texto: sh.texto } : null;
      return res.json({ ...conteudo, creditos, sussurroHoje, postDoDia: { ...conteudo.postDoDia, post, recentes: (posts || []).slice(0, 6) }, atualizado: salvo.atualizado || null });
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
        videos: (Array.isArray(c.videos) ? c.videos : PADRAO.videos).map(v => ({ tipo: txt(v.tipo, 20), titulo: txt(v.titulo, 80), yt: ytId(v.yt), legenda: txt(v.legenda, 160) })).filter(v => v.yt && v.titulo).slice(0, 12),
        elenco: Object.fromEntries(ELENCO_IDS.map(id => [id, { video: ytId(c.elenco?.[id]?.video), foto: https(c.elenco?.[id]?.foto) }])),
        papeis: (Array.isArray(c.papeis) ? c.papeis : []).map(p => ({ id: txt(p.id, 40).replace(/[^\w-]/g, ''), titulo: txt(p.titulo, 40), tipo: ['bloqueio', 'inicio', 'ambos'].includes(p.tipo) ? p.tipo : 'bloqueio', img: https(p.img), mini: https(p.mini) })).filter(p => p.id && p.titulo && p.img).slice(0, 40),
        sussurros: (Array.isArray(c.sussurros) ? c.sussurros : []).map(x => ({ gato: GATOS.includes(x.gato) ? x.gato : 'naru', texto: txt(x.texto, 160).trim() })).filter(x => x.texto).slice(0, 366),
        recursos: { sussurro: c.recursos?.sussurro !== false, quiz: c.recursos?.quiz !== false, papeis: c.recursos?.papeis !== false, sussurroIA: c.recursos?.sussurroIA !== false, sussurroAviso: c.recursos?.sussurroAviso !== false },
        creditos: { pessoas: (c.creditos?.pessoas || PADRAO.creditos.pessoas).slice(0, 8).map(p => ({ usuario: txt(p.usuario, 60), busca: txt(p.busca, 30), fotoPropria: https(p.fotoPropria), nome: txt(p.nome, 60), cargo: txt(p.cargo, 60), arroba: txt(p.arroba, 40), texto: txt(p.texto, 500) })).filter(p => p.nome),
          carta: txt(c.creditos?.carta, 2000), agradecimentos: txt(c.creditos?.agradecimentos, 600) },
        site: { apk: https(c.site?.apk) },
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
        envio = { titulo, texto, topico }; destino = topico === 'gazeta' ? 'Todos' : topico === 'milka' ? 'Quem pediu aviso do vídeo da Milka' : topico === 'sussurro' ? 'Quem recebe o Sussurro do dia' : 'Lembrete do episódio ' + topico.slice(3);
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
