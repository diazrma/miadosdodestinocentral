// Ponte entre a Central (Vercel) e a Evolution API deste computador.
// A cada minuto busca a fila em /api/zap e manda no WhatsApp; a cada 5 min conta para a Central
// se está conectado e em quais grupos o bot está (para escolher na Central). Sem dependências.
const env = process.env;
const C = (env.CENTRAL_URL || '').replace(/\/$/, ''), KEY = env.ZAP_KEY || '';
const EVO = (env.EVO_URL || 'http://evolution:8080').replace(/\/$/, ''), EK = env.EVO_KEY || '', INST = env.EVO_INSTANCIA || 'bigode';
const MIN = 60e3, pausa = ms => new Promise(r => setTimeout(r, ms));
// entre uma mensagem e outra o bot espera um pouco, como gente (rajada é o que mais leva a banimento)
const INTERVALO = +(env.ZAP_INTERVALO_MS ?? 3000);

async function json(url, o = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30e3), ...o, headers: { 'Content-Type': 'application/json', ...o.headers }, body: o.body && JSON.stringify(o.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + String(j.erro || j.message || JSON.stringify(j.response || '')).slice(0, 200));
  return j;
}
const evo = (p, body) => json(EVO + p, { method: body ? 'POST' : 'GET', headers: { apikey: EK }, body });
const central = body => json(C + '/api/zap', { method: body ? 'POST' : 'GET', headers: { 'x-zap-key': KEY }, body });

// primeira vez: cria a instância; o QR code aparece no painel da Evolution (http://localhost:8080/manager)
async function instancia() {
  const l = await evo('/instance/fetchInstances?instanceName=' + INST).catch(() => []);
  const i = (Array.isArray(l) ? l : []).map(x => x.instance || x).find(x => (x.name || x.instanceName) === INST);
  if (i) return i;
  await evo('/instance/create', { instanceName: INST, integration: 'WHATSAPP-BAILEYS', qrcode: true });
  console.log(`Instância "${INST}" criada. Abra http://localhost:8080/manager e leia o QR code com o celular do bot.`);
  return {};
}

let nomeAtual = '';
async function status() {
  const i = await instancia();
  const estado = (await evo('/instance/connectionState/' + INST)).instance?.state || 'close';
  const grupos = estado === 'open' ? (await evo('/group/fetchAllGroups/' + INST + '?getParticipants=false').catch(() => [])).map(g => ({ id: g.id, nome: g.subject })) : [];
  const numero = String(i.ownerJid || i.owner || '').split('@')[0];
  const { nome } = await central({ acao: 'status', estado, numero, grupos });
  // só renomeia o perfil se pedirem explicitamente (EVO_RENOMEAR=1): o nome vale para todos os
  // grupos e conversas do número, então num WhatsApp pessoal isso mexeria na vida da pessoa
  if (process.env.EVO_RENOMEAR === '1' && estado === 'open' && nome && nome !== nomeAtual) {
    await evo('/chat/updateProfileName/' + INST, { name: nome }).then(() => { nomeAtual = nome; console.log('Nome do perfil:', nome); }).catch(e => console.log('Não troquei o nome do perfil:', e.message));
  }
  return { estado, grupos: grupos.length };
}

// manda o que veio da fila; quem falhou volta para a Central tentar de novo no próximo minuto
async function ciclo() {
  const { msgs = [] } = await central();
  const falhas = [];
  for (const m of msgs) {
    const faltou = [];
    for (const para of m.para || []) {
      try { await evo('/message/sendText/' + INST, { number: para, text: m.texto }); console.log('✓', m.tipo, '→', para); }
      catch (e) { faltou.push(para); console.log('✗', m.tipo, '→', para, e.message); }
      await pausa(INTERVALO);
    }
    if (faltou.length) falhas.push({ ...m, para: faltou });
  }
  if (falhas.length) await central({ acao: 'devolver', msgs: falhas }).catch(e => console.log('Não devolvi para a fila:', e.message));
  return { enviadas: msgs.length - falhas.length, falhas: falhas.length };
}

async function start() {
  if (!C || !KEY || !EK) { console.error('Faltam CENTRAL_URL, ZAP_KEY ou EVO_KEY no .env'); process.exit(1); }
  console.log('🐾 Bigode ligado:', C, '↔', EVO);
  for (let n = 0; ; n++) {
    if (n % 5 === 0) await status().then(s => console.log('status:', s.estado, '·', s.grupos, 'grupo(s)')).catch(e => console.log('status falhou:', e.message));
    await ciclo().catch(e => console.log('fila falhou:', e.message));
    await pausa(MIN);
  }
}

if (require.main === module) start();
module.exports = { ciclo, status, instancia };
