#!/usr/bin/env python3
"""
Картинки для README из скриншотов витрины.

Скриншоты снимаются Playwright в 2x; здесь они уменьшаются до 1440 px для
статичных кадров и собираются в анимированный обзор (GIF). Инструмент
для разработчика: нужен Pillow (`pip3 install --user pillow`).

Использование:
    SHOTS_DIR=/tmp/shots pnpm --filter @resolvr/desktop shots
    python3 scripts/readme-media.py /tmp/shots
"""
import sys
from pathlib import Path

from PIL import Image

STILLS = {
    'main-dark': 'hero-dark.png',
    'main-light': 'hero-light.png',
    'schema-user': 'schema-browser.png',
    'report': 'flows-report.png',
    'search': 'response-search.png',
}
TOUR = ['main-dark', 'search', 'schema-user', 'flow', 'report', 'palette']
STILL_WIDTH = 1440
GIF_WIDTH = 1100
FRAME_MS = 2600


def resize(image: Image.Image, width: int) -> Image.Image:
    ratio = width / image.width
    return image.convert('RGB').resize((width, round(image.height * ratio)), Image.LANCZOS)


def main(source: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)

    for name, output in STILLS.items():
        image = Image.open(source / f'{name}.png')
        resize(image, STILL_WIDTH).save(target / output, optimize=True)
        print('still:', output)

    frames = [resize(Image.open(source / f'{name}.png'), GIF_WIDTH) for name in TOUR]
    # Одна палитра на все кадры: иначе каждый кадр квантуется по-своему и
    # фон «дышит» между кадрами.
    palette = frames[0].quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    quantized = [frame.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG) for frame in frames]
    quantized[0].save(
        target / 'tour.gif',
        save_all=True,
        append_images=quantized[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=True,
    )
    print('gif: tour.gif', (target / 'tour.gif').stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(Path(sys.argv[1]), Path(__file__).resolve().parent.parent / 'docs' / 'screenshots')
