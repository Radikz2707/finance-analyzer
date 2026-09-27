"""
MOEX ISS API клиент (свечи и котировки).

Использует stdlib urllib — без внешних зависимостей.
Документация: https://iss.moex.com/iss/reference/
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

ISS_BASE = "https://iss.moex.com/iss"
USER_AGENT = "FinanceAnalyzer/1.0"


def _get_json(url: str, timeout: int = 10) -> dict[str, Any]:
    """GET + JSON-парсинг с User-Agent."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_candles(
    ticker: str,
    days: int = 120,
    interval: int = 24,
    board: str = "TQBR",
) -> dict[str, Any]:
    """
    Исторические свечи по тикеру.

    interval: 1/10/60 — минуты, 24 — день.
    """
    if not ticker:
        return {"ok": False, "error": "empty ticker"}

    url = (
        f"{ISS_BASE}/engines/stock/markets/shares/boards/{board}/securities/"
        f"{urllib.parse.quote(ticker)}/candles.json?interval={interval}"
    )

    try:
        data = _get_json(url)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    if "candles" not in data:
        return {"ok": False, "error": f"no candles for {ticker}"}

    columns = data["candles"]["columns"]
    rows = data["candles"]["data"]

    result: list[dict[str, Any]] = []
    for row in rows[-days:]:
        row_map = dict(zip(columns, row))
        result.append(
            {
                "date": row_map.get("begin", ""),
                "open": row_map.get("open"),
                "high": row_map.get("high"),
                "low": row_map.get("low"),
                "close": row_map.get("close"),
                "volume": row_map.get("volume"),
            }
        )

    return {"ok": True, "ticker": ticker, "candles": result}


def get_quotes(tickers: list[str]) -> dict[str, Any]:
    """Последние котировки нескольких тикеров за один запрос."""
    clean = [t for t in tickers if t]
    if not clean:
        return {"ok": False, "error": "empty tickers"}

    joined = ",".join(clean)
    url = (
        f"{ISS_BASE}/engines/stock/markets/shares/boards/TQBR/securities.json?"
        f"iss.meta=off&iss.only=marketdata"
        f"&marketdata.columns=SECID,LAST,LASTCHANGEPCT,VALTODAY,VALTODAY_USD"
        f"&securities={urllib.parse.quote(joined)}"
    )

    try:
        data = _get_json(url)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    columns = data["marketdata"]["columns"]
    rows = data["marketdata"]["data"]
    quotes = [dict(zip(columns, row)) for row in rows if row and row[0] in clean]

    return {"ok": True, "quotes": quotes}
