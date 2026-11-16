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
    trimmed = re.sub(r"\s+", " ", class_name.strip())
    if trimmed:
        # 1. Numeric-leading grades: "10A", "11b", "10-1", "10"
        m_num = re.match(r"^(\d{1,2})(?:[^0-9].*)?$", trimmed)
        if m_num:
            return m_num.group(1)

        # 2. Prefix + digits + explicit parallel suffix: "BG25a", "ITA24-1", "Q1b"
        m_suffix = re.match(
            r"^([A-Za-zÄÖÜäöüß]+)[- _/.]?(\d{1,4})(?:[-_ /.]+[A-Za-z0-9]+|[A-Za-z]+)$",
            trimmed,
        )
        if m_suffix:
            return f"{m_suffix.group(1)}{m_suffix.group(2)}"

        # 3. Berufskolleg <Abteilung><Stufe><Klasse>, e.g. "AIT11"/"AIT12" -> "AIT1", "AIT21" -> "AIT2"
        m_track = re.match(r"^([A-Za-zÄÖÜäöüß]+)[- _/.]?(\d)(\d)$", trimmed)
        if m_track:
            prefix, d1, d2 = m_track.group(1), m_track.group(2), m_track.group(3)
            is_calendar_year = d1 == "2" and int(d2) >= 4
            if not is_calendar_year and 1 <= int(d1) <= 4:
                return f"{prefix}{d1}"
            return f"{prefix}{d1}{d2}"

        # 4. Prefix + single digit: "AIT 1", "AIT2" -> "AIT1", "AIT2"
        m_single = re.match(r"^([A-Za-zÄÖÜäöüß]+)[- _/.]?(\d)$", trimmed)
        if m_single:
            return f"{m_single.group(1)}{m_single.group(2)}"

    if api_grade is not None and str(api_grade).strip():
        return str(api_grade).strip()

    fallback = re.sub(r"(?:[-_ /.]+[A-Za-z]+|[A-Za-z])$", "", trimmed)
    if fallback and re.search(r"\d", fallback) and len(fallback) >= 2:
        return fallback
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


def _extract_teachers(lesson: Any, full_names_out: dict[str, str] | None = None) -> list[str]:
    teachers = getattr(lesson, "teachers", None)
    if teachers is None:
        single = getattr(lesson, "teacher", None)
        teachers = [single] if single else []
    names: list[str] = []
    for t in teachers:
        if t is None:
            continue
        short_t = (getattr(t, "short", None) or "").strip()
        name_t = (getattr(t, "name", None) or "").strip()
        label = short_t or name_t
        if label:
            if label not in names:
                names.append(label)
            if full_names_out is not None and name_t:
                full_names_out[label] = name_t
    return names


def _fetch_week_schedule(
    edupage: Any,
    cls_obj: Any,
    monday_date: datetime.date,
    use_short_subjects: bool,
) -> tuple[dict[str, list[str]], dict[str, dict[str, list[str]]], dict[str, str]]:
    subjects_by_day: dict[str, list[str]] = {d: [] for d in DAY_NAMES}
    teachers_by_day: dict[str, dict[str, list[str]]] = {}
    teacher_full_names: dict[str, str] = {}

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
            t_list = _extract_teachers(lesson, teacher_full_names)
            if t_list:
                existing_t = day_teachers.setdefault(subj_label, [])
                for t in t_list:
                    if t not in existing_t:
                        existing_t.append(t)

        subjects_by_day[day_name] = day_subjects
        if day_teachers:
            teachers_by_day[day_name] = day_teachers

    return subjects_by_day, teachers_by_day, teacher_full_names


def _monday_of_date(date_str: str) -> datetime.date:
    d = datetime.date.fromisoformat(date_str)
    return d - datetime.timedelta(days=d.weekday())


def _build_subject_lookup(edupage: Any, use_short: bool) -> dict[str, str]:
    lookup: dict[str, str] = {}
    try:
        subjects = edupage.get_subjects() or []
        for s in subjects:
            sid = getattr(s, "subject_id", None)
            if sid is None:
                continue
            short_n = getattr(s, "short", None)
            full_n = getattr(s, "name", None)
            label = (short_n or full_n) if use_short else (full_n or short_n)
            if label:
                lookup[str(sid)] = str(label).strip()
    except Exception:
        pass
    return lookup


