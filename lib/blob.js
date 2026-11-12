// Antes: credenciais do Vercel Blob. Agora o armazenamento é o Supabase Storage (lib/storage.js), que lê as próprias
// variáveis; cred() ficou só para não mexer em cada chamada antiga que ainda passa "...cred(req)".
const cred = () => ({});
module.exports = { cred };
