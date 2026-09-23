"""Build licensed stills for the MacBook Neo editorial pipeline pilot.

The illustrations are original. Stock photographs retain their Pexels license.
No Apple photography, logos, or product renders are copied.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "pilots" / "macbook-neo"
OUT.mkdir(parents=True, exist_ok=True)
CACHE = ROOT / "tmp" / "pilot-macbook" / "source"
CACHE.mkdir(parents=True, exist_ok=True)

SIZES = {"portrait": (1080, 1920), "landscape": (1920, 1080)}
INK = "#111427"
INK2 = "#222746"
WHITE = "#F6F7FF"
MUTED = "#C8CCE2"
CYAN = "#42DED7"
PINK = "#FFC1D3"
YELLOW = "#F9EA86"
INDIGO = "#6677B9"
SILVER = "#D9DEE8"

FONT_REGULAR = Path("C:/Windows/Fonts/segoeui.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/segoeuib.ttf")
if not FONT_REGULAR.exists():
    FONT_REGULAR = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def font(px: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REGULAR), px)


def gradient(size: tuple[int, int]) -> Image.Image:
    w, h = size
    top = (12, 17, 38)
    bottom = (29, 32, 62)
    strip = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(strip)
    for y in range(h):
        t = y / max(1, h - 1)
        d.point((0, y), fill=tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
    im = strip.resize(size)
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((w * .42, -h * .18, w * 1.24, h * .42), fill=(65, 211, 210, 38))
    gd.ellipse((-w * .4, h * .55, w * .42, h * 1.22), fill=(104, 110, 229, 34))
    return Image.alpha_composite(im.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(w // 9)))


def dims(size: tuple[int, int]):
    w, h = size
    portrait = h > w
    return w, h, portrait, (76 if portrait else 120)


def text_lines(draw, xy, words, max_width, font_size, fill=WHITE, bold=False, spacing=1.15):
    f = font(font_size, bold)
    x, y = xy
    line = ""
    for word in words.split():
        attempt = (line + " " + word).strip()
        if line and draw.textbbox((0, 0), attempt, font=f)[2] > max_width:
            draw.text((x, y), line, font=f, fill=fill)
            y += int(font_size * spacing)
            line = word
        else:
            line = attempt
    if line:
        draw.text((x, y), line, font=f, fill=fill)
        y += int(font_size * spacing)
    return y


def chrome(im: Image.Image, label: str, number: int):
    w, h, portrait, m = dims(im.size)
    d = ImageDraw.Draw(im)
    bar_y = 80 if portrait else 52
    d.rounded_rectangle((m, bar_y, m + (445 if portrait else 460), bar_y + 58), radius=26, fill="#263753")
    d.text((m + 27, bar_y + 12), "FRITZ INOVA  /  PILOTO", font=font(26, True), fill=CYAN)
    d.text((w - m - 90, bar_y + 15), f"{number:02d}/07", font=font(25, True), fill=MUTED)
    # Keep the landscape lower 200 px and the portrait subtitle band clear.
    footer_y = h - 245 if portrait else 133
    d.text((m, footer_y), label.upper(), font=font(24, True), fill=CYAN)
    d.line((m, footer_y + 46, w - m, footer_y + 46), fill="#566080", width=2)
    return d, m, portrait


def card(d, box, fill=INK2, outline="#57617E", radius=38, width=3):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def scene_1(size):
    im = gradient(size)
    w, h, p, m = dims(size)
    d, _, _ = chrome(im, "Cores esquemáticas · sem fotografia do produto", 1)
    title_y = 240 if p else 185
    text_lines(d, (m, title_y), "QUATRO CORES. UMA PERGUNTA.", w - 2 * m, 76 if p else 72, bold=True)
    d.text((m, title_y + (235 if p else 114)), "MacBook Neo", font=font(49 if p else 44, True), fill=CYAN)
    cols = [("PRATEADO", SILVER), ("BLUSH", PINK), ("AMARELO-CÍTRICO", YELLOW), ("ÍNDIGO", INDIGO)]
    if p:
        x0, y0, cw, ch, gap = m, 570, (w - 2*m - 28)//2, 290, 22
    else:
        x0, y0, cw, ch, gap = m, 465, (w - 2*m - 3*30)//4, 340, 30
    for i, (name, color) in enumerate(cols):
        col, row = (i % 2, i // 2) if p else (i, 0)
        x, y = x0 + col*(cw+gap), y0 + row*(ch+gap)
        card(d, (x, y, x+cw, y+ch), fill="#232A45", outline="#515B77")
        d.rounded_rectangle((x+24, y+24, x+cw-24, y+ch-94), radius=27, fill=color)
        d.text((x+25, y+ch-72), name, font=font(25 if p else 24, True), fill=WHITE)
    return im


def scene_3(size):
    im = gradient(size)
    w, h, p, m = dims(size)
    d, _, _ = chrome(im, "Medidas oficiais · ilustração editorial", 3)
    title_y = 250 if p else 190
    text_lines(d, (m, title_y), "O TAMANHO NO PAPEL", w-2*m, 75 if p else 76, bold=True)
    metrics = [("13″", "TELA"), ("1,23 kg", "PESO"), ("1,27 cm", "ESPESSURA")]
    if p:
        box_h, gap, start = 220, 24, 535
        for i, (value, name) in enumerate(metrics):
            y = start + i*(box_h+gap)
            card(d, (m, y, w-m, y+box_h))
            d.text((m+48, y+20), value, font=font(86, True), fill=[CYAN,PINK,YELLOW][i])
            d.text((m+53, y+151), name, font=font(31, True), fill=MUTED)
    else:
        gap, y, box_h = 34, 450, 380
        cw = (w-2*m-2*gap)//3
        for i, (value, name) in enumerate(metrics):
            x=m+i*(cw+gap)
            card(d, (x,y,x+cw,y+box_h))
            d.text((x+40,y+65),value,font=font(92 if i else 110,True),fill=[CYAN,PINK,YELLOW][i])
            d.text((x+43,y+266),name,font=font(32,True),fill=MUTED)
    return im


def scene_5(size):
    im = gradient(size)
    w, h, p, m = dims(size)
    d, _, _ = chrome(im, "Ficha técnica · fonte: Apple Brasil", 5)
    text_lines(d,(m,250 if p else 180),"DUAS CAPACIDADES. MESMA MEMÓRIA.",w-2*m,72 if p else 73,bold=True)
    if p:
        boxes=[(m,530,w-m,805),(m,832,w-m,1107)]
    else:
        gap=38; cw=(w-2*m-gap)//2
        boxes=[(m,425,m+cw,828),(m+cw+gap,425,w-m,828)]
    for i,(box,v) in enumerate(zip(boxes,["256 GB","512 GB"])):
        card(d,box,fill="#262D4C")
        x,y,_,_=box
        d.text((x+55,y+45),v,font=font(100 if p else 105,True),fill=CYAN if i==0 else PINK)
        d.text((x+58,y+(184 if p else 234)),"ARMAZENAMENTO",font=font(31,True),fill=MUTED)
    if p:
        d.text((m,1160),"AMBAS: 8 GB DE MEMÓRIA",font=font(41,True),fill=YELLOW)
    return im


def scene_6(size):
    im=gradient(size)
    w,h,p,m=dims(size)
    d,_,_=chrome(im,"Limitação · ficha técnica Apple Brasil",6)
    text_lines(d,(m,250 if p else 185),"DUAS USB-C. VELOCIDADES DIFERENTES.",w-2*m,73 if p else 76,bold=True)
    if p:
        boxes=[(m,535,w-m,820),(m,850,w-m,1135)]
    else:
        gap=40;cw=(w-2*m-gap)//2
        boxes=[(m,450,m+cw,830),(m+cw+gap,450,w-m,830)]
    for i,(box,name,sub,color) in enumerate(zip(boxes,["USB 3","USB 2"],["ATÉ 10 Gb/s","ATÉ 480 Mb/s"],[CYAN,PINK])):
        card(d,box)
        x,y,_,_=box
        d.rounded_rectangle((x+48,y+48,x+188,y+97),radius=24,outline=color,width=9)
        d.text((x+48,y+(119 if p else 142)),name,font=font(94 if p else 105,True),fill=color)
        d.text((x+52,y+(224 if p else 277)),sub,font=font(32,True),fill=MUTED)
    return im


def scene_7(size):
    im=gradient(size)
    w,h,p,m=dims(size)
    d,_,_=chrome(im,"Interação orgânica · sem oferta ou link",7)
    text_lines(d,(m,280 if p else 195),"QUAL COR VOCÊ USARIA?",w-2*m,88 if p else 94,bold=True)
    colors=[SILVER,PINK,YELLOW,INDIGO]
    if p:
        y=590;gap=30;cw=(w-2*m-3*gap)//4
        for i,c in enumerate(colors):d.rounded_rectangle((m+i*(cw+gap),y,m+i*(cw+gap)+cw,y+290),radius=48,fill=c)
        d.text((m,960),"PRATEADO · BLUSH",font=font(38,True),fill=WHITE)
        d.text((m,1025),"CÍTRICO · ÍNDIGO",font=font(38,True),fill=WHITE)
        d.text((m,1140),"CONTE NOS COMENTÁRIOS",font=font(41,True),fill=CYAN)
    else:
        y=540;gap=32;cw=(w-2*m-3*gap)//4
        for i,c in enumerate(colors):d.rounded_rectangle((m+i*(cw+gap),y,m+i*(cw+gap)+cw,y+265),radius=38,fill=c)
    return im


PEXELS = {
    2: (8062404, "https://www.pexels.com/photo/laptop-on-white-wooden-desk-8062404/", "Nataliya Vaitkevich"),
    4: (8004008, "https://www.pexels.com/photo/laptop-and-smartphone-on-a-white-table-8004008/", "Darina Belonogova"),
}


def scene_photo(scene: int, size: tuple[int,int], raw: Image.Image):
    w,h=size
    # Keep the desk or the full 9:16 photo visible. Crop is deliberately reviewed in both ratios.
    centering=(.5,.43) if scene==2 else (.5,.5)
    im=ImageOps.fit(raw.convert("RGB"),size,method=Image.Resampling.LANCZOS,centering=centering).convert("RGBA")
    shade=Image.new("RGBA",size,(0,0,0,0));sd=ImageDraw.Draw(shade)
    sd.rectangle((0,0,w,int(h*.26)),fill=(8,13,29,195))
    sd.rectangle((0,int(h*.72),w,h),fill=(8,13,29,205))
    im=Image.alpha_composite(im,shade)
    d,m,p=chrome(im,"Foto ilustrativa · Pexels",scene)
    title="ESTUDO, TRABALHO, MOBILIDADE" if scene==2 else "UM NOTEBOOK NA ROTINA"
    text_lines(d,(m,250 if p else 200),title,w-2*m,72 if p else 77,bold=True)
    d.text((m,h-(315 if p else 240)),"FOTO ILUSTRATIVA · NÃO É O MACBOOK NEO",font=font(26 if p else 31,True),fill=WHITE)
    return im


def main():
    manifest=[]
    originals={1:scene_1,3:scene_3,5:scene_5,6:scene_6,7:scene_7}
    for scene in range(1,8):
        raw=None
        if scene in PEXELS:
            pid,source,author=PEXELS[scene]
            photo=CACHE/f"source-pexels-{pid}.jpg"
            if not photo.exists():
                url=f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?auto=compress&cs=tinysrgb&w=2600"
                with urlopen(Request(url,headers={"User-Agent":"Mozilla/5.0"}),timeout=30) as response:
                    photo.write_bytes(response.read())
            raw=Image.open(photo)
        for orientation,size in SIZES.items():
            im=scene_photo(scene,size,raw) if raw is not None else originals[scene](size)
            path=OUT/f"scene-{scene:02d}-{orientation}.png"
            im.convert("RGB").save(path,optimize=True)
            entry={"scene_order":scene-1,"orientation":orientation,"file":path.name,
                   "sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
                   "license":"pexels" if raw is not None else "own",
                   "source":"pexels" if raw is not None else "system"}
            if raw is not None:
                entry.update({"source_url":source,"author":author,"pexels_photo_id":pid})
            else:
                entry.update({"source_url":"https://www.apple.com/br/macbook-neo/specs/","editorial_note":"Original infographic; source URL verifies facts, not image rights."})
            manifest.append(entry)
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Created {len(manifest)} images and manifest in {OUT}")


if __name__=="__main__":
    main()
