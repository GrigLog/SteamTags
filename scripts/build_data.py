"""Convert a raw Steam app dataset CSV into the compact binary used by the web app.

Usage:
    uv run --python 3.14 scripts/build_data.py path/to/app_dataset.csv [--out public/data]

Output:
    <out>/games.<sha8>.bin.zst   zstd-compressed columnar binary (format "STG1", see below)
    <out>/manifest.json          points the app at the current data file

Binary layout (little-endian, before compression):
    "STG1" | u32 json_len | JSON meta | section bytes...
    meta.sections = [{name, offset, length}], offsets relative to the first section byte.

Sections (n = number of games, sorted by appid):
    appid        varint deltas
    name         UTF-8 names joined by "\\0"
    release_day  u16 days since 1970-01-01 (0 = unknown), stored as two byte planes (lo[n], hi[n])
    total        varint total reviews
    negative     varint (total - positive) reviews
    price_init   varint USD cents (0 when unknown)
    price_final  varint USD cents (0 when unknown)
    flags        u8: bit0 is_free, bit1 has_price
    genre_count  u8
    genre_ids    u8 genre ids (frequency rank)
    tag_count    u8
    tag_ids      u8 tag ids (frequency rank); byte 255 is an escape: the real id is 255 + next byte.
                 Tags keep their original Steam order (most voted first).
"""

from __future__ import annotations

import argparse
import ast
import collections
import csv
import datetime as dt
import hashlib
import json
import struct
import sys
from compression import zstd
from pathlib import Path

MAGIC = b"STG1"
FORMAT_VERSION = 1
ZSTD_LEVEL = 19

# Fixed exchange rates to USD. The build fails on any currency not listed here.
FX_TO_USD = {
    "USD": 1.0,
    "EUR": 1.17,
    "JPY": 0.0068,
    "CNY": 0.14,
    "BRL": 0.18,
    "TWD": 0.031
}

EPOCH = dt.date(1970, 1, 1)


def varint(out: bytearray, x: int) -> None:
    if x < 0:
        raise ValueError(f"varint must be non-negative, got {x}")
    while True:
        b = x & 0x7F
        x >>= 7
        if x:
            out.append(b | 0x80)
        else:
            out.append(b)
            return


def read_varints(buf: bytes, count: int) -> list[int]:
    res, pos = [], 0
    for _ in range(count):
        x = shift = 0
        while True:
            b = buf[pos]
            pos += 1
            x |= (b & 0x7F) << shift
            if b < 0x80:
                break
            shift += 7
        res.append(x)
    assert pos == len(buf), "trailing bytes in varint section"
    return res


def parse_list(s: str) -> list[str]:
    return list(ast.literal_eval(s)) if s else []


def to_int(s: str) -> int:
    return int(float(s)) if s else 0


def load_rows(csv_path: Path) -> list[dict]:
    games = []
    skipped = 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["coming_soon"] != "False":
                skipped += 1
                continue
            currency = r["currency"]
            has_price = currency != "" and r["initial_price"] != ""
            if has_price and currency not in FX_TO_USD:
                sys.exit(f"Unknown currency {currency!r} (appid {r['appid']}); add it to FX_TO_USD")
            rate = FX_TO_USD.get(currency, 0.0)
            total = to_int(r["total_reviews"])
            positive = to_int(r["positive_reviews"])
            if positive > total:
                sys.exit(f"positive > total for appid {r['appid']}")
            name = r["name"]
            if "\0" in name:
                sys.exit(f"NUL in name for appid {r['appid']}")
            day = 0
            if r["release_date"]:
                day = (dt.date.fromisoformat(r["release_date"]) - EPOCH).days
                if not 0 < day < 65536:
                    sys.exit(f"release date out of range for appid {r['appid']}")
            games.append(
                {
                    "appid": int(r["appid"]),
                    "name": name,
                    "day": day,
                    "total": total,
                    "negative": total - positive,
                    "price_init": round(float(r["initial_price"]) * rate * 100) if has_price else 0,
                    "price_final": round(float(r["final_price"]) * rate * 100) if has_price else 0,
                    "is_free": r["is_free"] == "True",
                    "has_price": has_price,
                    "genres": parse_list(r["genres"]),
                    "tags": parse_list(r["tags"]),
                    "fetched_at": r["fetched_at"],
                }
            )
    games.sort(key=lambda g: g["appid"])
    print(f"kept {len(games)} released games, skipped {skipped} coming-soon rows")
    return games


def ranked_vocab(lists) -> list[str]:
    counter = collections.Counter()
    for items in lists:
        counter.update(items)
    # Frequency rank, ties broken alphabetically so the output is deterministic.
    return [name for name, _ in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))]


