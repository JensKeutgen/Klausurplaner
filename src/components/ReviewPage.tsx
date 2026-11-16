import { useEffect, useMemo, useState } from 'react';
import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  type DayWishType,
  type Exam,
  type ExamChangePreference,
  type ExamFeedbackStatus,
  type ReviewDayWish,
  type ReviewExamFeedback,
  type ReviewPlanData,
  type ReviewSubmission,
  type Week,
} from '../types';
import {
  extractTeacherCodes,
  fetchColleaguePlan,
  fetchPlanMeta,
  getExamTeachersNormalized,
  getOrCreateReviewerToken,
  getSavedTeacherCode,
  getTeacherClasses,
  saveTeacherCode,
  submitColleagueFeedback,
  unlockReviewPlan,
} from '../logic/reviewClient';
import {
  formatISODate,
  formatShortDate,
  getISOWeek,
  getWeekDateRangeString,
  getWeekDayDate,
} from '../logic/dateUtils';
import {
  AlertCircle,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Lock,
  Plus,
  Send,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';

interface ReviewPageProps {
  planId: string;
}

const GERMAN_DAY_SHORT: Record<DayOfWeek, string> = {
  Monday: 'Mo',
  Tuesday: 'Di',
  Wednesday: 'Mi',
  Thursday: 'Do',
  Friday: 'Fr',
};

const GERMAN_DAY_FULL: Record<DayOfWeek, string> = {
  Monday: 'Montag',
  Tuesday: 'Dienstag',
  Wednesday: 'Mittwoch',
  Thursday: 'Donnerstag',
  Friday: 'Freitag',
};

const DAY_ORDER: Record<DayOfWeek, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
};

interface DraftExamFeedback {
  examId: string;
  className: string;
  subject: string;
  status: ExamFeedbackStatus;
  preference: ExamChangePreference | null;
  note: string;
  resolutionStatus?: 'open' | 'applied' | 'dismissed';
  resolutionNote?: string;
}

interface DraftDayWish {
  id: string;
  weekId: string;
  day: DayOfWeek;
  className: string | null;
  wishType: DayWishType;
  note: string;
  resolutionStatus?: 'open' | 'applied' | 'dismissed';
  resolutionNote?: string;
}

interface CalendarSlotInfo {
  weekId: string;
  day: DayOfWeek;
  week: Week;
  isGlobalBlocked: boolean;
}

