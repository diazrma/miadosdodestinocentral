const { randomUUID } = require('crypto');
const { dbGet, dbSet, hash, auth, MENUS } = require('../lib/db');
// quem posta por padrão: se ninguém foi escolhido no Painel, é a Ana Paula (criadora de conteúdo do Instagram)
const padraoAna = us => (us.find(u => /^ana\b/i.test(String(u.nome || '').trim())) || {}).id || '';
const pub = u => { const { hash: _h, ...r } = u; return r; };
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const st = await dbGet('state') || {}, us = await dbGet('users') || [], b = req.body || {};
    const can = m => a.menus.includes(m), isAdmin = !!a.role?.admin, roleOf = id => (st.roles || []).find(r => r.id === id);
    // uma vez só: a Ana Paula passa a ser quem posta por padrão (pedido da direção, 09/10/2026); depois vale o que for escolhido no Painel
    if (req.method === 'GET' && !st.padraoAna && padraoAna(us)) { st.padrao = padraoAna(us); st.padraoAna = 1; await dbSet('state', st); }
    if (req.method === 'GET') return res.json({ me: { ...pub(a.u), menus: MENUS.filter(can), admin: isAdmin }, users: us.map(pub), roles: st.roles, state: { resp: st.resp || {}, notes: st.notes || {}, seg: st.seg || {}, last: st.last || '', padrao: st.padrao || padraoAna(us), menu: st.menu || null, fds: !!st.fds } });
    const no = (c, m) => res.status(c).json({ erro: m });
    if (b.acao === 'salvar_estado') {
      if (!['posts', 'dados', 'relatorio', 'equipe'].some(can)) return no(403, 'Sem permissão');
      const e = b.estado || {};
      Object.assign(st, { resp: e.resp || {}, notes: e.notes || {}, seg: e.seg || {}, last: e.last || '', padrao: String(e.padrao || st.padrao || '') });
      await dbSet('state', st); return res.json({ ok: 1 });
    }
    // ordem do menu e seções, arrumadas pelo administrador (vale para todos; cada um continua vendo só as abas liberadas)
    if (b.acao === 'salvar_menu') {
      if (!isAdmin) return no(403, 'Só administradores organizam o menu');
      const m = (Array.isArray(b.menu) ? b.menu : []).slice(0, 12).map(g => ({ nome: String(g?.nome || '').slice(0, 30), abas: (Array.isArray(g?.abas) ? g.abas : []).filter(k => /^[a-z]{2,20}$/.test(k)).slice(0, 30) })).filter(g => g.abas.length);
      st.menu = m.length ? m : null; await dbSet('state', st); return res.json({ ok: 1 });
    }
    // a criadora de conteúdo posta no fim de semana? (padrão: não) — o cronograma deixa sábado e domingo como folga
    if (b.acao === 'salvar_fds') {
      if (!['equipe', 'posts', 'publicar', 'cronograma'].some(can)) return no(403, 'Sem permissão');
      st.fds = !!b.fds; await dbSet('state', st); return res.json({ ok: 1 });
    }
    if (b.acao === 'salvar_padrao') {
      if (!['equipe', 'posts', 'publicar'].some(can)) return no(403, 'Sem permissão');
      const v = String(b.padrao || '');
      if (v && !us.some(u => u.id === v)) return no(400, 'Pessoa não encontrada');
      st.padrao = v; await dbSet('state', st); return res.json({ ok: 1 });
    }
    if (b.acao === 'salvar_usuario') {
      if (!can('equipe')) return no(403, 'Sem permissão');
      const x = b.u || {}, email = String(x.email || '').trim().toLowerCase(), old = us.find(u => u.id === x.id);
      if (!x.nome || !email) return no(400, 'Nome e e-mail são obrigatórios');
      if (!roleOf(x.role)) return no(400, 'Perfil inválido');
      if (x.foto && x.foto.length > 120000) return no(400, 'Foto muito grande');
      if (us.some(u => u.email === email && u.id !== x.id)) return no(400, 'E-mail já cadastrado');
      if ((!old && !x.senha) || (x.senha && x.senha.length < 8)) return no(400, 'Senha com no mínimo 8 caracteres');
      const wasAdm = old && roleOf(old.role)?.admin, willAdm = roleOf(x.role)?.admin;
      if ((wasAdm || willAdm) && !isAdmin) return no(403, 'Só administradores alteram administradores');
      if (wasAdm && !willAdm && us.filter(u => roleOf(u.role)?.admin).length < 2) return no(400, 'Precisa existir ao menos um administrador');
      const n = { id: old ? old.id : randomUUID(), nome: String(x.nome).trim(), email, funcao: x.funcao || '', role: x.role, meta: +x.meta || 0, foto: x.foto || '', hash: x.senha ? hash(x.senha) : old.hash };
      await dbSet('users', old ? us.map(u => u.id === n.id ? n : u) : [...us, n]); return res.json({ ok: 1 });
    }
    if (b.acao === 'remover_usuario') {
      if (!can('equipe')) return no(403, 'Sem permissão');
      const t = us.find(u => u.id === b.id);
      if (!t) return no(404, 'Usuário não encontrado');
      if (t.id === a.u.id) return no(400, 'Você não pode remover a si mesmo');
      if (roleOf(t.role)?.admin && !isAdmin) return no(403, 'Só administradores removem administradores');
      await dbSet('users', us.filter(u => u.id !== t.id)); return res.json({ ok: 1 });
    }
    if (b.acao === 'salvar_roles') {
      if (!can('acessos')) return no(403, 'Sem permissão');
      const keep = (st.roles || []).filter(r => r.admin).map(r => ({ ...r, menus: MENUS }));
      const novos = (b.roles || []).filter(r => !r.admin && r.nome).map(r => ({ id: r.id || r.nome.toLowerCase().replace(/[^a-z0-9]/g, '') + randomUUID().slice(0, 4), nome: String(r.nome).slice(0, 40), menus: (r.menus || []).filter(m => MENUS.includes(m)) }));
      const all = [...keep, ...novos];
      if (us.some(u => !all.find(r => r.id === u.role))) return no(400, 'Há usuários neste perfil. Troque o perfil deles antes de excluir.');
      st.roles = all; await dbSet('state', st); return res.json({ ok: 1 });
    }
    // 🛒 Loja: produtos cadastrados na Uma Penca e o que fica ou sai na renovação do mês
    if (b.acao && b.acao.startsWith('loja_')) {
      if (!can('loja')) return no(403, 'Sem permissão');
      const ps = await dbGet('loja') || [];
      if (b.acao === 'loja_listar') return res.json({ produtos: ps });
      if (b.acao === 'loja_salvar') {
        const x = b.p || {}, old = ps.find(p => p.id === x.id), txt = (v, n) => String(v || '').trim().slice(0, n);
        if (!txt(x.nome, 120)) return no(400, 'Nome é obrigatório');
        const n = { id: old ? old.id : randomUUID(), up: txt(x.up, 12).replace(/\D/g, ''), nome: txt(x.nome, 120), tipo: txt(x.tipo, 40), preco: txt(x.preco, 60),
          status: ['aguardando', 'no_ar', 'arquivado'].includes(x.status) ? x.status : 'aguardando', mes: /^\d{4}-\d{2}$/.test(x.mes) ? x.mes : new Date().toISOString().slice(0, 7),
          proximo: ['fica', 'sai', ''].includes(x.proximo) ? x.proximo : '', url: /^https:\/\/umapenca\.com\//.test(x.url || '') ? txt(x.url, 300) : '', img: /^https:\/\//.test(x.img || '') ? txt(x.img, 400) : '', obs: txt(x.obs, 300),
          por: old ? old.por : a.u.nome, em: Date.now() };
        await dbSet('loja', old ? ps.map(p => p.id === n.id ? n : p) : [n, ...ps].slice(0, 500)); return res.json({ ok: 1, p: n });
      }
      if (b.acao === 'loja_remover') { await dbSet('loja', ps.filter(p => p.id !== b.id)); return res.json({ ok: 1 }); }
    }
    no(400, 'Ação inválida');
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
