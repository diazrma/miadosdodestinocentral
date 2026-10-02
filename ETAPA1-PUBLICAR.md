Projeto: Miados Central (index.html + api/*.js na Vercel, Redis Upstash em lib/db.js, Instagram em api/sync.js com IG_TOKEN via graph.instagram.com).

Tarefa — Etapa 1: criar a aba "📤 Publicar" para postar no Instagram pela plataforma.

- Nova aba no menu (MN em index.html e MENUS em lib/db.js), controlada por Acessos como as outras.
- Tipos: Foto, Carrossel (2 a 10 fotos/vídeos) e Vídeo/Reels.
- Upload direto do navegador para o Vercel Blob (client upload, para passar do limite de 4,5 MB da Vercel), via nova rota api/upload.js com @vercel/blob.
- Campos: legenda, responsável (já vem com o dono padrão S.padrao), prévia da mídia.
- Botão "Publicar": nova rota api/publicar.js usando a Content Publishing API (criar container, esperar status FINISHED no vídeo, media_publish). Ao publicar, gravar o responsável em S.resp do novo post e sincronizar.
- Depois de publicar, apagar o arquivo do Blob.
- Mostrar erros claros (token sem permissão, formato inválido etc.). Não usar a palavra "IA" na tela.
- Atualizar o LEIA-ME.txt com: ativar Vercel Blob e gerar IG_TOKEN com permissão de publicação.
- Seguir o estilo do código atual (compacto, funções curtas, sem frameworks).
