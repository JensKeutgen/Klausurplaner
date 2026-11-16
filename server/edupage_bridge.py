#!/usr/bin/env python3
"""
Lokaler Bridge-Server für den Klausurplaner:
- Persistiert den kompletten Plan automatisch in server/data/klausurplan.json
- Stellt eine direkte EduPage-Anbindung (Login, optional 2FA, Klassen- & Stundenplanabruf) bereit
"""

from __future__ import annotations

import datetime
import inspect
import json
import os
import re
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATE_FILE = DATA_DIR / "klausurplan.json"
CONFIG_FILE = DATA_DIR / "edupage_config.json"

PORT = int(os.environ.get("EDUPAGE_BRIDGE_PORT", "8787"))
HOST = os.environ.get("EDUPAGE_BRIDGE_HOST", "127.0.0.1")

DATA_DIR.mkdir(parents=True, exist_ok=True)
FILE_LOCK = threading.Lock()

try:
    import edupage_api
    from edupage_api import Edupage
    import edupage_api.exceptions as edupage_exceptions

    try:
        from edupage_api.twofactor import TwoFactorLogin
    except ImportError:  # pragma: no cover
        TwoFactorLogin = getattr(edupage_api, "TwoFactorLogin", None)  # type: ignore

    EDUPAGE_AVAILABLE = True
    EDUPAGE_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover
    Edupage = None  # type: ignore
    edupage_exceptions = None  # type: ignore
    TwoFactorLogin = None  # type: ignore
    EDUPAGE_AVAILABLE = False
    EDUPAGE_IMPORT_ERROR = str(exc)


class SessionStore:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.edupage: Any = None
        self.pending_2fa: Any = None
        self.subdomain: str = ""
        self.username: str = ""
        self.classes_cache: list[Any] = []


SESSION = SessionStore()

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def _infer_grade_level(class_name: str, api_grade: Any = None) -> str:
    if api_grade is not None and str(api_grade).strip():
        g = str(api_grade).strip()
        # Keep coherent prefix if class_name has cohort code like BG25a
        m_cohort = re.match(r"^([A-Za-zÄÖÜäöüß]+\s*\d{1,4})(?:[-_ /.]*[A-Za-z0-9]+)?$", class_name.strip())
        if m_cohort:
            stripped = re.sub(r"(?:[-_ /.]+[A-Za-z0-9]+|[A-Za-z])$", "", class_name.strip())
            if stripped and len(stripped) >= 2:
                return stripped
        return g

    trimmed = class_name.strip()
    m_num = re.match(r"^(\d{1,2})([A-Za-z_-].*)?$", trimmed)
    if m_num:
        return m_num.group(1)

    stripped = re.sub(r"(?:[-_ /.]+[A-Za-z0-9]+|[A-Za-z])$", "", trimmed)
    if stripped and len(stripped) >= 2:
        return stripped
    return trimmed


def _atomic_write_json(path: Path, data: Any, restrict_perms: bool = False) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with FILE_LOCK:
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        if restrict_perms and os.name == "posix":
            os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)


def _read_json(path: Path, default: Any = None) -> Any:
    with FILE_LOCK:
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))


def _serialize_classes(classes: list[Any]) -> list[dict[str, Any]]:
    result = []
    for cls in classes or []:
        cid = getattr(cls, "class_id", getattr(cls, "id", None))
        name = getattr(cls, "name", None) or getattr(cls, "short", None) or str(cid)
        short = getattr(cls, "short", None) or name
        grade = getattr(cls, "grade", None)
        result.append(
            {
                "id": str(cid) if cid is not None else name,
                "name": str(name),
                "short": str(short),
                "gradeLevel": _infer_grade_level(str(name), grade),
            }
        )
    result.sort(key=lambda c: c["name"])
    return result


