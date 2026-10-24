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
CENA = PASTA / 'cena.png'   # a Milka no estúdio, sem texto (1122x1402)
MIAU = PASTA / 'miau.mp3'   # miado de abertura
LOGO = PASTA / 'logo.png'   # no estilo da logo do Miados (ouro granulado)
RATO = PASTA / 'rato.png'   # ratinho que atravessa a mesa
FONTES = PASTA / 'fontes'
VOZ, VELOCIDADE, TOM = 'pt-BR-ThalitaMultilingualNeural', '-8%', '+18Hz'  # "thalita doce"
ATRASO = 1.3                # a voz entra depois do miado
W, H, FPS = 1080, 1920, 30
TOPO_CENA, ALT_CENA = 250, 1350


def central(corpo):
    req = urllib.request.Request(CENTRAL + '/api/milka-cast', data=json.dumps(corpo).encode(), headers={
        'Content-Type': 'application/json', 'User-Agent': 'milka-cast', 'x-milka-cast': os.environ['MILKA_CAST_SECRET']})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'Central respondeu {e.code}: {e.read().decode()[:300]}')


def voz(texto, pasta):
    async def falar():
        com = edge_tts.Communicate(texto, VOZ, rate=VELOCIDADE, pitch=TOM, boundary='WordBoundary')
        palavras = []
        with open(pasta / 'voz.mp3', 'wb') as f:
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


def legenda_ass(palavras, titulo, numero, dur):
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
        fim_bloco = linhas[i + 1][0]['ini'] if i + 1 < len(linhas) else dur
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


def audio(pasta, dur):
    """Miado na abertura, a voz logo depois e um ronronado baixo de fundo."""
    saida = pasta / 'audio.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(pasta / 'voz.mp3'), '-i', str(MIAU),
                    '-f', 'lavfi', '-t', f'{dur:.2f}', '-i', 'anoisesrc=color=brown:amplitude=0.6:sample_rate=44100',
                    '-filter_complex',
                    f"[0]aresample=44100,aformat=channel_layouts=mono,adelay={int(ATRASO * 1000)}[voz];"
                    f"[1]aresample=44100,aformat=channel_layouts=mono,atrim=0:1.4,afade=t=out:st=1.1:d=0.3,volume=0.8[miau];"
                    f"[2]lowpass=f=220,tremolo=f=24:d=0.9,volume=0.18,afade=t=in:d=1.5,afade=t=out:st={dur - 2:.2f}:d=2[ronron];"
                    f"[miau][voz][ronron]amix=inputs=3:normalize=0:duration=longest,atrim=0:{dur:.2f},loudnorm=I=-16",
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


def video(ep, palavras, pasta):
    palavras = [{**p, 'ini': p['ini'] + ATRASO, 'fim': p['fim'] + ATRASO} for p in palavras]
    dur = palavras[-1]['fim'] + 1.2
    som = audio(pasta, dur)
    (pasta / 'legenda.ass').write_text(legenda_ass(palavras, ep['titulo'], ep['numero'], dur))
    n = int(dur * FPS)
    # o ratinho entra pela esquerda, para na frente da Milka e sai pela direita, pulando de leve enquanto anda
    t0 = dur * 0.4
    u = f'(t-{t0:.2f})'
    rato_x = f"if(lt({u},3.5),-160+{u}*640/3.5,if(lt({u},5),480,480+({u}-5)*760/3.5))"
    rato_y = f"1150-h-not(between({u},3.5,5))*abs(sin({u}*16))*6"
    # fundo: a própria cena desfocada; por cima, a cena nítida com zoom lento; legenda e onda dourada sobre a mesa
    filtro = (
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:2,eq=brightness=-0.25,setsar=1[fundo];"
        f"[0:v]scale={W}:{ALT_CENA},"
        f"zoompan=z='1.0+0.05*on/{n}':x='iw/2-iw/zoom/2':y='ih/3-ih/zoom/3':d={n}:s={W}x{ALT_CENA}:fps={FPS},setsar=1[nitida];"
        f"[4:v]format=gray,setsar=1[masc];[nitida][masc]alphamerge[cena];"
        f"[1:a]aformat=channel_layouts=mono,showwaves=s=760x90:mode=cline:rate={FPS}:colors=0xE6B84F:scale=sqrt,"
        f"format=rgba,colorchannelmixer=aa=0.85[onda];"
        f"[2:v]scale=150:-1,format=rgba[rato];[3:v]scale=720:-1,format=rgba[logo];"
        f"[fundo][cena]overlay=0:{TOPO_CENA}:format=auto[v0];"
        f"[v0][rato]overlay=x='{rato_x}':y='{rato_y}':enable='between(t,{t0:.2f},{t0 + 8.6:.2f})'[v1];"
        f"[v1][onda]overlay=(W-w)/2:1330[v2];[v2][logo]overlay=(W-w)/2:80[v3];"
        f"[v3]ass={pasta / 'legenda.ass'}:fontsdir={FONTES},fade=t=in:d=0.4,fade=t=out:st={dur - 0.6}:d=0.6[v]"
    )
    laco = ['-loop', '1', '-framerate', str(FPS)]
    saida = pasta / f"milka-cast-{ep['numero']:02d}.mp4"
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *laco, '-i', str(CENA), '-i', str(som), *laco, '-i', str(RATO),
                    *laco, '-i', str(LOGO), *laco, '-i', str(mascara(pasta)), '-filter_complex', filtro,
                    '-map', '[v]', '-map', '1:a', '-t', f'{dur:.2f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(saida)], check=True)
    return saida


def fazer(ep, pasta):
    pasta.mkdir(parents=True, exist_ok=True)
    return video(ep, voz(ep['fala'], pasta), pasta)


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
