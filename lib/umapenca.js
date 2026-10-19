// 🛒 Coletor da loja oficial na Uma Penca: lê o catálogo público e sincroniza a aba Loja da Central.
// A Uma Penca não tem API aberta de listagem; as páginas de categoria já trazem os produtos em
// window.vueInitialData (36 por página) e a home traz a vitrine em window.initialScope.
const { randomUUID } = require('crypto');
const { rd, PFX, dbGet, dbSet } = require('./db');

const BASE = 'https://umapenca.com';
const LOJA = BASE + '/miadosdodestino/';
// categorias da Uma Penca; as que a loja não usa respondem 404 e são ignoradas
const CATEGORIAS = ['roupas', 'casa', 'acessorios', 'infantil', 'papelaria', 'decoracao'];
const POR_PAGINA = 36;
const UA = { 'User-Agent': 'Mozilla/5.0 (Central Miados do Destino; sincroniza a loja oficial)' };

// lê o objeto JSON que começa logo depois do marcador (window.x = {...}), sem depender do que vem depois
function jsonDepois(html, marcador) {
  const i = html.indexOf(marcador);
  if (i < 0) return null;
  const ini = html.indexOf('{', i);
  let nivel = 0, str = false, esc = false;
  for (let k = ini; k < html.length; k++) {
    const ch = html[k];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') str = true;
    else if (ch === '{') nivel++;
    else if (ch === '}' && --nivel === 0) return JSON.parse(html.slice(ini, k + 1));
  }
  return null;
}

