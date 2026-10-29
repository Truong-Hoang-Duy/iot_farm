# -*- coding: utf-8 -*-
"""Kiá»ƒm tra tÄ©nh tÆ°Æ¡ng thÃ­ch Python 3.6 (JetPack 4.6) cho toÃ n bá»™ code trong edge/.

1. ast.parse(..., feature_version=(3, 6)) â€“ báº¯t cÃº phÃ¡p má»›i (walrus, positional-only, ...)
   (Python má»›i cÃ³ thá»ƒ khÃ´ng há»— trá»£ (3,6) -> tá»± lÃ¹i vá» (3,7)).
2. TÃ¬m cÃ¡c API/cÃº phÃ¡p 3.7+ hay gáº·p báº±ng regex.
Cháº¡y:  python tests/check_py36.py
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = os.path.dirname(HERE)

FORBIDDEN = [
    (r"from\s+__future__\s+import\s+annotations", "from __future__ import annotations (3.7+)"),
    (r"^\s*(import\s+dataclasses|from\s+dataclasses\s+import)", "dataclasses (3.7+)"),
    (r"\.fromisoformat\(", "datetime.fromisoformat (3.7+)"),
    (r"asyncio\.run\(", "asyncio.run (3.7+)"),
    (r"capture_output\s*=", "subprocess capture_output (3.7+)"),
    (r"\btext\s*=\s*True", "subprocess text=True (3.7+)"),
    (r"ThreadingHTTPServer", "http.server.ThreadingHTTPServer (3.7+)"),
    (r"contextlib\.nullcontext|\bnullcontext\(", "contextlib.nullcontext (3.7+)"),
    (r"time\.(time_ns|monotonic_ns|perf_counter_ns)\(", "time.*_ns (3.7+)"),
    (r"\.removeprefix\(|\.removesuffix\(", "str.removeprefix/suffix (3.9+)"),
    (r"\.isascii\(", "str.isascii (3.7+)"),
    (r"math\.(prod|isqrt|dist)\(", "math.prod/isqrt/dist (3.8+)"),
    (r"functools\.cached_property|\bcached_property\b", "cached_property (3.8+)"),
    (r"\bimportlib\.metadata\b", "importlib.metadata (3.8+)"),
    (r"\bzoneinfo\b", "zoneinfo (3.9+)"),
    (r"\{[^{}'\"]+=\}", "f-string debug {x=} (3.8+)"),
    (r"\bmatch\s+\S.*:\s*$", "match statement (3.10+)"),
    (r":\s*(list|dict|tuple|set)\[", "built-in generic annotations (3.9+)"),
    (r"->\s*\w+\s*\|", "PEP 604 union annotation (3.10+)"),
    (r"asyncio\.(create_task|get_running_loop)\(", "asyncio 3.7+ API"),
    (r"\.reconfigure\(", "TextIOWrapper.reconfigure (3.7+)"),
    (r"breakpoint\(", "breakpoint() (3.7+)"),
    (r"ON\s+CONFLICT\s*\(.*\)\s*DO", "SQLite UPSERT (cáº§n 3.24, Ubuntu 18.04 cÃ³ 3.22)"),
    (r"[\"'][^\"']*\bRETURNING\b", "SQLite RETURNING (3.35+)"),
]


def say(msg):
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    sys.stdout.write(msg.encode(enc, "backslashreplace").decode(enc, "replace") + "\n")


def iter_py():
    for root, dirs, files in os.walk(EDGE):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".venv", "data", "logs")]
        for f in files:
            if f.endswith(".py") and f != "check_py36.py":
                yield os.path.join(root, f)


def main():
    problems = 0
    files = sorted(iter_py())
    fv = (3, 6)
    try:
        ast.parse("x = 1", feature_version=fv)
    except (TypeError, ValueError):
        fv = (3, 7)
    for path in files:
        rel = os.path.relpath(path, EDGE)
        with open(path, encoding="utf-8") as f:
            src = f.read()
        try:
            ast.parse(src, filename=rel, feature_version=fv)
        except SyntaxError as e:
            say("SYNTAX %s:%s %s (feature_version=%s)" % (rel, e.lineno, e.msg, fv))
            problems += 1
        for lineno, line in enumerate(src.splitlines(), 1):
            code = line.split("#", 1)[0] if not line.lstrip().startswith(("'", '"')) else line
            for pat, why in FORBIDDEN:
                if re.search(pat, code):
                    say("API    %s:%d %s | %s" % (rel, lineno, why, line.strip()[:100]))
                    problems += 1
    say("ÄÃ£ kiá»ƒm tra %d file (ast feature_version=%s): %s" % (
        len(files), fv, "OK" if not problems else "%d váº¥n Ä‘á»" % problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
