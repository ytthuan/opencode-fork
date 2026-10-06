"""Deterministic identity derivatives. Run from repository root with Pillow installed."""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[3]
folder = root / "output/imagegen/apple-identity"
source = Image.open(folder / "02-fold.png").convert("RGB")
assert source.size == (1024, 1024)

# Keep generated pixels within the tile; extend its blue backdrop into the
# corners for opaque iOS/adaptive originals. A deterministic high-resolution
# mask provides clean alpha rather than retaining the generated gray backdrop.
mask = Image.new("L", (4096, 4096))
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 4095, 4095), radius=880, fill=255)
mask = mask.resize(source.size, Image.Resampling.LANCZOS)
colors = [source.getpixel(p) for p in [(240, 1), (784, 1), (240, 1022), (784, 1022)]]
backdrop = Image.new("RGB", source.size)
backdrop.putdata([
    tuple(round((1-y/1023)*((1-x/1023)*colors[0][c]+x/1023*colors[1][c])
                +y/1023*((1-x/1023)*colors[2][c]+x/1023*colors[3][c])) for c in range(3))
    for y in range(1024) for x in range(1024)
])
full = Image.composite(source, backdrop, mask)
tile = full.convert("RGBA")
tile.putalpha(mask)
tile.save(folder / "selected-icon.png", optimize=True)
full.save(folder / "selected-square.png", optimize=True)

# Standard macOS inset: the tile occupies 84% of the transparent canvas.
desktop = Image.new("RGBA", (1024, 1024))
desktop.alpha_composite(tile.resize((860, 860), Image.Resampling.LANCZOS), (82, 82))

baseline = json.loads((folder / "baseline.json").read_text())
for item in baseline:
    path = root / item["path"]
    if not (item["path"].startswith("packages/desktop/icons/") or item["path"].startswith("packages/desktop/resources/icons/")):
        continue
    size = tuple(item["size"])
    image = desktop
    if "/ios/" in item["path"]:
        image = full
    if "/android/" in item["path"]:
        image = full
        if "foreground" in path.name:
            image = Image.new("RGBA", (1024, 1024))
            image.alpha_composite(tile.resize((640, 640), Image.Resampling.LANCZOS), (192, 192))
        if "round" in path.name:
            image = full.convert("RGBA")
            circle = Image.new("L", (4096, 4096))
            ImageDraw.Draw(circle).ellipse((0, 0, 4095, 4095), fill=255)
            image.putalpha(circle.resize((1024, 1024), Image.Resampling.LANCZOS))
    if path.suffix == ".png":
        image.resize(size, Image.Resampling.LANCZOS).save(path, optimize=True)
    if path.suffix == ".ico":
        desktop.save(path, format="ICO", sizes=[(s, s) for s in [16, 24, 32, 48, 64, 128, 256]])
    if path.suffix == ".icns":
        desktop.save(path, format="ICNS")

identity = root / "packages/ui/src/assets/identity"
for name, size in [("emblem.png", 128), ("favicon-96.png", 96), ("apple-touch-icon.png", 180)]:
    image = full if name == "apple-touch-icon.png" else tile
    image.resize((size, size), Image.Resampling.LANCZOS).save(identity / name, optimize=True)
tile.save(identity / "favicon.ico", format="ICO", sizes=[(s, s) for s in [16, 24, 32, 48, 64]])

# Opaque install icons preserve the blue background when platforms apply their mask.
for size in [192, 512]:
    path = root / f"packages/ui/src/assets/favicon/web-app-manifest-{size}x{size}.png"
    full.resize((size, size), Image.Resampling.LANCZOS).save(path, optimize=True)
    if not any(item["path"] == str(path.relative_to(root)) for item in baseline):
        baseline.append({"path": str(path.relative_to(root)), "size": [size, size]})

# Preserve the consuming components' 3:2 dimensions, while eliminating the old
# rectangular artwork. Both themes use the exact same transparent identity.
welcome = Image.new("RGBA", (768, 512))
welcome.alpha_composite(tile.resize((448, 448), Image.Resampling.LANCZOS), (160, 32))
for theme in ["light", "dark"]:
    welcome.save(identity / f"welcome-{theme}.webp", lossless=True, method=6)
    preview = Image.new("RGBA", welcome.size, "#f9fafb" if theme == "light" else "#15171e")
    preview.alpha_composite(welcome)
    preview.convert("RGB").save(folder / f"welcome-{theme}.png", optimize=True)

# Review all concepts at native small sizes and show the selected direction.
sheet = Image.new("RGB", (960, 440), "#e9ecf4")
draw = ImageDraw.Draw(sheet)
for i, name in enumerate(["01-current", "02-fold", "03-offset"]):
    image = Image.open(folder / f"{name}.png").convert("RGB")
    sheet.paste(image.resize((256, 256), Image.Resampling.LANCZOS), (32+320*i, 24))
    draw.text((32+320*i, 293), name + (" / selected" if i == 1 else ""), fill="#202538",
              font=ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18))
    for j, size in enumerate([16, 32, 64]):
        sheet.paste(image.resize((size, size), Image.Resampling.LANCZOS), (32+320*i+j*90, 338))
        draw.text((32+320*i+j*90, 411), f"{size}px", fill="#202538")
sheet.save(folder / "contact-sheet.png", optimize=True)

records = []
for item in baseline:
    path = root / item["path"]
    with Image.open(path) as image:
        image.load()
        assert list(image.size) == item["size"], (path, image.size, item["size"])
        if path.suffix == ".ico":
            for size in image.ico.sizes():
                image.ico.getimage(size).load()
        if path.suffix == ".icns":
            for size in image.info["sizes"]:
                image.size = size
                image.load()
        if "/ios/" in item["path"]:
            assert "A" not in image.getbands(), path
        if path.name == "emblem.png":
            assert image.getpixel((0, 0))[3] == 0
    records.append({"path": item["path"], "size": item["size"], "bytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
logos = json.loads((folder / "provider-baseline.json").read_text())
assert all(hashlib.sha256((root / path).read_bytes()).hexdigest() == checksum for path, checksum in logos.items())
packaging = [item for item in records if item["path"].startswith("packages/desktop/")]
qa = {"selected": "02-fold.png", "model": "gpt-image-2", "quality": "high", "source_size": [1024, 1024],
      "derivatives": len(records), "provider_logos_unchanged": len(logos),
      "packaging_bytes": sum(item["bytes"] for item in packaging), "files": records,
      "settings": {"rounding_radius": 220, "desktop_inset": 82, "resampling": "LANCZOS",
                   "welcome_size": [768, 512], "welcome_tile_size": [448, 448], "webp": "lossless, method=6"}}
(folder / "asset-qa.json").write_text(json.dumps(qa, indent=2) + "\n")
(folder / "checksums.sha256").write_text("".join(
    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(root)}\n"
    for path in sorted(folder.iterdir()) if path.is_file() and path.name != "checksums.sha256"
) + "".join(f"{item['sha256']}  {item['path']}\n" for item in records))
print(json.dumps({key: value for key, value in qa.items() if key != "files"}, indent=2))
