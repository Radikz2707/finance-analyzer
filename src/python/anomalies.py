"""
Модуль статистических аномалий цен.

Реализован на чистом Python stdlib (без numpy/pandas):
- быстрый старт процесса (~50 мс вместо ~400 мс на импорт numpy);
- детерминированность результатов на любом окружении;
- не требует установки зависимостей для базового функционала.

Pandas/NumPy задекларированы в requirements.txt и подключаются
для расширенных задач (портфельная статистика, оптимизация).

Алгоритмы:
- Z-score цены относительно скользящего окна предшествующих значений
- Аннуализированная волатильность (std * sqrt(252))
- RSI (Wilder)
- SMA(20)/SMA(50) + определение тренда
"""
from __future__ import annotations

import math
from typing import Any


# ──────────────────────────────────────────────
# Базовые статистические функции
# ──────────────────────────────────────────────

def sma(values: list[float], window: int) -> list[float | None]:
    """Простое скользящее среднее. Первые window-1 элементов = None."""
    result: list[float | None] = [None] * len(values)
    if window <= 0 or len(values) < window:
        return result

    running = sum(values[:window])
    result[window - 1] = running / window

    for i in range(window, len(values)):
        running += values[i] - values[i - window]
        result[i] = running / window

    return result


def stddev(values: list[float]) -> float:
    """Стандартное отклонение (population)."""
    n = len(values)
    if n == 0:
        return 0.0
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n
    return math.sqrt(variance)


def rolling_zscore(
    values: list[float],
    window: int,
    threshold: float,
) -> list[dict[str, Any] | None]:
    """
    Z-score каждой точки относительно окна ПРЕДШЕСТВУЮЩИХ значений
    (текущая точка не участвует в своём среднем/разбросе).

    Возвращает список той же длины: первые window элементов = None.
    """
    points: list[dict[str, Any] | None] = []
    for i in range(len(values)):
        if i < window:
            points.append(None)
            continue

        history = values[i - window : i]
        mean = sum(history) / window
        std = stddev(history)

        z = 0.0 if std == 0 else (values[i] - mean) / std
        deviation = ((values[i] - mean) / mean * 100) if mean != 0 else 0.0

        points.append(
            {
                "zScore": round(float(z), 4),
                "isAnomaly": bool(abs(z) > threshold),
                "deviationPct": round(float(deviation), 2),
            }
        )

    return points


def price_returns(values: list[float]) -> list[float]:
    """Доходности (логарифмические)."""
    result: list[float] = []
    for i in range(1, len(values)):
        prev = values[i - 1]
        cur = values[i]
        if prev > 0 and cur > 0:
            result.append(math.log(cur / prev))
    return result


def annualized_volatility(
    values: list[float],
    window: int,
    periods_per_year: int = 252,
) -> float:
    """Аннуализированная волатильность по хвосту окна."""
    rets = price_returns(values)
    if len(rets) < 2:
        return 0.0
    tail = rets[-window:]
    return round(float(stddev(tail) * math.sqrt(periods_per_year)), 4)


def rsi(values: list[float], period: int = 14) -> float:
    """Индекс относительной силы (Wilder smoothing)."""
    if len(values) < period + 1:
        return 50.0

    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(values)):
        change = values[i] - values[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0

    rs = avg_gain / avg_loss
    return round(100.0 - 100.0 / (1.0 + rs), 2)


def detect_trend(
    values: list[float],
    sma20: list[float | None],
    sma50: list[float | None],
) -> str:
    """Тренд по пересечению SMA20/SMA50 относительно цены."""
    last = len(values) - 1
    if last < 0:
        return "flat"

    s20 = sma20[last] if last < len(sma20) else None
    s50 = sma50[last] if last < len(sma50) else None
    if s20 is not None and s50 is not None:
        if s20 > s50 and values[last] > s20:
            return "up"
        if s20 < s50 and values[last] < s20:
            return "down"
    return "flat"


def risk_level(volatility: float, z_score: float, threshold: float) -> str:
    """Уровень риска: high/medium/low."""
    score = 0
    if volatility > 0.5:
        score += 2
    elif volatility > 0.3:
        score += 1
    if abs(z_score) > threshold:
        score += 1
    if score >= 3:
        return "high"
    if score == 2:
        return "medium"
    return "low"


# ──────────────────────────────────────────────
# Главный обработчик команды detect_anomalies
# ──────────────────────────────────────────────

def detect_anomalies(payload: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Обработка серий цен.

    payload: {"series": [{"ticker", "prices", "dates"}]}
    config:  {"zScoreThreshold", "window", "volatilityWindow", "rsiPeriod"}
    """
    series: list[dict[str, Any]] = payload.get("series", [])
    window = int(config.get("window", 20))
    z_threshold = float(config.get("zScoreThreshold", 2.0))
    vol_window = int(config.get("volatilityWindow", 20))
    rsi_period = int(config.get("rsiPeriod", 14))

    results: list[dict[str, Any]] = []

    for item in series:
        ticker = str(item.get("ticker", "?"))
        prices = [float(p) for p in item.get("prices", [])]
        dates = item.get("dates") or []

        if len(prices) < window + 1:
            results.append({"ticker": ticker, "error": "not enough data"})
            continue

        zpoints = rolling_zscore(prices, window, z_threshold)
        sma20 = sma(prices, 20)
        sma50 = sma(prices, 50)
        vol = annualized_volatility(prices, vol_window)
        r = rsi(prices, rsi_period)
        trend = detect_trend(prices, sma20, sma50)

        last_idx = len(prices) - 1
        last_point = zpoints[last_idx]
        last_z = last_point["zScore"] if last_point else 0.0
        last_is_anomaly = bool(last_point["isAnomaly"]) if last_point else False

        anomalies: list[dict[str, Any]] = []
        for i, zp in enumerate(zpoints):
            if zp and zp["isAnomaly"]:
                anomalies.append(
                    {
                        "index": i,
                        "date": dates[i] if i < len(dates) else None,
                        "price": prices[i],
                        **zp,
                    }
                )

        results.append(
            {
                "ticker": ticker,
                "lastPrice": round(prices[last_idx], 4),
                "zScoreLast": last_z,
                "isLastAnomaly": last_is_anomaly,
                "volatilityAnnual": vol,
                "rsi": r,
                "sma20": round(sma20[last_idx], 4) if sma20[last_idx] is not None else None,
                "sma50": round(sma50[last_idx], 4) if sma50[last_idx] is not None else None,
                "trend": trend,
                "riskLevel": risk_level(vol, last_z, z_threshold),
                "anomaliesCount": len(anomalies),
                "pointsCount": len(prices),
                "anomalies": anomalies,
            }
        )

    return results