async function pagina(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Uma Penca respondeu ${r.status} em ${url}`);
  return r.text();
}

const produto = (h, categoria) => ({
  up: String(h.id),
  nome: String(h.name || '').trim(),
  tipo: h.type?.name || '',
  preco: Number(h.price) || 0,
  precoMin: Number(h.price_min) > 0 && Number(h.price_min) < Number(h.price) ? Number(h.price_min) : null,
  precoAntigo: Number(h.price_old) > Number(h.price) ? Number(h.price_old) : null,
  url: new URL(h.link, LOJA).href,
  img: h.img_cover || '',
  esgotado: h.in_stock === false,
  categoria
});

// Catálogo completo: todas as categorias (paginadas) + a vitrine da home para conferir se faltou algo.
async function coletar() {
  const achados = new Map(), avisos = [], categorias = [];
  for (const cat of CATEGORIAS) {
    for (let pag = 1; pag <= 20; pag++) {
      const html = await pagina(`${LOJA}${cat}/${pag > 1 ? '?page=' + pag : ''}`);
      if (!html) break;
      const d = jsonDepois(html, 'window.vueInitialData');
      const hits = d?.products?.hits || [];
      if (pag === 1 && hits.length) categorias.push(`${cat} (${d.products.totalHits})`);
      hits.forEach(h => achados.has(String(h.id)) || achados.set(String(h.id), produto(h, cat)));
      if (hits.length < POR_PAGINA) break;
    }
  }
  const home = await pagina(LOJA);
  const escopo = home && jsonDepois(home, 'window.initialScope');
  if (!escopo) avisos.push('Não consegui ler a vitrine da home: o layout da Uma Penca pode ter mudado.');
  const vitrine = Object.keys(escopo || {}).filter(k => k.startsWith('home_showcase')).flatMap(k => escopo[k]?.products?.hits || []);
  for (const h of vitrine) {
    if (achados.has(String(h.id))) continue;
    achados.set(String(h.id), produto(h, 'vitrine'));
    avisos.push(`"${h.name}" está na vitrine mas em nenhuma categoria conhecida: pode haver categoria nova na Uma Penca.`);
  }
  // ordem: a da vitrine da home primeiro (é a que a loja destaca), depois o resto
  const ordem = new Map(vitrine.map((h, i) => [String(h.id), i]));
  const produtos = [...achados.values()].sort((a, b) => (ordem.get(a.up) ?? 999) - (ordem.get(b.up) ?? 999));
  produtos.forEach((p, i) => { p.ordem = i; });
  return { produtos, avisos, categorias };
}

const brl = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
const usd = v => 'R$ ' + Number(v).toFixed(2); // preço em reais, com ponto decimal para o público em inglês

// 🇺🇸 Nomes em inglês (parte do público é dos EUA): a IA traduz uma vez e o banco guarda (loja_en);
// sem IA, o dicionário cobre os tipos e as expressões mais comuns da loja.
const DIC = [[/^Kit de Bottons/i, 'Button Pin Set'], [/^Camiseta/i, 'T-shirt'], [/^Caneca/i, 'Mug'], [/^P[oô]ster/i, 'Poster'], [/^Ecobag/i, 'Tote Bag'],
  [/Os Cinco Guardiões/g, 'The Five Guardians'], [/Os Guardiões/g, 'The Guardians'], [/O Ciclo se Completa/g, 'The Cycle Is Complete'], [/O Ciclo de (\w+)/g, "$1's Cycle"],
  [/ e /g, ' and '], [/ com /g, ' with ']];
const dicionario = nome => DIC.reduce((t, [de, para]) => t.replace(de, para), String(nome));
async function nomesEmIngles(produtos) {
  const cache = await dbGet('loja_en').catch(() => null) || {};
  const faltam = produtos.filter(c => !cache[c.up]);
  if (faltam.length) {
    try {
      const { perguntar } = require('./groq');
      const r = await perguntar([
        { role: 'system', content: 'You translate Brazilian Portuguese product names of the drama "Miados do Destino" into natural US English for an online store. Keep character names (Yoonari, Naru, Haneul, Milka, Spark, Merlin, Zelda, Baek) unchanged. Answer ONLY a JSON object mapping each id to its English name.' },
        { role: 'user', content: JSON.stringify(Object.fromEntries(faltam.map(c => [c.up, c.nome]))) }
      ], { temperatura: 0.1 });
      const j = JSON.parse(r.texto.slice(r.texto.indexOf('{'), r.texto.lastIndexOf('}') + 1));
      for (const c of faltam) if (typeof j[c.up] === 'string' && j[c.up].trim()) cache[c.up] = j[c.up].trim().slice(0, 80);
    } catch (e) { /* sem IA: usa o dicionário abaixo e tenta a IA de novo na próxima leitura */ }
    const traduzidos = faltam.filter(c => cache[c.up]);
    if (traduzidos.length) await dbSet('loja_en', cache).catch(() => {});
  }
  for (const c of produtos) c.nomeEn = cache[c.up] || dicionario(c.nome);
}
const precoTxt = p => (p.precoMin ? 'a partir de ' + brl(p.precoMin) : brl(p.preco));
const dataBR = () => new Date(Date.now() - 3 * 3600e3).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

// Aplica o catálogo na aba Loja: no ar = está na Uma Penca; saiu da Uma Penca = arquivado.
async function sincronizar(por = 'Robô da loja') {
  const { produtos, avisos, categorias } = await coletar();
  // loja vazia quase sempre é falha de leitura, não a loja inteira saindo: não arquiva nada
  if (!produtos.length) throw new Error('A Uma Penca não devolveu nenhum produto; nada foi alterado.');
  await nomesEmIngles(produtos);

  const lista = await dbGet('loja') || [];
  const r = { novos: [], aprovados: [], precos: [], arquivados: [], voltaram: [], total: produtos.length };
  const vistos = new Set(), saiu = new Set(), mudouPreco = new Map();
  const agora = Date.now(), mes = new Date().toISOString().slice(0, 7);

  const atualizada = lista.map(p => {
    const c = produtos.find(x => x.up === p.up) || (p.url && produtos.find(x => x.url === p.url));
    if (!c) {
      if (p.up && p.status === 'no_ar') {
        r.arquivados.push(p.nome); saiu.add(p.up);
        return { ...p, status: 'arquivado', obs: `Saiu da Uma Penca em ${dataBR()}`, em: agora };
      }
      return p;
    }
    vistos.add(c.up);
    if (p.status === 'aguardando') r.aprovados.push(c.nome);
    if (p.status === 'arquivado') r.voltaram.push(c.nome);
    const preco = precoTxt(c);
    if (p.preco && p.preco !== preco) { r.precos.push(`${c.nome}: ${p.preco} → ${preco}`); mudouPreco.set(c.up, p.preco); }
    return {
      ...p, up: c.up, nome: p.nome || c.nome, tipo: p.tipo || c.tipo, preco, url: c.url, img: c.img, status: 'no_ar',
      obs: p.obs && /^Saiu da Uma Penca/.test(p.obs) ? '' : p.obs,
      loja: { nome: c.nome, nomeEn: c.nomeEn, preco: c.preco, precoMin: c.precoMin, precoAntigo: c.precoAntigo, esgotado: c.esgotado, categoria: c.categoria, ordem: c.ordem, visto: agora },
      em: agora
    };
  });
  const novos = produtos.filter(c => !vistos.has(c.up)).map(c => {
    r.novos.push(c.nome);
    return {
      id: randomUUID(), up: c.up, nome: c.nome, tipo: c.tipo, preco: precoTxt(c), status: 'no_ar', mes, proximo: '', url: c.url, img: c.img, obs: '',
      loja: { nome: c.nome, nomeEn: c.nomeEn, preco: c.preco, precoMin: c.precoMin, precoAntigo: c.precoAntigo, esgotado: c.esgotado, categoria: c.categoria, ordem: c.ordem, visto: agora },
      por, em: agora
    };
  });

  await dbSet('loja', [...novos, ...atualizada].slice(0, 500));
  const auto = await automacoes(produtos, saiu, mudouPreco);
  const registro = { quando: new Date().toISOString(), por, categorias, avisos: [...avisos, ...auto.avisos], ...r, automacoes: auto.r };
  await dbSet('loja_sync', registro);
  return registro;
}

// 🤖 Automações do Instagram que citam produtos da loja (link da página ou foto da Uma Penca levam o id):
// produto saiu da loja -> a automação é pausada (ninguém recebe link quebrado);
// voltou -> a automação que o robô pausou volta a rodar; preço mudou -> o robô corrige as automações dele
// e avisa nas que a equipe escreveu; produto sem nenhuma automação -> o robô cria uma, já ligada.
const idsCitados = a => new Set([...JSON.stringify([a.passos, a.abertura, a.seguir, a.publicas]).matchAll(/umapenca\.(?:com\/[^"\s]*?-|imgix\.net\/)(\d{5,7})(?:\.html|\/)/g)].map(m => m[1]));
const minusculo = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
// a resposta privada de um comentário só leva 1 mensagem: texto, preço e o botão de comprar juntos
const passosDoRobo = c => [{ t: 'msg', texto: `🇧🇷 Oi {nome}! 😺 ${c.nome} está na loja oficial do Miados do Destino ${c.precoMin ? 'a partir de ' + brl(c.precoMin) : 'por ' + brl(c.preco)}. Produção sob demanda pela Uma Penca, com entrega para todo o Brasil.\n\n🇺🇸 Hi {nome}! ${c.nomeEn || c.nome} is available at the official Miados do Destino store ${c.precoMin ? 'from ' + usd(c.precoMin) : 'for ' + usd(c.preco)} (Brazilian reais). Made to order by Uma Penca, a Brazilian print shop.`, img: '', botoes: [{ titulo: '🛒 Comprar / Buy', url: c.url, auto: '' }] }];
const palavrasDoRobo = c => [...new Set([minusculo(c.nome), minusculo(c.nomeEn)].filter(Boolean).map(p => p.slice(0, 40)))];
const PUBLICAS = ['🇧🇷 Te mandei o link no direct, {nome}! 💛 🇺🇸 Link sent to your DMs!'];
const automacaoNova = c => ({
  id: randomUUID().slice(0, 8), nome: ('🛒 ' + c.nome).slice(0, 60), ativo: true, tipo: 'comentario', todos: true, posts: [],
  palavras: palavrasDoRobo(c), modo: 'contem', publicas: PUBLICAS, umaVez: true,
  abertura: { ativo: false, texto: '', botao: '' }, seguir: { ativo: false, texto: '', botao: '' },
  passos: passosDoRobo(c), criado: Date.now(), editado: Date.now(), criadaPelaLoja: c.up
});
async function automacoes(produtos, saiu, mudouPreco) {
  const lista = await dbGet('bot:autos') || [], r = { pausadas: [], reativadas: [], criadas: [], corrigidas: [] }, avisos = [];
  const noAr = new Map(produtos.map(c => [c.up, c]));
  let mudou = false;
  const nova = lista.map(a => {
    const ids = idsCitados(a);
    if (!ids.size) return a;
    const fora = [...ids].filter(id => !noAr.has(id));
    let x = a;
    // automação do próprio robô (a equipe não editou): texto, preço e link acompanham a loja
    const dono = a.criadaPelaLoja && noAr.get(a.criadaPelaLoja);
    if (dono && JSON.stringify([a.passos, a.palavras, a.publicas]) !== JSON.stringify([passosDoRobo(dono), palavrasDoRobo(dono), PUBLICAS])) {
      x = { ...x, passos: passosDoRobo(dono), palavras: palavrasDoRobo(dono), publicas: PUBLICAS, editado: Date.now() }; mudou = true; r.corrigidas.push(a.nome);
    }
    else if (!a.criadaPelaLoja) for (const [id, antigo] of mudouPreco) if (ids.has(id) && JSON.stringify(a).includes(antigo)) avisos.push(`A automação "${a.nome}" cita o preço antigo ${antigo}: revise o texto.`);
    if (x.ativo && fora.some(id => saiu.has(id))) {
      mudou = true; r.pausadas.push(a.nome);
      return { ...x, ativo: false, pausadaPelaLoja: fora };
    }
    if (!x.ativo && x.pausadaPelaLoja && !fora.length) {
      mudou = true; r.reativadas.push(a.nome);
      const { pausadaPelaLoja, ...resto } = x;
      return { ...resto, ativo: true };
    }
    return x;
  });
  // produto no ar que nenhuma automação cita ganha uma, no fim da lista (as da equipe continuam com prioridade)
  // a do story do dia troca de produto todo dia: não conta como automação do produto
  const citados = new Set(nova.filter(a => a.criadaPelaLoja !== 'story').flatMap(a => [...idsCitados(a)]));
  const chaves = new Set(nova.filter(a => a.tipo === 'comentario').flatMap(a => (a.palavras || []).map(minusculo)));
  for (const c of produtos) {
    if (c.esgotado || citados.has(c.up)) continue;
    const n = automacaoNova(c), repetida = n.palavras.find(k => chaves.has(k));
    if (repetida) { avisos.push(`"${c.nome}" ficou sem automação: já existe outra com a palavra-chave "${repetida}".`); continue; }
    n.palavras.forEach(k => chaves.add(k)); citados.add(c.up); nova.push(n); r.criadas.push(n.nome); mudou = true;
  }
  if (mudou) await dbSet('bot:autos', nova);
  return { r, avisos };
}

// Além do cron diário, a vitrine se renova sozinha quando a última leitura passa de 3 horas
// (a trava evita duas leituras ao mesmo tempo quando várias visitas chegam juntas).
const VALIDADE = 3 * 3600e3;
async function renovarSeVelha(sync) {
  if (sync && Date.now() - Date.parse(sync.quando) < VALIDADE) return sync;
  const livre = await rd(['SET', PFX + 'loja_trava', '1', 'NX', 'EX', '120']).catch(() => null);
  if (!livre) return sync;
  return sincronizar('Robô da loja (automático)').catch(() => sync);
}

// O que o site mostra: só o que está no ar na Uma Penca, com o preço e a foto da última leitura.
async function vitrinePublica() {
  const sync = await renovarSeVelha(await dbGet('loja_sync').catch(() => null));
  const lista = await dbGet('loja').catch(() => null) || [];
  const produtos = lista.filter(p => p.status === 'no_ar' && p.url && p.img && p.loja).sort((a, b) => (a.loja.ordem ?? 999) - (b.loja.ordem ?? 999)).map(p => ({
    id: p.up, nome: p.loja.nome || p.nome, nomeEn: p.loja.nomeEn || '', tipo: p.tipo, preco: p.loja.preco, precoMin: p.loja.precoMin, precoAntigo: p.loja.precoAntigo,
    link: p.url, img: p.img, esgotado: !!p.loja.esgotado
  }));
  return { url: LOJA, atualizado: sync?.quando || null, produtos };
}

module.exports = { coletar, sincronizar, vitrinePublica, LOJA };