def _build_teacher_lookup(edupage: Any) -> dict[str, tuple[str, str]]:
    """Returns mapping teacher person_id -> (label, full_name)."""
    lookup: dict[str, tuple[str, str]] = {}
    try:
        teachers = edupage.get_teachers() or []
        for t in teachers:
            pid = getattr(t, "person_id", getattr(t, "id", None))
            if pid is None:
                continue
            short_t = (getattr(t, "short", None) or "").strip()
            name_t = (getattr(t, "name", None) or "").strip()
            label = short_t or name_t
            if label:
                lookup[str(pid)] = (label, name_t or label)
    except Exception:
        pass
    return lookup


def _parse_weeks_payload(
    weeks_payload: list[dict[str, Any]],
) -> list[tuple[str, datetime.date, datetime.date]]:
    parsed_weeks: list[tuple[str, datetime.date, datetime.date]] = []
    for w in weeks_payload:
        if not isinstance(w, dict):
            continue
        wid = str(w.get("id") or "")
        s_str = str(w.get("startDate") or "")
        e_str = str(w.get("endDate") or "")
        if s_str and e_str and wid:
            try:
                parsed_weeks.append(
                    (wid, datetime.date.fromisoformat(s_str[:10]), datetime.date.fromisoformat(e_str[:10]))
                )
                continue
            except Exception:
                pass
        year_val = w.get("year")
        wn_val = w.get("weekNumber")
        if wid and year_val is not None and wn_val is not None:
            try:
                y_int = int(year_val)
                wn_int = int(wn_val)
                parsed_weeks.append(
                    (
                        wid,
                        datetime.date.fromisocalendar(y_int, wn_int, 1),
                        datetime.date.fromisocalendar(y_int, wn_int, 5),
                    )
                )
            except Exception:
                continue
    return parsed_weeks


def _fetch_range_ttitems(
    edupage: Any,
    class_id: int | str,
    start_date: datetime.date,
    end_date: datetime.date,
) -> list[dict[str, Any]] | None:
    """Queries EduPage currentttGetData for a full date range in chunks."""
    try:
        school_year = edupage.get_school_year()
    except Exception:
        return None

    url = f"https://{edupage.subdomain}.edupage.org/timetable/server/currenttt.js?__func=curentttGetData"
    all_items: list[dict[str, Any]] = []
    chunk_start = start_date
    while chunk_start <= end_date:
        chunk_end = min(end_date, chunk_start + datetime.timedelta(days=27))
        payload = {
            "__args": [
                None,
                {
                    "year": school_year,
                    "datefrom": chunk_start.strftime("%Y-%m-%d"),
                    "dateto": chunk_end.strftime("%Y-%m-%d"),
                    "table": "classes",
                    "id": str(class_id),
                    "showColors": True,
                    "showIgroupsInClasses": True,
                    "showOrig": True,
                    "log_module": "CurrentTTView",
                },
            ],
            "__gsh": edupage.gsec_hash,
        }
        try:
            resp = edupage.session.post(url, json=payload)
            data = resp.json()
            r_obj = data.get("r") if isinstance(data, dict) else None
            if not isinstance(r_obj, dict) or r_obj.get("error") is not None:
                return None
            ttitems = r_obj.get("ttitems") or []
            if isinstance(ttitems, list):
                for item in ttitems:
                    if isinstance(item, dict):
                        all_items.append(item)
        except Exception:
            return None
        chunk_start = chunk_end + datetime.timedelta(days=1)

    return all_items


