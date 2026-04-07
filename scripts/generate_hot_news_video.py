from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


WIDTH = 720
HEIGHT = 1280
FPS = 12

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "outputs" / "wechat"
OUTPUT_PATH = OUTPUT_DIR / "2026-04-07-global-hot-brief.mp4"

FONT_TITLE = r"C:\Windows\Fonts\simhei.ttf"
FONT_BODY = r"C:\Windows\Fonts\simsun.ttc"


@dataclass(frozen=True)
class Slide:
    label: str
    title: str
    body: str
    accent: str
    duration: float


SLIDES: list[Slide] = [
    Slide(
        label="今日热点快报",
        title="国际新闻三分钟速览",
        body="整理时间：2026-04-07\n聚焦关税、加沙、俄乌三条主线",
        accent="#F25F5C",
        duration=6.0,
    ),
    Slide(
        label="热点 01",
        title="全球市场继续盯住美国关税变化",
        body=(
            "多家国际媒体持续追踪美国贸易政策新动作。\n"
            "市场关注点集中在全球供应链、主要股指波动，\n"
            "以及能源、航运与制造业成本的连锁反应。"
        ),
        accent="#FF9F1C",
        duration=14.0,
    ),
    Slide(
        label="热点 02",
        title="加沙局势与人道援助仍是国际焦点",
        body=(
            "截至 4 月 7 日，加沙地带冲突和援助进入问题仍被持续报道。\n"
            "国际社会一边推动停火谈判，一边关注平民伤亡、\n"
            "医疗补给和跨境救援通道能否稳定运行。"
        ),
        accent="#2EC4B6",
        duration=14.0,
    ),
    Slide(
        label="热点 03",
        title="俄乌前线仍在拉锯  欧洲安全议题升温",
        body=(
            "俄乌双方互袭和空防压力依旧是当天报道重点。\n"
            "乌方继续争取外部援助，欧洲多国则同步讨论\n"
            "军援节奏、能源安全与地区防务准备。"
        ),
        accent="#5E60CE",
        duration=14.0,
    ),
    Slide(
        label="持续关注",
        title="后续重点：谈判、援助、市场波动",
        body="如需下一版，我可以继续扩成配音版、字幕版或横屏版。",
        accent="#43AA8B",
        duration=10.0,
    ),
]


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size)


def hex_rgba(value: str, alpha: int) -> tuple[int, int, int, int]:
    rgb = ImageColor.getrgb(value)
    return rgb[0], rgb[1], rgb[2], alpha


def ease_out_cubic(t: float) -> float:
    return 1 - pow(1 - t, 3)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines():
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for char in paragraph:
            candidate = current + char
            width = font.getbbox(candidate)[2]
            if width <= max_width or not current:
                current = candidate
                continue
            lines.append(current)
            current = char
        if current:
            lines.append(current)
    return lines


def draw_gradient_background(accent: str, frame_index: int, total_frames: int) -> Image.Image:
    base = Image.new("RGBA", (WIDTH, HEIGHT), "#09111F")
    draw = ImageDraw.Draw(base)
    progress = frame_index / max(total_frames - 1, 1)
    shift = int(90 * math.sin(progress * math.pi * 2))

    for y in range(HEIGHT):
        ratio = y / HEIGHT
        r = int(lerp(10, 31, ratio))
        g = int(lerp(18, 40, ratio))
        b = int(lerp(33, 72, ratio))
        draw.line((0, y, WIDTH, y), fill=(r, g, b, 255))

    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    o = ImageDraw.Draw(overlay)
    o.ellipse((-120 + shift, 80, 360 + shift, 560), fill=hex_rgba(accent, 100))
    o.ellipse((300 - shift, 720, 860 - shift, 1320), fill=(30, 144, 255, 60))
    o.rounded_rectangle((36, 36, WIDTH - 36, HEIGHT - 36), radius=42, outline=(255, 255, 255, 28), width=2)
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=36))
    base.alpha_composite(overlay)
    return base


def draw_slide(slide: Slide, local_t: float, frame_index: int, total_frames: int) -> Image.Image:
    image = draw_gradient_background(slide.accent, frame_index, total_frames)
    draw = ImageDraw.Draw(image)

    title_font = load_font(FONT_TITLE, 48)
    label_font = load_font(FONT_TITLE, 24)
    body_font = load_font(FONT_BODY, 30)
    small_font = load_font(FONT_BODY, 24)

    appear = ease_out_cubic(clamp(local_t / 0.22, 0.0, 1.0))
    card_y = int(lerp(720, 230, appear))
    card_alpha = int(lerp(0, 235, appear))

    card = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    card_draw = ImageDraw.Draw(card)
    card_draw.rounded_rectangle(
        (54, card_y, WIDTH - 54, 1030),
        radius=34,
        fill=(8, 14, 24, card_alpha),
        outline=(255, 255, 255, 22),
        width=2,
    )
    card_draw.rounded_rectangle(
        (78, card_y + 38, 252, card_y + 88),
        radius=18,
        fill=hex_rgba(slide.accent, 225),
    )
    image.alpha_composite(card)

    draw.text((96, card_y + 47), slide.label, font=label_font, fill="white")

    draw.text((78, 126), "GLOBAL WATCH", font=label_font, fill=hex_rgba(slide.accent, 255))
    draw.text((78, 176), "WORLD NEWS", font=load_font(FONT_TITLE, 74), fill="white")
    draw.text((78, 258), "HOT BRIEF", font=load_font(FONT_TITLE, 74), fill="#D7E3FC")

    title_y = card_y + 132
    draw.text((78, title_y), slide.title, font=title_font, fill="white")

    wrapped = wrap_text(slide.body, body_font, WIDTH - 156)
    line_y = title_y + 96
    for line in wrapped:
        draw.text((78, line_y), line, font=body_font, fill="#D9E2F2")
        line_y += 46

    progress = clamp(local_t, 0.0, 1.0)
    bar_x1 = 78
    bar_x2 = WIDTH - 78
    bar_y = 1108
    draw.rounded_rectangle((bar_x1, bar_y, bar_x2, bar_y + 16), radius=8, fill=(255, 255, 255, 28))
    draw.rounded_rectangle(
        (bar_x1, bar_y, int(lerp(bar_x1, bar_x2, progress)), bar_y + 16),
        radius=8,
        fill=slide.accent,
    )

    draw.text((78, 1160), "来源整理：Reuters / AP / BBC / Al Jazeera 持续报道线索", font=small_font, fill="#AAB7CF")
    draw.text((78, 1196), "注：本视频为摘要快报，适合先看脉络，再展开追踪。", font=small_font, fill="#91A2C2")
    return image


def build_video() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    total_frames = sum(int(slide.duration * FPS) for slide in SLIDES)
    frame_cursor = 0

    with imageio.get_writer(
        OUTPUT_PATH,
        fps=FPS,
        codec="libx264",
        format="FFMPEG",
        ffmpeg_log_level="error",
        quality=8,
        pixelformat="yuv420p",
    ) as writer:
        for slide in SLIDES:
            slide_frames = int(slide.duration * FPS)
            for frame_in_slide in range(slide_frames):
                local_t = frame_in_slide / max(slide_frames - 1, 1)
                frame = draw_slide(slide, local_t, frame_cursor, total_frames).convert("RGB")
                writer.append_data(np.asarray(frame))
                frame_cursor += 1


if __name__ == "__main__":
    build_video()
    print(OUTPUT_PATH)