def _get_lessons_for_class_day(edupage: Any, cls_obj: Any, target_date: datetime.date) -> list[Any]:
    sig = inspect.signature(edupage.get_timetable)
    params = list(sig.parameters.keys())
    if len(params) >= 2:
        tt = edupage.get_timetable(cls_obj, target_date)
    else:
        # Fallback if a specific library version expects (target, date) differently
        tt = edupage.get_timetable(cls_obj, target_date)
    if tt is None:
        return []
    lessons = getattr(tt, "lessons", None) or []
    return list(lessons)


def _extract_subject_label(lesson: Any, use_short: bool) -> str | None:
    subj = getattr(lesson, "subject", None)
    if subj is None:
        return None
    short_name = getattr(subj, "short", None)
    full_name = getattr(subj, "name", None)
    if use_short:
        label = short_name or full_name
    else:
        label = full_name or short_name
    if not label:
        return None
    return str(label).strip()


def _extract_teachers(lesson: Any) -> list[str]:
    teachers = getattr(lesson, "teachers", None)
    if teachers is None:
        single = getattr(lesson, "teacher", None)
        teachers = [single] if single else []
    names: list[str] = []
    for t in teachers:
        if t is None:
            continue
        short_t = getattr(t, "short", None)
        name_t = getattr(t, "name", None)
        label = (short_t or name_t or "").strip()
        if label and label not in names:
            names.append(label)
    return names


def _fetch_week_schedule(
    edupage: Any,
    cls_obj: Any,
    monday_date: datetime.date,
    use_short_subjects: bool,
) -> tuple[dict[str, list[str]], dict[str, dict[str, list[str]]]]:
    subjects_by_day: dict[str, list[str]] = {d: [] for d in DAY_NAMES}
    teachers_by_day: dict[str, dict[str, list[str]]] = {}

    for idx, day_name in enumerate(DAY_NAMES):
        day_date = monday_date + datetime.timedelta(days=idx)
        lessons = _get_lessons_for_class_day(edupage, cls_obj, day_date)

        # Sort lessons by period/start_time if available
        def _sort_key(l: Any) -> tuple[int, str]:
            p = getattr(l, "period", None)
            try:
                p_num = int(p) if p is not None else 999
            except Exception:
                p_num = 999
            st = str(getattr(l, "start_time", "") or "")
            return (p_num, st)

        lessons.sort(key=_sort_key)

        day_subjects: list[str] = []
        day_teachers: dict[str, list[str]] = {}

        for lesson in lessons:
            if getattr(lesson, "is_cancelled", False):
                continue
            subj_label = _extract_subject_label(lesson, use_short_subjects)
            if not subj_label:
                continue
            day_subjects.append(subj_label)
            t_list = _extract_teachers(lesson)
            if t_list:
                existing_t = day_teachers.setdefault(subj_label, [])
                for t in t_list:
                    if t not in existing_t:
                        existing_t.append(t)

        subjects_by_day[day_name] = day_subjects
        if day_teachers:
            teachers_by_day[day_name] = day_teachers

    return subjects_by_day, teachers_by_day