def _collect_timeline_holidays(
    edupage: Any,
    start_date: datetime.date,
    end_date: datetime.date,
) -> dict[str, str]:
    """Extracts holiday / free-day labels from EduPage timeline events if available."""
    labels_by_date: dict[str, str] = {}
    events: list[Any] = []

    for fetcher in (
        lambda: edupage.get_notifications() or [],
        lambda: edupage.get_notifications_history(start_date - datetime.timedelta(days=14)) or [],
    ):
        try:
            events.extend(fetcher())
        except Exception:
            pass

    holiday_types = {"holiday", "freeday", "sholiday"}
    for ev in events:
        if getattr(ev, "is_removed", False):
            continue
        ev_type = getattr(ev, "event_type", None)
        ev_type_val = getattr(ev_type, "value", str(ev_type or "")).lower()
        text = str(getattr(ev, "text", "") or "").strip()
        add_data = getattr(ev, "additional_data", None)
        is_holiday_type = ev_type_val in holiday_types or (
            ev_type_val == "ttcancel" and bool(re.search(r"ferien|feiertag|schulfrei|holiday", text, re.I))
        )
        if not is_holiday_type:
            continue

        label = text.splitlines()[0].strip()[:48] if text else "Ferien / Schulfrei"
        dates_covered: list[datetime.date] = []
        if isinstance(add_data, dict):
            df = add_data.get("datefrom") or add_data.get("dateFrom") or add_data.get("date")
            dt = add_data.get("dateto") or add_data.get("dateTo") or df
            if isinstance(df, str):
                try:
                    d1 = datetime.date.fromisoformat(df[:10])
                    d2 = datetime.date.fromisoformat(str(dt)[:10]) if dt else d1
                    cur = max(start_date, d1)
                    limit = min(end_date, d2)
                    while cur <= limit:
                        dates_covered.append(cur)
                        cur += datetime.timedelta(days=1)
                except Exception:
                    pass

        if not dates_covered:
            ts = getattr(ev, "timestamp", None) or getattr(ev, "event_time", None)
            if isinstance(ts, datetime.datetime):
                d = ts.date()
                if start_date <= d <= end_date:
                    dates_covered.append(d)

        for d in dates_covered:
            if d.weekday() < 5:
                labels_by_date.setdefault(d.isoformat(), label)

    return labels_by_date


