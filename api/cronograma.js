// Cronograma de postagens: itens por mês (crono:AAAA-MM) com data, hora, tipo, status, título, descrição e imagem (Blob, pasta crono/)
const { randomUUID } = require('crypto');
const { del } = require('@vercel/blob');
const { auth, dbGet, dbSet } = require('../lib/db');
const { cred } = require('../lib/blob');
const MES = /^\d{4}-\d{2}$/, DIA = /^\d{4}-\d{2}-\d{2}$/, TIPOS = ['post', 'reels', 'carrossel', 'story'], STATUS = ['ideia', 'pronto', 'postado'];
const BLOB = u => /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/crono\//i.test(String(u || ''));
const S = (v, n) => String(v ?? '').slice(0, n);
const ordem = (x, y) => (x.data + (x.hora || '99')).localeCompare(y.data + (y.hora || '99'));
// GET ?img=<url>: repassa a foto do Instagram (só hosts do CDN da Meta) para o navegador poder desenhá-la no canvas
const IGHOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
async function proxyImg(req, res) {
  let u; try { u = new URL(String(req.query.img)); } catch (e) { return res.status(400).end(); }
  if (u.protocol !== 'https:' || !IGHOST.test(u.hostname)) return res.status(400).end();
  const r = await fetch(u, { redirect: 'error' }).catch(() => null), tipo = r?.headers.get('content-type') || '';
  if (!r || !r.ok || !tipo.startsWith('image/')) return res.status(502).end();
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 8e6) return res.status(413).end();
  res.setHeader('Content-Type', tipo); res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(b);
}
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET' && req.query?.img) return await proxyImg(req, res);
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    if (!a.menus.includes('cronograma')) return res.status(403).json({ erro: 'Sem permissão para o cronograma' });
    const b = req.body || {}, no = (c, m) => res.status(c).json({ erro: m }), apagaImg = u => BLOB(u) ? del(u, cred(req)).catch(() => {}) : null;
    if (b.acao === 'mes') {
      if (!MES.test(b.mes || '')) return no(400, 'Mês inválido');
      return res.json({ itens: await dbGet('crono:' + b.mes) || [] });
    }
    if (b.acao === 'salvar') {
      const x = b.item || {};
      if (!DIA.test(x.data || '')) return no(400, 'Escolha a data');
      if (!S(x.titulo, 120).trim()) return no(400, 'Coloque um título');
      const mes = x.data.slice(0, 7), de = MES.test(x.de || '') ? x.de : mes;
      let it = await dbGet('crono:' + mes) || [], old = it.find(i => i.id === x.id);
      if (x.id && de !== mes) { const l = await dbGet('crono:' + de) || []; old = l.find(i => i.id === x.id); await dbSet('crono:' + de, l.filter(i => i.id !== x.id)); }
      const n = {
        id: old?.id || randomUUID().slice(0, 8), data: x.data, hora: /^\d{2}:\d{2}$/.test(x.hora || '') ? x.hora : '',
        tipo: TIPOS.includes(x.tipo) ? x.tipo : 'post', status: STATUS.includes(x.status) ? x.status : 'ideia',
        titulo: S(x.titulo, 120).trim(), desc: S(x.desc, 2200), img: BLOB(x.img) ? x.img : '', por: old?.por || a.u.nome, t: Date.now()
      };
      if (old?.img && old.img !== n.img) await apagaImg(old.img);
      it = [...it.filter(i => i.id !== n.id), n].sort(ordem);
      await dbSet('crono:' + mes, it);
      return res.json({ item: n });
    }
    if (b.acao === 'apagar') {
      if (!MES.test(b.mes || '')) return no(400, 'Mês inválido');
      const it = await dbGet('crono:' + b.mes) || [], x = it.find(i => i.id === b.id);
      if (!x) return no(404, 'Item não encontrado');
      await apagaImg(x.img);
      await dbSet('crono:' + b.mes, it.filter(i => i.id !== b.id));
      return res.json({ ok: 1 });
    }
    no(400, 'Ação inválida');
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
