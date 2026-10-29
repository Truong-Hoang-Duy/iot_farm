"""Thẻ mô hình (model cards): bài báo gốc, DOI, siêu tham số."""
from __future__ import annotations

from . import config as C

YEAR_DESC = {
    "xgboost": (2016, "Cây quyết định tăng cường gradient; dự báo trực tiếp nhiều bước với horizon là đặc trưng, hồi quy phân vị cho khoảng 80 %."),
    "lstm": (1997, "Mạng hồi quy có cổng nhớ dài-ngắn; encoder LSTM + decoder MLP dự báo trực tiếp H bước."),
    "nhits": (2023, "MLP phân cấp đa tần số: pooling đa tốc độ + nội suy phân cấp, mạnh cho dự báo dài."),
    "patchtst": (2023, "Transformer chia chuỗi thành patch, độc lập kênh, chuẩn hoá theo cửa sổ."),
    "chronos": (2024, "Mô hình nền tảng huấn luyện trước trên ~100 tỷ điểm dữ liệu, dùng zero-shot (không huấn luyện lại)."),
    "seasonal_naive": (2021, "Baseline: lặp lại giá trị cùng giờ của ngày hôm trước."),
    "naive": (2021, "Baseline: giữ nguyên giá trị quan sát cuối cùng."),
}

PAPERS = {
    "xgboost": {
        "family": "Gradient boosting decision trees",
        "paper": "Chen, T. & Guestrin, C. (2016). XGBoost: A Scalable Tree Boosting System. Proc. 22nd ACM SIGKDD, 785-794.",
        "doi": "10.1145/2939672.2939785",
        "strategy": "Direct multi-horizon (horizon-as-feature), quantile regression q10/q50/q90, 1 model per target per group",
    },
    "lstm": {
        "family": "Recurrent neural network",
        "paper": "Hochreiter, S. & Schmidhuber, J. (1997). Long Short-Term Memory. Neural Computation 9(8), 1735-1780.",
        "doi": "10.1162/neco.1997.9.8.1735",
        "strategy": "LSTM encoder (2x128) over the input window -> last hidden state + future-exog MLP -> H x 3 quantiles "
                    "(direct multi-step, pinball loss, own PyTorch implementation), global across 9 series",
    },
    "nhits": {
        "family": "Deep MLP, hierarchical interpolation",
        "paper": "Challu, C., Olivares, K. G., Oreshkin, B. N., Garza, F., Mergenthaler-Canseco, M. & Dubrawski, A. (2023). "
                 "N-HiTS: Neural Hierarchical Interpolation for Time Series Forecasting. AAAI 37(6), 6989-6997.",
        "doi": "10.1609/aaai.v37i6.25854",
        "strategy": "Multi-rate pooling + hierarchical interpolation, MQLoss (80% interval), global across 9 series",
    },
    "patchtst": {
        "family": "Transformer (patching, channel-independent)",
        "paper": "Nie, Y., Nguyen, N. H., Sinthong, P. & Kalagnanam, J. (2023). A Time Series is Worth 64 Words: "
                 "Long-term Forecasting with Transformers. ICLR 2023.",
        "doi": "10.48550/arXiv.2211.14730",
        "strategy": "Patches of the input window as tokens, univariate, MQLoss (80% interval), global across 9 series",
    },
    "chronos": {
        "family": "Pretrained foundation model (T5 encoder-decoder, zero-shot)",
        "paper": "Ansari, A. F. et al. (2024). Chronos: Learning the Language of Time Series. Transactions on Machine Learning Research.",
        "doi": "10.48550/arXiv.2403.07815",
        "strategy": "amazon/chronos-bolt-small used zero-shot (no fine-tuning); quantiles q10/q50/q90",
    },
    "seasonal_naive": {
        "family": "Baseline",
        "paper": "Hyndman, R. J. & Athanasopoulos, G. (2021). Forecasting: Principles and Practice, 3rd ed. OTexts.",
        "doi": None,
        "url": "https://otexts.com/fpp3/simple-methods.html",
        "strategy": "y(T+k) = y(T+k - m*ceil(k/m)), m = 1 day",
    },
    "naive": {
        "family": "Baseline",
        "paper": "Hyndman, R. J. & Athanasopoulos, G. (2021). Forecasting: Principles and Practice, 3rd ed. OTexts.",
        "doi": None,
        "url": "https://otexts.com/fpp3/simple-methods.html",
        "strategy": "y(T+k) = last observed value",
    },
}


def model_cards(metrics: dict | None = None) -> list[dict]:
    from .models import XGBForecaster, futr_exog_for, neural_hparams

    cards = []
    for key in C.MODEL_KEYS:
        p = PAPERS[key]
        hp = {}
        for g in C.GROUPS:
            if key == "xgboost":
                x = XGBForecaster(g)
                hp[g] = {**x.params, "sampling": x.sampling}
            elif key == "lstm":
                from .lstm_direct import LSTMDirectForecaster

                uses_w = bool(metrics and metrics.get("groups", {}).get(g, {}).get("uses_weather"))
                x = LSTMDirectForecaster(g, has_weather=uses_w)
                hp[g] = {**x.hparams, "futr_exog": x.futr_exog}
            elif key in ("nhits", "patchtst"):
                uses_w = bool(metrics and metrics.get("groups", {}).get(g, {}).get("uses_weather"))
                hp[g] = {**neural_hparams(key, g, False), "loss": "MQLoss(level=[80])",
                         "futr_exog": futr_exog_for(key, g, uses_w)}
            elif key == "chronos":
                hp[g] = {"model_id": C.CHRONOS_MODEL_ID, "context_length": 2048, "prediction_length": C.GROUPS[g]["H"],
                         "quantiles": list(C.QUANTILES)}
            else:
                hp[g] = {"season_m": C.GROUPS[g]["season"]} if key == "seasonal_naive" else {}
        card = {
            "key": key,
            "name": C.MODEL_LABELS[key],
            "family": p["family"],
            "paper": p["paper"],
            "year": YEAR_DESC[key][0],
            "description": YEAR_DESC[key][1],
            "doi": p["doi"],
            "url": f"https://doi.org/{p['doi']}" if p["doi"] else p.get("url"),
            "doi_url": f"https://doi.org/{p['doi']}" if p["doi"] else p.get("url"),
            "strategy": p["strategy"],
            "probabilistic": key in ("xgboost", "lstm", "nhits", "patchtst", "chronos"),
            "hyperparameters": hp,
        }
        if metrics:
            card["train_info"] = {g: _slim(metrics.get("models", {}).get(g, {}).get(key)) for g in C.GROUPS}
        cards.append(card)
    return cards


def _slim(info):
    if not isinstance(info, dict):
        return info
    return {k: v for k, v in info.items() if k not in ("valid_trajectory", "per_target")}
