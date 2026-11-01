# Bigode do Destino (bot do WhatsApp)

Os avisos da Central também chegam no grupo da equipe no WhatsApp. A ponte (`worker.js`) usa a
Evolution API que já roda nesta máquina (projeto `../Evolution API`, a mesma da instância
`canteiro`), só numa instância separada chamada **bigode**. A cada minuto a ponte busca a fila em
`/api/zap` na Central e manda. A Vercel nunca chama este computador, então funciona em qualquer
rede, sem abrir porta.

Aqui só sobe a ponte (~60 MB de RAM). A Evolution API, o Postgres e o Redis já estão de pé para o
resto da casa. A ponte liga sozinha quando o computador liga (`restart: always`).

## Ligar pela primeira vez

1. Gere a chave da ponte: `openssl rand -hex 24`.
2. Na Vercel, em Settings › Environment Variables, crie `ZAP_KEY` com essa chave e faça Redeploy.
3. Aqui, copie `.env.example` para `.env` e preencha `CENTRAL_URL`, `ZAP_KEY` (a mesma) e `EVO_KEY`
   (o `AUTHENTICATION_API_KEY` do projeto `../Evolution API`).
4. `docker compose up -d` (sobe só a ponte, na rede `evolution` que já existe).
5. Abra http://localhost:8080/manager, entre com a `EVO_KEY`, abra a instância **bigode** e leia o
   QR code com o celular do chip do bot (WhatsApp › Aparelhos conectados › Conectar).
6. Coloque o número do bot no grupo da equipe.
7. Na Central, Configurações › Geral › 🐾 Bigode no WhatsApp: em até 5 min aparece "Conectado".
   Escolha o grupo, marque o que vai, coloque o seu número de teste e toque em **Mandar teste**.

## Dia a dia

- Ver o que ele está fazendo: `docker logs -f zap-bigode-1`
- Desconectou (a Central mostra "⚠️ WhatsApp desconectado"): leia o QR code de novo no passo 5.
- O celular do chip precisa abrir o WhatsApp pelo menos a cada 14 dias, senão a sessão cai.
- Computador desligado: os avisos esperam na fila (as 50 mais novas) e saem quando ele voltar.

## Para não ser banido

- Chip só do bot, usado normalmente por uns dias antes de ligar a automação.
- Só mande para o grupo; nada de disparo no privado de quem não salvou o número.
- A ponte espera 3 s entre uma mensagem e outra (`ZAP_INTERVALO_MS`).