def _monday_of_date(date_str: str) -> datetime.date:
    d = datetime.date.fromisoformat(date_str)
    return d - datetime.timedelta(days=d.weekday())


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "KlausurplanerBridge/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        sys.stderr.write(f"[edupage-bridge] {format % args}\n")

    def _send_json(self, status: int, payload: Any) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(raw)

    def _read_body_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(HTTPStatus.NO_CONTENT, {})

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/health":
            cfg = _read_json(CONFIG_FILE, {}) or {}
            with SESSION.lock:
                logged_in = SESSION.edupage is not None
                classes_count = len(SESSION.classes_cache)
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "edupageAvailable": EDUPAGE_AVAILABLE,
                    "edupageError": EDUPAGE_IMPORT_ERROR,
                    "loggedIn": logged_in,
                    "classesCount": classes_count,
                    "hasSavedState": STATE_FILE.exists(),
                    "hasSavedCredentials": bool(cfg.get("password")),
                },
            )
            return

        if path == "/api/state":
            state = _read_json(STATE_FILE, None)
            self._send_json(HTTPStatus.OK, {"state": state})
            return

        if path == "/api/edupage/config":
            cfg = _read_json(CONFIG_FILE, {}) or {}
            with SESSION.lock:
                logged_in = SESSION.edupage is not None
                classes = _serialize_classes(SESSION.classes_cache) if logged_in else []
            self._send_json(
                HTTPStatus.OK,
                {
                    "subdomain": cfg.get("subdomain", ""),
                    "username": cfg.get("username", ""),
                    "rememberCredentials": bool(cfg.get("rememberCredentials", False)),
                    "hasSavedPassword": bool(cfg.get("password")),
                    "loggedIn": logged_in,
                    "classes": classes,
                },
            )
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint nicht gefunden"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self._read_body_json()
        except Exception as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Ungültiges JSON: {exc}"})
            return

        if path == "/api/state":
            state = body.get("state")
            if not isinstance(state, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Erwarte 'state'-Objekt"})
                return
            _atomic_write_json(STATE_FILE, state)
            self._send_json(HTTPStatus.OK, {"saved": True, "savedAt": datetime.datetime.now().isoformat()})
            return

        if path == "/api/edupage/login":
            self._handle_login(body)
            return

        if path == "/api/edupage/2fa":
            self._handle_2fa(body)
            return

        if path == "/api/edupage/fetch-timetables":
            self._handle_fetch_timetables(body)
            return

        if path == "/api/edupage/logout":
            clear_saved = bool(body.get("clearSaved", False))
            with SESSION.lock:
                if SESSION.edupage is not None and hasattr(SESSION.edupage, "logout"):
                    try:
                        SESSION.edupage.logout()
                    except Exception:
                        pass
                SESSION.edupage = None
                SESSION.pending_2fa = None
                SESSION.classes_cache = []
            if clear_saved and CONFIG_FILE.exists():
                CONFIG_FILE.unlink(missing_ok=True)
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint nicht gefunden"})

    def _ensure_edupage_available(self) -> bool:
        if EDUPAGE_AVAILABLE:
            return True
        self._send_json(
            HTTPStatus.SERVICE_UNAVAILABLE,
            {
                "error": (
                    "Das Python-Paket 'edupage-api' ist noch nicht installiert. "
                    "Bitte einmalig 'npm run setup:edupage' (bzw. 'pip install -r server/requirements.txt') ausführen."
                ),
                "details": EDUPAGE_IMPORT_ERROR,
            },
        )
        return False

    def _handle_login(self, body: dict[str, Any]) -> None:
        if not self._ensure_edupage_available():
            return

        cfg = _read_json(CONFIG_FILE, {}) or {}
        subdomain = str(body.get("subdomain") or cfg.get("subdomain") or "").strip()
        # Allow passing full URL like https://schule.edupage.org
        subdomain = re.sub(r"^https?://", "", subdomain).split(".")[0].strip()

        username = str(body.get("username") or cfg.get("username") or "").strip()
        password = body.get("password")
        if not password and body.get("useSavedPassword"):
            password = cfg.get("password")
        password = str(password or "")
        remember = bool(body.get("rememberCredentials", False))

        if not subdomain or not username or not password:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Bitte Schul-Subdomain, Benutzername und Passwort angeben."},
            )
            return

        bad_creds_exc = getattr(edupage_exceptions, "BadCredentialsException", Exception)
        captcha_exc = getattr(edupage_exceptions, "CaptchaException", Exception)
        legacy_2fa_exc = getattr(edupage_exceptions, "SecondFactorLogin", None)
        two_fa_types = tuple(t for t in (TwoFactorLogin, legacy_2fa_exc) if t is not None)

        try:
            edupage = Edupage(request_timeout=15)
        except TypeError:
            edupage = Edupage()

        def _respond_2fa_required(two_fa_obj: Any) -> None:
            with SESSION.lock:
                SESSION.edupage = edupage
                SESSION.pending_2fa = two_fa_obj
                SESSION.subdomain = subdomain
                SESSION.username = username
            self._save_config(subdomain, username, password, remember)
            device_names = getattr(two_fa_obj, "device_names", None) or []
            email = getattr(two_fa_obj, "email", None)
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "2fa_required",
                    "email": email,
                    "deviceNames": device_names,
                    "message": "Bitte gib den 2FA-Bestätigungscode (E-Mail / App) ein oder bestätige in der EduPage-App.",
                },
            )

        try:
            res = edupage.login(username, password, subdomain)
            is_two_fa = (two_fa_types and isinstance(res, two_fa_types)) or (
                res is not None and (hasattr(res, "finish_with_code") or hasattr(res, "is_confirmed"))
            )
            if is_two_fa:
                _respond_2fa_required(res)
                return
        except bad_creds_exc:
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Benutzername oder Passwort falsch."})
            return
        except captcha_exc:
            self._send_json(
                HTTPStatus.FORBIDDEN,
                {
                    "error": (
                        "EduPage verlangt aktuell ein Captcha. Bitte einmal im Browser bei EduPage anmelden "
                        "und es anschließend erneut versuchen."
                    )
                },
            )
            return
        except Exception as exc:
            if two_fa_types and isinstance(exc, two_fa_types):
                _respond_2fa_required(exc)
                return
            self._send_json(HTTPStatus.BAD_GATEWAY, {"error": f"EduPage-Login fehlgeschlagen: {exc}"})
            return

        classes = edupage.get_classes() or []
        with SESSION.lock:
            SESSION.edupage = edupage
            SESSION.pending_2fa = None
            SESSION.subdomain = subdomain
            SESSION.username = username
            SESSION.classes_cache = list(classes)

        self._save_config(subdomain, username, password, remember)
        self._send_json(
            HTTPStatus.OK,
            {
                "status": "ok",
                "subdomain": subdomain,
                "username": username,
                "classes": _serialize_classes(classes),
            },
        )

    def _save_config(self, subdomain: str, username: str, password: str, remember: bool) -> None:
        data: dict[str, Any] = {
            "subdomain": subdomain,
            "username": username,
            "rememberCredentials": remember,
        }
        if remember:
            data["password"] = password
        _atomic_write_json(CONFIG_FILE, data, restrict_perms=True)

    def _handle_2fa(self, body: dict[str, Any]) -> None:
        action = str(body.get("action") or "code").strip()
        code = str(body.get("code") or "").strip()
        check_confirmed = bool(body.get("checkConfirmed", False)) or action == "check_confirmed"

        with SESSION.lock:
            edupage = SESSION.edupage
            pending = SESSION.pending_2fa
            subdomain = SESSION.subdomain
            username = SESSION.username

        if edupage is None or pending is None:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Keine offene 2FA-Anfrage vorhanden."})
            return

        retry_exc = getattr(edupage_exceptions, "RetryLaterException", Exception)
        failed_2fa_exc = getattr(edupage_exceptions, "SecondFactorFailedException", Exception)

        if action == "send_email":
            if not hasattr(pending, "send_email_code"):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "E-Mail-Code wird von dieser edupage-api Version nicht unterstützt."})
                return
            try:
                pending.send_email_code()
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "status": "email_sent",
                        "email": getattr(pending, "email", None),
                        "message": f"Bestätigungscode per E-Mail gesendet{f' ({pending.email})' if getattr(pending, 'email', None) else ''}.",
                    },
                )
            except retry_exc as exc:
                secs = getattr(exc, "retry_in_seconds", None)
                hint = f" (erneut versuchen in {secs} Sekunden)" if secs else ""
                self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": f"Zu früh erneut angefordert{hint}."})
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"error": f"E-Mail-Code konnte nicht gesendet werden: {exc}"})
            return

        try:
            if check_confirmed:
                if not hasattr(pending, "is_confirmed"):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Gerätebestätigung wird nicht unterstützt."})
                    return
                if not pending.is_confirmed():
                    self._send_json(
                        HTTPStatus.CONFLICT,
                        {"error": "Noch nicht auf dem Gerät bestätigt. Bitte Push-Meldung in der EduPage-App freigeben."},
                    )
                    return
                pending.finish()
            else:
                if not code:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Bitte 2FA-Code eingeben."})
                    return
                if hasattr(pending, "finish_with_code"):
                    pending.finish_with_code(code)
                elif hasattr(pending, "finish"):
                    pending.finish(code)
                elif hasattr(pending, "confirm"):
                    pending.confirm(code)
                else:
                    raise RuntimeError("Unbekannte 2FA-Schnittstelle in edupage-api.")
        except failed_2fa_exc as exc:
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": f"2FA-Code ungültig oder abgelaufen: {exc}"})
            return
        except Exception as exc:
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": f"2FA-Prüfung fehlgeschlagen: {exc}"})
            return

        classes = edupage.get_classes() or []
        with SESSION.lock:
            SESSION.pending_2fa = None
            SESSION.classes_cache = list(classes)

        self._send_json(
            HTTPStatus.OK,
            {
                "status": "ok",
                "subdomain": subdomain,
                "username": username,
                "classes": _serialize_classes(classes),
            },
        )

    def _handle_fetch_timetables(self, body: dict[str, Any]) -> None:
        if not self._ensure_edupage_available():
            return

        with SESSION.lock:
            edupage = SESSION.edupage
            classes_cache = list(SESSION.classes_cache)

        if edupage is None:
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Bitte zuerst bei EduPage anmelden."})
            return

        class_ids = set(str(x) for x in (body.get("classIds") or []))
        week_a_date_str = str(body.get("weekADate") or datetime.date.today().isoformat())
        week_b_date_str = body.get("weekBDate")
        use_short = bool(body.get("useShortSubjects", True))

        try:
            monday_a = _monday_of_date(week_a_date_str)
            monday_b = _monday_of_date(str(week_b_date_str)) if week_b_date_str else None
        except Exception as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Ungültiges Datum: {exc}"})
            return

        if not classes_cache:
            classes_cache = list(edupage.get_classes() or [])
            with SESSION.lock:
                SESSION.classes_cache = classes_cache

        selected_objs = []
        for cls_obj in classes_cache:
            cid = str(getattr(cls_obj, "class_id", getattr(cls_obj, "id", getattr(cls_obj, "name", ""))))
            cname = str(getattr(cls_obj, "name", cid))
            if not class_ids or cid in class_ids or cname in class_ids:
                selected_objs.append(cls_obj)

        if not selected_objs:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Keine passenden Klassen ausgewählt."})
            return

        schedules: list[dict[str, Any]] = []
        errors: list[str] = []

        for cls_obj in selected_objs:
            cname = str(getattr(cls_obj, "name", getattr(cls_obj, "short", "Unbekannt")))
            grade = getattr(cls_obj, "grade", None)
            try:
                subj_a, teachers_a = _fetch_week_schedule(edupage, cls_obj, monday_a, use_short)
                entry: dict[str, Any] = {
                    "className": cname,
                    "gradeLevel": _infer_grade_level(cname, grade),
                    "subjects": subj_a,
                }
                if teachers_a:
                    entry["subjectTeachers"] = teachers_a

                if monday_b is not None:
                    subj_b, teachers_b = _fetch_week_schedule(edupage, cls_obj, monday_b, use_short)
                    if subj_b != subj_a:
                        entry["subjectsB"] = subj_b
                        if teachers_b:
                            entry["subjectTeachersB"] = teachers_b

                schedules.append(entry)
            except Exception as exc:
                errors.append(f"{cname}: {exc}")

        self._send_json(
            HTTPStatus.OK,
            {
                "schedules": schedules,
                "errors": errors,
                "fetchedAt": datetime.datetime.now().isoformat(),
            },
        )


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), BridgeHandler)
    sys.stderr.write(f"[edupage-bridge] Läuft auf http://{HOST}:{PORT} (edupage-api={EDUPAGE_AVAILABLE})\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
