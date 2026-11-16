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
import { formatShortDate, getWeekDateRangeString, getWeekDayDate } from '../logic/dateUtils';
import {
  AlertCircle,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Lock,
  Plus,
  Send,
  Star,
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

  // Overview calendar filter
  const [showFullSchedule, setShowFullSchedule] = useState(true);
  const [onlyMyClassesInOverview, setOnlyMyClassesInOverview] = useState(false);
  const [highlightMyExams, setHighlightMyExams] = useState(true);

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

  const formatExamDateLabel = (exam: Exam) => {
    if (!plan || !exam.assignedWeekId || !exam.assignedDay) return 'Noch nicht terminiert';
    const week = plan.snapshot.weeks.find((w) => w.id === exam.assignedWeekId);
    if (!week) return `${exam.assignedWeekId}`;
    const d = getWeekDayDate(week, exam.assignedDay);
    return `${GERMAN_DAY_SHORT[exam.assignedDay]}, ${formatShortDate(d)} (KW ${week.weekNumber})`;
  };

  const formatWishDateLabel = (weekId: string, day: DayOfWeek) => {
    if (!plan) return `${weekId} ${GERMAN_DAY_SHORT[day]}`;
    const week = plan.snapshot.weeks.find((w) => w.id === weekId);
    if (!week) return `${weekId} ${GERMAN_DAY_SHORT[day]}`;
    const d = getWeekDayDate(week, day);
    return `${GERMAN_DAY_SHORT[day]}, ${formatShortDate(d)} (KW ${week.weekNumber})`;
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Lade Klausurplan...</div>
      </div>
    );
  }

  if (error && !meta) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '2rem', maxWidth: '460px', textAlign: 'center' }}>
          <AlertCircle size={32} color="var(--accent-danger)" style={{ marginBottom: '0.75rem' }} />
          <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Plan nicht verfügbar</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{error}</p>
        </div>
      </div>
    );
  }

  // Step 1: Passcode Gate
  if (meta && !meta.unlocked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <form
          onSubmit={handleUnlock}
          style={{
            width: '100%',
            maxWidth: '420px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.75rem' }}>
            <Lock size={22} color="var(--accent-primary)" />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{meta.title}</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
            Bitte gib den Zugangscode aus der Rundmail ein, um den Klausurplan anzusehen und Rückmeldung zu geben.
          </p>

          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            Zugangscode
          </label>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Code eingeben..."
            autoFocus
            style={{
              width: '100%',
              padding: '0.7rem 0.85rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-app)',
              color: 'var(--text-primary)',
              fontSize: '1rem',
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
            style={{
              width: '100%',
              padding: '0.75rem',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--accent-primary)',
              color: 'white',
              fontWeight: 600,
              fontSize: '0.95rem',
              opacity: unlocking || !passcode.trim() ? 0.6 : 1,
            }}
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <div
          style={{
            width: '100%',
            maxWidth: '580px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <UserCheck size={22} color="var(--accent-primary)" />
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{plan.title}</h1>
            </div>
            {normalizedTeacherCode && (
              <button
                onClick={() => setIsChangingTeacher(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.85rem' }}
              >
                Abbrechen
              </button>
            )}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
            Wähle dein Lehrkraft-Kürzel aus, damit deine Klausuren direkt vorgefiltert werden (du siehst danach trotzdem den kompletten Plan für alle Klassen).
          </p>

          {allTeacherCodes.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Kürzel im Plan:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', maxHeight: '220px', overflowY: 'auto' }}>
                {allTeacherCodes.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => selectTeacher(code)}
                    style={{
                      padding: '0.45rem 0.75rem',
                      borderRadius: '6px',
                      border: code === normalizedTeacherCode ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: code === normalizedTeacherCode ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '0.85rem',
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
            style={{ display: 'flex', gap: '0.5rem' }}
          >
            <input
              type="text"
              value={customTeacherInput}
              onChange={(e) => setCustomTeacherInput(e.target.value)}
              placeholder="Oder Kürzel direkt eintippen (z. B. MÜL)..."
              style={{
                flex: 1,
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-app)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
              }}
            />
            <button
              type="submit"
              disabled={!customTeacherInput.trim()}
              style={{
                padding: '0.65rem 1.1rem',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--accent-primary)',
                color: 'white',
                fontWeight: 600,
                opacity: customTeacherInput.trim() ? 1 : 0.5,
              }}
            >
              Weiter
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Overview classes filtered
  const overviewClasses = onlyMyClassesInOverview
    ? plan.snapshot.classes.filter((c) => myClasses.includes(c.className))
    : plan.snapshot.classes;

  const myExamIdsSet = new Set(myExams.map((e) => e.id));
  const answeredCount = myExams.filter((e) => Boolean(examFeedbackMap[e.id])).length;

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1480px', margin: '0 auto', width: '100%' }}>
      {/* Top Bar */}
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          padding: '1rem 1.25rem',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          marginBottom: '1.25rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>{plan.title}</h1>
            {!plan.isActive && (
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-danger)',
                  border: '1px solid var(--accent-danger)',
                  fontWeight: 600,
                }}
              >
                Abstimmung geschlossen (nur Ansicht)
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <span>
              Kürzel: <strong style={{ color: 'var(--text-primary)' }}>{normalizedTeacherCode}</strong>
            </span>
            <button
              type="button"
              onClick={() => setIsChangingTeacher(true)}
              style={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '0.75rem',
              }}
            >
              Kürzel wechseln
            </button>
            {savedSubmission && (
              <span style={{ color: 'var(--accent-success)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={14} />
                Letzte Rückmeldung gespeichert ({new Date(savedSubmission.updatedAt).toLocaleString('de-DE')})
              </span>
            )}
          </div>
        </div>

        {plan.isActive && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              padding: '0.7rem 1.25rem',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.95rem',
              opacity: submitting ? 0.65 : 1,
            }}
          >
            <Send size={16} />
            {submitting
              ? 'Speichere...'
              : savedSubmission
                ? 'Rückmeldung aktualisieren'
                : 'Rückmeldung absenden'}
          </button>
        )}
      </header>

      {submitMessage && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '8px',
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid var(--accent-success)',
            color: 'var(--text-primary)',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={18} color="var(--accent-success)" />
          <span>{submitMessage}</span>
        </div>
      )}

      {submitError && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--accent-danger)',
            color: 'var(--text-primary)',
            marginBottom: '1.25rem',
          }}
        >
          {submitError}
        </div>
      )}

      {/* Overview Section: Full Read-Only Schedule for All Classes */}
      <section
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          marginBottom: '1.5rem',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.85rem 1.15rem',
            borderBottom: showFullSchedule ? '1px solid var(--border-color)' : 'none',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            onClick={() => setShowFullSchedule((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '1.05rem',
              fontWeight: 700,
            }}
          >
            <Calendar size={18} color="var(--accent-primary)" />
            <span>Gesamtplan im Überblick ({plan.snapshot.classes.length} Klassen)</span>
            {showFullSchedule ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showFullSchedule && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setOnlyMyClassesInOverview(false)}
                style={{
                  padding: '0.35rem 0.7rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: '1px solid var(--border-color)',
                  background: !onlyMyClassesInOverview ? 'var(--accent-primary)' : 'var(--bg-app)',
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
                    background: onlyMyClassesInOverview ? 'var(--accent-primary)' : 'var(--bg-app)',
                    color: onlyMyClassesInOverview ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  Nur meine Klassen ({myClasses.length})
                </button>
              )}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '0.25rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={highlightMyExams}
                  onChange={(e) => setHighlightMyExams(e.target.checked)}
                />
                Meine Klausuren hervorheben
              </label>
            </div>
          )}
        </div>

        {showFullSchedule && (
          <div style={{ overflow: 'auto', maxHeight: '420px', background: 'var(--bg-card)' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `130px repeat(${plan.snapshot.weeks.length * 5}, minmax(74px, 1fr))`,
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
                  padding: '0.6rem 0.75rem',
                  fontWeight: 700,
                  fontSize: '0.85rem',
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
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: week.isBlocked ? 'var(--accent-danger)' : 'var(--text-primary)',
                  }}
                >
                  KW {week.weekNumber}{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
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
                        top: '30px',
                        zIndex: 10,
                        background: isGlobalBlocked ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-panel)',
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
                return (
                  <div key={cls.className} style={{ display: 'contents' }}>
                    <div
                      style={{
                        gridColumn: '1 / 2',
                        gridRow: `${row} / ${row + 1}`,
                        position: 'sticky',
                        left: 0,
                        zIndex: 5,
                        background: 'var(--bg-panel)',
                        borderRight: '1px solid var(--border-color)',
                        borderBottom: '1px solid var(--border-color)',
                        padding: '0.45rem 0.75rem',
                        fontWeight: 600,
                        fontSize: '0.82rem',
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
                              minHeight: '46px',
                              padding: '3px',
                              borderRight: '1px solid var(--border-color)',
                              borderBottom: '1px solid var(--border-color)',
                              background: isBlocked
                                ? 'repeating-linear-gradient(45deg, var(--bg-app), var(--bg-app) 8px, var(--bg-panel) 8px, var(--bg-panel) 16px)'
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
                              return (
                                <div
                                  key={exam.id}
                                  style={{
                                    padding: '3px 5px',
                                    borderRadius: '4px',
                                    fontSize: '0.73rem',
                                    background:
                                      highlightMyExams && isMine
                                        ? 'rgba(59, 130, 246, 0.25)'
                                        : 'var(--bg-panel)',
                                    border:
                                      fb?.status === 'not_ok'
                                        ? '1px solid var(--accent-danger)'
                                        : fb?.status === 'ok'
                                          ? '1px solid var(--accent-success)'
                                          : highlightMyExams && isMine
                                            ? '1px solid var(--accent-primary)'
                                            : '1px solid var(--border-color)',
                                  }}
                                >
                                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{exam.subject}</div>
                                  {teachers.length > 0 && (
                                    <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
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
        )}
      </section>

      {/* Main 2-step Colleague Sections */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem', alignItems: 'start' }}>
        {/* Section 1: My Exams (Passt / Passt nicht) */}
        <section
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                1. Meine Klausuren ({myExams.length})
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {answeredCount}/{myExams.length} bewertet · Klicke einfach „Passt“ oder „Passt nicht“.
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
                  padding: '0.4rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--accent-success)',
                  background: 'rgba(34, 197, 94, 0.12)',
                  color: 'var(--accent-success)',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                }}
              >
                <Check size={14} />
                Alle offenen auf „Passt“
              </button>
            )}
          </div>

          {myExams.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem', background: 'var(--bg-app)', borderRadius: '8px' }}>
              Für das Kürzel <strong>{normalizedTeacherCode}</strong> sind im Plan keine Klausuren zugeordnet. Falls eine Klausur fehlt, kannst du sie unten manuell hinzufügen.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {myExams.map((exam) => {
                const fb = examFeedbackMap[exam.id];
                const status = fb?.status;
                return (
                  <div
                    key={exam.id}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '8px',
                      background: 'var(--bg-app)',
                      border:
                        status === 'not_ok'
                          ? '1px solid var(--accent-danger)'
                          : status === 'ok'
                            ? '1px solid var(--accent-success)'
                            : '1px solid var(--border-color)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                          {exam.className} · {exam.subject}
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                          <Clock size={13} />
                          <span>{formatExamDateLabel(exam)}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.45rem' }}>
                        <button
                          type="button"
                          disabled={!plan.isActive}
                          onClick={() => setExamStatus(exam, 'ok')}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '0.45rem 0.8rem',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: '0.85rem',
                            border: status === 'ok' ? '1px solid var(--accent-success)' : '1px solid var(--border-color)',
                            background: status === 'ok' ? 'var(--accent-success)' : 'var(--bg-panel)',
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
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '0.45rem 0.8rem',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: '0.85rem',
                            border: status === 'not_ok' ? '1px solid var(--accent-danger)' : '1px solid var(--border-color)',
                            background: status === 'not_ok' ? 'var(--accent-danger)' : 'var(--bg-panel)',
                            color: status === 'not_ok' ? 'white' : 'var(--text-primary)',
                          }}
                        >
                          <X size={15} />
                          Passt nicht
                        </button>
                      </div>
                    </div>

                    {status === 'not_ok' && (
                      <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
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
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: '6px',
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                  border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                                  background: active ? 'rgba(59, 130, 246, 0.22)' : 'var(--bg-panel)',
                                  color: 'var(--text-primary)',
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
                          placeholder="Kurzer Grund / Hinweis (optional, z. B. Stoff fehlt noch)..."
                          style={{
                            width: '100%',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-panel)',
                            color: 'var(--text-primary)',
                            fontSize: '0.83rem',
                          }}
                        />
                      </div>
                    )}

                    {fb?.resolutionStatus && fb.resolutionStatus !== 'open' && (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          fontSize: '0.78rem',
                          padding: '0.35rem 0.6rem',
                          borderRadius: '5px',
                          background:
                            fb.resolutionStatus === 'applied'
                              ? 'rgba(34, 197, 94, 0.14)'
                              : 'rgba(234, 179, 8, 0.14)',
                          color:
                            fb.resolutionStatus === 'applied'
                              ? 'var(--accent-success)'
                              : 'var(--accent-warning)',
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
          )}

          {plan.isActive && otherExams.length > 0 && (
            <div style={{ marginTop: '0.85rem' }}>
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
                }}
              >
                <Plus size={14} />
                Klausur fehlt in meiner Liste? Manuell ergänzen
              </button>

              {showExtraExamPicker && (
                <div style={{ marginTop: '0.5rem' }}>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setExtraExamIds((prev) => (prev.includes(e.target.value) ? prev : [...prev, e.target.value]));
                      setShowExtraExamPicker(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.65rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                    }}
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
        </section>

        {/* Section 2: Always-available Calendar for No-Go Dates & Wishes */}
        <section
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.25rem',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            2. Termine, die auf keinen Fall gehen & Wünsche
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.9rem' }}>
            Auch wenn oben alles „Passt“, kannst du hier Tage markieren, an denen du (oder eine Klasse) auf keinen Fall schreiben kannst – z. B. falls später noch etwas verschoben werden muss.
          </p>

          {/* Controls */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                onClick={() => setWishMode('no_go')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  border: wishMode === 'no_go' ? '1px solid var(--accent-danger)' : '1px solid var(--border-color)',
                  background: wishMode === 'no_go' ? 'rgba(239, 68, 68, 0.2)' : 'var(--bg-app)',
                  color: wishMode === 'no_go' ? 'var(--accent-danger)' : 'var(--text-secondary)',
                }}
              >
                <Ban size={14} />
                Auf keinen Fall
              </button>
              <button
                type="button"
                onClick={() => setWishMode('prefer')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  border: wishMode === 'prefer' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  background: wishMode === 'prefer' ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-app)',
                  color: wishMode === 'prefer' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                }}
              >
                <Star size={14} />
                Wunschtermin
              </button>
            </div>

            <select
              value={wishClassScope}
              onChange={(e) => setWishClassScope(e.target.value)}
              style={{
                flex: 1,
                minWidth: '180px',
                padding: '0.45rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-app)',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
              }}
            >
              <option value="ALL_MY_CLASSES">Gilt für alle meine Klassen ({normalizedTeacherCode})</option>
              {plan.snapshot.classes.map((cls) => (
                <option key={cls.className} value={cls.className}>
                  Nur Klasse {cls.className}
                </option>
              ))}
            </select>
          </div>

          {/* Clickable Week/Day Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {plan.snapshot.weeks.map((week) => (
              <div
                key={week.id}
                style={{
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '0.5rem 0.65rem',
                }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.4rem', color: week.isBlocked ? 'var(--accent-danger)' : 'var(--text-secondary)' }}>
                  KW {week.weekNumber} ({getWeekDateRangeString(week)}){week.isBlocked ? ' – Woche gesperrt' : ''}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.35rem' }}>
                  {DAYS_OF_WEEK.map((day) => {
                    const dayDate = getWeekDayDate(week, day);
                    const isGlobalBlocked = week.isBlocked || Boolean(plan.snapshot.blockedDays[week.id]?.[day]);
                    const activeScopeClass = wishClassScope === 'ALL_MY_CLASSES' ? null : wishClassScope;
                    const exactWish = dayWishes.find(
                      (w) => w.weekId === week.id && w.day === day && (w.className || null) === activeScopeClass
                    );
                    const anyWishCount = dayWishes.filter((w) => w.weekId === week.id && w.day === day).length;

                    return (
                      <button
                        key={day}
                        type="button"
                        disabled={!plan.isActive || isGlobalBlocked}
                        onClick={() => toggleWishDay(week.id, day)}
                        style={{
                          padding: '0.4rem 0.25rem',
                          borderRadius: '6px',
                          border:
                            exactWish?.wishType === 'no_go'
                              ? '1px solid var(--accent-danger)'
                              : exactWish?.wishType === 'prefer'
                                ? '1px solid var(--accent-primary)'
                                : '1px solid var(--border-color)',
                          background: isGlobalBlocked
                            ? 'rgba(148, 163, 184, 0.08)'
                            : exactWish?.wishType === 'no_go'
                              ? 'rgba(239, 68, 68, 0.22)'
                              : exactWish?.wishType === 'prefer'
                                ? 'rgba(59, 130, 246, 0.22)'
                                : 'var(--bg-panel)',
                          color: isGlobalBlocked ? 'var(--text-secondary)' : 'var(--text-primary)',
                          opacity: isGlobalBlocked ? 0.45 : 1,
                          fontSize: '0.75rem',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>{GERMAN_DAY_SHORT[day]}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                          {formatShortDate(dayDate)}
                        </span>
                        {exactWish ? (
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: exactWish.wishType === 'no_go' ? 'var(--accent-danger)' : 'var(--accent-primary)' }}>
                            {exactWish.wishType === 'no_go' ? 'No-Go' : 'Wunsch'}
                          </span>
                        ) : anyWishCount > 0 ? (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                            {anyWishCount}× markiert
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Selected Wishes List */}
          {dayWishes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Deine eingetragenen Termine ({dayWishes.length}):
              </div>
              {dayWishes.map((w) => (
                <div
                  key={w.id}
                  style={{
                    padding: '0.6rem 0.75rem',
                    borderRadius: '6px',
                    background: 'var(--bg-app)',
                    border: w.wishType === 'no_go' ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(59, 130, 246, 0.5)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                      <span style={{ color: w.wishType === 'no_go' ? 'var(--accent-danger)' : 'var(--accent-primary)', marginRight: '6px' }}>
                        {w.wishType === 'no_go' ? 'Auf keinen Fall:' : 'Wunschtermin:'}
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
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', padding: '2px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <input
                    type="text"
                    disabled={!plan.isActive}
                    value={w.note}
                    onChange={(e) => updateWishNote(w.id, e.target.value)}
                    placeholder="Grund / Hinweis (optional, z. B. Fortbildung, Exkursion)..."
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.6rem',
                      borderRadius: '5px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      fontSize: '0.8rem',
                    }}
                  />

                  {w.resolutionStatus && w.resolutionStatus !== 'open' && (
                    <div
                      style={{
                        fontSize: '0.76rem',
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
        </section>
      </div>

      {/* Bottom Submit Area */}
      {plan.isActive && (
        <section
          style={{
            marginTop: '1.25rem',
            padding: '1.15rem 1.25rem',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.85rem',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            value={generalNote}
            onChange={(e) => setGeneralNote(e.target.value)}
            placeholder="Allgemeiner Hinweis an die Planung (optional)..."
            style={{
              flex: 1,
              minWidth: '240px',
              padding: '0.65rem 0.85rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-app)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.4rem',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.95rem',
              opacity: submitting ? 0.65 : 1,
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
  );
}
