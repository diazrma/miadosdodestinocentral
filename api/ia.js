const { auth } = require('../lib/db');
const SYS = `Você é analista de social media do projeto "Miados do Destino" (um dorama sobre gatos, amor e destino). Escreva em português do Brasil, em tom profissional e acolhedor, para a equipe e a gestão. Use SOMENTE os números do JSON recebido. Nunca invente métricas, causas ou fatos. Se faltar dado, diga que não há dados suficientes. Não use markdown (sem **, #, tabelas): use apenas texto simples e marcadores "•". Estrutura: 1) Resumo do período (2 a 3 frases). 2) O que funcionou (2 a 4 pontos, citando números e posts). 3) Pontos de atenção (2 a 3 pontos). 4) Recomendações para o próximo período (3 a 5 ações práticas). 5) Destaques da equipe (só se houver dados por pessoa; tom construtivo). Máximo 280 palavras.`;
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('relatorio')) return res.status(403).json({ erro: 'Sem permissão' });
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ erro: 'GROQ_API_KEY não configurada na Vercel' });
    const d = req.body && req.body.dados, s = JSON.stringify(d || {});
    if (!d || s.length > 20000) return res.status(400).json({ erro: 'Dados inválidos ou grandes demais' });
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', temperature: 0.3, max_tokens: 900, messages: [{ role: 'system', content: SYS }, { role: 'user', content: 'Dados reais do período:\n' + s }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ erro: 'Groq: ' + (j.error?.message || r.status) });
    res.json({ texto: (j.choices?.[0]?.message?.content || '').trim() });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
