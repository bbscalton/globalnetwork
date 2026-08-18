"""Generate GN launcher icons and TWA splash from the shared globe logo."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
LOGO = REPO / "customer-app" / "assets" / "logo-gn.png"
RES = ROOT / "app" / "src" / "main" / "res"
NAVY = (5, 8, 22, 255)
WHITE = (226, 232, 240, 255)
CYAN = (34, 211, 238, 255)


def load_logo() -> Image.Image:
    img = Image.open(LOGO).convert("RGBA")
    return img


def fit_logo(logo: Image.Image, size: int, pad_ratio: float = 0.08) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), NAVY)
    inner = int(size * (1 - pad_ratio * 2))
    scaled = logo.copy()
    scaled.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    x = (size - scaled.width) // 2
    y = (size - scaled.height) // 2
    canvas.alpha_composite(scaled, (x, y))
    return canvas


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    path = Path(r"C:\Windows\Fonts") / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def make_splash(logo: Image.Image) -> Image.Image:
    w, h = 1080, 1920
    img = Image.new("RGBA", (w, h), NAVY)
    draw = ImageDraw.Draw(img)
    mark = fit_logo(logo, 560, pad_ratio=0.04)
    img.alpha_composite(mark, ((w - mark.width) // 2, 430))
    title = font(64, bold=True)
    tag = font(36, bold=False)
    title_text = "GlobalNetwork Desk"
    tag_text = "Owner desk  ·  Antigua"
    tb = draw.textbbox((0, 0), title_text, font=title)
    gb = draw.textbbox((0, 0), tag_text, font=tag)
    draw.text(((w - (tb[2] - tb[0])) / 2, 1040), title_text, font=title, fill=WHITE)
    draw.text(((w - (gb[2] - gb[0])) / 2, 1130), tag_text, font=tag, fill=CYAN)
    return img


def main() -> None:
    logo = load_logo()
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, size in densities.items():
        square = fit_logo(logo, size)
        save_png(square, RES / folder / "ic_launcher.png")
        round_icon = square.copy()
        round_icon.putalpha(circle_mask(size))
        bg = Image.new("RGBA", (size, size), NAVY)
        bg.alpha_composite(round_icon)
        save_png(bg, RES / folder / "ic_launcher_round.png")

    # Adaptive foreground: logo inset so the globe survives the mask.
    fg = fit_logo(logo, 432, pad_ratio=0.18)
    save_png(fg, RES / "drawable" / "ic_launcher_foreground.png")
    save_png(make_splash(logo), RES / "drawable" / "splash.png")
    print("wrote launcher icons and splash")


if __name__ == "__main__":
    main()
