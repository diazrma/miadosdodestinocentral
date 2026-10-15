const { randomUUID } = require('crypto');
const { auth, dbGet, dbSet } = require('../lib/db');
const { igToken } = require('../lib/ig');
const IG = require('../lib/igbot');
const B = require('../lib/bot');
const rd = B.rk;
const TIPOS = ['comentario', 'dm', 'story', 'mencao', 'manual'], PASSOS = ['msg', 'pergunta', 'esperar', 'tag', 'se', 'humano'];
const S = (v, n) => String(v ?? '').slice(0, n);
const hm = l => { const o = {}; for (let k = 0; k < (l || []).length; k += 2) o[l[k]] = +l[k + 1]; return o; };
const tag = v => S(v, 30).trim().toLowerCase().replace(/\s+/g, '-');
const botoes = bs => (bs || []).slice(0, 3).map(b => ({ titulo: S(b.titulo, 20), url: /^https?:\/\//i.test(b.url || '') ? S(b.url, 500) : '', auto: b.url ? '' : S(b.auto, 40) })).filter(b => b.titulo && (b.url || b.auto));
function limpaAuto(x, old) {
  return {
    id: old ? old.id : randomUUID().slice(0, 8), nome: S(x.nome, 60).trim() || 'Sem nome', ativo: !!x.ativo, tipo: TIPOS.includes(x.tipo) ? x.tipo : 'dm',
    todos: x.todos !== false, posts: (x.posts || []).map(p => S(p, 40)).slice(0, 50),
    palavras: (x.palavras || []).map(p => S(p, 40).trim()).filter(Boolean).slice(0, 30), modo: ['contem', 'exato', 'qualquer'].includes(x.modo) ? x.modo : 'contem',
    publicas: (x.publicas || []).map(p => S(p, 300).trim()).filter(Boolean).slice(0, 10), umaVez: x.umaVez !== false,
    abertura: { ativo: !!x.abertura?.ativo, texto: S(x.abertura?.texto, 640), botao: S(x.abertura?.botao, 20) },
    seguir: { ativo: !!x.seguir?.ativo, texto: S(x.seguir?.texto, 640), botao: S(x.seguir?.botao, 20) },
    passos: (x.passos || []).filter(p => PASSOS.includes(p.t)).slice(0, 30).map(p => ({
      t: p.t, texto: S(p.texto, 1000), img: /^https:\/\//.test(p.img || '') ? S(p.img, 500) : '', botoes: botoes(p.botoes),
      campo: tag(p.campo) || undefined, valida: ['email', 'telefone', 'texto'].includes(p.valida) ? p.valida : undefined,
      min: p.t === 'esperar' ? Math.min(43200, Math.max(1, +p.min || 1)) : undefined, add: tag(p.add) || undefined, rem: tag(p.rem) || undefined,
      tag: tag(p.tag) || undefined, auto: S(p.auto, 40) || undefined, neg: p.neg ? 1 : undefined
    })),
    criado: old?.criado || Date.now(), editado: Date.now()
  };
}
const pub = c => ({ id: c.id, nome: c.nome, user: c.user, foto: c.foto, tags: c.tags || [], campos: c.campos || {}, n: c.n || 0, ultimo: c.ultimo, janela: c.janela || 0, prev: c.prev || '', prevD: c.prevD || '', humano: !!c.humano, pausa: c.pausa || 0, novo: !!c.novo, segue: c.segue, seg: c.seg, cliques: c.cliques || 0, notas: c.notas || '', criado: c.criado });
async function lista(n) {
  const ids = await rd(['ZREVRANGE', 'cts', 0, n - 1]) || [], out = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await rd(['MGET', ...ids.slice(i, i + 100).map(x => 'ct:' + x)])).filter(Boolean).map(x => pub(JSON.parse(x))));
  return out;
}
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const b = req.body || {}, can = m => a.menus.includes(m), no = (c, m) => res.status(c).json({ erro: m });
    const precisa = (...ms) => ms.some(can) ? null : no(403, 'Sem permissão');
    if (b.acao === 'tick') return res.json({ n: await B.tick() });
    if (b.acao === 'painel') {
      if (precisa('automacoes', 'contatos', 'conversas')) return;
      const as = await B.autos(), dias = [];
      for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - 3 * 3600e3 - i * 864e5).toISOString().slice(0, 10); dias.push({ d, ...hm(await rd(['HGETALL', 'std:' + d])) }); }
      const st = {};
      for (const x of as) st[x.id] = hm(await rd(['HGETALL', 'st:' + x.id]));
      const ct = await dbGet('ig_conta').catch(() => null), conectado = !!(await igToken().catch(() => null));
      const campos = conectado ? await IG.assinatura().catch(e => ({ erro: e.message })) : [];
      return res.json({
        cfg: await B.cfg(), autos: as, st, dias, log: (await rd(['LRANGE', 'bot:log', 0, 19]) || []).map(x => JSON.parse(x)),
        fila: await rd(['ZCARD', 'fila']), contatos: await rd(['ZCARD', 'cts']), janela: await rd(['ZCOUNT', 'ctj', Date.now() - 864e5, '+inf']),
        env: { token: conectado, usuario: ct?.usuario || '', secret: !!IG.SECRET(), verify: a.role?.admin ? IG.VERIFY() : !!IG.VERIFY(), groq: !!process.env.GROQ_API_KEY, tokenExp: ct?.expira || 0, campos }
      });
    }
    if (b.acao === 'salvar_auto') {
      if (precisa('automacoes')) return;
      const as = await B.autos(), old = as.find(x => x.id === b.auto?.id), n = limpaAuto(b.auto || {}, old);
      if (n.tipo !== 'manual' && n.tipo !== 'mencao' && n.modo !== 'qualquer' && !n.palavras.length) return no(400, 'Coloque ao menos uma palavra-chave (ou escolha "qualquer texto")');
      if (!n.passos.length && !n.publicas.length) return no(400, 'Adicione ao menos uma mensagem');
      await dbSet('bot:autos', old ? as.map(x => x.id === n.id ? n : x) : [...as, n]); return res.json({ auto: n });
    }
    if (b.acao === 'apagar_auto') {
      if (precisa('automacoes')) return;
      const as = await B.autos(), usada = as.find(x => x.id !== b.id && x.passos.some(p => p.auto === b.id || p.botoes?.some(k => k.auto === b.id))), C = await B.cfg();
      if (usada) return no(400, 'A automação "' + usada.nome + '" usa esta. Tire de lá primeiro.');
      if ([C.boas, C.padrao, ...C.ib.map(x => x.auto)].includes(b.id)) return no(400, 'Esta automação está em uso nas Configurações.');
      await dbSet('bot:autos', as.filter(x => x.id !== b.id)); await rd(['DEL', 'st:' + b.id]); return res.json({ ok: 1 });
    }
    if (b.acao === 'salvar_cfg') {
      if (precisa('automacoes')) return;
      const x = b.cfg || {}, as = await B.autos(), ok = id => as.some(y => y.id === id) ? id : '';
      const n = { ativo: !!x.ativo, base: /^https:\/\//.test(x.base || '') ? S(x.base, 200) : '', lbase: /^https:\/\/[^/\s]+\/?$/.test(x.lbase || '') ? S(x.lbase, 200).replace(/\/$/, '') : B.CFG0.lbase, boas: ok(x.boas), padrao: ok(x.padrao), padraoH: Math.min(168, Math.max(1, +x.padraoH || 12)), pausaH: Math.min(72, Math.max(0.25, +x.pausaH || 2)),
        ib: (x.ib || []).filter(i => i.q && ok(i.auto)).slice(0, 4).map(i => ({ q: S(i.q, 80), auto: i.auto })),
        assist: { ativo: !!x.assist?.ativo, info: S(x.assist?.info, 6000), limite: Math.min(100, Math.max(1, +x.assist?.limite || 20)), humano: S(x.assist?.humano, 300) } };
      const old = await B.cfg(); let aviso = '';
      await dbSet('bot:cfg', n);
      if (JSON.stringify(old.ib) !== JSON.stringify(n.ib)) await IG.iceBreakers(n.ib).catch(e => { aviso = 'Configurações salvas, mas as perguntas iniciais não foram para o Instagram: ' + e.message; });
      return res.json({ cfg: n, aviso });
    }
    if (b.acao === 'simular') { if (precisa('automacoes')) return; return res.json(await B.simular(TIPOS.includes(b.tipo) ? b.tipo : 'dm', S(b.texto, 500), S(b.media, 40))); }
    if (b.acao === 'assinar') { if (precisa('automacoes')) return; await IG.assinar(); return res.json({ campos: await IG.assinatura(), testes: await IG.testarPermissoes() }); }
    if (b.acao === 'limpar_log') { if (precisa('automacoes')) return; await rd(['DEL', 'bot:log']); return res.json({ ok: 1 }); }
    if (b.acao === 'conversas') { if (precisa('conversas')) return; return res.json({ lista: await lista(300) }); }
    if (b.acao === 'conversa') {
      if (precisa('conversas')) return;
      const c = await B.getC(S(b.id, 40));
      if (b.lida && c.novo) { c.novo = 0; await B.putC(c); }
      return res.json({ c: pub(c), msgs: (await rd(['LRANGE', 'cv:' + c.id, 0, 149]) || []).map(x => JSON.parse(x)).reverse() });
    }
    if (b.acao === 'enviar') { if (precisa('conversas')) return; return res.json({ c: pub(await B.enviarManual(S(b.id, 40), S(b.texto, 1000), a.u.nome.split(' ')[0])) }); }
    if (b.acao === 'contato') {
      if (precisa('conversas', 'contatos')) return;
      const c = await B.getC(S(b.id, 40));
      if (!c.n && !c.user) return no(404, 'Contato não encontrado');
      if (b.tags) c.tags = [...new Set(b.tags.map(tag).filter(Boolean))].slice(0, 30);
      if (b.notas !== undefined) c.notas = S(b.notas, 2000);
      if (b.pausa !== undefined) c.pausa = +b.pausa ? Date.now() + Math.min(720, +b.pausa) * 3600e3 : 0;
      if (b.humano !== undefined) c.humano = b.humano ? 1 : 0;
      if (b.espera === null) c.espera = null;
      await B.putC(c); return res.json({ c: pub(c) });
    }
    if (b.acao === 'rodar') {
      if (precisa('conversas')) return;
      const c = await B.getC(S(b.id, 40)), as = await B.autos(), x = as.find(y => y.id === b.auto);
      if (!x) return no(404, 'Automação não encontrada');
      if (!B.naJanela(c)) return no(400, 'Passou de 24 h desde a última mensagem da pessoa: o Instagram não deixa a automação enviar.');
      await B.rodarPara(c, x); return res.json({ c: pub(c) });
    }
    if (b.acao === 'contatos') { if (precisa('contatos')) return; return res.json({ lista: await lista(5000) }); }
    if (b.acao === 'disparo') { if (precisa('contatos')) return; return res.json(await B.disparo(S(b.auto, 40), tag(b.tag))); }
    no(400, 'Ação inválida');
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
