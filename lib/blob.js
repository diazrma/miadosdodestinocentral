process.env.VERCEL_BLOB_RETRIES = process.env.VERCEL_BLOB_RETRIES || '1';
const SID = () => String(process.env.BLOB_STORE_ID || '').replace(/^store_/, '');
// chave antiga (vercel_blob_rw_<store>_...) só vale se for do store conectado; senão usa OIDC + BLOB_STORE_ID
const RW = () => { const t = process.env.BLOB_READ_WRITE_TOKEN; return t && (!SID() || t.split('_')[3] === SID()) ? t : null; };
const cred = req => { const t = RW(); if (t) return { token: t }; const o = req?.headers?.['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN; return o && SID() ? { oidcToken: o, storeId: SID() } : {}; };
module.exports = { SID, RW, cred };
