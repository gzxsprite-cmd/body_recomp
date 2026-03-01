from __future__ import annotations

import glob
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request

ROOT = Path("/mnt/c/Users/gzxsp/training_hub")
BASE = Path("/mnt/c/Users/gzxsp/training_hub/body_recomp")
SESSIONS_DIR = BASE / "06_sessions"
RUNS_DIR = BASE / "07_runs"
INBOX_DIR = Path(__file__).resolve().parent.parent / "data" / "inbox"

app = Flask(__name__)


def _slugify(value: str) -> str:
    safe = (value or "").strip().lower()
    safe = re.sub(r"\s+", "_", safe)
    safe = re.sub(r"[^a-z0-9_\-\u4e00-\u9fff]", "", safe)
    return safe[:80] or "unknown"


def _validate_session_script(payload: dict[str, Any]) -> tuple[bool, str | None]:
    required_top = ["session_id", "session_name", "total_steps", "steps"]
    for key in required_top:
        if key not in payload:
            return False, f"missing field: {key}"

    if not isinstance(payload["steps"], list) or not payload["steps"]:
        return False, "steps must be a non-empty array"

    for i, step in enumerate(payload["steps"]):
        for k in ["step_no", "action_name", "action_type", "sets", "rest_seconds", "phase"]:
            if k not in step:
                return False, f"steps[{i}] missing field: {k}"
        if step["action_type"] not in ["reps", "timed"]:
            return False, f"steps[{i}].action_type must be reps|timed"
        if step["phase"] not in ["warmup", "main", "cooldown"]:
            return False, f"steps[{i}].phase must be warmup|main|cooldown"

    return True, None


def find_today_session(base_path: Path) -> tuple[Path | None, str | None, dict[str, Any] | None]:
    today = datetime.now()
    day_code = today.strftime("%Y%m%d")
    iso_year, iso_week, _ = today.isocalendar()
    week_dir = base_path / "06_sessions" / f"week{iso_year}_{iso_week:02d}"
    pattern = str(week_dir / f"session_{day_code}_*.json")
    candidates = sorted(glob.glob(pattern))

    if not candidates:
        return None, "NO_SESSION_FOR_TODAY", None

    target = Path(candidates[0])
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return None, f"INVALID_SESSION_FILE: {exc}", None

    valid, error = _validate_session_script(payload)
    if not valid:
        return None, f"INVALID_SESSION_CONTRACT: {error}", None

    return target, None, payload


def write_run_result(base_path: Path, run_obj: dict[str, Any]) -> Path:
    runs_dir = base_path / "07_runs"
    runs_dir.mkdir(parents=True, exist_ok=True)

    safe_session_id = _slugify(str(run_obj.get("session_id") or "unknown_session"))
    run_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_path = runs_dir / f"run_{run_ts}_{safe_session_id}.json"
    run_path.write_text(json.dumps(run_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    latest_path = runs_dir / "latest_run.json"
    latest_path.write_text(
        json.dumps({"latest_run_path": str(run_path)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return run_path


def _extract_skipped_steps(event_logs: list[dict[str, Any]]) -> list[int]:
    skipped = sorted({int(e.get("step_no")) for e in event_logs if e.get("event_code") == "skip" and e.get("step_no") is not None})
    return skipped


def _normalize_event_log(event_logs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for event in event_logs:
        normalized.append(
            {
                "time": event.get("timestamp"),
                "type": event.get("event_code"),
                "current_step_no": event.get("step_no"),
            }
        )
    return normalized


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route("/today-session", methods=["GET"])
def today_session() -> tuple[Any, int]:
    session_path, status_code, payload = find_today_session(BASE)
    if session_path is None:
        return jsonify({"success": False, "status_code": status_code}), 200

    return (
        jsonify(
            {
                "success": True,
                "session_file_path": str(session_path),
                "session_script": payload,
                "status_code": None,
            }
        ),
        200,
    )


@app.route("/save-session", methods=["POST", "OPTIONS"])
def save_session() -> tuple[Any, int]:
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    session_result = payload.get("session_result")
    event_logs = payload.get("event_logs")
    session_name = payload.get("session_name")
    ts = payload.get("timestamp")
    session_file_path = payload.get("session_file_path")
    completed_steps = payload.get("completed_steps")

    if not isinstance(session_result, dict):
        return jsonify({"success": False, "error": "session_result 必须是对象"}), 400
    if not isinstance(event_logs, list):
        return jsonify({"success": False, "error": "event_logs 必须是数组"}), 400
    if not isinstance(session_name, str) or not session_name.strip():
        return jsonify({"success": False, "error": "session_name 必填"}), 400

    try:
        INBOX_DIR.mkdir(parents=True, exist_ok=True)
        RUNS_DIR.mkdir(parents=True, exist_ok=True)

        safe_ts = re.sub(r"[^0-9A-Za-z_\-]", "", str(ts or "")) or datetime.now().strftime("%Y%m%d_%H%M%S")
        slug = _slugify(session_name)
        prefix = f"{safe_ts}__{slug}"

        session_result_path = INBOX_DIR / f"{prefix}__session_result.json"
        event_logs_path = INBOX_DIR / f"{prefix}__event_logs.json"

        session_result_path.write_text(json.dumps(session_result, ensure_ascii=False, indent=2), encoding="utf-8")
        event_logs_path.write_text(json.dumps(event_logs, ensure_ascii=False, indent=2), encoding="utf-8")

        run_obj = {
            "session_id": session_result.get("session_id"),
            "session_file_path": session_file_path,
            "start_time": session_result.get("start_time"),
            "end_time": session_result.get("end_time"),
            "duration_seconds": session_result.get("duration_seconds"),
            "completed_steps": completed_steps if isinstance(completed_steps, list) else [],
            "skipped_steps": _extract_skipped_steps(event_logs),
            "event_log": _normalize_event_log(event_logs),
        }

        run_file_path = write_run_result(BASE, run_obj)

        return (
            jsonify(
                {
                    "success": True,
                    "saved_dir": str(INBOX_DIR),
                    "session_result_path": str(session_result_path),
                    "event_logs_path": str(event_logs_path),
                    "run_file_path": str(run_file_path),
                    "latest_run_path": str(RUNS_DIR / "latest_run.json"),
                    "error": None,
                }
            ),
            200,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "saved_dir": str(INBOX_DIR), "error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8765)
