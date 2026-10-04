# UI fonts

`fusion-pixel-12px-mono-zh-hans-subset.woff2` is a subset of
[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)'s
**12px Monospaced zh-Hans** face, used for the Simplified Chinese UI. It is
licensed under the SIL Open Font License 1.1 (see `OFL.txt`); component font
licenses are in `LICENSES/`. The subset is limited to the glyphs the game
currently uses, which keeps it at ~26 KB.

The English UI does not load this font (it stays on the system monospace stack).

## Regenerating the subset

When new Chinese strings are added, regenerate the subset so the new glyphs are
included:

```bash
# 1. download the release (the ttf.woff2 zip) from
#    https://github.com/TakWolf/fusion-pixel-font/releases
# 2. collect the characters used by the translated sources
node -e "
const fs = require('fs');
let txt = '';
for (const f of ['src/ui/lang/zh-content.js','src/ui/i18n.js']) txt += fs.readFileSync(f,'utf8');
const set = new Set(txt);
for (let i = 32; i < 127; i++) set.add(String.fromCharCode(i));
fs.writeFileSync('/tmp/chars.txt', [...set].join(''));
"
# 3. subset (needs: pip install fonttools brotli)
pyftsubset fusion-pixel-12px-monospaced-zh_hans.ttf.woff2 \
  --text-file=/tmp/chars.txt \
  --output-file=src/ui/fonts/fusion-pixel-12px-mono-zh-hans-subset.woff2 \
  --flavor=woff2 --no-hinting
```
