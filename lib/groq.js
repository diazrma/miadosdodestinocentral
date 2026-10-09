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
async function chamar(key, model, msgs, opcoes = {}) {
  const body = { model, temperature: opcoes.temperatura ?? 0.3, max_completion_tokens: 2000, messages: msgs };
  if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
  const r = await fetch(G + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
  return { r, j: await r.json() };
}
// conversa simples: devolve o texto (sem o raciocínio <think>) e o modelo usado
async function perguntar(msgs, opcoes = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY não configurada na Vercel');
  const fixo = process.env.GROQ_MODEL;
  let model = fixo || MODELO || (MODELO = await escolher(key));
  if (!model) throw new Error('Nenhum modelo de texto disponível na sua conta Groq');
  let { r, j } = await chamar(key, model, msgs, opcoes);
  if (!r.ok && !fixo && /model|exist|access/i.test((j.error && j.error.message) || '')) {
    MODELO = null; model = MODELO = await escolher(key);
    if (!model) throw new Error('Nenhum modelo de texto disponível na sua conta Groq');
    ({ r, j } = await chamar(key, model, msgs, opcoes));
  }
  if (!r.ok) throw new Error('Groq (' + model + '): ' + ((j.error && j.error.message) || r.status));
  return { texto: String((j.choices && j.choices[0] && j.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), model };
}

module.exports = { perguntar };
