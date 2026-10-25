# Milka Cast: faz o vídeo do episódio do dia (roda no GitHub Actions, .github/workflows/milka-cast.yml).
# A Central (api/milka-cast.js) escolhe o tema sem repetir e escreve o roteiro; aqui sai a voz (edge-tts, com o tempo
# de cada palavra), a legenda palavra a palavra e o reel 1080x1920. O vídeo vai direto para o Blob e a Central publica às 17h.
#
#   python3 episodio.py                       -> episódio do dia: roteiro, vídeo, envio (precisa de MILKA_CAST_SECRET)
#   python3 episodio.py previa roteiro.json   -> só faz o vídeo de um roteiro salvo, em ./saida (para testar o visual)
#   python3 episodio.py teste                 -> vídeo de exemplo, sobe para o Blob e apaga (testa o caminho todo sem publicar)
import asyncio, json, os, re, subprocess, sys, urllib.request
from pathlib import Path

import edge_tts
from PIL import Image, ImageDraw, ImageFilter

PASTA = Path(__file__).resolve().parent
CENTRAL = os.environ.get('CENTRAL_URL', 'https://miadosdodestinocentral.vercel.app')
CLIPE = PASTA / 'clipe.mp4'  # a Milka falando no estúdio (Grok, 848x1072, 15 s); aos 6,5 s entra um ratinho na mesa
FALA_FIM = 5.9              # até aqui ela só fala (aos 6 s o ratinho surge no livro): esse trecho vai e volta enquanto a voz dura
FINAL = 6.8                 # mínimo do final: o ratinho chega e ela levanta para olhar (o clipe tem 9,1 s depois de FALA_FIM)
RATO = 'Queijinho'          # o ratinho amigo da Milka, que aparece no fim de todo episódio
DESPEDIDA = f'Ih, olha quem chegou! É o {RATO}, meu amigo. Vou lá brincar com ele!'
MIAU = PASTA / 'miau.mp3'   # miado de abertura
LOGO = PASTA / 'logo.png'   # no estilo da logo do Miados (ouro granulado)
FONTES = PASTA / 'fontes'
VOZ, VELOCIDADE, TOM = 'pt-BR-ThalitaMultilingualNeural', '-8%', '+18Hz'  # "thalita doce"
ATRASO = 1.3                # a voz entra depois do miado
W, H, FPS = 1080, 1920, 30
TOPO_CENA, ALT_CENA = 250, 1364  # o clipe ocupa 1080x1364 (o x264 pede altura par)


def central(corpo):
    req = urllib.request.Request(CENTRAL + '/api/milka-cast', data=json.dumps(corpo).encode(), headers={
        'Content-Type': 'application/json', 'User-Agent': 'milka-cast', 'x-milka-cast': os.environ['MILKA_CAST_SECRET']})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'Central respondeu {e.code}: {e.read().decode()[:300]}')


def voz(texto, pasta, arquivo='voz.mp3'):
    async def falar():
        com = edge_tts.Communicate(texto, VOZ, rate=VELOCIDADE, pitch=TOM, boundary='WordBoundary')
        palavras = []
        with open(pasta / arquivo, 'wb') as f:
            async for parte in com.stream():
                if parte['type'] == 'audio':
                    f.write(parte['data'])
                elif parte['type'] == 'WordBoundary':
                    ini = parte['offset'] / 1e7
                    palavras.append({'p': parte['text'], 'ini': ini, 'fim': ini + parte['duration'] / 1e7})
        return palavras

    palavras = asyncio.run(falar())
    # o edge-tts manda a palavra sem pontuação; recoloca a do texto para a legenda quebrar nas pausas
    tokens = texto.split()
    i = 0
    for p in palavras:
        while i < len(tokens) and not re.sub(r'\W', '', tokens[i]).lower().startswith(re.sub(r'\W', '', p['p']).lower()[:3]):
            i += 1
        if i < len(tokens):
            p['p'] = tokens[i]
            i += 1
    return palavras


def _t(s):
    return f'{int(s // 3600)}:{int(s % 3600 // 60):02d}:{s % 60:05.2f}'