export function ReviewPage({ planId }: ReviewPageProps) {
  const reviewerToken = useMemo(() => getOrCreateReviewerToken(planId), [planId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    title: string;
    isActive: boolean;
    updatedAt: string;
    unlocked: boolean;
  } | null>(null);

  const [passcode, setPasscode] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [plan, setPlan] = useState<ReviewPlanData | null>(null);
  const [savedSubmission, setSavedSubmission] = useState<ReviewSubmission | null>(null);

  // Teacher identification
  const [teacherCode, setTeacherCode] = useState(() => getSavedTeacherCode(planId));
  const [customTeacherInput, setCustomTeacherInput] = useState('');
  const [isChangingTeacher, setIsChangingTeacher] = useState(false);

  // Expandable sections:
  // 1) Compact day calendar under "Meine Klausuren" (starts collapsed)
  const [showDayCalendar, setShowDayCalendar] = useState(false);
  // 2) Full overview schedule at the bottom (starts collapsed)
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [onlyMyClassesInOverview, setOnlyMyClassesInOverview] = useState(false);
  const [highlightMyExams, setHighlightMyExams] = useState(true);

  // Mini month calendar states (day wish picker + exam overview calendar)
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [examCalMonth, setExamCalMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [highlightedExamCardId, setHighlightedExamCardId] = useState<string | null>(null);

  // Draft feedback state
  const [examFeedbackMap, setExamFeedbackMap] = useState<Record<string, DraftExamFeedback>>({});
  const [extraExamIds, setExtraExamIds] = useState<string[]>([]);
  const [showExtraExamPicker, setShowExtraExamPicker] = useState(false);

  const [dayWishes, setDayWishes] = useState<DraftDayWish[]>([]);
  const [wishMode, setWishMode] = useState<DayWishType>('no_go');
  const [wishClassScope, setWishClassScope] = useState<string>('ALL_MY_CLASSES');

  const [generalNote, setGeneralNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hydrateFromSubmission = (sub: ReviewSubmission | null) => {
    setSavedSubmission(sub);
    if (!sub) return;
    if (sub.teacherCode) {
      setTeacherCode(sub.teacherCode);
      saveTeacherCode(planId, sub.teacherCode);
    }
    setGeneralNote(sub.generalNote || '');

    const efMap: Record<string, DraftExamFeedback> = {};
    for (const ef of sub.examFeedback || []) {
      efMap[ef.examId] = {
        examId: ef.examId,
        className: ef.className,
        subject: ef.subject,
        status: ef.status,
        preference: ef.preference,
        note: ef.note || '',
        resolutionStatus: ef.resolutionStatus,
        resolutionNote: ef.resolutionNote,
      };
    }
    setExamFeedbackMap(efMap);
    setDayWishes(
      (sub.dayWishes || []).map((dw: ReviewDayWish) => ({
        id: dw.id,
        weekId: dw.weekId,
        day: dw.day,
        className: dw.className,
        wishType: dw.wishType,
        note: dw.note || '',
        resolutionStatus: dw.resolutionStatus,
        resolutionNote: dw.resolutionNote,
      }))
    );
  };

  const loadPlan = async () => {
    try {
      const res = await fetchColleaguePlan(planId, reviewerToken);
      setPlan(res.plan);
      hydrateFromSubmission(res.mySubmission);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan konnte nicht geladen werden.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPlanMeta(planId)
      .then(async (m) => {
        if (cancelled) return;
        setMeta(m);
        if (m.unlocked) {
          await loadPlan();
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Abstimmungsplan nicht gefunden.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  // Jump mini calendars automatically to first exam week's month once plan loads
  useEffect(() => {
    if (!plan || plan.snapshot.weeks.length === 0) return;
    const firstActiveWeek = plan.snapshot.weeks.find((w) => !w.isBlocked) || plan.snapshot.weeks[0];
    const monday = getWeekDayDate(firstActiveWeek, 0);
    const initialMonth = new Date(monday.getFullYear(), monday.getMonth(), 1);
    setCalendarMonth(initialMonth);
    setExamCalMonth(initialMonth);
  }, [plan]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await unlockReviewPlan(planId, passcode.trim());
      setMeta((prev) => (prev ? { ...prev, unlocked: true } : prev));
      await loadPlan();
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Zugangscode ungültig.');
    } finally {
      setUnlocking(false);
    }
  };

  const allTeacherCodes = useMemo(
    () => (plan ? extractTeacherCodes(plan.snapshot.classes) : []),
    [plan]
  );

  const normalizedTeacherCode = teacherCode.trim().toUpperCase();

  const myClasses = useMemo(() => {
    if (!plan || !normalizedTeacherCode) return [];
    return getTeacherClasses(plan.snapshot.classes, normalizedTeacherCode);
  }, [plan, normalizedTeacherCode]);

  const myExams = useMemo(() => {
    if (!plan || !normalizedTeacherCode) return [];
    const weekOrder = new Map(plan.snapshot.weeks.map((w, idx) => [w.id, idx]));

    const matching = plan.snapshot.exams.filter((exam) => {
      if (extraExamIds.includes(exam.id) || examFeedbackMap[exam.id]) return true;
      const teachers = getExamTeachersNormalized(exam, plan.snapshot.classes, plan.snapshot.weeks);
      return teachers.includes(normalizedTeacherCode);
    });

    return matching.sort((a, b) => {
      const wa = a.assignedWeekId ? weekOrder.get(a.assignedWeekId) ?? 999 : 999;
      const wb = b.assignedWeekId ? weekOrder.get(b.assignedWeekId) ?? 999 : 999;
      if (wa !== wb) return wa - wb;
      const da = a.assignedDay ? DAY_ORDER[a.assignedDay] : 99;
      const db = b.assignedDay ? DAY_ORDER[b.assignedDay] : 99;
      if (da !== db) return da - db;
      return a.className.localeCompare(b.className, 'de');
    });
  }, [plan, normalizedTeacherCode, extraExamIds, examFeedbackMap]);

  const otherExams = useMemo(() => {
    if (!plan) return [];
    const mySet = new Set(myExams.map((e) => e.id));
    return plan.snapshot.exams
      .filter((e) => !mySet.has(e.id))
      .sort((a, b) => a.className.localeCompare(b.className, 'de') || a.subject.localeCompare(b.subject, 'de'));
  }, [plan, myExams]);

  // Lookup map: ISO date ('YYYY-MM-DD') -> slot info for the mini month calendar
  const dateSlotMap = useMemo(() => {
    const map = new Map<string, CalendarSlotInfo>();
    if (!plan) return map;
    for (const week of plan.snapshot.weeks) {
      for (const day of DAYS_OF_WEEK) {
        const d = getWeekDayDate(week, day);
        const iso = formatISODate(d);
        const isGlobalBlocked = week.isBlocked || Boolean(plan.snapshot.blockedDays[week.id]?.[day]);
        map.set(iso, { weekId: week.id, day, week, isGlobalBlocked });
      }
    }
    return map;
  }, [plan]);

  // Distinct months covered by the exam period for quick mobile month jumping
  const planMonths = useMemo(() => {
    if (!plan) return [];
    const seen = new Map<string, Date>();
    for (const week of plan.snapshot.weeks) {
      for (const idx of [0, 4] as const) {
        const d = getWeekDayDate(week, idx);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!seen.has(key)) {
          seen.set(key, new Date(d.getFullYear(), d.getMonth(), 1));
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.getTime() - b.getTime());
  }, [plan]);

  // Map & set of ISO dates where the colleague already has exams assigned
  const { myExamIsoDates, myExamsByIsoDate } = useMemo(() => {
    const set = new Set<string>();
    const map = new Map<string, Exam[]>();
    if (!plan) return { myExamIsoDates: set, myExamsByIsoDate: map };
    for (const exam of myExams) {
      if (!exam.assignedWeekId || !exam.assignedDay) continue;
      const week = plan.snapshot.weeks.find((w) => w.id === exam.assignedWeekId);
      if (!week) continue;
      const iso = formatISODate(getWeekDayDate(week, exam.assignedDay));
      set.add(iso);
      const list = map.get(iso) || [];
      list.push(exam);
      map.set(iso, list);
    }
    return { myExamIsoDates: set, myExamsByIsoDate: map };
  }, [plan, myExams]);

  const sortedDayWishes = useMemo(() => {
    if (!plan) return dayWishes;
    const weekOrder = new Map(plan.snapshot.weeks.map((w, idx) => [w.id, idx]));
    return [...dayWishes].sort((a, b) => {
      const wa = weekOrder.get(a.weekId) ?? 999;
      const wb = weekOrder.get(b.weekId) ?? 999;
      if (wa !== wb) return wa - wb;
      const da = DAY_ORDER[a.day] ?? 99;
      const db = DAY_ORDER[b.day] ?? 99;
      return da - db;
    });
  }, [dayWishes, plan]);

  const selectTeacher = (code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setTeacherCode(clean);
    saveTeacherCode(planId, clean);
    setIsChangingTeacher(false);
    setCustomTeacherInput('');
  };

  const setExamStatus = (exam: Exam, status: ExamFeedbackStatus) => {
    setSubmitMessage(null);
    setExamFeedbackMap((prev) => {
      const existing = prev[exam.id];
      return {
        ...prev,
        [exam.id]: {
          examId: exam.id,
          className: exam.className,
          subject: exam.subject,
          status,
          preference: status === 'not_ok' ? existing?.preference || 'later' : null,
          note: existing?.note || '',
          resolutionStatus: existing?.resolutionStatus,
          resolutionNote: existing?.resolutionNote,
        },
      };
    });
  };

  const setExamPreference = (exam: Exam, preference: ExamChangePreference) => {
    setSubmitMessage(null);
    setExamFeedbackMap((prev) => {
      const existing = prev[exam.id];
      return {
        ...prev,
        [exam.id]: {
          examId: exam.id,
          className: exam.className,
          subject: exam.subject,
          status: 'not_ok',
          preference,
          note: existing?.note || '',
          resolutionStatus: existing?.resolutionStatus,
          resolutionNote: existing?.resolutionNote,
        },
      };
    });
  };

  const setExamNote = (exam: Exam, note: string) => {
    setSubmitMessage(null);
    setExamFeedbackMap((prev) => {
      const existing = prev[exam.id];
      return {
        ...prev,
        [exam.id]: {
          examId: exam.id,
          className: exam.className,
          subject: exam.subject,
          status: existing?.status || 'not_ok',
          preference: existing?.preference || 'later',
          note,
          resolutionStatus: existing?.resolutionStatus,
          resolutionNote: existing?.resolutionNote,
        },
      };
    });
  };

  const markAllOpenAsOk = () => {
    setSubmitMessage(null);
    setExamFeedbackMap((prev) => {
      const next = { ...prev };
      for (const exam of myExams) {
        if (!next[exam.id]) {
          next[exam.id] = {
            examId: exam.id,
            className: exam.className,
            subject: exam.subject,
            status: 'ok',
            preference: null,
            note: '',
          };
        }
      }
      return next;
    });
  };

  const toggleWishDay = (weekId: string, day: DayOfWeek) => {
    if (!plan?.isActive) return;
    setSubmitMessage(null);
    const scopeClass = wishClassScope === 'ALL_MY_CLASSES' ? null : wishClassScope;

    setDayWishes((prev) => {
      const existingIdx = prev.findIndex(
        (w) => w.weekId === weekId && w.day === day && (w.className || null) === scopeClass
      );
      if (existingIdx >= 0) {
        const existing = prev[existingIdx];
        if (existing.wishType === wishMode) {
          return prev.filter((_, i) => i !== existingIdx);
        }
        return prev.map((item, i) => (i === existingIdx ? { ...item, wishType: wishMode } : item));
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          weekId,
          day,
          className: scopeClass,
          wishType: wishMode,
          note: '',
        },
      ];
    });
  };

  const updateWishNote = (id: string, note: string) => {
    setSubmitMessage(null);
    setDayWishes((prev) => prev.map((w) => (w.id === id ? { ...w, note } : w)));
  };

  const removeWish = (id: string) => {
    setSubmitMessage(null);
    setDayWishes((prev) => prev.filter((w) => w.id !== id));
  };

  const handleSubmit = async () => {
    if (!plan || !normalizedTeacherCode) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitMessage(null);

    try {
      const feedbackList: ReviewExamFeedback[] = myExams
        .map((exam) => examFeedbackMap[exam.id])
        .filter((item): item is DraftExamFeedback => Boolean(item))
        .map((item) => ({
          id: item.examId,
          examId: item.examId,
          className: item.className,
          subject: item.subject,
          status: item.status,
          preference: item.preference,
          note: item.note,
          resolutionStatus: item.resolutionStatus || 'open',
          resolutionNote: item.resolutionNote || '',
        }));

      const res = await submitColleagueFeedback(plan.id, {
        teacherCode: normalizedTeacherCode,
        reviewerToken,
        generalNote,
        examFeedback: feedbackList.map((f) => ({
          examId: f.examId,
          className: f.className,
          subject: f.subject,
          status: f.status,
          preference: f.preference,
          note: f.note,
        })),
        dayWishes: dayWishes.map((w) => ({
          id: w.id,
          weekId: w.weekId,
          day: w.day,
          className: w.className,
          wishType: w.wishType,
          note: w.note,
        })),
      });
      hydrateFromSubmission(res.submission);
      setSubmitMessage('Vielen Dank! Deine Rückmeldung wurde gespeichert.');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Speichern.');
    } finally {
      setSubmitting(false);
    }
  };

  const getExamDateParts = (exam: Exam) => {
    if (!plan || !exam.assignedWeekId || !exam.assignedDay) return null;
    const week = plan.snapshot.weeks.find((w) => w.id === exam.assignedWeekId);
    if (!week) return null;
    const d = getWeekDayDate(week, exam.assignedDay);
    return {
      dayShort: GERMAN_DAY_SHORT[exam.assignedDay],
      dayFull: GERMAN_DAY_FULL[exam.assignedDay],
      shortDate: formatShortDate(d),
      weekNumber: week.weekNumber,
      iso: formatISODate(d),
    };
  };

  const formatExamDateLabel = (exam: Exam) => {
    const parts = getExamDateParts(exam);
    if (!parts) return exam.assignedWeekId || 'Noch nicht terminiert';
    return `${parts.dayFull}, ${parts.shortDate} · KW ${parts.weekNumber}`;
  };

  const formatWishDateLabel = (weekId: string, day: DayOfWeek) => {
    if (!plan) return `${weekId} ${GERMAN_DAY_SHORT[day]}`;
    const week = plan.snapshot.weeks.find((w) => w.id === weekId);
    if (!week) return `${weekId} ${GERMAN_DAY_SHORT[day]}`;
    const d = getWeekDayDate(week, day);
    return `${GERMAN_DAY_SHORT[day]}, ${formatShortDate(d)} (KW ${week.weekNumber})`;
  };

  const buildMonthRows = (monthDate: Date) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let startDay = firstDay.getDay() - 1;
    if (startDay === -1) startDay = 6;

    const totalSlots = Math.ceil((startDay + daysInMonth) / 7) * 7;
    const rows: { kw: number; cells: Array<Date | null> }[] = [];

    for (let rowStart = 0; rowStart < totalSlots; rowStart += 7) {
      const cells: Array<Date | null> = [];
      let sampleDate: Date | null = null;
      for (let col = 0; col < 7; col++) {
        const dayNum = rowStart + col - startDay + 1;
        if (dayNum >= 1 && dayNum <= daysInMonth) {
          const d = new Date(year, month, dayNum);
          cells.push(d);
          if (!sampleDate) sampleDate = d;
        } else {
          cells.push(null);
        }
      }
      const kw = sampleDate ? getISOWeek(sampleDate) : 0;
      rows.push({ kw, cells });
    }
    return rows;
  };

  const calendarRows = useMemo(() => buildMonthRows(calendarMonth), [calendarMonth]);

  // Compact Mon-Fri rows for the "Meine Klausuren" overview calendar
  const examCalendarRows = useMemo(() => {
    return buildMonthRows(examCalMonth)
      .map((r) => ({ kw: r.kw, cells: r.cells.slice(0, 5) }))
      .filter((r) => r.cells.some((c) => c !== null));
  }, [examCalMonth]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Lade Klausurplan...</div>
      </div>
    );
  }

  if (error && !meta) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <div
          className="ui-card"
          style={{ padding: '1.5rem', maxWidth: '420px', width: '100%', textAlign: 'center' }}
        >
          <AlertCircle size={32} color="var(--accent-danger)" style={{ marginBottom: '0.75rem' }} />
          <h2 style={{ fontSize: '1.15rem', marginBottom: '0.5rem' }}>Plan nicht verfügbar</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{error}</p>
        </div>
      </div>
    );
  }

  // Step 1: Passcode Gate
  if (meta && !meta.unlocked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <form
          onSubmit={handleUnlock}
          className="ui-card"
          style={{
            width: '100%',
            maxWidth: '400px',
            padding: '1.5rem',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.65rem' }}>
            <Lock size={22} color="var(--accent-primary)" />
            <h1 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{meta.title}</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.15rem' }}>
            Bitte gib den Zugangscode aus der Rundmail ein, um deine Klausuren zu prüfen.
          </p>

          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Zugangscode
          </label>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Code eingeben..."
            autoFocus
            className="ui-input"
            style={{
              padding: '0.7rem 0.85rem',
              fontSize: '16px',
              marginBottom: '0.9rem',
            }}
          />

          {unlockError && (
            <div style={{ color: 'var(--accent-danger)', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
              {unlockError}
            </div>
          )}

          <button
            type="submit"
            disabled={unlocking || !passcode.trim()}
            className="ui-btn ui-btn-primary"
            style={{ width: '100%', padding: '0.75rem', fontSize: '0.95rem', minHeight: '44px' }}
          >
            {unlocking ? 'Prüfe Code...' : 'Plan öffnen'}
          </button>
        </form>
      </div>
    );
  }

  if (!plan) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        {error || 'Plan wird geladen...'}
      </div>
    );
  }

  // Step 2: Select Kürzel if not chosen yet
  if (!normalizedTeacherCode || isChangingTeacher) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <div
          className="ui-card"
          style={{
            width: '100%',
            maxWidth: '520px',
            padding: '1.4rem',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <UserCheck size={22} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
              <h1 style={{ fontSize: '1.15rem', fontWeight: 700, wordBreak: 'break-word' }}>{plan.title}</h1>
            </div>
            {normalizedTeacherCode && (
              <button
                type="button"
                onClick={() => setIsChangingTeacher(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.85rem', flexShrink: 0 }}
              >
                Abbrechen
              </button>
            )}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.1rem' }}>
            Wähle dein Kürzel aus – du siehst danach direkt übersichtlich deine eigenen Klausuren.
          </p>

          {allTeacherCodes.length > 0 && (
            <div style={{ marginBottom: '1.1rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Kürzel im Plan:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', maxHeight: '230px', overflowY: 'auto' }}>
                {allTeacherCodes.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => selectTeacher(code)}
                    style={{
                      padding: '0.5rem 0.85rem',
                      minHeight: '38px',
                      borderRadius: '8px',
                      border: code === normalizedTeacherCode ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: code === normalizedTeacherCode ? 'var(--accent-soft)' : 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '0.88rem',
                    }}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              selectTeacher(customTeacherInput);
            }}
            style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
          >
            <input
              type="text"
              value={customTeacherInput}
              onChange={(e) => setCustomTeacherInput(e.target.value)}
              placeholder="Oder Kürzel eintippen (z. B. MÜL)..."
              className="ui-input"
              style={{ flex: '1 1 180px', padding: '0.65rem 0.85rem', fontSize: '16px' }}
            />
            <button
              type="submit"
              disabled={!customTeacherInput.trim()}
              className="ui-btn ui-btn-primary"
              style={{ minHeight: '42px', padding: '0 1.1rem' }}
            >
              Weiter
            </button>
          </form>
        </div>
      </div>
    );
  }

  const overviewClasses = onlyMyClassesInOverview
    ? plan.snapshot.classes.filter((c) => myClasses.includes(c.className))
    : plan.snapshot.classes;

  const myExamIdsSet = new Set(myExams.map((e) => e.id));
  const answeredCount = myExams.filter((e) => Boolean(examFeedbackMap[e.id])).length;
  const noGoCount = dayWishes.filter((w) => w.wishType === 'no_go').length;
  const preferCount = dayWishes.filter((w) => w.wishType === 'prefer').length;

  return (
    <div style={{ padding: 'clamp(0.75rem, 2.5vw, 1.5rem)', width: '100%' }}>
      {/* Centered compact container for colleague workflow */}
      <div style={{ maxWidth: '720px', margin: '0 auto', width: '100%' }}>
        {/* Compact Header */}
        <header
          className="ui-card"
          style={{
            padding: '0.9rem 1rem',
            marginBottom: '0.9rem',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.15rem', fontWeight: 700, wordBreak: 'break-word' }}>{plan.title}</h1>
              {!plan.isActive && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: 'var(--accent-danger-soft)',
                    color: 'var(--accent-danger)',
                    border: '1px solid var(--accent-danger)',
                    fontWeight: 600,
                  }}
                >
                  Geschlossen
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginTop: '0.3rem', fontSize: '0.84rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
              <span>
                Kürzel: <strong style={{ color: 'var(--text-primary)' }}>{normalizedTeacherCode}</strong>
              </span>
              <button
                type="button"
                onClick={() => setIsChangingTeacher(true)}
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                Wechseln
              </button>
              {savedSubmission && (
                <span style={{ color: 'var(--accent-success)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}>
                  <CheckCircle2 size={14} />
                  Gespeichert ({new Date(savedSubmission.updatedAt).toLocaleDateString('de-DE')})
                </span>
              )}
            </div>
          </div>
        </header>

        {submitMessage && (
          <div
            style={{
              padding: '0.8rem 1rem',
              borderRadius: '10px',
              background: 'var(--accent-success-soft)',
              border: '1px solid var(--accent-success)',
              color: 'var(--text-primary)',
              marginBottom: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.9rem',
            }}
          >
            <CheckCircle2 size={18} color="var(--accent-success)" style={{ flexShrink: 0 }} />
            <span>{submitMessage}</span>
          </div>
        )}

        {submitError && (
          <div
            style={{
              padding: '0.8rem 1rem',
              borderRadius: '10px',
              background: 'var(--accent-danger-soft)',
              border: '1px solid var(--accent-danger)',
              color: 'var(--text-primary)',
              marginBottom: '0.9rem',
              fontSize: '0.9rem',
            }}
          >
            {submitError}
          </div>
        )}

        {/* Main Card: ONLY "Meine Klausuren" + expandable compact calendar below */}
        <section className="ui-card" style={{ padding: 'clamp(0.9rem, 2.5vw, 1.25rem)', marginBottom: '0.9rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.65rem',
              marginBottom: '0.9rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.08rem', fontWeight: 700 }}>
                Meine Klausuren ({myExams.length})
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {myExams.length > 0
                  ? `${answeredCount} von ${myExams.length} bewertet`
                  : 'Keine direkt zugeordneten Klausuren'}
              </p>
            </div>
            {plan.isActive && myExams.length > 0 && answeredCount < myExams.length && (
              <button
                type="button"
                onClick={markAllOpenAsOk}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-success)',
                  background: 'var(--accent-success-soft)',
                  color: 'var(--accent-success)',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                }}
              >
                <Check size={14} />
                Alle offenen „Passt“
              </button>
            )}
          </div>

          {myExams.length === 0 ? (
            <div
              style={{
                padding: '1.1rem',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.88rem',
                background: 'var(--bg-panel)',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Für <strong>{normalizedTeacherCode}</strong> sind keine Klausuren im Plan eingetragen. Falls eine fehlt, kannst du sie unten ergänzen oder über den Kalender freie/gesperrte Tage angeben.
            </div>
          ) : (
            <>
              {/* Compact Mon-Fri Overview Calendar showing own exam dates at a glance */}
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.4rem',
                    marginBottom: '0.55rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <Calendar size={15} color="var(--accent-primary)" />
                    <span>Deine Termine im Kalender</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <button
                      type="button"
                      className="ui-btn"
                      style={{ padding: '4px', minWidth: '28px', minHeight: '28px' }}
                      onClick={() =>
                        setExamCalMonth(new Date(examCalMonth.getFullYear(), examCalMonth.getMonth() - 1, 1))
                      }
                      title="Vorheriger Monat"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, minWidth: '108px', textAlign: 'center' }}>
                      {examCalMonth.toLocaleString('de-DE', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      className="ui-btn"
                      style={{ padding: '4px', minWidth: '28px', minHeight: '28px' }}
                      onClick={() =>
                        setExamCalMonth(new Date(examCalMonth.getFullYear(), examCalMonth.getMonth() + 1, 1))
                      }
                      title="Nächster Monat"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                {planMonths.length > 1 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
                    {planMonths.map((pm) => {
                      const active =
                        pm.getFullYear() === examCalMonth.getFullYear() &&
                        pm.getMonth() === examCalMonth.getMonth();
                      return (
                        <button
                          key={`ex-${pm.getFullYear()}-${pm.getMonth()}`}
                          type="button"
                          onClick={() => setExamCalMonth(pm)}
                          style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                            background: active ? 'var(--accent-primary)' : 'var(--bg-surface)',
                            color: active ? 'white' : 'var(--text-secondary)',
                          }}
                        >
                          {pm.toLocaleString('de-DE', { month: 'short', year: '2-digit' })}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px repeat(5, 1fr)',
                    gap: '4px',
                    textAlign: 'center',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    marginBottom: '4px',
                  }}
                >
                  <div>KW</div>
                  <div>Mo</div>
                  <div>Di</div>
                  <div>Mi</div>
                  <div>Do</div>
                  <div>Fr</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {examCalendarRows.map((row, rIdx) => (
                    <div
                      key={`ex-row-${examCalMonth.getFullYear()}-${examCalMonth.getMonth()}-r${rIdx}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '28px repeat(5, 1fr)',
                        gap: '4px',
                        alignItems: 'stretch',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          color: 'var(--accent-primary)',
                          background: 'var(--accent-soft)',
                          borderRadius: '5px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title={`Kalenderwoche ${row.kw}`}
                      >
                        {row.kw}
                      </div>

                      {row.cells.map((date, cIdx) => {
                        if (!date) return <div key={`ex-e-${cIdx}`} />;
                        const iso = formatISODate(date);
                        const slot = dateSlotMap.get(iso);
                        const inPlan = Boolean(slot);
                        const isBlocked = Boolean(slot?.isGlobalBlocked);
                        const dayExams = myExamsByIsoDate.get(iso) || [];
                        const hasExams = dayExams.length > 0;
                        const hasNotOk = dayExams.some((e) => examFeedbackMap[e.id]?.status === 'not_ok');
                        const allOk = hasExams && dayExams.every((e) => examFeedbackMap[e.id]?.status === 'ok');

                        return (
                          <button
                            key={date.getDate()}
                            type="button"
                            disabled={!hasExams}
                            onClick={() => {
                              if (!hasExams) return;
                              const first = dayExams[0];
                              setHighlightedExamCardId(first.id);
                              document
                                .getElementById(`my-exam-${first.id}`)
                                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                            style={{
                              minHeight: '42px',
                              padding: '3px 2px',
                              borderRadius: '6px',
                              border: hasExams
                                ? hasNotOk
                                  ? '1.5px solid var(--accent-danger)'
                                  : allOk
                                    ? '1.5px solid var(--accent-success)'
                                    : '1.5px solid var(--accent-primary)'
                                : '1px solid var(--border-subtle)',
                              background: hasExams
                                ? hasNotOk
                                  ? 'var(--accent-danger)'
                                  : allOk
                                    ? 'var(--accent-success)'
                                    : 'var(--accent-primary)'
                                : isBlocked
                                  ? 'var(--bg-app)'
                                  : 'var(--bg-surface)',
                              color: hasExams
                                ? '#ffffff'
                                : !inPlan || isBlocked
                                  ? 'var(--text-muted)'
                                  : 'var(--text-primary)',
                              opacity: !inPlan ? 0.4 : isBlocked && !hasExams ? 0.55 : 1,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              gap: '2px',
                              cursor: hasExams ? 'pointer' : 'default',
                              overflow: 'hidden',
                            }}
                            title={
                              hasExams
                                ? dayExams.map((e) => `${e.className} ${e.subject}`).join(', ')
                                : isBlocked
                                  ? 'Ferien / gesperrt'
                                  : undefined
                            }
                          >
                            <span style={{ fontSize: '0.76rem', fontWeight: hasExams ? 800 : 500, lineHeight: 1.1 }}>
                              {date.getDate()}.
                            </span>
                            {hasExams && (
                              <span
                                style={{
                                  fontSize: '0.63rem',
                                  fontWeight: 700,
                                  lineHeight: 1.05,
                                  maxWidth: '100%',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  padding: '0 2px',
                                }}
                              >
                                {dayExams.length === 1
                                  ? `${dayExams[0].className} ${dayExams[0].subject.slice(0, 3)}`
                                  : `${dayExams.length} Klaus.`}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {myExams.map((exam) => {
                  const fb = examFeedbackMap[exam.id];
                  const status = fb?.status;
                  const dateParts = getExamDateParts(exam);
                  const isFocused = highlightedExamCardId === exam.id;

                  const accentColor =
                    status === 'not_ok'
                      ? 'var(--accent-danger)'
                      : status === 'ok'
                        ? 'var(--accent-success)'
                        : 'var(--accent-primary)';

                  return (
                    <div
                      key={exam.id}
                      id={`my-exam-${exam.id}`}
                      style={{
                        padding: '0.85rem',
                        borderRadius: '10px',
                        background: 'var(--bg-panel)',
                        border:
                          status === 'not_ok'
                            ? '1.5px solid var(--accent-danger)'
                            : status === 'ok'
                              ? '1.5px solid var(--accent-success)'
                              : isFocused
                                ? '2px solid var(--accent-primary)'
                                : '1px solid var(--border-subtle)',
                        boxShadow: isFocused ? '0 0 0 3px var(--accent-soft)' : undefined,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        {/* Prominent Date Tile + Day/Date in Focus */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: '1 1 200px' }}>
                          <div
                            style={{
                              width: '62px',
                              flexShrink: 0,
                              borderRadius: '8px',
                              overflow: 'hidden',
                              border: `1.5px solid ${accentColor}`,
                              background: 'var(--bg-surface)',
                              textAlign: 'center',
                            }}
                          >
                            <div
                              style={{
                                background: accentColor,
                                color: '#ffffff',
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                padding: '2px 0',
                                letterSpacing: '0.04em',
                              }}
                            >
                              {dateParts ? dateParts.dayShort : '—'}
                            </div>
                            <div style={{ padding: '4px 2px' }}>
                              <div style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15 }}>
                                {dateParts ? dateParts.shortDate : 'Offen'}
                              </div>
                              {dateParts && (
                                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', marginTop: '1px' }}>
                                  KW {dateParts.weekNumber}
                                </div>
                              )}
                            </div>
                          </div>

                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)', lineHeight: 1.25 }}>
                              {dateParts ? `${dateParts.dayFull}, ${dateParts.shortDate}` : 'Noch nicht terminiert'}
                            </div>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {exam.className} · {exam.subject}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.45rem', flex: '1 1 210px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            disabled={!plan.isActive}
                            onClick={() => setExamStatus(exam, 'ok')}
                            style={{
                              flex: 1,
                              minHeight: '42px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '5px',
                              padding: '0.45rem 0.75rem',
                              borderRadius: '8px',
                              fontWeight: 600,
                              fontSize: '0.88rem',
                              border: status === 'ok' ? '1px solid var(--accent-success)' : '1px solid var(--border-color)',
                              background: status === 'ok' ? 'var(--accent-success)' : 'var(--bg-surface)',
                              color: status === 'ok' ? 'white' : 'var(--text-primary)',
                            }}
                          >
                            <Check size={15} />
                            Passt
                          </button>

                          <button
                            type="button"
                            disabled={!plan.isActive}
                            onClick={() => setExamStatus(exam, 'not_ok')}
                            style={{
                              flex: 1,
                              minHeight: '42px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '5px',
                              padding: '0.45rem 0.75rem',
                              borderRadius: '8px',
                              fontWeight: 600,
                              fontSize: '0.88rem',
                              border: status === 'not_ok' ? '1px solid var(--accent-danger)' : '1px solid var(--border-color)',
                              background: status === 'not_ok' ? 'var(--accent-danger)' : 'var(--bg-surface)',
                              color: status === 'not_ok' ? 'white' : 'var(--text-primary)',
                            }}
                          >
                            <X size={15} />
                            Passt nicht
                          </button>
                        </div>
                      </div>

                      {status === 'not_ok' && (
                        <div
                          style={{
                            marginTop: '0.75rem',
                            paddingTop: '0.75rem',
                            borderTop: '1px solid var(--border-subtle)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.55rem',
                          }}
                        >
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {(
                              [
                                { key: 'earlier', label: '← Lieber früher' },
                                { key: 'later', label: '→ Lieber später' },
                                { key: 'not_this_day', label: 'Nur dieser Tag geht nicht' },
                              ] as const
                            ).map((opt) => {
                              const active = fb?.preference === opt.key;
                              return (
                                <button
                                  key={opt.key}
                                  type="button"
                                  disabled={!plan.isActive}
                                  onClick={() => setExamPreference(exam, opt.key)}
                                  style={{
                                    flex: '1 1 auto',
                                    minHeight: '36px',
                                    padding: '0.35rem 0.65rem',
                                    borderRadius: '8px',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                                    background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                                    color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                                  }}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>

                          <input
                            type="text"
                            disabled={!plan.isActive}
                            value={fb?.note || ''}
                            onChange={(e) => setExamNote(exam, e.target.value)}
                            placeholder="Hinweise (optional, z. B. Stoff fehlt)..."
                            className="ui-input"
                            style={{ fontSize: '16px', padding: '0.5rem 0.7rem' }}
                          />
                        </div>
                      )}

                    {fb?.resolutionStatus && fb.resolutionStatus !== 'open' && (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          fontSize: '0.78rem',
                          padding: '0.35rem 0.6rem',
                          borderRadius: '6px',
                          background:
                            fb.resolutionStatus === 'applied'
                              ? 'var(--accent-success-soft)'
                              : 'var(--accent-warning-soft)',
                          color:
                            fb.resolutionStatus === 'applied'
                              ? 'var(--accent-success)'
                              : 'var(--accent-warning)',
                          fontWeight: 600,
                        }}
                      >
                        Planung: {fb.resolutionStatus === 'applied' ? 'Übernommen ✓' : 'Leider nicht möglich'}
                        {fb.resolutionNote ? ` – ${fb.resolutionNote}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}

          {plan.isActive && otherExams.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowExtraExamPicker((v) => !v)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: '0.8rem',
                  padding: '4px 0',
                }}
              >
                <Plus size={14} />
                Klausur fehlt in meiner Liste? Manuell ergänzen
              </button>

              {showExtraExamPicker && (
                <div style={{ marginTop: '0.45rem' }}>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setExtraExamIds((prev) => (prev.includes(e.target.value) ? prev : [...prev, e.target.value]));
                      setShowExtraExamPicker(false);
                    }}
                    className="ui-input"
                    style={{ fontSize: '16px', padding: '0.5rem 0.7rem' }}
                  >
                    <option value="">-- Klausur auswählen --</option>
                    {otherExams.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.className} · {e.subject} ({formatExamDateLabel(e)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Expandable Compact Day-Marking Calendar directly under Passt / Passt nicht */}
          <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => setShowDayCalendar((v) => !v)}
              style={{
                width: '100%',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.6rem',
                padding: '0.6rem 0.85rem',
                borderRadius: '10px',
                border: showDayCalendar ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: showDayCalendar ? 'var(--accent-soft)' : 'var(--bg-panel)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '0.88rem',
                textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <Calendar size={17} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                <span>Tage im Kalender markieren (was passt / nicht passt)</span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {dayWishes.length > 0 && (
                  <span
                    style={{
                      fontSize: '0.74rem',
                      padding: '2px 7px',
                      borderRadius: '999px',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                      fontWeight: 700,
                    }}
                  >
                    {noGoCount > 0 && `${noGoCount}× Nein`}
                    {noGoCount > 0 && preferCount > 0 && ' · '}
                    {preferCount > 0 && `${preferCount}× Passt`}
                  </span>
                )}
                {showDayCalendar ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </span>
            </button>

            {showDayCalendar && (
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.9rem',
                  borderRadius: '10px',
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  Modus wählen und Tage im Kalender antippen – z. B. wenn du an bestimmten Tagen auf keinen Fall kannst oder Wunschtage hast.
                </p>

                {/* Mode Switch + Class Scope */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '0.85rem' }}>
                  <div style={{ display: 'flex', gap: '0.45rem' }}>
                    <button
                      type="button"
                      onClick={() => setWishMode('no_go')}
                      style={{
                        flex: 1,
                        minHeight: '40px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '0.45rem 0.7rem',
                        borderRadius: '8px',
                        fontSize: '0.84rem',
                        fontWeight: 600,
                        border: wishMode === 'no_go' ? '1.5px solid var(--accent-danger)' : '1px solid var(--border-color)',
                        background: wishMode === 'no_go' ? 'var(--accent-danger-soft)' : 'var(--bg-surface)',
                        color: wishMode === 'no_go' ? 'var(--accent-danger)' : 'var(--text-secondary)',
                      }}
                    >
                      <Ban size={15} />
                      Passt nicht
                    </button>
                    <button
                      type="button"
                      onClick={() => setWishMode('prefer')}
                      style={{
                        flex: 1,
                        minHeight: '40px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '0.45rem 0.7rem',
                        borderRadius: '8px',
                        fontSize: '0.84rem',
                        fontWeight: 600,
                        border: wishMode === 'prefer' ? '1.5px solid var(--accent-success)' : '1px solid var(--border-color)',
                        background: wishMode === 'prefer' ? 'var(--accent-success-soft)' : 'var(--bg-surface)',
                        color: wishMode === 'prefer' ? 'var(--accent-success)' : 'var(--text-secondary)',
                      }}
                    >
                      <Check size={15} />
                      Passt gut
                    </button>
                  </div>

                  <select
                    value={wishClassScope}
                    onChange={(e) => setWishClassScope(e.target.value)}
                    className="ui-input"
                    style={{ fontSize: '16px', padding: '0.45rem 0.65rem' }}
                  >
                    <option value="ALL_MY_CLASSES">Gilt für alle meine Klassen ({normalizedTeacherCode})</option>
                    {plan.snapshot.classes.map((cls) => (
                      <option key={cls.className} value={cls.className}>
                        Nur Klasse {cls.className}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quick Month Chips if multiple months exist */}
                {planMonths.length > 1 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', justifyContent: 'center', marginBottom: '0.65rem' }}>
                    {planMonths.map((pm) => {
                      const active =
                        pm.getFullYear() === calendarMonth.getFullYear() &&
                        pm.getMonth() === calendarMonth.getMonth();
                      return (
                        <button
                          key={`${pm.getFullYear()}-${pm.getMonth()}`}
                          type="button"
                          onClick={() => setCalendarMonth(pm)}
                          style={{
                            padding: '3px 9px',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                            background: active ? 'var(--accent-primary)' : 'var(--bg-surface)',
                            color: active ? 'white' : 'var(--text-secondary)',
                          }}
                        >
                          {pm.toLocaleString('de-DE', { month: 'short', year: '2-digit' })}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Compact Mini Month Calendar (like ConfigSection / Import) */}
                <div
                  style={{
                    maxWidth: '360px',
                    width: '100%',
                    margin: '0 auto',
                    background: 'var(--bg-surface)',
                    padding: '0.75rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.6rem',
                      gap: '0.4rem',
                    }}
                  >
                    <button
                      type="button"
                      className="ui-btn"
                      style={{ padding: '6px', minWidth: '34px', minHeight: '34px' }}
                      onClick={() =>
                        setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))
                      }
                      title="Vorheriger Monat"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', textAlign: 'center' }}>
                      {calendarMonth.toLocaleString('de-DE', { month: 'long', year: 'numeric' })}
                    </div>
                    <button
                      type="button"
                      className="ui-btn"
                      style={{ padding: '6px', minWidth: '34px', minHeight: '34px' }}
                      onClick={() =>
                        setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))
                      }
                      title="Nächster Monat"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  {/* Header: KW + Mo..So */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '30px repeat(7, 1fr)',
                      gap: '3px',
                      textAlign: 'center',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      marginBottom: '4px',
                    }}
                  >
                    <div>KW</div>
                    <div>Mo</div>
                    <div>Di</div>
                    <div>Mi</div>
                    <div>Do</div>
                    <div>Fr</div>
                    <div>Sa</div>
                    <div>So</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {calendarRows.map((row, rIdx) => (
                      <div
                        key={`${calendarMonth.getFullYear()}-${calendarMonth.getMonth()}-r${rIdx}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '30px repeat(7, 1fr)',
                          gap: '3px',
                          alignItems: 'center',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            color: 'var(--accent-primary)',
                            background: 'var(--accent-soft)',
                            borderRadius: '4px',
                            textAlign: 'center',
                            padding: '4px 2px',
                          }}
                          title={`Kalenderwoche ${row.kw}`}
                        >
                          {row.kw}
                        </div>

                        {row.cells.map((date, cIdx) => {
                          if (!date) return <div key={`e-${cIdx}`} />;
                          const isWeekend = cIdx >= 5;
                          const iso = formatISODate(date);
                          const slot = !isWeekend ? dateSlotMap.get(iso) : undefined;
                          const inPlan = Boolean(slot);
                          const isBlocked = Boolean(slot?.isGlobalBlocked);
                          const clickable = Boolean(plan.isActive && slot && !isBlocked);

                          const activeScopeClass = wishClassScope === 'ALL_MY_CLASSES' ? null : wishClassScope;
                          const exactWish = slot
                            ? dayWishes.find(
                                (w) =>
                                  w.weekId === slot.weekId &&
                                  w.day === slot.day &&
                                  (w.className || null) === activeScopeClass
                              )
                            : undefined;
                          const otherScopeWishCount = slot
                            ? dayWishes.filter(
                                (w) =>
                                  w.weekId === slot.weekId &&
                                  w.day === slot.day &&
                                  (w.className || null) !== activeScopeClass
                              ).length
                            : 0;
                          const hasMyExam = myExamIsoDates.has(iso);

                          let bg = 'transparent';
                          let border = '1px solid transparent';
                          let color = 'var(--text-primary)';

                          if (isWeekend || !inPlan) {
                            color = 'var(--text-muted)';
                          } else if (isBlocked) {
                            bg = 'var(--bg-app)';
                            color = 'var(--text-muted)';
                          } else if (exactWish?.wishType === 'no_go') {
                            bg = 'var(--accent-danger)';
                            border = '1px solid var(--accent-danger)';
                            color = '#ffffff';
                          } else if (exactWish?.wishType === 'prefer') {
                            bg = 'var(--accent-success)';
                            border = '1px solid var(--accent-success)';
                            color = '#ffffff';
                          } else if (otherScopeWishCount > 0) {
                            bg = 'var(--bg-panel)';
                            border = '1px dashed var(--border-color)';
                          } else {
                            bg = 'var(--bg-panel)';
                            border = '1px solid var(--border-subtle)';
                          }

                          return (
                            <button
                              key={date.getDate()}
                              type="button"
                              disabled={!clickable}
                              onClick={() => {
                                if (slot && clickable) {
                                  toggleWishDay(slot.weekId, slot.day);
                                }
                              }}
                              title={
                                isWeekend
                                  ? 'Wochenende'
                                  : !inPlan
                                    ? 'Außerhalb des Klausurzeitraums'
                                    : isBlocked
                                      ? 'Ferien / global gesperrt'
                                      : exactWish?.wishType === 'no_go'
                                        ? 'Markiert: Passt nicht'
                                        : exactWish?.wishType === 'prefer'
                                          ? 'Markiert: Passt gut'
                                          : 'Antippen zum Markieren'
                              }
                              style={{
                                position: 'relative',
                                minHeight: '36px',
                                padding: '2px 0',
                                borderRadius: '6px',
                                border,
                                background: bg,
                                color,
                                fontWeight: exactWish || hasMyExam ? 700 : 500,
                                fontSize: '0.8rem',
                                opacity: isWeekend || !inPlan ? 0.35 : isBlocked ? 0.5 : 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: clickable ? 'pointer' : 'default',
                              }}
                            >
                              <span>{date.getDate()}</span>
                              {hasMyExam && (
                                <span
                                  style={{
                                    width: '5px',
                                    height: '5px',
                                    borderRadius: '50%',
                                    background: exactWish ? '#ffffff' : 'var(--accent-primary)',
                                    marginTop: '1px',
                                  }}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Compact Legend */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                      gap: '0.65rem',
                      marginTop: '0.65rem',
                      paddingTop: '0.55rem',
                      borderTop: '1px solid var(--border-subtle)',
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--accent-danger)' }} />
                      Passt nicht
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--accent-success)' }} />
                      Passt gut
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent-primary)' }} />
                      Eigene Klausur
                    </span>
                  </div>
                </div>

                {/* Selected Days List */}
                {sortedDayWishes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.85rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Eingetragene Tage ({sortedDayWishes.length}):
                    </div>
                    {sortedDayWishes.map((w) => (
                      <div
                        key={w.id}
                        style={{
                          padding: '0.55rem 0.7rem',
                          borderRadius: '8px',
                          background: 'var(--bg-surface)',
                          border:
                            w.wishType === 'no_go'
                              ? '1px solid rgba(220, 38, 38, 0.45)'
                              : '1px solid rgba(22, 163, 74, 0.45)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ fontSize: '0.83rem', fontWeight: 600 }}>
                            <span
                              style={{
                                color: w.wishType === 'no_go' ? 'var(--accent-danger)' : 'var(--accent-success)',
                                marginRight: '6px',
                              }}
                            >
                              {w.wishType === 'no_go' ? 'Passt nicht:' : 'Passt gut:'}
                            </span>
                            {formatWishDateLabel(w.weekId, w.day)} ·{' '}
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                              {w.className ? `Klasse ${w.className}` : 'Alle meine Klassen'}
                            </span>
                          </div>
                          {plan.isActive && (
                            <button
                              type="button"
                              onClick={() => removeWish(w.id)}
                              title="Entfernen"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                padding: '4px',
                                minWidth: '28px',
                                minHeight: '28px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>

                        <input
                          type="text"
                          disabled={!plan.isActive}
                          value={w.note}
                          onChange={(e) => updateWishNote(w.id, e.target.value)}
                          placeholder="Hinweise (optional, z. B. Fortbildung, Ausflug)..."
                          className="ui-input"
                          style={{ fontSize: '16px', padding: '0.4rem 0.6rem' }}
                        />

                        {w.resolutionStatus && w.resolutionStatus !== 'open' && (
                          <div
                            style={{
                              fontSize: '0.76rem',
                              fontWeight: 600,
                              color: w.resolutionStatus === 'applied' ? 'var(--accent-success)' : 'var(--accent-warning)',
                            }}
                          >
                            Planung: {w.resolutionStatus === 'applied' ? 'Übernommen ✓' : 'Nicht möglich'}
                            {w.resolutionNote ? ` – ${w.resolutionNote}` : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Submit Area */}
        {plan.isActive && (
          <section
            className="ui-card"
            style={{
              padding: '0.9rem 1rem',
              marginBottom: '0.9rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
            }}
          >
            <input
              type="text"
              value={generalNote}
              onChange={(e) => setGeneralNote(e.target.value)}
              placeholder="Allgemeiner Hinweis an die Planung (optional)..."
              className="ui-input"
              style={{ fontSize: '16px', padding: '0.6rem 0.75rem' }}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="ui-btn ui-btn-primary"
              style={{
                width: '100%',
                minHeight: '46px',
                fontSize: '0.96rem',
                fontWeight: 700,
              }}
            >
              <Send size={16} />
              {submitting
                ? 'Speichere...'
                : savedSubmission
                  ? 'Rückmeldung aktualisieren'
                  : 'Rückmeldung absenden'}
            </button>
          </section>
        )}
      </div>

      {/* Bottom Collapsed Overview: Full Read-Only Schedule for All Classes */}
      <div style={{ maxWidth: showFullSchedule ? '1440px' : '720px', margin: '0 auto', width: '100%' }}>
        <section className="ui-card" style={{ overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setShowFullSchedule((v) => !v)}
            style={{
              width: '100%',
              minHeight: '48px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.85rem 1rem',
              background: 'transparent',
              border: 'none',
              borderBottom: showFullSchedule ? '1px solid var(--border-subtle)' : 'none',
              color: 'var(--text-primary)',
              fontSize: '0.92rem',
              fontWeight: 700,
              textAlign: 'left',
              gap: '0.5rem',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={17} color="var(--text-secondary)" />
              <span>Gesamtübersicht (alle {plan.snapshot.classes.length} Klassen)</span>
            </span>
            {showFullSchedule ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {showFullSchedule && (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  padding: '0.75rem 1rem',
                  background: 'var(--bg-panel)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setOnlyMyClassesInOverview(false)}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    border: '1px solid var(--border-color)',
                    background: !onlyMyClassesInOverview ? 'var(--accent-primary)' : 'var(--bg-surface)',
                    color: !onlyMyClassesInOverview ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  Alle Klassen
                </button>
                {myClasses.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOnlyMyClassesInOverview(true)}
                    style={{
                      padding: '0.35rem 0.7rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      border: '1px solid var(--border-color)',
                      background: onlyMyClassesInOverview ? 'var(--accent-primary)' : 'var(--bg-surface)',
                      color: onlyMyClassesInOverview ? 'white' : 'var(--text-secondary)',
                    }}
                  >
                    Nur meine Klassen ({myClasses.length})
                  </button>
                )}
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    marginLeft: '0.25rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={highlightMyExams}
                    onChange={(e) => setHighlightMyExams(e.target.checked)}
                  />
                  Meine Klausuren hervorheben
                </label>
              </div>

              <div
                style={{
                  overflow: 'auto',
                  maxHeight: '65vh',
                  background: 'var(--bg-card)',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `96px repeat(${plan.snapshot.weeks.length * 5}, minmax(72px, 1fr))`,
                    minWidth: 'fit-content',
                  }}
                >
                  {/* Corner */}
                  <div
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: 0,
                      zIndex: 20,
                      background: 'var(--bg-card)',
                      borderRight: '1px solid var(--border-color)',
                      borderBottom: '1px solid var(--border-color)',
                      padding: '0.5rem 0.6rem',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      gridColumn: '1 / 2',
                      gridRow: '1 / 3',
                      alignContent: 'center',
                    }}
                  >
                    Klasse
                  </div>

                  {/* Weeks */}
                  {plan.snapshot.weeks.map((week, idx) => (
                    <div
                      key={week.id}
                      style={{
                        gridColumn: `${2 + idx * 5} / span 5`,
                        gridRow: '1 / 2',
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                        background: 'var(--bg-card)',
                        borderRight: '1px solid var(--border-color)',
                        borderBottom: '1px solid var(--border-color)',
                        padding: '0.35rem 0.5rem',
                        textAlign: 'center',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: week.isBlocked ? 'var(--accent-danger)' : 'var(--text-primary)',
                      }}
                    >
                      KW {week.weekNumber}{' '}
                      <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                        ({getWeekDateRangeString(week)})
                      </span>
                    </div>
                  ))}

                  {/* Days */}
                  {plan.snapshot.weeks.map((week, wIdx) =>
                    DAYS_OF_WEEK.map((day, dIdx) => {
                      const dayDate = getWeekDayDate(week, day);
                      const isGlobalBlocked = week.isBlocked || Boolean(plan.snapshot.blockedDays[week.id]?.[day]);
                      return (
                        <div
                          key={`${week.id}-${day}`}
                          style={{
                            gridColumn: `${2 + wIdx * 5 + dIdx} / span 1`,
                            gridRow: '2 / 3',
                            position: 'sticky',
                            top: '29px',
                            zIndex: 10,
                            background: isGlobalBlocked ? 'var(--accent-danger-soft)' : 'var(--bg-panel)',
                            borderRight: '1px solid var(--border-color)',
                            borderBottom: '1px solid var(--border-color)',
                            padding: '0.25rem',
                            textAlign: 'center',
                            fontSize: '0.72rem',
                            color: isGlobalBlocked ? 'var(--accent-danger)' : 'var(--text-secondary)',
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{GERMAN_DAY_SHORT[day]}</div>
                          <div>{formatShortDate(dayDate)}</div>
                        </div>
                      );
                    })
                  )}

                  {/* Rows */}
                  {overviewClasses.map((cls, cIdx) => {
                    const row = 3 + cIdx;
                    const isMyClass = myClasses.includes(cls.className);
                    return (
                      <div key={cls.className} style={{ display: 'contents' }}>
                        <div
                          style={{
                            gridColumn: '1 / 2',
                            gridRow: `${row} / ${row + 1}`,
                            position: 'sticky',
                            left: 0,
                            zIndex: 5,
                            background: highlightMyExams && isMyClass ? 'var(--accent-soft)' : 'var(--bg-panel)',
                            borderLeft: highlightMyExams && isMyClass ? '4px solid var(--accent-primary)' : 'none',
                            borderRight: '1px solid var(--border-color)',
                            borderBottom: '1px solid var(--border-color)',
                            padding: '0.45rem 0.6rem',
                            fontWeight: highlightMyExams && isMyClass ? 700 : 600,
                            fontSize: '0.8rem',
                            color: highlightMyExams && isMyClass ? 'var(--accent-primary)' : 'var(--text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          {cls.className}
                        </div>

                        {plan.snapshot.weeks.map((week, wIdx) =>
                          DAYS_OF_WEEK.map((day, dIdx) => {
                            const isBlocked =
                              week.isBlocked ||
                              Boolean(plan.snapshot.blockedDays[week.id]?.[day]) ||
                              Boolean(plan.snapshot.blockedClassDays[cls.className]?.[week.id]?.[day]);

                            const cellExams = plan.snapshot.exams.filter(
                              (e) => e.className === cls.className && e.assignedWeekId === week.id && e.assignedDay === day
                            );

                            return (
                              <div
                                key={`${cls.className}-${week.id}-${day}`}
                                style={{
                                  gridColumn: `${2 + wIdx * 5 + dIdx} / span 1`,
                                  gridRow: `${row} / ${row + 1}`,
                                  minHeight: '44px',
                                  padding: '3px',
                                  borderRight: '1px solid var(--border-color)',
                                  borderBottom: '1px solid var(--border-color)',
                                  background: isBlocked
                                    ? 'repeating-linear-gradient(45deg, var(--stripe-a), var(--stripe-a) 8px, var(--stripe-b) 8px, var(--stripe-b) 16px)'
                                    : 'transparent',
                                  opacity: isBlocked ? 0.55 : 1,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '3px',
                                }}
                              >
                                {cellExams.map((exam) => {
                                  const isMine = myExamIdsSet.has(exam.id);
                                  const teachers = getExamTeachersNormalized(
                                    exam,
                                    plan.snapshot.classes,
                                    plan.snapshot.weeks
                                  );
                                  const fb = examFeedbackMap[exam.id];
                                  const emphasize = highlightMyExams && isMine;
                                  const dimOther = highlightMyExams && !isMine;

                                  const mineBg =
                                    fb?.status === 'not_ok'
                                      ? 'var(--accent-danger)'
                                      : fb?.status === 'ok'
                                        ? 'var(--accent-success)'
                                        : 'var(--accent-primary)';

                                  return (
                                    <div
                                      key={exam.id}
                                      style={{
                                        padding: emphasize ? '4px 6px' : '3px 5px',
                                        borderRadius: '5px',
                                        fontSize: '0.73rem',
                                        background: emphasize
                                          ? mineBg
                                          : dimOther
                                            ? 'var(--bg-app)'
                                            : 'var(--bg-panel)',
                                        border: emphasize
                                          ? `1.5px solid ${mineBg}`
                                          : fb?.status === 'not_ok'
                                            ? '1px solid var(--accent-danger)'
                                            : fb?.status === 'ok'
                                              ? '1px solid var(--accent-success)'
                                              : '1px solid var(--border-color)',
                                        opacity: dimOther ? 0.48 : 1,
                                        boxShadow: emphasize ? '0 2px 6px rgba(37, 99, 235, 0.32)' : undefined,
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontWeight: emphasize ? 800 : 600,
                                          color: emphasize ? '#ffffff' : 'var(--text-primary)',
                                        }}
                                      >
                                        {emphasize && (fb?.status === 'ok' ? '✓ ' : fb?.status === 'not_ok' ? '✕ ' : '★ ')}
                                        {exam.subject}
                                      </div>
                                      {teachers.length > 0 && (
                                        <div
                                          style={{
                                            fontSize: '0.66rem',
                                            color: emphasize ? 'rgba(255, 255, 255, 0.9)' : 'var(--text-secondary)',
                                            fontWeight: emphasize ? 600 : 400,
                                          }}
                                        >
                                          {teachers.join(', ')}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
