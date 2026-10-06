# Fold identity

Original generated artwork for the OpenCode v2 fork: a pearl folded sail on a blue/violet rounded square. The chosen direction was reviewed at 16, 32 and 64 pixels. It replaces the rejected ceramic loop; provider logos remain unchanged.

`02-fold.png` is the unmodified selected 1024px generation. `selected-icon.png` is its finished transparent master; `selected-square.png` is the opaque install master. The other candidates, their prompts and contact sheet document selection. Generation used the bundled imagegen CLI with `gpt-image-2` at high quality on October 6, 2026.

To reproduce sizing, transparency, platform icons and welcome images from the retained source, run from the repository root with Pillow installed:

```sh
python3 output/imagegen/apple-identity/derive.py
shasum -a 256 -c output/imagegen/apple-identity/checksums.sha256
```

`reproduce.sh` additionally reruns the imagegen CLI and requires its configured API credentials. Generated candidates may differ on a new run. Derivative generation is deterministic for the retained source.

`baseline.json` preserves platform dimensions. `provider-baseline.json` protects 105 provider logos. `asset-qa.json` records 212 decoded assets, embedded ICO/ICNS families, opaque iOS/PWA install icons and hashes. Desktop icons use a transparent 82px inset; installed web icons use opaque 192px/512px images.

Consumers include the new-session artwork, native startup splash, UI/browser favicons, native notification icon, web installation manifest, desktop Dock/installer icons and existing Android/iOS packaging asset families. Mobile packaging files are supplied; this work did not build an iOS or Android app.
