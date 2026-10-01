const { auth } = require('../lib/db');
const SYS = `Você é analista de social media do projeto "Miados do Destino" (um dorama sobre gatos, amor e destino). Escreva em português do Brasil, em tom profissional e acolhedor, para a equipe e a gestão. Use SOMENTE os números do JSON recebido. Nunca invente métricas, causas ou fatos. Se faltar dado, diga que não há dados suficientes. Não use markdown (sem **, #, tabelas): use apenas texto simples e marcadores "•". Estrutura: 1) Resumo do período (2 a 3 frases). 2) O que funcionou (2 a 4 pontos, citando números e posts). 3) Pontos de atenção (2 a 3 pontos). 4) Recomendações para o próximo período (3 a 5 ações práticas). 5) Destaques da equipe (só se houver dados por pessoa; tom construtivo). Máximo 280 palavras.`;
const G = 'https://api.groq.com/openai/v1';
const PREF = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'qwen/qwen3.8-27b'];
let MODELO = null;
async function escolher(key) {
  const r = await fetch(G + '/models', { headers: { Authorization: 'Bearer ' + key } });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
  const ids = (j.data || []).map(m => m.id);
  return PREF.find(p => ids.includes(p)) || ids.find(i => !/whisper|tts|guard|safeguard|orpheus|compound|embed/i.test(i)) || null;
}
async function chamar(key, model, msgs) {
  const body = { model, temperature: 0.3, max_completion_tokens: 2000, messages: msgs };
  if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
  const r = await fetch(G + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
  return { r, j: await r.json() };
}
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('relatorio')) return res.status(403).json({ erro: 'Sem permissão' });
    const key = process.env.GROQ_API_KEY;
    if (!key) return res.status(500).json({ erro: 'GROQ_API_KEY não configurada na Vercel' });
    const d = req.body && req.body.dados, s = JSON.stringify(d || {});
    if (!d || s.length > 20000) return res.status(400).json({ erro: 'Dados inválidos ou grandes demais' });
    const msgs = [{ role: 'system', content: SYS }, { role: 'user', content: 'Dados reais do período:\n' + s }];
    const fixo = process.env.GROQ_MODEL;
    let model = fixo || MODELO || (MODELO = await escolher(key));
    if (!model) return res.status(502).json({ erro: 'Nenhum modelo de texto disponível na sua conta Groq' });
    let { r, j } = await chamar(key, model, msgs);
    if (!r.ok && !fixo && /model|exist|access/i.test((j.error && j.error.message) || '')) {
      MODELO = null; model = MODELO = await escolher(key);
      if (!model) return res.status(502).json({ erro: 'Nenhum modelo de texto disponível na sua conta Groq' });
      ({ r, j } = await chamar(key, model, msgs));
    }
    if (!r.ok) return res.status(502).json({ erro: 'Groq (' + model + '): ' + ((j.error && j.error.message) || r.status) });
    const texto = String((j.choices && j.choices[0] && j.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!texto) return res.status(502).json({ erro: 'A IA não devolveu texto (' + model + '). Tente de novo.' });
    res.json({ texto });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