def _sync_calendar_from_edupage(
    edupage: Any,
    class_objs: list[Any],
    weeks_payload: list[dict[str, Any]],
    ref_schedules: list[dict[str, Any]],
    use_short: bool,
) -> dict[str, Any]:
    if not weeks_payload or not class_objs:
        return {"blockedDays": {}, "holidayLabels": {}, "weekTypes": {}, "detectedHolidayCount": 0}

    ref_by_name: dict[str, dict[str, Any]] = {}
    for s in ref_schedules:
        if isinstance(s, dict) and s.get("className"):
            ref_by_name[str(s["className"])] = s

    # Pick up to 5 reference classes diversified across grade levels (preferring imported classes)
    ordered_objs: list[Any] = []
    seen_grades: set[str] = set()
    preferred_objs: list[Any] = []
    for cls_obj in class_objs:
        cname = str(getattr(cls_obj, "name", getattr(cls_obj, "short", "")))
        if cname in ref_by_name:
            preferred_objs.append(cls_obj)
    for cls_obj in preferred_objs + [c for c in class_objs if c not in preferred_objs]:
        cname = str(getattr(cls_obj, "name", getattr(cls_obj, "short", "")))
        g = _infer_grade_level(cname, getattr(cls_obj, "grade", None))
        if g not in seen_grades:
            seen_grades.add(g)
            ordered_objs.append(cls_obj)
    for cls_obj in preferred_objs + class_objs:
        if cls_obj not in ordered_objs:
            ordered_objs.append(cls_obj)
    sampled_objs = ordered_objs[:5]

    parsed_weeks: list[tuple[str, datetime.date, datetime.date]] = []
    for w in weeks_payload:
        wid = str(w.get("id") or "")
        s_str = str(w.get("startDate") or "")
        e_str = str(w.get("endDate") or "")
        if s_str and e_str and wid:
            parsed_weeks.append((wid, datetime.date.fromisoformat(s_str), datetime.date.fromisoformat(e_str)))
            continue
        year_val = w.get("year")
        wn_val = w.get("weekNumber")
        if wid and year_val is not None and wn_val is not None:
            try:
                y_int = int(year_val)
                wn_int = int(wn_val)
                parsed_weeks.append(
                    (
                        wid,
                        datetime.date.fromisocalendar(y_int, wn_int, 1),
                        datetime.date.fromisocalendar(y_int, wn_int, 5),
                    )
                )
            except Exception:
                continue

    if not parsed_weeks:
        return {"blockedDays": {}, "holidayLabels": {}, "weekTypes": {}, "detectedHolidayCount": 0, "activeSchoolDaysFound": 0}

    min_date = min(s for _, s, _ in parsed_weeks)
    max_date = max(e for _, _, e in parsed_weeks)

    subject_lookup = _build_subject_lookup(edupage, use_short)
    timeline_labels = _collect_timeline_holidays(edupage, min_date, max_date)

    # Track regular lesson count & subjects per date and class
    regular_count_by_date: dict[str, int] = {}
    event_label_by_date: dict[str, str] = {}
    # date_iso -> class_name -> set of subject labels
    subjects_by_date_cls: dict[str, dict[str, set[str]]] = {}
    used_range_query = False

    for cls_obj in sampled_objs:
        cname = str(getattr(cls_obj, "name", getattr(cls_obj, "short", "")))
        cid = getattr(cls_obj, "class_id", getattr(cls_obj, "id", None))
        if cid is None:
            continue
        items = _fetch_range_ttitems(edupage, cid, min_date, max_date)
        if items is None:
            continue
        # Check if range query actually includes per-item dates
        has_date_field = any(isinstance(it.get("date"), str) and len(it.get("date", "")) >= 10 for it in items)
        if items and not has_date_field:
            continue

        used_range_query = True
        for it in items:
            d_raw = it.get("date")
            if not isinstance(d_raw, str) or len(d_raw) < 10:
                continue
            d_iso = d_raw[:10]
            l_type = str(it.get("type") or "")
            is_removed = bool(it.get("removed"))
            is_event = l_type in ("event", "out") or bool(it.get("main"))
            is_cancelled = is_removed or l_type in ("absent", "")

            if is_event and d_iso not in event_label_by_date:
                flags = it.get("flags") if isinstance(it.get("flags"), dict) else {}
                ev_name = (
                    (flags.get("event") or {}).get("name")
                    if isinstance(flags.get("event"), dict)
                    else None
                ) or it.get("name")
                if isinstance(ev_name, str) and ev_name.strip():
                    if re.search(
                        r"ferien|feiertag|frei|holiday|bewegl|ausfall|unterrichtsfrei|pädagog|studien|konferenz|brückentag",
                        ev_name,
                        re.I,
                    ):
                        event_label_by_date[d_iso] = ev_name.strip()[:48]

            if is_cancelled or is_event:
                continue

            subj_id = it.get("subjectid")
            if not subj_id:
                continue

            regular_count_by_date[d_iso] = regular_count_by_date.get(d_iso, 0) + 1
            subj_label = subject_lookup.get(str(subj_id))
            if subj_label:
                subjects_by_date_cls.setdefault(d_iso, {}).setdefault(cname, set()).add(subj_label)

    # Fallback if range query didn't expose item dates: sample per day for first reference class
    if not used_range_query and sampled_objs:
        ref_cls = sampled_objs[0]
        ref_name = str(getattr(ref_cls, "name", getattr(ref_cls, "short", "")))
        cur = min_date
        while cur <= max_date:
            if cur.weekday() < 5:
                d_iso = cur.isoformat()
                try:
                    tt = edupage.get_timetable(ref_cls, cur)
                    lessons = getattr(tt, "lessons", None) or []
                    for lesson in lessons:
                        if getattr(lesson, "is_cancelled", False) or getattr(lesson, "is_event", False):
                            cur_txt = str(getattr(lesson, "curriculum", "") or "")
                            if cur_txt and re.search(
                                r"ferien|feiertag|frei|holiday|bewegl|ausfall|unterrichtsfrei|pädagog|studien|konferenz|brückentag",
                                cur_txt,
                                re.I,
                            ):
                                event_label_by_date.setdefault(d_iso, cur_txt[:48])
                            continue
                        lbl = _extract_subject_label(lesson, use_short)
                        if lbl:
                            regular_count_by_date[d_iso] = regular_count_by_date.get(d_iso, 0) + 1
                            subjects_by_date_cls.setdefault(d_iso, {}).setdefault(ref_name, set()).add(lbl)
                except Exception:
                    pass
            cur += datetime.timedelta(days=1)

    active_school_days = sum(1 for c in regular_count_by_date.values() if c > 0)

    blocked_days: dict[str, dict[str, bool]] = {}
    holiday_labels: dict[str, dict[str, str]] = {}
    week_types: dict[str, str] = {}
    detected_holiday_count = 0

    for wid, w_start, _w_end in parsed_weeks:
        score_a = 0
        score_b = 0
        has_ab_comparison = False

        for idx, day_name in enumerate(DAY_NAMES):
            d_obj = w_start + datetime.timedelta(days=idx)
            d_iso = d_obj.isoformat()
            reg_cnt = regular_count_by_date.get(d_iso, 0)
            explicit_label = timeline_labels.get(d_iso) or event_label_by_date.get(d_iso)

            # Treat as holiday/free day if explicitly marked OR no regular lessons while surrounding term has lessons
            if explicit_label or (active_school_days >= 2 and reg_cnt == 0):
                blocked_days.setdefault(wid, {})[day_name] = True
                holiday_labels.setdefault(wid, {})[day_name] = explicit_label or "Schulfrei / Ferien"
                detected_holiday_count += 1
                continue

            # Compare fetched subjects on this day against imported Week A & Week B schedules
            day_cls_map = subjects_by_date_cls.get(d_iso, {})
            for cname, actual_subjs in day_cls_map.items():
                ref = ref_by_name.get(cname)
                if not ref or not ref.get("subjectsB"):
                    continue
                subjs_a = set((ref.get("subjects") or {}).get(day_name) or [])
                subjs_b = set((ref.get("subjectsB") or {}).get(day_name) or [])
                if subjs_a == subjs_b:
                    continue
                has_ab_comparison = True
                # Symmetric match: subjects present only in A or only in B distinguish the week strongly
                only_a = subjs_a - subjs_b
                only_b = subjs_b - subjs_a
                score_a += len(actual_subjs & only_a) * 2 + len(actual_subjs & subjs_a)
                score_b += len(actual_subjs & only_b) * 2 + len(actual_subjs & subjs_b)

        if has_ab_comparison and score_a != score_b:
            week_types[wid] = "B" if score_b > score_a else "A"

    return {
        "blockedDays": blocked_days,
        "holidayLabels": holiday_labels,
        "weekTypes": week_types,
        "detectedHolidayCount": detected_holiday_count,
        "activeSchoolDaysFound": active_school_days,
    }


