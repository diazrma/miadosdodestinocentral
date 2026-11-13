// Roda uma rota agendada da Central fora da Vercel (GitHub Actions), com o mesmo código de api/[rota].js.
// Uso: node ferramentas/rodar-rota.js "/api/loja?story=1"
// Serve de reserva quando a Vercel está fora do ar: as variáveis vêm dos Secrets do GitHub.
const handler = require('../api/[rota].js');

async function rodar(caminho) {
  const url = new URL(caminho, 'https://miadosdodestinocentral.vercel.app');
  const query = Object.fromEntries(url.searchParams);
  const req = {
    method: 'GET', url: url.pathname + url.search, query, body: {},
    headers: { authorization: 'Bearer ' + (process.env.CRON_SECRET || ''), host: url.host, 'user-agent': 'github-actions' }
  };
  return new Promise((ok, falha) => {
    let status = 200;
    const res = {
      status(s) { status = s; return res; },
      setHeader() { return res; },
      json(d) { ok({ status, d }); return res; },
      send(d) { ok({ status, d }); return res; },
      end(d) { ok({ status, d }); return res; }
    };
    Promise.resolve(handler(req, res)).catch(falha);
  });
}

if (require.main === module) {
  const caminho = process.argv[2];
  if (!caminho) { console.error('Uso: node ferramentas/rodar-rota.js "/api/rota?x=1"'); process.exit(2); }
  rodar(caminho).then(({ status, d }) => {
    console.log(status, typeof d === 'string' ? d : JSON.stringify(d, null, 1));
    process.exit(status >= 400 ? 1 : 0);
  }, e => { console.error(e); process.exit(1); });
}
module.exports = { rodar };
