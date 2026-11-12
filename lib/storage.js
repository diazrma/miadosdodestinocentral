// Armazenamento de mídia e backups no Supabase Storage (plano gratuito, sem cartão), no lugar do Vercel Blob.
// Mesma forma de uso que o projeto já tinha: put / del / list, mais o link assinado para o navegador e o GitHub
// Actions mandarem arquivos direto para o Supabase (sem passar pela função da Vercel).
// Variáveis na Vercel: SUPABASE_URL (ex.: https://xxxx.supabase.co) e SUPABASE_SERVICE_KEY (chave service_role).
// O bucket (SUPABASE_BUCKET, padrão "miados") é criado público na primeira vez que for usado.
// Limite do plano gratuito: 50 MB por arquivo.
const crypto = require('crypto');

const MAX_BYTES = 50 * 1024 * 1024;
const VARS = { url: 'SUPABASE_URL', chave: 'SUPABASE_SERVICE_KEY' };
const env = () => ({
  url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  chave: process.env.SUPABASE_SERVICE_KEY || '',
  bucket: process.env.SUPABASE_BUCKET || 'miados'
});
const faltando = () => Object.entries(VARS).filter(([k]) => !env()[k]).map(([, v]) => v);
const configurado = () => !faltando().length;
const exige = () => {
  const f = faltando();
  if (f.length) throw new Error('Armazenamento sem configuração na Vercel (falta ' + f.join(', ') + ')');
  return env();
};

const encChave = k => k.split('/').map(encodeURIComponent).join('/');
const cabecalhos = (e, extra = {}) => ({ authorization: 'Bearer ' + e.chave, apikey: e.chave, ...extra });
const urlPublica = chave => { const e = exige(); return `${e.url}/storage/v1/object/public/${e.bucket}/${encChave(chave)}`; };
const prefixoPublico = () => { const e = env(); return e.url ? `${e.url}/storage/v1/object/public/${e.bucket}/` : ''; };
const chaveDaUrl = u => {
  const p = prefixoPublico(), s = String(u || '');
  return p && s.startsWith(p) ? decodeURIComponent(s.slice(p.length).split('?')[0]) : null;
};
/** A URL é um arquivo deste bucket (e, se informado, dentro da pasta)? */
const ehNosso = (u, pasta = '') => { const k = chaveDaUrl(u); return !!k && k.startsWith(pasta); };

async function api(metodo, caminho, { corpo, headers = {} } = {}) {
  const e = exige();
  const r = await fetch(e.url + '/storage/v1' + caminho, { method: metodo, headers: cabecalhos(e, headers), body: corpo });
  const texto = await r.text();
  let j = null; try { j = texto ? JSON.parse(texto) : null; } catch (x) { j = null; }
  if (!r.ok) {
    const erro = new Error(`Supabase ${metodo} ${r.status}: ${(j && (j.message || j.error)) || texto.slice(0, 200)}`);
    erro.status = r.status; erro.semBucket = /bucket not found/i.test(texto);
    throw erro;
  }
  return j;
}

let bucketPronto = false;
async function garanteBucket() {
  if (bucketPronto) return;
  const e = exige();
  try {
    await api('POST', '/bucket', { headers: { 'content-type': 'application/json' }, corpo: JSON.stringify({ id: e.bucket, name: e.bucket, public: true }) });
  } catch (x) {
    if (!/already exists|duplicate/i.test(x.message) && x.status !== 409) throw x;
  }
  bucketPronto = true;
}
// tenta a operação; se o bucket ainda não existir, cria e tenta de novo uma vez
async function comBucket(fn) {
  try { return await fn(); } catch (x) {
    if (!x.semBucket) throw x;
    await garanteBucket();
    return fn();
  }
}

const sufixo = nome => {
  const i = nome.lastIndexOf('.'), r = crypto.randomBytes(10).toString('hex');
  return i > nome.lastIndexOf('/') ? `${nome.slice(0, i)}-${r}${nome.slice(i)}` : `${nome}-${r}`;
};

/** Envia um arquivo. Devolve { url, pathname }. */
async function put(nome, corpo, o = {}) {
  const chave = o.addRandomSuffix ? sufixo(nome) : nome, e = exige();
  const dados = typeof corpo === 'string' ? Buffer.from(corpo) : corpo;
  if (dados && dados.length > MAX_BYTES) throw new Error('Arquivo acima de 50 MB (limite do plano gratuito do armazenamento)');
  await comBucket(() => api('POST', `/object/${e.bucket}/${encChave(chave)}`, {
    headers: { 'content-type': o.contentType || 'application/octet-stream', 'x-upsert': 'true' }, corpo: dados
  }));
  return { url: urlPublica(chave), pathname: chave };
}

/** Apaga um ou vários arquivos, pela URL pública (ou pela chave). Uma chamada só para todos. */
async function del(urls) {
  const e = exige();
  const prefixes = (Array.isArray(urls) ? urls : [urls]).map(u => chaveDaUrl(u) || String(u || '')).filter(k => k && !/^https?:/.test(k));
  if (!prefixes.length) return;
  await api('DELETE', `/object/${e.bucket}`, { headers: { 'content-type': 'application/json' }, corpo: JSON.stringify({ prefixes }) })
    .catch(x => { if (!x.semBucket) throw x; });
}

/** Lista os arquivos de uma pasta (até `limit`), no formato { blobs: [{ url, pathname, size, uploadedAt }] }. */
async function list({ prefix = '', limit = 1000 } = {}) {
  const e = exige(), pasta = prefix.replace(/\/+$/, '');
  let itens;
  try {
    itens = await api('POST', `/object/list/${e.bucket}`, {
      headers: { 'content-type': 'application/json' },
      corpo: JSON.stringify({ prefix: pasta, limit: Math.min(limit, 1000), offset: 0, sortBy: { column: 'created_at', order: 'desc' } })
    });
  } catch (x) { if (x.semBucket) return { blobs: [] }; throw x; }
  const blobs = (itens || []).filter(i => i.id).map(i => {
    const pathname = (pasta ? pasta + '/' : '') + i.name;
    return { pathname, url: urlPublica(pathname), size: +(i.metadata && i.metadata.size) || 0, uploadedAt: i.created_at };
  });
  return { blobs };
}

/**
 * Link assinado para enviar um arquivo direto ao Supabase com PUT (navegador ou GitHub Actions), válido por 2 h.
 * Devolve { uploadUrl, url, pathname }; o envio é um PUT simples com o arquivo no corpo (até 50 MB).
 */
async function linkDeEnvio(nome, { addRandomSuffix = true } = {}) {
  const e = exige(), chave = addRandomSuffix ? sufixo(nome) : nome;
  const r = await comBucket(() => api('POST', `/object/upload/sign/${e.bucket}/${encChave(chave)}`, { headers: { 'content-type': 'application/json' }, corpo: '{}' }));
  if (!r || !r.url) throw new Error('Supabase não devolveu o link de envio');
  return { uploadUrl: e.url + '/storage/v1' + r.url, url: urlPublica(chave), pathname: chave };
}

/** Confere se o armazenamento responde (uma listagem de 1 item: operação barata, sem gravar nada). */
async function teste() {
  if (!configurado()) return 'Armazenamento sem configuração na Vercel (falta ' + faltando().join(', ') + ')';
  try { await list({ limit: 1 }); return 'ok'; } catch (x) { return x.message; }
}

module.exports = { put, del, list, linkDeEnvio, ehNosso, chaveDaUrl, configurado, teste, MAX_BYTES, interno: { sufixo, garanteBucket } };
