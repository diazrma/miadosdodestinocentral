// Bigode no WhatsApp (lib/zap.js).
// Computador da Evolution (cabeçalho x-zap-key = ZAP_KEY):
//   GET  /api/zap                                  -> até 10 mensagens da fila (saem da fila ao ler)
//   POST /api/zap { acao: 'status', estado, numero, grupos } -> conexão e grupos em que o número está; responde o nome do bot
//        { acao: 'devolver', msgs }                -> o que não conseguiu mandar volta para a fila
// Central (administrador): { acao: 'ver' } | { acao: 'salvar', zap } | { acao: 'teste' }
const { timingSafeEqual } = require('crypto');
const { auth, dbGet, dbSet } = require('../lib/db');
const Z = require('../lib/zap');
const igual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const S = (v, n) => String(v ?? '').slice(0, n);

module.exports = async (req, res) => {
  try {
    const b = req.body || {}, chave = process.env.ZAP_KEY || '';
    if (req.headers['x-zap-key'] !== undefined) {
      if (!chave || !igual(req.headers['x-zap-key'], chave)) return res.status(401).json({ erro: 'Chave inválida' });
      if (req.method === 'GET') return res.json({ msgs: await Z.puxar() });
      if (b.acao === 'status') {
        const grupos = (Array.isArray(b.grupos) ? b.grupos : []).filter(g => /@g\.us$/.test(g?.id || '')).slice(0, 100).map(g => ({ id: S(g.id, 40), nome: S(g.nome, 100) }));
        await dbSet('zap:status', { estado: S(b.estado, 20), numero: S(b.numero, 20).replace(/\D/g, ''), grupos, visto: Date.now() });
        return res.json({ nome: (await Z.cfg()).nome });
      }
      if (b.acao === 'devolver') return res.json({ voltaram: await Z.devolver(b.msgs) });
      return res.status(400).json({ erro: 'Ação desconhecida' });
    }
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.role?.admin) return res.status(403).json({ erro: 'Só administradores mexem no Bigode' });
    if (b.acao === 'ver') return res.json({ zap: await Z.cfg(), tipos: Z.TIPOS, status: await dbGet('zap:status'), fila: await Z.fila(), chave: !!chave });
    if (b.acao === 'salvar') {
      const st = await dbGet('state') || {};
      st.zap = Z.limpa(b.zap || {}); await dbSet('state', st);
      return res.json({ zap: st.zap });
    }
    if (b.acao === 'teste') {
      const n = await Z.enfileirar('teste', '🐾 Teste da Central', `Teste mandado por ${a.u.nome.split(' ')[0]} pela Central. Se chegou aqui, os avisos vão chegar também.`, { teste: true });
      return n ? res.json({ ok: 1, fila: await Z.fila() }) : res.status(400).json({ erro: 'Coloque o número de teste ou escolha um grupo antes de testar' });
    }
    return res.status(400).json({ erro: 'Ação desconhecida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