def encode(games: list[dict], source: str) -> tuple[bytes, dict]:
    tags = ranked_vocab(g["tags"] for g in games)
    genres = ranked_vocab(g["genres"] for g in games)
    if len(tags) > 255 + 256:
        sys.exit("too many tags for the u8+escape encoding")
    if len(genres) > 255:
        sys.exit("too many genres for u8 encoding")
    tag_id = {t: i for i, t in enumerate(tags)}
    genre_id = {t: i for i, t in enumerate(genres)}

    sec: dict[str, bytearray] = {k: bytearray() for k in (
        "appid", "name", "release_day", "total", "negative", "price_init", "price_final",
        "flags", "genre_count", "genre_ids", "tag_count", "tag_ids")}
    prev = 0
    lo, hi = bytearray(), bytearray()
    for g in games:
        varint(sec["appid"], g["appid"] - prev)
        prev = g["appid"]
        lo.append(g["day"] & 0xFF)
        hi.append(g["day"] >> 8)
        varint(sec["total"], g["total"])
        varint(sec["negative"], g["negative"])
        varint(sec["price_init"], g["price_init"])
        varint(sec["price_final"], g["price_final"])
        sec["flags"].append(int(g["is_free"]) | (int(g["has_price"]) << 1))
        sec["genre_count"].append(len(g["genres"]))
        sec["genre_ids"].extend(genre_id[x] for x in g["genres"])
        if len(g["tags"]) > 255:
            sys.exit("too many tags per game")
        sec["tag_count"].append(len(g["tags"]))
        for t in g["tags"]:
            i = tag_id[t]
            if i < 255:
                sec["tag_ids"].append(i)
            else:
                sec["tag_ids"] += bytes((255, i - 255))
    sec["release_day"] = lo + hi
    sec["name"] = bytearray("\0".join(g["name"] for g in games).encode("utf-8"))

    sections, offset = [], 0
    for name, data in sec.items():
        sections.append({"name": name, "offset": offset, "length": len(data)})
        offset += len(data)

    fetched = sorted({g["fetched_at"] for g in games if g["fetched_at"]})
    days = [g["day"] for g in games if g["day"]]
    meta = {
        "format": FORMAT_VERSION,
        "n": len(games),
        "source": source,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fetchedFrom": fetched[0] if fetched else None,
        "fetchedTo": fetched[-1] if fetched else None,
        "minDay": min(days),
        "maxDay": max(days),
        "fxToUsd": FX_TO_USD,
        "tags": tags,
        "genres": genres,
        "sections": sections,
    }
    meta_bytes = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    raw = MAGIC + struct.pack("<I", len(meta_bytes)) + meta_bytes + b"".join(bytes(v) for v in sec.values())
    return raw, meta


def verify(raw: bytes, games: list[dict]) -> None:
    """Decode the binary independently and compare it with the parsed CSV rows."""
    assert raw[:4] == MAGIC
    (json_len,) = struct.unpack_from("<I", raw, 4)
    meta = json.loads(raw[8:8 + json_len])
    base = 8 + json_len
    s = {x["name"]: raw[base + x["offset"]: base + x["offset"] + x["length"]] for x in meta["sections"]}
    n = meta["n"]
    appid_d = read_varints(s["appid"], n)
    appids, acc = [], 0
    for d in appid_d:
        acc += d
        appids.append(acc)
    names = s["name"].decode("utf-8").split("\0")
    lo, hi = s["release_day"][:n], s["release_day"][n:]
    total = read_varints(s["total"], n)
    negative = read_varints(s["negative"], n)
    pi = read_varints(s["price_init"], n)
    pf = read_varints(s["price_final"], n)
    flags = s["flags"]
    gc, gi = s["genre_count"], s["genre_ids"]
    tc, ti = s["tag_count"], s["tag_ids"]
    gpos = tpos = 0
    for k, g in enumerate(games):
        assert appids[k] == g["appid"], k
        assert names[k] == g["name"], k
        assert lo[k] | (hi[k] << 8) == g["day"], k
        assert total[k] == g["total"] and negative[k] == g["negative"], k
        assert pi[k] == g["price_init"] and pf[k] == g["price_final"], k
        assert flags[k] == (int(g["is_free"]) | (int(g["has_price"]) << 1)), k
        gl = [meta["genres"][gi[gpos + j]] for j in range(gc[k])]
        gpos += gc[k]
        assert gl == g["genres"], k
        tl = []
        for _ in range(tc[k]):
            b = ti[tpos]
            tpos += 1
            if b == 255:
                b = 255 + ti[tpos]
                tpos += 1
            tl.append(meta["tags"][b])
        assert tl == g["tags"], k
    assert gpos == len(gi) and tpos == len(ti)
    print(f"verify: OK ({n} games round-tripped)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "public" / "data")
    args = ap.parse_args()

    games = load_rows(args.csv)
    raw, meta = encode(games, args.csv.name)
    verify(raw, games)

    compressed = zstd.compress(raw, level=ZSTD_LEVEL)
    assert zstd.decompress(compressed) == raw
    version = hashlib.sha256(compressed).hexdigest()[:8]

    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("games.*.bin.zst"):
        old.unlink()
    data_file = f"games.{version}.bin.zst"
    (args.out / data_file).write_bytes(compressed)
    manifest = {
        "version": version,
        "file": data_file,
        "bytes": len(compressed),
        "rawBytes": len(raw),
        "n": meta["n"],
        "source": meta["source"],
        "generatedAt": meta["generatedAt"],
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"tags: {len(meta['tags'])}, genres: {len(meta['genres'])}")
    print("section sizes (raw bytes):")
    for x in meta["sections"]:
        print(f"  {x['name']:12s} {x['length']:>10,}")
    print(f"raw {len(raw):,} B -> zstd-{ZSTD_LEVEL} {len(compressed):,} B")
    print(f"wrote {args.out / data_file} and manifest.json (version {version})")


if __name__ == "__main__":
    main()
