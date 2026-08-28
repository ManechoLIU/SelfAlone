#!/usr/bin/env python3
"""Reject newly introduced CSS/WXSS pseudo-element selectors.

The checked-in baseline only preserves historical occurrences until their owning
component is touched. New visual work must use real DOM/WXML, SVG, or approved
assets instead of ::before/::after shapes.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
BASELINE = Path(__file__).with_name("visual-pseudo-element-baseline.txt")
SEARCH_ROOTS = (ROOT / "apps" / "web" / "src", ROOT / "apps" / "miniapp" / "src")
EXTENSIONS = {".css", ".scss", ".less", ".wxss"}
PSEUDO_PATTERN = re.compile(r"::?(?:before|after)\b")


def collect_current() -> Counter[str]:
    matches: Counter[str] = Counter()
    for search_root in SEARCH_ROOTS:
        if not search_root.exists():
            continue
        for path in sorted(search_root.rglob("*")):
            if not path.is_file() or path.suffix not in EXTENSIONS:
                continue
            relative = path.relative_to(ROOT).as_posix()
            for line in path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if PSEUDO_PATTERN.search(stripped):
                    matches[f"{relative}\t{stripped}"] += 1
    return matches


def load_baseline() -> Counter[str]:
    if not BASELINE.exists():
        raise SystemExit(f"missing baseline: {BASELINE}")
    return Counter(
        line
        for raw in BASELINE.read_text(encoding="utf-8").splitlines()
        if (line := raw.strip()) and not line.startswith("#")
    )


def main() -> int:
    current = collect_current()
    baseline = load_baseline()
    additions = current - baseline
    if additions:
        print("visual contract failed: new pseudo-element selectors are forbidden", file=sys.stderr)
        for item, count in sorted(additions.items()):
            print(f"  {count}x {item}", file=sys.stderr)
        print("Use real DOM/WXML, mature SVG/vector icons, or approved assets.", file=sys.stderr)
        return 1
    print(f"visual contract passed: no new pseudo-element selectors ({sum(current.values())} historical occurrences)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
