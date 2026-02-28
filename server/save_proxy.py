from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request

APP_ROOT = Path(__file__).resolve().parent.parent
INBOX_DIR = APP_ROOT / "data" / "inbox"

app = Flask(__name__)


def _slugify_session_name(name: str) -> str:
    name = (name or "session").strip().lower()
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"[^a-z0-9_\-\u4e00-\u9fff]", "", name)
    return name[:80] or "session"


def _safe_timestamp(ts: str | None) -> str:
    if ts and isinstance(ts, str):
        cleaned = re.sub(r"[^0-9A-Za-z_\-]", "", ts)
        if cleaned:
            return cleaned
    return datetime.now().strftime("%Y%m%d_%H%M%S")


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


@app.route("/save-session", methods=["POST", "OPTIONS"])
def save_session() -> tuple[Any, int]:
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    session_result = payload.get("session_result")
    event_logs = payload.get("event_logs")
    session_name = payload.get("session_name")
    ts = payload.get("timestamp")

    if not isinstance(session_result, dict):
        return jsonify({"success": False, "error": "session_result 必须是对象"}), 400
    if not isinstance(event_logs, list):
        return jsonify({"success": False, "error": "event_logs 必须是数组"}), 400
    if not isinstance(session_name, str) or not session_name.strip():
        return jsonify({"success": False, "error": "session_name 必填"}), 400

    try:
        INBOX_DIR.mkdir(parents=True, exist_ok=True)

        safe_ts = _safe_timestamp(ts)
        slug = _slugify_session_name(session_name)
        prefix = f"{safe_ts}__{slug}"

        session_result_path = INBOX_DIR / f"{prefix}__session_result.json"
        event_logs_path = INBOX_DIR / f"{prefix}__event_logs.json"

        session_result_path.write_text(json.dumps(session_result, ensure_ascii=False, indent=2), encoding="utf-8")
        event_logs_path.write_text(json.dumps(event_logs, ensure_ascii=False, indent=2), encoding="utf-8")

        return jsonify(
            {
                "success": True,
                "saved_dir": str(INBOX_DIR),
                "session_result_path": str(session_result_path),
                "event_logs_path": str(event_logs_path),
                "error": None,
            }
        ), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "saved_dir": str(INBOX_DIR), "error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8765)