def _fetch_period_schedules(
    edupage: Any,
    selected_objs: list[Any],
    weeks_payload: list[dict[str, Any]],
    use_short: bool,
) -> dict[str, Any]:
    """
    Fetches concrete week-by-week schedules for every selected class across the
    selected Klausurzeitraum (`weeks_payload`), checking on every single day
    whether each class actually has lessons or is free (holidays, trips, etc.).
    """
    parsed_weeks = _parse_weeks_payload(weeks_payload)
    if not parsed_weeks or not selected_objs:
        return {
            "schedules": [],
            "errors": [],
            "blockedDays": {},
            "holidayLabels": {},
            "blockedClassDays": {},
            "activeSchoolDaysFound": 0,
        }

    min_date = min(s for _, s, _ in parsed_weeks)
    max_date = max(e for _, _, e in parsed_weeks)

    subject_lookup = _build_subject_lookup(edupage, use_short)
    teacher_lookup = _build_teacher_lookup(edupage)
    timeline_labels = _collect_timeline_holidays(edupage, min_date, max_date)

    # Global holiday keyword matcher (holidays/vacation/school-wide closures)
    holiday_kw_re = re.compile(
        r"ferien|feiertag|frei|holiday|bewegl|ausfall|unterrichtsfrei|pädagog|studien|konferenz|brückentag",
        re.I,
    )
    # Any event text matcher (also catches class-specific trips like Ausflug / Exkursion / Praktikum)
    any_event_re = re.compile(
        r"ferien|feiertag|frei|holiday|bewegl|ausfall|unterrichtsfrei|pädagog|studien|konferenz|brückentag|ausflug|wandertag|exkursion|praktikum|klassenfahrt|projekt",
        re.I,
    )

    per_class_raw: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    total_active_class_days = 0

    for cls_obj in selected_objs:
        cname = str(getattr(cls_obj, "name", getattr(cls_obj, "short", "Unbekannt")))
        cid = getattr(cls_obj, "class_id", getattr(cls_obj, "id", None))
        grade = getattr(cls_obj, "grade", None)

        subjects_by_date: dict[str, list[str]] = {}
        teachers_by_date: dict[str, dict[str, list[str]]] = {}
        event_by_date: dict[str, str] = {}
        cancelled_by_date: dict[str, int] = {}
        teacher_names: dict[str, str] = {}

        try:
            used_range = False
            if cid is not None:
                items = _fetch_range_ttitems(edupage, cid, min_date, max_date)
                if items is not None:
                    has_date_field = any(
                        isinstance(it.get("date"), str) and len(it.get("date", "")) >= 10
                        for it in items
                    )
                    if len(items) == 0 or has_date_field:
                        used_range = True
                        # Group items by date, then sort each day's lessons by (period, start_time)
                        by_date_items: dict[str, list[dict[str, Any]]] = {}
                        for it in items:
                            d_raw = it.get("date")
                            if not isinstance(d_raw, str) or len(d_raw) < 10:
                                continue
                            by_date_items.setdefault(d_raw[:10], []).append(it)

                        def _item_sort_key(it: dict[str, Any]) -> tuple[int, str]:
                            p_raw = str(it.get("uniperiod") or "")
                            p_num = int(p_raw) if p_raw.isdigit() else 999
                            st = str(it.get("starttime") or "")
                            return (p_num, st)

                        for d_iso, day_items in by_date_items.items():
                            day_items.sort(key=_item_sort_key)
                            for it in day_items:
                                if "header" in it and (
                                    not it.get("header")
                                    or (
                                        isinstance(it.get("header"), list)
                                        and isinstance(it["header"][0], dict)
                                        and it["header"][0].get("cmd") == "addlesson_t"
                                    )
                                ):
                                    continue
                                raw_type = it.get("type")
                                l_type = str(raw_type) if raw_type is not None else ""
                                is_removed = bool(it.get("removed"))
                                is_event = l_type in ("event", "out") or bool(it.get("main"))
                                is_cancelled = is_removed or raw_type in ("absent", "")

                                if is_event:
                                    flags = it.get("flags") if isinstance(it.get("flags"), dict) else {}
                                    ev_name = (
                                        (flags.get("event") or {}).get("name")
                                        if isinstance(flags.get("event"), dict)
                                        else None
                                    ) or (
                                        (flags.get("dp0") or {}).get("note_wd")
                                        if isinstance(flags.get("dp0"), dict)
                                        else None
                                    ) or it.get("name")
                                    if isinstance(ev_name, str) and ev_name.strip():
                                        if any_event_re.search(ev_name) or not it.get("subjectid"):
                                            event_by_date.setdefault(d_iso, ev_name.strip()[:48])
                                    continue

                                if is_cancelled:
                                    cancelled_by_date[d_iso] = cancelled_by_date.get(d_iso, 0) + 1
                                    continue

                                subj_id = it.get("subjectid")
                                if not subj_id:
                                    continue
                                subj_label = subject_lookup.get(str(subj_id))
                                if not subj_label:
                                    continue

                                subjects_by_date.setdefault(d_iso, []).append(subj_label)
                                t_ids = it.get("teacherids") or []
                                if isinstance(t_ids, list) and t_ids:
                                    t_map = teachers_by_date.setdefault(d_iso, {}).setdefault(subj_label, [])
                                    for tid in t_ids:
                                        t_info = teacher_lookup.get(str(tid))
                                        if not t_info:
                                            continue
                                        t_lbl, t_full = t_info
                                        if t_lbl not in t_map:
                                            t_map.append(t_lbl)
                                        if t_full:
                                            teacher_names[t_lbl] = t_full

            # Fallback per day if range endpoint did not include per-date fields
            if not used_range:
                for _, w_start, _ in parsed_weeks:
                    for idx in range(5):
                        d_obj = w_start + datetime.timedelta(days=idx)
                        d_iso = d_obj.isoformat()
                        lessons = _get_lessons_for_class_day(edupage, cls_obj, d_obj)

                        def _lesson_sort_key(l: Any) -> tuple[int, str]:
                            p = getattr(l, "period", None)
                            try:
                                p_num = int(p) if p is not None else 999
                            except Exception:
                                p_num = 999
                            return (p_num, str(getattr(l, "start_time", "") or ""))

                        lessons.sort(key=_lesson_sort_key)
                        for lesson in lessons:
                            if getattr(lesson, "is_event", False):
                                cur_txt = str(getattr(lesson, "curriculum", "") or "").strip()
                                if cur_txt:
                                    event_by_date.setdefault(d_iso, cur_txt[:48])
                                continue
                            if getattr(lesson, "is_cancelled", False):
                                cancelled_by_date[d_iso] = cancelled_by_date.get(d_iso, 0) + 1
                                continue
                            subj_label = _extract_subject_label(lesson, use_short)
                            if not subj_label:
                                continue
                            subjects_by_date.setdefault(d_iso, []).append(subj_label)
                            t_list = _extract_teachers(lesson, teacher_names)
                            if t_list:
                                existing_t = teachers_by_date.setdefault(d_iso, {}).setdefault(subj_label, [])
                                for t_lbl in t_list:
                                    if t_lbl not in existing_t:
                                        existing_t.append(t_lbl)

            total_active_class_days += sum(1 for s_list in subjects_by_date.values() if len(s_list) > 0)
            per_class_raw[cname] = {
                "cname": cname,
                "grade": grade,
                "subjects_by_date": subjects_by_date,
                "teachers_by_date": teachers_by_date,
                "event_by_date": event_by_date,
                "cancelled_by_date": cancelled_by_date,
                "teacher_names": teacher_names,
            }
        except Exception as exc:
            errors.append(f"{cname}: {exc}")

    # Build concrete weeklySchedules + detect global holidays vs class-specific free days
    blocked_days: dict[str, dict[str, bool]] = {}
    holiday_labels: dict[str, dict[str, str]] = {}
    blocked_class_days: dict[str, dict[str, dict[str, bool]]] = {}

    class_names_fetched = list(per_class_raw.keys())

    # Pre-initialize per-class output containers
    schedules_out: list[dict[str, Any]] = []
    class_week_maps: dict[str, dict[str, dict[str, Any]]] = {c: {} for c in class_names_fetched}

    for wid, w_start, _ in parsed_weeks:
        for idx, day_name in enumerate(DAY_NAMES):
            d_iso = (w_start + datetime.timedelta(days=idx)).isoformat()
            tl_label = timeline_labels.get(d_iso)

            # Check per-class lesson counts and explicit event reasons for this date
            classes_with_lessons = 0
            explicit_holiday_label = tl_label
            for cname in class_names_fetched:
                raw = per_class_raw[cname]
                if len(raw["subjects_by_date"].get(d_iso, [])) > 0:
                    classes_with_lessons += 1
                elif not explicit_holiday_label:
                    ev = raw["event_by_date"].get(d_iso)
                    if ev and holiday_kw_re.search(ev):
                        explicit_holiday_label = ev

            all_classes_free = (
                len(class_names_fetched) > 0
                and total_active_class_days >= 1
                and classes_with_lessons == 0
            )
            is_global_holiday = bool(explicit_holiday_label) or all_classes_free

            if is_global_holiday:
                global_label = explicit_holiday_label or "Schulfrei / Ferien"
                blocked_days.setdefault(wid, {})[day_name] = True
                holiday_labels.setdefault(wid, {})[day_name] = global_label

            for cname in class_names_fetched:
                raw = per_class_raw[cname]
                w_data = class_week_maps[cname].setdefault(
                    wid,
                    {
                        "subjects": {d: [] for d in DAY_NAMES},
                        "subjectTeachers": {},
                        "freeDays": {},
                    },
                )
                day_subjs = raw["subjects_by_date"].get(d_iso, [])
                day_teach = raw["teachers_by_date"].get(d_iso, {})

                w_data["subjects"][day_name] = list(day_subjs)
                if day_teach:
                    w_data["subjectTeachers"][day_name] = {k: list(v) for k, v in day_teach.items()}

                if len(day_subjs) == 0 and (total_active_class_days >= 1 or bool(tl_label) or bool(raw["event_by_date"].get(d_iso))):
                    reason = (
                        tl_label
                        or raw["event_by_date"].get(d_iso)
                        or explicit_holiday_label
                        or ("Unterricht entfällt" if raw["cancelled_by_date"].get(d_iso, 0) > 0 else "Kein Unterricht")
                    )
                    w_data["freeDays"][day_name] = reason
                    if not is_global_holiday:
                        blocked_class_days.setdefault(cname, {}).setdefault(wid, {})[day_name] = True

    for cname in class_names_fetched:
        raw = per_class_raw[cname]
        weekly_schedules = class_week_maps[cname]

        # Build representative fallback subjects & teachers across weeks (for SubjectSelection / fallback)
        # Prefer the first week that actually has lessons for each weekday so blocked holidays don't leave Monday empty everywhere
        fallback_subjects: dict[str, list[str]] = {d: [] for d in DAY_NAMES}
        fallback_teachers: dict[str, dict[str, list[str]]] = {}
        for day_name in DAY_NAMES:
            seen_day_subjs: list[str] = []
            for wid, _, _ in parsed_weeks:
                w_subjs = weekly_schedules[wid]["subjects"].get(day_name, [])
                for s in w_subjs:
                    if s not in seen_day_subjs:
                        seen_day_subjs.append(s)
                w_teach = weekly_schedules[wid]["subjectTeachers"].get(day_name, {})
                for s, t_list in w_teach.items():
                    dest = fallback_teachers.setdefault(day_name, {}).setdefault(s, [])
                    for t in t_list:
                        if t not in dest:
                            dest.append(t)
            fallback_subjects[day_name] = seen_day_subjs

        # Clean empty dicts inside weeklySchedules
        cleaned_weekly: dict[str, dict[str, Any]] = {}
        for wid, w_data in weekly_schedules.items():
            w_entry: dict[str, Any] = {"subjects": w_data["subjects"]}
            if w_data["subjectTeachers"]:
                w_entry["subjectTeachers"] = w_data["subjectTeachers"]
            if w_data["freeDays"]:
                w_entry["freeDays"] = w_data["freeDays"]
            cleaned_weekly[wid] = w_entry

        entry: dict[str, Any] = {
            "className": cname,
            "gradeLevel": _infer_grade_level(cname, raw["grade"]),
            "subjects": fallback_subjects,
            "weeklySchedules": cleaned_weekly,
        }
        if fallback_teachers:
            entry["subjectTeachers"] = fallback_teachers
        if raw["teacher_names"]:
            entry["teacherNames"] = raw["teacher_names"]

        schedules_out.append(entry)

    return {
        "schedules": schedules_out,
        "errors": errors,
        "blockedDays": blocked_days,
        "holidayLabels": holiday_labels,
        "blockedClassDays": blocked_class_days,
        "activeSchoolDaysFound": total_active_class_days,
    }


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

        if path == "/api/edupage/sync-calendar":
            self._handle_sync_calendar(body)
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
        use_short = bool(body.get("useShortSubjects", True))
        weeks_payload = body.get("weeks")

        if not isinstance(weeks_payload, list) or not weeks_payload:
            # Fallback if called without explicit weeks array
            week_a_date_str = str(body.get("weekADate") or datetime.date.today().isoformat())
            try:
                monday_a = _monday_of_date(week_a_date_str)
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Ungültiges Datum: {exc}"})
                return
            iso_y, iso_w, _ = monday_a.isocalendar()
            weeks_payload = [
                {
                    "id": f"{iso_y}-KW{iso_w:02d}",
                    "year": iso_y,
                    "weekNumber": iso_w,
                    "startDate": monday_a.isoformat(),
                    "endDate": (monday_a + datetime.timedelta(days=4)).isoformat(),
                }
            ]

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

        result = _fetch_period_schedules(edupage, selected_objs, weeks_payload, use_short)
        result["fetchedAt"] = datetime.datetime.now().isoformat()
        self._send_json(HTTPStatus.OK, result)

    def _handle_sync_calendar(self, body: dict[str, Any]) -> None:
        if not self._ensure_edupage_available():
            return

        with SESSION.lock:
            edupage = SESSION.edupage
            classes_cache = list(SESSION.classes_cache)

        if edupage is None:
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Bitte zuerst bei EduPage anmelden."})
            return

        weeks_payload = body.get("weeks") or []
        if not isinstance(weeks_payload, list) or not weeks_payload:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Erwarte nicht-leere 'weeks'-Liste."})
            return

        if not classes_cache:
            classes_cache = list(edupage.get_classes() or [])
            with SESSION.lock:
                SESSION.classes_cache = classes_cache

        class_ids = set(str(x) for x in (body.get("classIds") or []))
        selected_objs = []
        for cls_obj in classes_cache:
            cid = str(getattr(cls_obj, "class_id", getattr(cls_obj, "id", getattr(cls_obj, "name", ""))))
            cname = str(getattr(cls_obj, "name", cid))
            if not class_ids or cid in class_ids or cname in class_ids:
                selected_objs.append(cls_obj)
        if not selected_objs:
            selected_objs = classes_cache

        ref_schedules = body.get("referenceSchedules") or []
        use_short = bool(body.get("useShortSubjects", True))

        try:
            result = _sync_calendar_from_edupage(
                edupage,
                selected_objs,
                weeks_payload,
                ref_schedules if isinstance(ref_schedules, list) else [],
                use_short,
            )
            result["syncedAt"] = datetime.datetime.now().isoformat()
            self._send_json(HTTPStatus.OK, result)
        except Exception as exc:
            self._send_json(HTTPStatus.BAD_GATEWAY, {"error": f"Kalender-Abgleich mit EduPage fehlgeschlagen: {exc}"})


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
