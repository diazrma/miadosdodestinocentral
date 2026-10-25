// Gazeta do Destino diária.
// GET  /api/gazeta                     -> agendado (Vercel Cron, 8h de Brasília): edição nova na capa do app, guardada no arquivo, e notificação para todos
// POST /api/gazeta { acao: 'gerar' }    -> equipe (menu App): gera de novo a edição de hoje (a anterior continua no arquivo)
//      { acao: 'notificar' }            -> envia agora a notificação da edição que está na capa
//      { acao: 'arquivo' }              -> lista das edições guardadas
//      { acao: 'ver', id }              -> uma edição do arquivo inteira
//      { acao: 'restaurar', id }        -> põe uma edição do arquivo de volta na capa
// Desliga no painel: recursos.gazetaAuto (edição diária), gazetaIA (escrever com IA), gazetaAviso (notificar).
const { auth, dbGet, dbSet } = require('../lib/db');
const { enviarPush } = require('../lib/fcm');
const G = require('../lib/gazeta');

async function gerar(por) {
  const conteudo = await dbGet('app_conteudo') || {};
  // primeira vez: a edição que estava na capa antes da automação também vai para o arquivo
  if (conteudo.gazeta?.manchete && !(await G.edicoes()).length) await G.arquivar({ ...conteudo.gazeta, data: conteudo.gazeta.data || String(conteudo.atualizado || '').slice(0, 10) || G.hojeBR() }, { origem: 'painel', por: conteudo.por || '' });
  const { ultimoPost } = require('./conteudo');
  const posts = await ultimoPost().catch(() => null) || [];
  const loja = await require('../lib/umapenca').vitrinePublica().catch(() => null);
  const g = await G.montar({ conteudo, posts, loja, numero: await G.proximoNumero(conteudo.gazeta) });
  await G.arquivar(g, { origem: g.origem, por });
  const { data, numero, origem, modelo, ...capa } = g;
  // relê antes de gravar para não desfazer o que a equipe salvou enquanto a IA escrevia
  const atual = await dbGet('app_conteudo') || {};
  await dbSet('app_conteudo', { ...atual, gazeta: { ...capa, data, numero }, atualizado: new Date().toISOString() });
  await dbSet('gazeta_dia', { data, numero, origem, modelo, titulo: capa.manchete.titulo, notificado: false });
  return g;
}

async function notificar(g, por) {
  const titulo = '📰 Gazeta do Destino · ' + G.dataLonga(g.data || G.hojeBR());
  const texto = String(g.manchete.titulo).slice(0, 180);
  const id = await enviarPush({ titulo, texto, topico: 'gazeta', dados: { tela: 'gazeta' } });
  const dia = await dbGet('gazeta_dia') || {};
  await dbSet('gazeta_dia', { ...dia, notificado: true });
  const log = (await dbGet('push_log') || []).slice(-49);
  log.push({ quando: new Date().toISOString(), por, titulo, texto, destino: 'Todos (Gazeta do dia, automático)', id });
  await dbSet('push_log', log);
  return id;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const seg = process.env.CRON_SECRET;
      if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado' });
      const rec = (await dbGet('app_conteudo') || {}).recursos || {};
      if (rec.gazetaAuto === false) return res.json({ ok: 1, pulou: 'Gazeta diária desligada no painel' });
      const dia = await dbGet('gazeta_dia');
      const hoje = dia && dia.data === G.hojeBR();
      const g = hoje ? (await dbGet('app_conteudo')).gazeta : await gerar('Agendamento');
      let aviso = null;
      if (rec.gazetaAviso !== false && !(hoje && dia.notificado)) aviso = await notificar(g, 'Agendamento').catch(e => 'erro: ' + e.message);
      return res.json({ ok: 1, novo: !hoje, edicao: g.edicao, titulo: g.manchete.titulo, origem: hoje ? dia.origem : g.origem, aviso });
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('app')) return res.status(403).json({ erro: 'Sem permissão para o menu App' });
    const b = req.body || {};
    if (b.acao === 'gerar') { const g = await gerar(a.u.nome); return res.json({ gazeta: g, dia: await dbGet('gazeta_dia') }); }
    if (b.acao === 'notificar') {
      const g = (await dbGet('app_conteudo') || {}).gazeta;
      if (!g || !g.manchete) return res.status(400).json({ erro: 'Não há edição na capa.' });
      return res.json({ id: await notificar(g, a.u.nome) });
    }
    if (b.acao === 'arquivo') return res.json({ dia: await dbGet('gazeta_dia'), lista: (await G.edicoes()).slice().reverse() });
    if (b.acao === 'ver') { const ed = await G.edicao(b.id); return ed ? res.json({ edicao: ed }) : res.status(404).json({ erro: 'Edição não encontrada' }); }
    if (b.acao === 'restaurar') {
      const ed = await G.edicao(b.id);
      if (!ed) return res.status(404).json({ erro: 'Edição não encontrada' });
      const atual = await dbGet('app_conteudo') || {};
      await dbSet('app_conteudo', { ...atual, gazeta: { edicao: ed.edicao, manchete: ed.manchete, materias: ed.materias, data: ed.data, numero: ed.numero }, atualizado: new Date().toISOString() });
      return res.json({ ok: 1 });
    }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
