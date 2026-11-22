"""產業鏈軌道圖的銀河背景：把 Poly Haven 夜空全景（.hdr）轉成「自發光層」PNG（只用標準函式庫）。

像 UE5 天空球材質的 Emissive：前端用加法疊在程式畫的星空上，黑＝不影響，亮＝發光。轉檔時：
- 只留天空：保留上方 keep 比例，下方 fade 比例漸淡成黑（沒有地面、沒有硬的地平線）
- 扣掉大氣霧：每個像素減掉天空亮度中位數 × haze，灰色底霧變成 0，只剩銀河光帶與星點
- 白點取 99.8 百分位，Reinhard 色調映射＋gamma，再偏冷色

來源（CC0，可商用、可再散布）：
  https://polyhaven.com/a/rogland_clear_night  →  web/assets/sky/rogland_emissive.png（預設「銀河：強」）
  https://polyhaven.com/a/qwantani_night       →  web/assets/sky/qwantani_emissive.png（「銀河：淡」）
下載 2k 的 .hdr（約 7 MB，不放進 git）：
  https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rogland_clear_night_2k.hdr
  https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_night_2k.hdr

用法（目前產出用的參數）：
  python tools/sky_emissive.py rogland_clear_night_2k.hdr web/assets/sky/rogland_emissive.png 2048 0.44 0.35 1.05 1.4
  python tools/sky_emissive.py qwantani_night_2k.hdr web/assets/sky/qwantani_emissive.png 2048 0.44 0.35 1.15 1.6
參數：輸入 輸出 寬度 keep fade haze gain
限制：只支援新式 RLE 的 Radiance .hdr（Poly Haven 的檔案都是）；純 Python 解碼，2k 約 10～20 秒。
"""

import math
import struct
import sys
import zlib


def read_hdr(path):
    with open(path, "rb") as f:
        data = f.read()
    pos = 0
    while True:
        end = data.index(b"\n", pos)
        line = data[pos:end]
        pos = end + 1
        if line.startswith(b"-Y") or line.startswith(b"+Y"):
            parts = line.split()
            h, w = int(parts[1]), int(parts[3])
            break
    pix = bytearray(w * h * 4)
    for y in range(h):
        if data[pos] != 2 or data[pos + 1] != 2:
            raise ValueError("只支援新式 RLE 的 .hdr")
        pos += 4
        row = [bytearray(w) for _ in range(4)]
        for c in range(4):
            x = 0
            r = row[c]
            while x < w:
                n = data[pos]
                pos += 1
                if n > 128:
                    n -= 128
                    r[x:x + n] = bytes([data[pos]]) * n
                    pos += 1
                else:
                    r[x:x + n] = data[pos:pos + n]
                    pos += n
                x += n
        base = y * w * 4
        for x in range(w):
            i = base + x * 4
            pix[i], pix[i + 1], pix[i + 2], pix[i + 3] = row[0][x], row[1][x], row[2][x], row[3][x]
    return w, h, pix


def write_png(path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    if len(sys.argv) != 8:
        sys.exit(__doc__)
    src, dst = sys.argv[1], sys.argv[2]
    out_w, keep, fade, haze, gain = int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7])
    w, h, pix = read_hdr(src)
    step = max(1, w // out_w)
    ow, oh = w // step, int(h // step * keep)
    lin, lums = [], []
    for y in range(oh):
        for x in range(ow):
            i = ((y * step) * w + x * step) * 4
            e = pix[i + 3]
            f = math.ldexp(1.0, e - 136) if e else 0.0
            rgb = (pix[i] * f, pix[i + 1] * f, pix[i + 2] * f)
            lin.append(rgb)
            lums.append(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2])
    srt = sorted(lums)
    base = srt[len(srt) // 2] * haze
    white = (srt[int(len(srt) * 0.998)] - base) or 1e-6
    tint = (0.86, 0.95, 1.12)  # 偏冷的星光色
    rows, k = [], 0
    for y in range(oh):
        fy = y / oh
        vfade = 1.0 if fy < 1 - fade else max(0.0, (1 - fy) / fade) ** 1.5
        row = bytearray(ow * 3)
        for x in range(ow):
            out = []
            for c, v in enumerate(lin[k]):
                v = max(0.0, v - base) / white * gain
                v = v / (1 + v)
                out.append(max(0, min(255, int((v ** (1 / 2.2)) * vfade * tint[c] * 255 + 0.5))))
            row[x * 3:x * 3 + 3] = bytes(out)
            k += 1
        rows.append(row)
    write_png(dst, ow, oh, rows)
    print(f"{src} → {dst}（{ow}x{oh}）")


if __name__ == "__main__":
    main()
