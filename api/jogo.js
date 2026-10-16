// Público: ranking do jogo "As Noites da Naru" do site da série (o site chama /api/jogo, repassado para cá).
// GET                                  -> { top: [{ nome, pontos }] } (10 melhores)
// POST { acao: 'inicio' }              -> { token } ficha assinada da partida (hora de início + id)
// POST { acao: 'pontos', token, nome, pontos, fases } -> { ok, posicao, top }
// Contra pontuação falsa: ficha assinada e de uso único, tempo mínimo por fase, teto de pontos por fase e limite por IP.
const crypto = require('crypto');
const { rd, PFX, mac } = require('../lib/db');
// precisa bater com o jogo do site (src/game): 20 gizes por fase, 10 pontos cada, bônus de tempo até 300 por fase
const REGRAS = { fases: 3, gizesPorFase: 20, ptsGiz: 10, bonusFase: 300, minMsPorFase: 8000, porHora: 30 };
const MAX_FASE = REGRAS.gizesPorFase * REGRAS.ptsGiz + REGRAS.bonusFase;
const K = PFX + 'jogo:rank';
const PROIB = /(porra|caralho|merda|puta|fdp|buceta|piroca|viado|cuzao|arrombad|bost|pqp|vsf|fuck|shit)/i;
const limpa = n => String(n || '').normalize('NFC').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);
const token = (agora = Date.now()) => { const p = Buffer.from(JSON.stringify({ t: agora, n: crypto.randomBytes(6).toString('hex') })).toString('base64url'); return p + '.' + mac('jogo:' + p); };
const abre = tk => { const [p, s] = String(tk || '').split('.'); if (!p || s !== mac('jogo:' + p)) return null; try { return JSON.parse(Buffer.from(p, 'base64url')); } catch (e) { return null; } };
// valida a partida sem tocar no banco (testável)
function confere(t, b, agora = Date.now()) {
  if (!t) return 'Partida inválida';
  const dur = agora - t.t, fases = Math.floor(+b.fases || 0), pts = Math.floor(+b.pontos || 0);
  if (dur > 2 * 3600e3) return 'Partida expirada';
  if (!(fases >= 1 && fases <= REGRAS.fases)) return 'Pontuação não confere';
  if (dur < fases * REGRAS.minMsPorFase || pts < 0 || pts > fases * MAX_FASE) return 'Pontuação não confere';
  const nome = limpa(b.nome);
  if (nome.length < 2 || PROIB.test(nome.replace(/[^a-z]/gi, ''))) return 'Escolha outro nome (2 a 14 letras)';
  return null;
}
async function top(n = 10) {
  const r = await rd(['ZREVRANGE', K, 0, n - 1, 'WITHSCORES']) || [];
  const out = []; for (let i = 0; i < r.length; i += 2) out.push({ nome: r[i].split('|')[0], pontos: +r[i + 1] });
  return out;
}
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.json({ top: await top(10) });
    const b = req.body || {};
    if (b.acao === 'inicio') return res.json({ token: token() });
    if (b.acao === 'pontos') {
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
      const kip = PFX + 'jogo:ip:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
      const n = +(await rd(['INCR', kip])); if (n === 1) await rd(['EXPIRE', kip, 3600]);
      if (n > REGRAS.porHora) return res.status(429).json({ erro: 'Muitas tentativas. Tente de novo daqui a pouco.' });
      const t = abre(b.token), erro = confere(t, b);
      if (erro) return res.status(400).json({ erro });
      if (!(await rd(['SET', PFX + 'jogo:tk:' + t.n, '1', 'NX', 'EX', 7200]))) return res.status(400).json({ erro: 'Essa partida já foi enviada' });
      const membro = limpa(b.nome) + '|' + t.n;
      await rd(['ZADD', K, Math.floor(+b.pontos), membro]);
      await rd(['ZREMRANGEBYRANK', K, 0, -101]); // guarda só os 100 melhores
      const pos = await rd(['ZREVRANK', K, membro]);
      return res.json({ ok: 1, posicao: pos == null ? null : +pos + 1, top: await top(10) });
    }
    res.status(400).json({ erro: 'Ação inválida' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
module.exports.interno = { REGRAS, MAX_FASE, limpa, token, abre, confere };
