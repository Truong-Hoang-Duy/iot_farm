"""Sinh bảng kết quả Markdown từ artifacts/metrics.json và chèn vào docs/MODELS.md.

    .venv\\Scripts\\python.exe -m app.ml.report            # in ra + cập nhật docs/MODELS.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from . import config as C

BEGIN, END = "<!-- RESULTS:BEGIN -->", "<!-- RESULTS:END -->"
DOC = C.REPO_DIR / "docs" / "MODELS.md"


def _fmt(v, nd=3):
    return "–" if v is None else f"{v:.{nd}f}"


def render(m: dict) -> str:
    L = []
    rows = m["rows"]
    sp = m["split"]
    dev = m.get("device", {})
    smi = dev.get("nvidia_smi", {})
    L.append(f"*Sinh tự động lúc {m['generated_at']} từ `backend/artifacts/metrics.json`"
             f"{' — CHẾ ĐỘ QUICK (không dùng để báo cáo)' if m.get('quick') else ''}.*\n")
    L.append("| Mục | Giá trị |\n|---|---|")
    L.append(f"| Nguồn dữ liệu | {m['data_source']} ({m['dataset']['start']} → {m['dataset']['end']}, "
             f"{m['dataset']['n_raw_records']} bản ghi thô, {m['dataset']['n_grid_points_5min']} điểm lưới 5') |")
    L.append(f"| Train | {sp['train'][0][:10]} → {sp['train'][1][:10]} |")
    L.append(f"| Validation | {sp['val'][0][:10]} → {sp['val'][1][:10]} |")
    L.append(f"| Test | {sp['test'][0][:10]} → {sp['test'][1][:16]} |")
    for g, gm in m["groups"].items():
        L.append(f"| Nhóm {g} | {gm['n_origins']} origin (mỗi {gm['origin_every_minutes']}′), "
                 f"điểm train/val/test = {gm['n_points']['train']}/{gm['n_points']['val']}/{gm['n_points']['test']}, "
                 f"thời tiết: {'có' if gm['uses_weather'] else 'không'} |")
    L.append(f"| Thiết bị | {dev.get('device')} – {dev.get('gpu_name')} (torch {dev.get('torch_version')}, CUDA {dev.get('torch_cuda')}) |")
    if smi.get("n_samples"):
        L.append(f"| nvidia-smi | max util {smi.get('max_util_pct')} %, max VRAM {smi.get('max_mem_used_mb')} MB, "
                 f"{smi.get('n_samples')} mẫu |")
    L.append(f"| Tổng thời gian | {m.get('total_seconds')} s |")
    L.append(f"| Thời tiết | {m.get('weather_source')} |\n")

    # thời gian huấn luyện
    L.append("**Thời gian huấn luyện (giây, fit trên train / refit toàn bộ)**\n")
    L.append("| Mô hình | " + " | ".join(m["groups"].keys()) + " |\n|---|" + "---|" * len(m["groups"]))
    for k in C.MODEL_KEYS:
        cells = []
        for g in m["groups"]:
            inf = m["models"].get(g, {}).get(k)
            if not inf:
                cells.append("–")
                continue
            ff = (inf.get("final_fit") or {}).get("train_seconds")
            dv = inf.get("device", "")
            cells.append(f"{_fmt(inf.get('train_seconds'), 1)} / {_fmt(ff, 1)} ({dv})")
        L.append(f"| {C.MODEL_LABELS[k]} | " + " | ".join(cells) + " |")
    L.append("")

    for g, gm in m["groups"].items():
        hz = list(gm["horizons"].keys())
        models = sorted({r["model"] for r in rows if r["group"] == g}, key=C.MODEL_KEYS.index)
        L.append(f"### Nhóm {g} – MASE (kiểu cum: gộp bước 1..k) trung bình 9 biến\n")
        L.append("| Mô hình | " + " | ".join(hz) + " |\n|---|" + "---|" * len(hz))
        for mk in models:
            cells = []
            for h in hz:
                v = [r["mase"] for r in rows if r["group"] == g and r["model"] == mk and r["horizon"] == h
                     and r["kind"] == "cum" and r["mase"] is not None]
                cells.append(_fmt(sum(v) / len(v)) if v else "–")
            L.append(f"| {C.MODEL_LABELS[mk]} | " + " | ".join(cells) + " |")
        L.append("")
        L.append(f"### Nhóm {g} – mô hình tốt nhất theo (biến, horizon) (MASE cum thấp nhất; trong ngoặc: MASE / MAE)\n")
        L.append("| Biến | " + " | ".join(hz) + " |\n|---|" + "---|" * len(hz))
        best = m["best"]["cum"]
        for t in C.TARGETS:
            cells = []
            for h in hz:
                b = best.get(t, {}).get(h)
                if not b:
                    cells.append("–")
                    continue
                r = next(r for r in rows if r["model"] == b["model"] and r["target"] == t and r["horizon"] == h
                         and r["kind"] == "cum")
                cells.append(f"**{C.MODEL_LABELS[b['model']].split(' (')[0]}** ({_fmt(r['mase'], 2)} / {_fmt(r['mae'], 3)})")
            L.append(f"| {t} | " + " | ".join(cells) + " |")
        L.append("")
        # chi tiết tại horizon dài nhất của nhóm
        hmax = hz[-1]
        hmid = hz[len(hz) // 2]
        for hh in (hmid, hmax):
            L.append(f"### Nhóm {g} – chi tiết tại horizon {hh} (cum)\n")
            L.append("| Biến | Mô hình | MAE | RMSE | sMAPE % | MASE | R² | Cov80 |\n|---|---|---|---|---|---|---|---|")
            for t in C.TARGETS:
                for mk in models:
                    r = next((r for r in rows if r["group"] == g and r["model"] == mk and r["target"] == t
                              and r["horizon"] == hh and r["kind"] == "cum"), None)
                    if not r:
                        continue
                    L.append(f"| {t} | {C.MODEL_LABELS[mk]} | {_fmt(r['mae'])} | {_fmt(r['rmse'])} | {_fmt(r['smape'], 2)} | "
                             f"{_fmt(r['mase'])} | {_fmt(r['r2'])} | {_fmt(r['coverage80'], 2)} |")
            L.append("")
    return "\n".join(L)


def main():
    m = json.loads(C.METRICS_PATH.read_text(encoding="utf-8"))
    md = render(m)
    if DOC.exists():
        doc = DOC.read_text(encoding="utf-8")
        if BEGIN in doc and END in doc:
            pre, rest = doc.split(BEGIN, 1)
            _, post = rest.split(END, 1)
            DOC.write_text(pre + BEGIN + "\n" + md + "\n" + END + post, encoding="utf-8")
            print(f"updated {DOC}")
    sys.stdout.reconfigure(encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()