def legenda_ass(palavras, titulo, numero, dur, fim_fala):
    """Blocos de até 4 palavras; a palavra falada fica dourada."""
    linhas, bloco = [], []
    for p in palavras:
        bloco.append(p)
        if len(bloco) == 4 or re.search(r'[.,!?;:]$', p['p']):
            linhas.append(bloco)
            bloco = []
    if bloco:
        linhas.append(bloco)
    ev = [f'Dialogue: 0,{_t(0)},{_t(dur)},Ep,,0,0,0,,episódio {numero:02d} · {titulo}']
    for i, bl in enumerate(linhas):
        fim_bloco = linhas[i + 1][0]['ini'] if i + 1 < len(linhas) else fim_fala  # a legenda some com a voz
        for k, p in enumerate(bl):
            fim = bl[k + 1]['ini'] if k + 1 < len(bl) else fim_bloco
            txt = ' '.join(('{\\c&H4FB8E6&}' + q['p'] + '{\\c&HFFFFFF&}') if q is p else q['p'] for q in bl)
            ev.append(f'Dialogue: 0,{_t(p["ini"])},{_t(fim)},Fala,,0,0,0,,{txt}')
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Ep,Inter,42,&HD8E6F0&,&H000000&,&H000000&,&H64000000&,0,0,0,0,100,100,1,0,1,0,3,8,60,60,212,1
Style: Fala,Inter,70,&HFFFFFF&,&H000000&,&H1A1008&,&H96000000&,1,0,0,0,100,100,0,0,1,5,3,2,70,70,430,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + '\n'.join(ev) + '\n'


def audio(pasta, dur, ini_final):
    """Miado na abertura, a voz logo depois, a despedida quando o Queijinho chega e um ronronado baixo de fundo."""
    saida = pasta / 'audio.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(pasta / 'voz.mp3'), '-i', str(MIAU),
                    '-f', 'lavfi', '-t', f'{dur:.2f}', '-i', 'anoisesrc=color=brown:amplitude=0.6:sample_rate=44100',
                    '-i', str(pasta / 'voz_final.mp3'),
                    '-filter_complex',
                    f"[0]aresample=44100,aformat=channel_layouts=mono,adelay={int(ATRASO * 1000)}[voz];"
                    f"[3]aresample=44100,aformat=channel_layouts=mono,adelay={int(ini_final * 1000)}[desp];"
                    f"[1]aresample=44100,aformat=channel_layouts=mono,atrim=0:1.4,afade=t=out:st=1.1:d=0.3,volume=0.8[miau];"
                    f"[2]lowpass=f=220,tremolo=f=24:d=0.9,volume=0.18,afade=t=in:d=1.5,afade=t=out:st={dur - 2:.2f}:d=2[ronron];"
                    f"[miau][voz][desp][ronron]amix=inputs=4:normalize=0:duration=longest,atrim=0:{dur:.2f},loudnorm=I=-16",
                    '-ar', '44100', str(saida)], check=True)
    return saida


def mascara(pasta):
    """Bordas de cima e de baixo da cena esfumadas no fundo (feita uma vez, em vez de calcular quadro a quadro)."""
    m = Image.new('L', (W, ALT_CENA), 255)
    d = ImageDraw.Draw(m)
    for y in range(90):
        d.line((0, y, W, y), fill=int(255 * y / 90))
    for y in range(160):
        d.line((0, ALT_CENA - 1 - y, W, ALT_CENA - 1 - y), fill=int(255 * y / 160))
    m.save(pasta / 'mascara.png')
    return pasta / 'mascara.png'


def fundo(pasta, dur, final):
    """A Milka falando enquanto a voz dura e, só depois da última palavra, o ratinho chegando e ela levantando para olhar.
    O trecho da fala vai e volta (sem emenda) e começa numa fase escolhida para terminar exatamente onde o final começa."""
    fala = max(dur - final, 0.1)
    ciclo = 2 * FALA_FIM
    inicio = (FALA_FIM - fala) % ciclo  # o vai e volta termina indo para a frente, no quadro em que o final começa
    base = f"fps={FPS},scale={W}:{ALT_CENA},setsar=1"
    saida = pasta / 'fundo.mp4'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(CLIPE), '-filter_complex',
                    f"[0:v]trim=0:{FALA_FIM},setpts=PTS-STARTPTS,{base},split[a][b];[b]reverse[r];[a][r]concat=n=2,"
                    f"loop=loop=-1:size=32767,trim={inicio:.3f}:{inicio + fala:.3f},setpts=PTS-STARTPTS[fala];"
                    f"[0:v]trim={FALA_FIM}:{FALA_FIM + final},setpts=PTS-STARTPTS,{base}[fim];[fala][fim]concat=n=2[v]",
                    '-map', '[v]', '-t', f'{dur:.2f}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', str(saida)],
                   check=True)
    return saida


