from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "outputs" / "wechat"
OUTPUT_PATH = OUTPUT_DIR / "2026-04-07-us-hotspot-chart.png"

WIDTH = 1080
HEIGHT = 1920

FONT_TITLE = r"C:\Windows\Fonts\simhei.ttf"
FONT_BODY = r"C:\Windows\Fonts\simsun.ttc"


SECTIONS = [
    {
        "tag": "贸易",
        "title": "保护主义继续深化",
        "body": "美国正把关税工具从传统制造业扩展到药品等战略产业，核心目标是供应链回流、关键环节本土化。",
        "accent": "#FF8A3D",
    },
    {
        "tag": "外交",
        "title": "对外施压更偏强硬",
        "body": "中东、伊朗、俄乌方向都体现出“先施压、后谈判”的做法，美国更强调用威慑换筹码。",
        "accent": "#FF5D73",
    },
    {
        "tag": "经济",
        "title": "增长仍在 但通胀风险回升",
        "body": "经济暂未失速，但能源价格、关税压力和财政赤字叠加，让通胀与利率路径重新变得敏感。",
        "accent": "#3AA6FF",
    },
    {
        "tag": "安全",
        "title": "欧洲与中东仍是主战场",
        "body": "美国没有退出全球安全事务，而是在要求盟友分担更多成本的同时，继续掌控议程和节奏。",
        "accent": "#67D58C",
    },
]


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size)


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines():
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for char in paragraph:
            trial = current + char
            if font.getbbox(trial)[2] <= max_width or not current:
                current = trial
                continue
            lines.append(current)
            current = char
        if current:
            lines.append(current)
    return lines


def rgba(color: str, alpha: int) -> tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(color)
    return r, g, b, alpha


def build_background() -> Image.Image:
    image = Image.new("RGBA", (WIDTH, HEIGHT), "#08111E")
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        ratio = y / HEIGHT
        r = int(8 + (20 - 8) * ratio)
        g = int(17 + (36 - 17) * ratio)
        b = int(30 + (74 - 30) * ratio)
        draw.line((0, y, WIDTH, y), fill=(r, g, b, 255))

    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-120, -40, 500, 540), fill=rgba("#FF8A3D", 72))
    gd.ellipse((560, 220, 1180, 920), fill=rgba("#3AA6FF", 64))
    gd.ellipse((200, 1280, 980, 2060), fill=rgba("#67D58C", 52))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    image.alpha_composite(glow)
    return image


def draw_card(draw: ImageDraw.ImageDraw, top: int, section: dict[str, str]) -> None:
    left = 64
    right = WIDTH - 64
    bottom = top + 280
    accent = section["accent"]
    draw.rounded_rectangle(
        (left, top, right, bottom),
        radius=36,
        fill=(10, 16, 28, 216),
        outline=(255, 255, 255, 24),
        width=2,
    )
    draw.rounded_rectangle((left + 28, top + 26, left + 168, top + 74), radius=20, fill=accent)
    draw.text((left + 52, top + 35), section["tag"], font=load_font(FONT_TITLE, 26), fill="white")
    draw.text((left + 28, top + 102), section["title"], font=load_font(FONT_TITLE, 44), fill="white")

    body_font = load_font(FONT_BODY, 32)
    lines = wrap_text(section["body"], body_font, right - left - 56)
    y = top + 170
    for line in lines:
        draw.text((left + 28, y), line, font=body_font, fill="#D6E2F3")
        y += 44

    draw.rounded_rectangle((right - 20, top + 28, right - 10, bottom - 28), radius=5, fill=accent)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    image = build_background()
    draw = ImageDraw.Draw(image)

    title_font = load_font(FONT_TITLE, 84)
    subtitle_font = load_font(FONT_BODY, 36)
    note_font = load_font(FONT_BODY, 28)

    draw.text((72, 88), "美国当前动向", font=title_font, fill="white")
    draw.text((72, 184), "事件热点图", font=title_font, fill="#D7E6FF")
    draw.text((72, 286), "截至 2026-04-07", font=subtitle_font, fill="#92A6C8")

    draw.rounded_rectangle((72, 356, WIDTH - 72, 542), radius=40, fill=(255, 255, 255, 18))
    draw.text((104, 396), "一句话判断", font=load_font(FONT_TITLE, 42), fill="#FFD166")
    summary = "外部更强硬，贸易更保护，内部则在稳增长、控通胀和防债务风险之间走钢丝。"
    for i, line in enumerate(wrap_text(summary, load_font(FONT_BODY, 36), WIDTH - 208)):
        draw.text((104, 458 + i * 48), line, font=load_font(FONT_BODY, 36), fill="white")

    top = 592
    gap = 36
    for section in SECTIONS:
        draw_card(draw, top, section)
        top += 280 + gap

    footer_top = HEIGHT - 220
    draw.rounded_rectangle((72, footer_top, WIDTH - 72, HEIGHT - 72), radius=34, fill=(7, 12, 22, 210))
    draw.text((100, footer_top + 34), "关注后续", font=load_font(FONT_TITLE, 38), fill="#9DD9D2")
    footer_lines = [
        "1. 新一轮关税与供应链回流政策是否继续扩大",
        "2. 中东局势是否推高油价并反向抬升美国通胀",
        "3. 美联储会否因价格压力延后降息或重提加息",
    ]
    for idx, line in enumerate(footer_lines):
        draw.text((100, footer_top + 92 + idx * 40), line, font=note_font, fill="#D5E0F2")

    image.convert("RGB").save(OUTPUT_PATH, quality=95)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
