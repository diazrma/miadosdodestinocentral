// Bigode, o bot do WhatsApp: os avisos da Central também chegam nos grupos escolhidos do zap.
// Número no privado só recebe o botão de teste (state.zap.teste).
// A Evolution API roda num computador sempre ligado (pasta zap/), que busca a fila aqui a cada minuto;
// a Vercel não fala direto com ele. Cada tipo liga/desliga em Configurações › Geral › Bigode no WhatsApp
// (state.zap; desligado por padrão, ao contrário das notificações).
const { rd, PFX, dbGet } = require('./db');
const TIPOS = { ...require('./avisos').TIPOS, gazeta: '📰 Gazeta do dia (edição nova às 8h)' };
const NOME = 'Bigode', FILA = PFX + 'zap:fila', MAX = 50, TENTATIVAS = 3;

const grupo = g => /^[\d-]{5,40}@g\.us$/.test(String(g && g.id || '')) ? { id: g.id, nome: String(g.nome || 'Grupo').slice(0, 100) } : null;
// número com DDD vira 55DDDNNNNNNNN
function numero(v) {
  let n = String(v || '').replace(/\D/g, '');
  if (n.length === 10 || n.length === 11) n = '55' + n;
  return n.length >= 12 && n.length <= 15 ? n : '';
}
const limpa = z => ({
  ativo: !!z.ativo, nome: String(z.nome || '').trim().slice(0, 25) || NOME, teste: numero(z.teste),
  grupos: (Array.isArray(z.grupos) ? z.grupos : []).map(grupo).filter(Boolean).filter((d, i, a) => a.findIndex(x => x.id === d.id) === i).slice(0, 10),
  tipos: Object.fromEntries(Object.keys(TIPOS).map(t => [t, !!(z.tipos || {})[t]]))
});
const cfg = async () => limpa((await dbGet('state') || {}).zap || {});
// *negrito* é o do WhatsApp; o nome assina a mensagem (o perfil do chip pode ser pessoal)
const texto = (nome, titulo, corpo) => String(nome || NOME).trim() + ': *' + String(titulo || '').trim() + '*' + (corpo ? '\n' + String(corpo).trim() : '');

// teste: vai só para o número de teste (ou para os grupos, se não houver número), mesmo com o bot desligado
async function enfileirar(tipo, titulo, corpo, { teste } = {}) {
  vaziaAte = 0;
  const z = await cfg(), para = teste ? (z.teste ? [z.teste] : z.grupos.map(g => g.id)) : z.ativo && z.tipos[tipo] ? z.grupos.map(g => g.id) : [];
  if (!para.length) return 0;
  await rd(['RPUSH', FILA, JSON.stringify({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), tipo, para, texto: texto(z.nome, titulo, corpo).slice(0, 4000), n: 0 })]);
  await rd(['LTRIM', FILA, -MAX, -1]);  // com o computador desligado a fila não cresce sem fim: ficam as 50 mais novas
  return 1;
}
// o computador leva até 10 por vez (um comando só no Redis, a cada minuto)
// o bridge consulta a cada minuto; com a fila vazia, a resposta fica na memória por até 10 min para o banco poder dormir
// (o Neon grátis tem horas de processamento contadas). Mensagem nova nesta mesma instância libera na hora.
const ESPERA_VAZIA = 10 * 60e3;
let vaziaAte = 0;
const puxar = async () => {
  if (Date.now() < vaziaAte) return [];
  const msgs = ((await rd(['LPOP', FILA, 10])) || []).map(m => JSON.parse(m));
  vaziaAte = msgs.length ? 0 : Date.now() + ESPERA_VAZIA;
  return msgs;
};
// o que não saiu volta para o começo da fila (só para quem faltou), até 3 tentativas
async function devolver(msgs) {
  vaziaAte = 0;
  const volta = (Array.isArray(msgs) ? msgs : []).filter(m => m && m.id && Array.isArray(m.para) && m.para.length && m.texto && (m.n || 0) + 1 < TENTATIVAS)
    .slice(0, 10).map(m => JSON.stringify({ id: String(m.id).slice(0, 20), t: +m.t || Date.now(), tipo: String(m.tipo || '').slice(0, 30), para: m.para.map(String).slice(0, 10), texto: String(m.texto).slice(0, 4000), n: (m.n || 0) + 1 }));
  if (volta.length) await rd(['LPUSH', FILA, ...volta.reverse()]);
  return volta.length;
}
const fila = async () => +(await rd(['LLEN', FILA])) || 0;

module.exports = { TIPOS, NOME, cfg, limpa, numero, texto, enfileirar, puxar, devolver, fila };
