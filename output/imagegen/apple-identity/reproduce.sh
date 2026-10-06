#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
/opt/homebrew/opt/python@3.14/bin/python3.14 /Users/leomacmini/.codex/skills/.system/imagegen/scripts/image_gen.py generate-batch --input output/imagegen/apple-identity/prompts.jsonl --out-dir output/imagegen/apple-identity --concurrency 3 --model gpt-image-2 --no-augment
/opt/homebrew/opt/python@3.14/bin/python3.14 output/imagegen/apple-identity/derive.py
