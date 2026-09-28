"""Placeholder app icons (docs/plans/S8_LAUNCH.md, decision G): the name's initial in white
on the brand blue. Replace them with a designed icon before the store submission; this
script only exists so test builds don't carry Expo's default. Run: python3 scripts/placeholder-icons.py"""

import json
import pathlib

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parents[1]
BRAND = "#1F4FD8"
FONT = HERE / "node_modules/@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf"
LETTER = json.loads((HERE / "app.json").read_text())["expo"]["name"][0].upper()
OUT = HERE / "assets/images"


def letter(size, scale, colour, background=None):
    """The letter centred on a square of `size`, filling `scale` of it."""
    image = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), int(size * scale))
    left, top, right, bottom = draw.textbbox((0, 0), LETTER, font=font)
    draw.text(((size - (right - left)) / 2 - left, (size - (bottom - top)) / 2 - top), LETTER, font=font, fill=colour)
    return image


letter(1024, 0.56, "white", BRAND).save(OUT / "icon.png")
# Android's adaptive icon: the letter inside the 66% safe zone, on its own blue layer.
letter(512, 0.36, "white").save(OUT / "android-icon-foreground.png")
Image.new("RGBA", (512, 512), BRAND).save(OUT / "android-icon-background.png")
letter(432, 0.36, "white").save(OUT / "android-icon-monochrome.png")
letter(228, 0.8, "white").save(OUT / "splash-icon.png")
letter(48, 0.62, "white", BRAND).save(OUT / "favicon.png")
print(f"Placeholder icons for “{LETTER}” written to {OUT}")