def video(ep, palavras, despedida, pasta):
    palavras = [{**p, 'ini': p['ini'] + ATRASO, 'fim': p['fim'] + ATRASO} for p in palavras]
    ini_final = palavras[-1]['fim'] + 0.4      # o final (o Queijinho chegando) começa logo depois da última palavra
    ini_desp = ini_final + 0.3                 # e ela anuncia o amigo enquanto ele sobe no livro
    despedida = [{**p, 'ini': p['ini'] + ini_desp, 'fim': p['fim'] + ini_desp} for p in despedida]
    fim_fala = despedida[-1]['fim'] + 0.4
    dur = max(ini_final + FINAL, fim_fala + 1.5)
    som = audio(pasta, dur, ini_desp)
    (pasta / 'legenda.ass').write_text(legenda_ass(palavras + despedida, ep['titulo'], ep['numero'], dur, fim_fala))
    # fundo: o próprio clipe desfocado; por cima, o clipe nítido com as bordas esfumadas; legenda e onda dourada sobre a mesa
    filtro = (
        f"[0:v]split[c1][c2];"
        f"[c1]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:2,eq=brightness=-0.25,setsar=1[fundo];"
        f"[3:v]format=gray,setsar=1[masc];[c2][masc]alphamerge[cena];"
        f"[1:a]aformat=channel_layouts=mono,showwaves=s=760x90:mode=cline:rate={FPS}:colors=0xE6B84F:scale=sqrt,"
        f"format=rgba,colorchannelmixer=aa=0.85[onda];"
        f"[2:v]scale=720:-1,format=rgba[logo];"
        f"[fundo][cena]overlay=0:{TOPO_CENA}:format=auto[v1];"
        f"[v1][onda]overlay=(W-w)/2:1330[v2];[v2][logo]overlay=(W-w)/2:80[v3];"
        f"[v3]ass={pasta / 'legenda.ass'}:fontsdir={FONTES},fade=t=in:d=0.4,fade=t=out:st={dur - 0.6}:d=0.6[v]"
    )
    laco = ['-loop', '1', '-framerate', str(FPS)]
    saida = pasta / f"milka-cast-{ep['numero']:02d}.mp4"
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(fundo(pasta, dur, dur - ini_final)), '-i', str(som),
                    *laco, '-i', str(LOGO), *laco, '-i', str(mascara(pasta)), '-filter_complex', filtro,
                    '-map', '[v]', '-map', '1:a', '-t', f'{dur:.2f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(saida)], check=True)
    return saida


def fazer(ep, pasta):
    pasta.mkdir(parents=True, exist_ok=True)
    return video(ep, voz(ep['fala'], pasta), voz(DESPEDIDA, pasta, 'voz_final.mp3'), pasta)


def enviar(arq, nome):
    return subprocess.run(['node', str(PASTA / 'enviar.js'), str(arq), nome],
                          check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1]


TESTE = {'numero': 0, 'titulo': 'teste', 'fala': 'Oi, aqui é a Milka. Isto é só um teste do Milka Cast.'}

if __name__ == '__main__':
    if sys.argv[1:2] == ['previa']:
        print(fazer(json.loads(Path(sys.argv[2]).read_text()), Path('saida')))
        sys.exit()
    if sys.argv[1:2] == ['teste']:
        arq = fazer(TESTE, Path('saida'))
        url = enviar(arq, 'milka-cast/teste-' + arq.name)
        print('vídeo de teste:', url, urllib.request.urlopen(url).status)
        print(central({'acao': 'descartar', 'video_url': url}))
        sys.exit()
    r = central({'acao': 'roteiro'})
    ep = r['ep']
    if r.get('pronto'):
        sys.exit(f"episódio {ep['numero']} já está pronto para as 17h")
    print(f"episódio {ep['numero']}: {ep['tema']} -> {ep['titulo']}")
    arq = fazer(ep, Path('saida'))
    url = enviar(arq, f'milka-cast/{arq.name}')
    print('vídeo:', url)
    print(central({'acao': 'pronto', 'numero': ep['numero'], 'video_url': url}))
