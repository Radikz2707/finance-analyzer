"""
FinanceAnalyzer Python Engine — точка входа TS↔Python моста.

Протокол: одна JSON-строка на stdin → одна JSON-строка на stdout.

Запрос:
    {"command": "detect_anomalies|get_candles|get_quotes|health",
     "config": {...}, "payload": {...}}

Ответ:
    {"ok": true, "data": ...}  |  {"ok": false, "error": "..."}
"""
from __future__ import annotations

import json
import sys
from typing import Any

from anomalies import detect_anomalies
from moex_client import get_candles, get_quotes

COMMANDS = {"detect_anomalies", "get_candles", "get_quotes", "health"}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    """Диспетчер команд Python-движка."""
    command = request.get("command", "")

    if command not in COMMANDS:
        return {"ok": False, "error": f"unknown command: {command}"}

    config: dict[str, Any] = request.get("config", {})
    payload: dict[str, Any] = request.get("payload", {})

    if command == "detect_anomalies":
        return {"ok": True, "data": detect_anomalies(payload, config)}

    if command == "get_candles":
        return get_candles(
            ticker=payload.get("ticker", ""),
            days=int(payload.get("days", 120)),
            interval=int(payload.get("interval", 24)),
            board=payload.get("board", "TQBR"),
        )

    if command == "get_quotes":
        return get_quotes(payload.get("tickers", []))

    if command == "health":
        return {
            "ok": True,
            "data": {
                "python": sys.version.split()[0],
                "commands": sorted(COMMANDS),
            },
        }

    return {"ok": False, "error": "unreachable"}


def main() -> None:
    """Чтение одной JSON-строки из stdin и ответ в stdout."""
    line = sys.stdin.readline()
    if not line or not line.strip():
        print(json.dumps({"ok": False, "error": "empty request"}, ensure_ascii=False))
        return

    try:
        request = json.loads(line)
        response = handle(request)
    except Exception as exc:  # noqa: BLE001
        response = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    print(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
