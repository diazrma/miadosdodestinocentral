// Armazenamento de mídia e backups no Cloudflare R2 (API compatível com S3), no lugar do Vercel Blob.
// Mesma forma de uso que o projeto já tinha com o Blob: put / del / list, mais o link assinado para o navegador
// e o GitHub Actions mandarem arquivos grandes direto para o R2 (sem passar pela função da Vercel).
// Variáveis na Vercel: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
// (R2_PUBLIC_URL é o endereço público do bucket, ex.: https://pub-xxxx.r2.dev, que o Instagram baixa).
const crypto = require('crypto');

const VARS = { conta: 'R2_ACCOUNT_ID', chave: 'R2_ACCESS_KEY_ID', segredo: 'R2_SECRET_ACCESS_KEY', bucket: 'R2_BUCKET', publico: 'R2_PUBLIC_URL' };
const env = () => {
  const e = Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, process.env[v] || '']));
  return { ...e, publico: e.publico.replace(/\/+$/, '') };
};
const faltando = () => Object.entries(env()).filter(([, v]) => !v).map(([k]) => VARS[k]);
const configurado = () => !faltando().length;
const exige = () => {
  const f = faltando();
  if (f.length) throw new Error('Armazenamento R2 sem configuração na Vercel (falta ' + f.join(', ') + ')');
  return env();
};

const sha = d => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encChave = k => k.split('/').map(enc).join('/');
const host = e => e.conta + '.r2.cloudflarestorage.com';
const carimbo = (d = new Date()) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

function chaveAssinatura(segredo, dia, regiao = 'auto') {
  return [regiao, 's3', 'aws4_request'].reduce(hmac, hmac('AWS4' + segredo, dia));
}

// URL pré-assinada SigV4 (assinatura na query, só o header host assinado)
function preAssinar({ metodo, hostname, caminho, regiao = 'auto', chave, segredo, segundos, agora = new Date() }) {
  const amz = carimbo(agora), dia = amz.slice(0, 8), escopo = `${dia}/${regiao}/s3/aws4_request`;
  const query = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${chave}/${escopo}`, 'X-Amz-Date': amz, 'X-Amz-Expires': segundos, 'X-Amz-SignedHeaders': 'host' };
  const qs = Object.keys(query).sort().map(k => enc(k) + '=' + enc(String(query[k]))).join('&');
  const canon = [metodo, caminho, qs, 'host:' + hostname + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sig = crypto.createHmac('sha256', chaveAssinatura(segredo, dia, regiao)).update(['AWS4-HMAC-SHA256', amz, escopo, sha(canon)].join('\n')).digest('hex');
  return `https://${hostname}${caminho}?${qs}&X-Amz-Signature=${sig}`;
}

// Assinatura AWS SigV4 (header Authorization). Corpo não assinado: o R2 aceita UNSIGNED-PAYLOAD.
function assinar(metodo, caminho, query, headers, e, agora = new Date()) {
  const amz = carimbo(agora), dia = amz.slice(0, 8), escopo = `${dia}/auto/s3/aws4_request`;
  const h = { ...headers, host: host(e), 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amz };
  const nomes = Object.keys(h).map(k => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const qs = Object.keys(query).sort().map(k => enc(k) + '=' + enc(String(query[k]))).join('&');
  const canon = [metodo, caminho, qs, nomes.map(n => n + ':' + lower[n] + '\n').join(''), nomes.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const texto = ['AWS4-HMAC-SHA256', amz, escopo, sha(canon)].join('\n');
  const sig = crypto.createHmac('sha256', chaveAssinatura(e.segredo, dia)).update(texto).digest('hex');
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${e.chave}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${sig}` };
}

async function s3(metodo, chave, { query = {}, headers = {}, corpo } = {}) {
  const e = exige(), caminho = '/' + e.bucket + (chave ? '/' + encChave(chave) : '');
  const qs = Object.keys(query).sort().map(k => enc(k) + '=' + enc(String(query[k]))).join('&');
  const r = await fetch(`https://${host(e)}${caminho}${qs ? '?' + qs : ''}`, { method: metodo, headers: assinar(metodo, caminho, query, headers, e), body: corpo });
  if (!r.ok && !(metodo === 'DELETE' && r.status === 404)) throw new Error(`R2 ${metodo} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

const sufixo = nome => {
  const i = nome.lastIndexOf('.'), r = crypto.randomBytes(10).toString('hex');
  return i > nome.lastIndexOf('/') ? `${nome.slice(0, i)}-${r}${nome.slice(i)}` : `${nome}-${r}`;
};
const urlPublica = chave => exige().publico + '/' + encChave(chave);
const chaveDaUrl = u => {
  const p = env().publico, s = String(u || '');
  return p && s.startsWith(p + '/') ? decodeURIComponent(s.slice(p.length + 1).split('?')[0]) : null;
};
/** A URL é um arquivo deste bucket (e, se informado, dentro da pasta)? */
const ehNosso = (u, pasta = '') => { const k = chaveDaUrl(u); return !!k && k.startsWith(pasta); };

/** Envia um arquivo. Devolve { url, pathname }. */
async function put(nome, corpo, o = {}) {
  const chave = o.addRandomSuffix ? sufixo(nome) : nome;
  await s3('PUT', chave, { headers: { 'content-type': o.contentType || 'application/octet-stream' }, corpo: typeof corpo === 'string' ? Buffer.from(corpo) : corpo });
  return { url: urlPublica(chave), pathname: chave };
}

/** Apaga um ou vários arquivos, pela URL pública (ou pela chave). */
async function del(urls) {
  const lista = (Array.isArray(urls) ? urls : [urls]).map(u => chaveDaUrl(u) || String(u || '')).filter(k => k && !/^https?:/.test(k));
  for (const k of lista) await s3('DELETE', k);
}

/** Lista arquivos (até `limit`), no formato { blobs: [{ url, pathname, size, uploadedAt }] }. */
async function list({ prefix = '', limit = 1000 } = {}) {
  const xml = await (await s3('GET', '', { query: { 'list-type': 2, prefix, 'max-keys': Math.min(limit, 1000) } })).text();
  const blobs = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => {
    const tag = t => (c.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
    const pathname = tag('Key').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return { pathname, url: urlPublica(pathname), size: +tag('Size'), uploadedAt: tag('LastModified') };
  });
  return { blobs };
}

/**
 * Link assinado para enviar um arquivo direto ao R2 com PUT (navegador ou GitHub Actions), válido por `segundos`.
 * Devolve { uploadUrl, url, pathname }; o envio é um PUT simples com o arquivo no corpo.
 */
function linkDeEnvio(nome, { segundos = 3600, addRandomSuffix = true, agora = new Date() } = {}) {
  const e = exige(), chave = addRandomSuffix ? sufixo(nome) : nome, caminho = '/' + e.bucket + '/' + encChave(chave);
  const uploadUrl = preAssinar({ metodo: 'PUT', hostname: host(e), caminho, chave: e.chave, segredo: e.segredo, segundos, agora });
  return { uploadUrl, url: urlPublica(chave), pathname: chave };
}

/** Confere se o R2 responde (uma listagem de 1 item: operação barata, sem gravar nada). */
async function teste() {
  if (!configurado()) return 'Armazenamento R2 sem configuração na Vercel (falta ' + faltando().join(', ') + ')';
  try { await list({ limit: 1 }); return 'ok'; } catch (e) { return e.message; }
}

module.exports = { put, del, list, linkDeEnvio, ehNosso, chaveDaUrl, configurado, teste, interno: { assinar, preAssinar, sufixo } };
