const { auth } = require('../lib/db');
const { perguntar } = require('../lib/groq');
const SYS = `Você é analista de social media do projeto "Miados do Destino" (um dorama sobre gatos, amor e destino). Escreva em português do Brasil, em tom profissional e acolhedor, para a equipe e a gestão. Use SOMENTE os números do JSON recebido. Nunca invente métricas, causas ou fatos. Se faltar dado, diga que não há dados suficientes. Não use markdown (sem **, #, tabelas): use apenas texto simples e marcadores "•". Estrutura: 1) Resumo do período (2 a 3 frases). 2) O que funcionou (2 a 4 pontos, citando números e posts). 3) Pontos de atenção (2 a 3 pontos). 4) Recomendações para o próximo período (3 a 5 ações práticas). 5) Destaques da equipe (só se houver dados por pessoa; tom construtivo). Máximo 280 palavras.`;
const SYS_FB = `Você é gerente de social media do perfil "Miados do Destino" (um dorama sobre gatos, amor e destino). Escreva um feedback mensal em português do Brasil, com tom acolhedor, direto e motivador, para a pessoa (ou equipe) indicada. Use SOMENTE os números e fatos do JSON recebido (o campo "rascunho" já traz os números calculados). Nunca invente métricas, causas ou fatos. Não use markdown (sem **, #, tabelas): use texto simples, marcadores "•" e mantenha as seções com emojis do rascunho (📈, ✨, 🔎, 🎯). Seja específico, citando posts e números. Máximo 250 palavras.`;
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const fb = req.body && req.body.tipo === 'feedback';
    if (!a.menus.includes(fb ? 'feed' : 'relatorio')) return res.status(403).json({ erro: 'Sem permissão' });
    const d = req.body && req.body.dados, s = JSON.stringify(d || {});
    if (!d || s.length > 20000) return res.status(400).json({ erro: 'Dados inválidos ou grandes demais' });
    const msgs = [{ role: 'system', content: fb ? SYS_FB : SYS }, { role: 'user', content: 'Dados reais do período:\n' + s }];
    let texto, model;
    try { ({ texto, model } = await perguntar(msgs)); } catch (e) { return res.status(/GROQ_API_KEY/.test(e.message) ? 500 : 502).json({ erro: e.message }); }
    if (!texto) return res.status(502).json({ erro: 'A análise veio vazia (' + model + '). Tente de novo.' });
    res.json({ texto });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
