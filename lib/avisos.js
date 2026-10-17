// Avisos internos da equipe: push nos celulares marcados como equipe (Central › App › Aparelhos), nunca no público do app.
// Cada tipo liga/desliga em Configurações › Geral › Notificações da equipe (state.avisos; ligado por padrão).
const { dbGet, dbSet } = require('./db');
const { enviarPush } = require('./fcm');

const TIPOS = {
  testador_novo: '🤝 Testador novo (página /testar)',
  testadores_meta: '🎉 Bateu 14 testadores',
  teste_14_dias: '✅ 14 dias de teste fechado (já dá para pedir a produção)',
  kwai: '📲 Post do Kwai do dia pronto',
  post_ok: '✅ Post ou story automático publicado',
  post_erro: '⚠️ Falha num post ou story automático',
  seguidores: '🎉 A cada 50 seguidores no Instagram'
};
const META = 14, DIAS = 14 * 864e5;

async function avisar(tipo, titulo, texto) {
  const st = await dbGet('state') || {};
  if (st.avisos && st.avisos[tipo] === false) return 0;
  const ap = (await dbGet('push_aparelhos')) || [];
  let ok = 0;
  for (const a of ap.filter(x => x.equipe).slice(-10)) { try { await enviarPush({ titulo, texto, token: a.token }); ok++; } catch (e) {} }
  // navegadores inscritos na Central (Configurações › Notificações da equipe › Receber neste aparelho)
  ok += await require('./webpush').enviarWeb({ title: titulo, body: texto, tag: tipo, url: /^https:\/\//.test(texto) ? texto : '/' }).catch(() => 0);
  return ok;
}

/** Inscrição nova na página /testar: avisa o testador novo e, na primeira vez que chega a 14, a meta. */
async function testador(nome, total, novo) {
  if (novo) await avisar('testador_novo', '🤝 Testador novo', `${nome || 'Alguém'} entrou no teste do app (${total}/${META}).`).catch(() => {});
  if (total >= META && !(await dbGet('teste_meta'))) {
    await dbSet('teste_meta', { data: new Date().toISOString(), total });
    await avisar('testadores_meta', `🎉 ${META} testadores!`, 'A meta da Play Store foi batida. Agora contam 14 dias de teste fechado.').catch(() => {});
  }
}

/** Verificação diária: 14 dias depois de bater a meta. */
async function diario() {
  const m = await dbGet('teste_meta');
  if (!m || m.avisado14 || Date.now() - new Date(m.data).getTime() < DIAS) return null;
  await dbSet('teste_meta', { ...m, avisado14: new Date().toISOString() });
  return avisar('teste_14_dias', '✅ 14 dias de teste fechado', 'Já dá para pedir o acesso à produção na Play Console. Confira se os testadores continuam inscritos.');
}

/** Resultado de uma publicação automática (story do Sussurro, post do teste do app). */
const publicado = (oque, r) => r && r.link ? avisar('post_ok', '✅ ' + oque + ' publicado', r.link) : null;
const falhou = (oque, erro) => avisar('post_erro', '⚠️ Falhou: ' + oque, String(erro && erro.message || erro).slice(0, 160));

/** Seguidores do Instagram: avisa ao cruzar cada marca de 50 (a primeira leitura só guarda a marca atual). */
async function seguidores(n) {
  n = +n || 0; if (!n) return null;
  const marca = Math.floor(n / 50) * 50, ult = await dbGet('seguidores_marco');
  if (ult && marca <= ult.marca) return null;
  await dbSet('seguidores_marco', { marca, quando: new Date().toISOString() });
  if (!ult) return null;
  return avisar('seguidores', `🎉 ${marca.toLocaleString('pt-BR')} seguidores!`, `O @miadosdodestino passou de ${marca.toLocaleString('pt-BR')} seguidores (agora ${n.toLocaleString('pt-BR')}).`);
}

module.exports = { TIPOS, avisar, testador, diario, publicado, falhou, seguidores };
