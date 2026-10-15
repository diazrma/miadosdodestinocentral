// Público: webhook da Meta (comentários e DMs), fila de esperas (?tick=1, cron/QStash) e links rastreados (?r=...)
const IG = require('../lib/igbot');
const B = require('../lib/bot');
// a assinatura da Meta é sobre o corpo cru; se a Vercel já tiver lido o corpo, remonta no formato da Meta
async function corpo(req) {
  if (Buffer.isBuffer(req.rawBody)) return [req.rawBody];
  if (!req.readableEnded) {
    const ch = [];
    const ok = await Promise.race([(async () => { for await (const c of req) ch.push(Buffer.from(c)); return 1; })().catch(() => 0), new Promise(r => setTimeout(r, 1200, 0))]);
    if (ok && ch.length) return [Buffer.concat(ch)];
  }
  const b = req.body;
  if (Buffer.isBuffer(b)) return [b];
  if (typeof b === 'string') return [Buffer.from(b)];
  if (!b || typeof b !== 'object') return [];
  const j = JSON.stringify(b), u = (s, up) => s.replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')[up ? 'toUpperCase' : 'toLowerCase']());
  return [j, u(j).replace(/\//g, '\\/'), u(j, 1).replace(/\//g, '\\/'), u(j)].map(s => Buffer.from(s));
}
module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    if (q.r) {
      const o = B.abreLink(q.r);
      if (!o) return res.status(400).send('Link inválido');
      await Promise.all([B.stat('st:' + o.a, 'cliques'), B.dia('cliques'), B.getC(o.c).then(c => { if (!c.n && !c.user) return; c.cliques = (c.cliques || 0) + 1; return B.putC(c); }).catch(() => {})]);
      res.setHeader('Location', o.u); return res.status(302).end();
    }
    if (q.tick) return res.json({ ok: 1, n: await B.tick() });
    if (req.method === 'GET') {
      if (q['hub.mode'] !== 'subscribe') return res.status(200).send('ok');
      return IG.VERIFY() && q['hub.verify_token'] === IG.VERIFY() ? res.status(200).send(q['hub.challenge']) : res.status(403).send('Token de verificação não confere');
    }
    const sig = req.headers['x-hub-signature-256'], raws = await corpo(req), raw = raws.find(r => IG.assinaturaOk(r, sig));
    if (!raw) {
      await B.log(IG.SECRET() ? 'Webhook recusado: assinatura inválida (confira IG_APP_SECRET)' : 'Webhook recusado: falta IG_APP_SECRET na Vercel');
      return res.status(403).send('assinatura');
    }
    await B.processar(JSON.parse(raw.toString('utf8'))).catch(e => B.log('Webhook: ' + e.message));
    await B.tick().catch(() => {});
    res.status(200).send('EVENT_RECEIVED');
  } catch (e) { await B.log('Webhook: ' + e.message); res.status(200).send('EVENT_RECEIVED'); }
};
module.exports.config = { api: { bodyParser: false } };
