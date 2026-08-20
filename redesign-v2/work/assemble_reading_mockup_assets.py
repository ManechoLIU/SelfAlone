from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


CANVAS = (1440, 1024)


def match_reference_paper(canvas: Image.Image) -> None:
    pixels = canvas.load()
    for y in range(canvas.height):
        for x in range(203, canvas.width):
            r, g, b = pixels[x, y]
            if min(r, g, b) >= 242 and max(r, g, b) - min(r, g, b) <= 8:
                pixels[x, y] = (max(0, r - 9), max(0, g - 5), max(0, b - 4))


def feathered_patch(
    canvas: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    destination: tuple[int, int],
    feather: int,
) -> None:
    patch = source.crop(box)
    mask = Image.new("L", patch.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(
        (feather, feather, patch.width - feather - 1, patch.height - feather - 1),
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    canvas.paste(patch, destination, mask)


def replace_sidebar_bottom(canvas: Image.Image, reference: Image.Image) -> None:
    x0, y0, x1, y1 = 0, 440, 203, CANVAS[1]
    patch = reference.crop((x0, y0, x1, y1))
    mask = Image.new("L", patch.size, 255)
    draw = ImageDraw.Draw(mask)
    for y in range(28):
        draw.line((0, y, patch.width, y), fill=round(255 * y / 27))
    canvas.paste(patch, (x0, y0), mask)


def paste_avatar(canvas: Image.Image, avatar_path: Path) -> None:
    size = 76
    avatar = Image.open(avatar_path).convert("RGB").resize(
        (size, size), Image.Resampling.LANCZOS
    )
    high_res_mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(high_res_mask).ellipse(
        (0, 0, size * 4 - 1, size * 4 - 1), fill=255
    )
    mask = high_res_mask.resize((size, size), Image.Resampling.LANCZOS)
    canvas.paste(avatar, (18, 43), mask)


def draw_chat_bubble(canvas: Image.Image) -> None:
    x, y, size = 1320, 927, 44
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((x, y, x + size, y + size), fill="#006B5A")

    left, top, right, bottom = x + 11, y + 11, x + 33, y + 29
    draw.rounded_rectangle(
        (left, top, right, bottom), radius=7, outline="#FFFFFF", width=2
    )
    draw.polygon(
        ((left + 5, bottom - 1), (left + 3, bottom + 5), (left + 10, bottom - 1)),
        fill="#006B5A",
        outline="#FFFFFF",
    )
    for dot_x in (left + 7, left + 11, left + 15):
        draw.ellipse((dot_x, top + 8, dot_x + 2, top + 10), fill="#FFFFFF")


def assemble(
    input_path: Path, reference_path: Path, avatar_path: Path, output_path: Path
) -> None:
    canvas = Image.open(input_path).convert("RGB").resize(CANVAS, Image.Resampling.LANCZOS)
    reference = (
        Image.open(reference_path)
        .convert("RGB")
        .resize(CANVAS, Image.Resampling.LANCZOS)
    )

    match_reference_paper(canvas)
    replace_sidebar_bottom(canvas, reference)
    paste_avatar(canvas, avatar_path)

    # Exact approved sitting-reading mascot pixels from the reference image.
    # The crop ends before the reference bubble so the final bubble can keep a 6–8 px gap.
    feathered_patch(canvas, reference, (1144, 793, 1323, 1024), (1144, 793), feather=8)
    draw_chat_bubble(canvas)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--avatar", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assemble(args.input, args.reference, args.avatar, args.output)


if __name__ == "__main__":
    main()
