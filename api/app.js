const { randomUUID } = require('crypto');
const { dbGet, dbSet, hash, auth, MENUS } = require('../lib/db');
const pub = u => { const { hash: _h, ...r } = u; return r; };
module.exports = async (req, res) => {
  try {
    const a = await auth(req);
    if (!a) return res.status(401).json({ erro: 'Faça login' });
    const st = await dbGet('state') || {}, us = await dbGet('users') || [], b = req.body || {};
    const can = m => a.menus.includes(m), isAdmin = !!a.role?.admin, roleOf = id => (st.roles || []).find(r => r.id === id);
    if (req.method === 'GET') return res.json({ me: { ...pub(a.u), menus: MENUS.filter(can), admin: isAdmin }, users: us.map(pub), roles: st.roles, state: { resp: st.resp || {}, notes: st.notes || {}, seg: st.seg || {}, last: st.last || '', padrao: st.padrao || '' } });
    const no = (c, m) => res.status(c).json({ erro: m });
    if (b.acao === 'salvar_estado') {
      if (!['posts', 'dados', 'relatorio', 'equipe'].some(can)) return no(403, 'Sem permissão');
      const e = b.estado || {};
      Object.assign(st, { resp: e.resp || {}, notes: e.notes || {}, seg: e.seg || {}, last: e.last || '', padrao: String(e.padrao || '') });
      await dbSet('state', st); return res.json({ ok: 1 });
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
    no(400, 'Ação inválida');
  } catch (e) { res.status(500).json({ erro: e.message }); }
};
