from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "outputs" / "wechat"
VIDEO_PATH = OUTPUT_DIR / "2026-04-07-global-hot-brief.mp4"
AUDIO_MP3_PATH = OUTPUT_DIR / "2026-04-07-global-hot-brief-voice.mp3"
FINAL_VIDEO_PATH = OUTPUT_DIR / "2026-04-07-global-hot-brief-voiced.mp4"

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+8%"
VOLUME = "+0%"

SCRIPT_TEXT = """
今天是二零二六年四月七日，国际新闻热点快报。

第一条，全球市场继续盯住美国关税变化。
多家国际媒体持续追踪美国贸易政策新动作，市场关注点集中在全球供应链、主要股指波动，以及能源、航运与制造业成本的连锁反应。

第二条，加沙局势与人道援助仍是国际焦点。
截至四月七日，加沙地带冲突和援助进入问题仍被持续报道。国际社会一边推动停火谈判，一边关注平民伤亡、医疗补给和跨境救援通道能否稳定运行。

第三条，俄乌前线仍在拉锯，欧洲安全议题升温。
俄乌双方互袭和空防压力依旧是当天报道重点。乌方继续争取外部援助，欧洲多国则同步讨论军援节奏、能源安全与地区防务准备。

以上是今天的国际热点快报。
""".strip()


async def synthesize() -> None:
    import edge_tts

    communicate = edge_tts.Communicate(
        SCRIPT_TEXT,
        VOICE,
        rate=RATE,
        volume=VOLUME,
    )
    await communicate.save(str(AUDIO_MP3_PATH))


def mux_video() -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(VIDEO_PATH),
        "-i",
        str(AUDIO_MP3_PATH),
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        str(FINAL_VIDEO_PATH),
    ]
    subprocess.run(command, check=True)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    asyncio.run(synthesize())
    mux_video()
    print(FINAL_VIDEO_PATH)


if __name__ == "__main__":
    main()
