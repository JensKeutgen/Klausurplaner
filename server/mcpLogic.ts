import { v4 as uuidv4 } from 'uuid';
import {
  DAYS_OF_WEEK,
  DEFAULT_SOLVER_SETTINGS,
  type AppState,
  type DayOfWeek,
  type Exam,
  type PdfSettings,
  type ReviewDayWish,
  type ReviewExamFeedback,
  type SolverSettings,
  type SubjectTimingPreference,
  type TicketResolutionStatus,
  type Week,
} from '../src/types';
import {
  autoFix,
  distributeExams,
  evaluateSchedule,
  getAllSubjectsForClass,
  getEffectiveExamTeachers,
  getEffectiveGradeLevel,
  getExamTimingPreference,
  getSubjectPeriodCount,
  inferGradeLevel,
  validateMove,
  type ScheduleEvaluation,
  type TimingPreferences,
} from '../src/logic/solver';
import {
  formatISODate,
  formatShortDate,
  getWeekDateRangeString,
  getWeekDayDate,
} from '../src/logic/dateUtils';
import {
  DEFAULT_REVIEW_SERVER_URL,
  extractTeacherCodes,
  extractTeacherOptions,
  fetchReviewInbox,
  getEffectiveServerUrl,
  getExamTeachersNormalized,
  getTeacherClasses,
  updateTicketResolution,
} from '../src/logic/reviewClient';

export const DEFAULT_BRIDGE_URL = process.env.KLAUSURPLANER_BRIDGE_URL || 'http://127.0.0.1:8787';

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

const DAY_TO_INDEX: Record<DayOfWeek, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
};

export interface BridgeStateResponse {
  state: AppState | null;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface BackupEntry {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export async function fetchBridgeState(bridgeUrl = DEFAULT_BRIDGE_URL): Promise<BridgeStateResponse> {
  let res: Response;
  try {
    res = await fetch(`${bridgeUrl}/api/state`);
  } catch (err) {
    throw new Error(
      `Lokale Klausurplaner-Bridge unter ${bridgeUrl} nicht erreichbar (${err instanceof Error ? err.message : String(err)}). Bitte 'npm run dev:local' starten.`
    );
  }
  const data = (await res.json().catch(() => ({}))) as Partial<BridgeStateResponse> & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Bridge-Fehler HTTP ${res.status}`);
  }
  return {
    state: data.state ?? null,
    revision: Number(data.revision || 0),
    updatedAt: data.updatedAt ?? null,
    updatedBy: data.updatedBy ?? null,
  };
}

export async function requireBridgeState(bridgeUrl = DEFAULT_BRIDGE_URL): Promise<{
  state: AppState;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}> {
  const res = await fetchBridgeState(bridgeUrl);
  if (!res.state) {
    throw new Error(
      'In server/data/klausurplan.json ist noch kein Klausurplan gespeichert. Bitte zuerst im Browser einen Plan öffnen oder importieren.'
    );
  }
  return {
    state: normalizeState(res.state),
    revision: res.revision,
    updatedAt: res.updatedAt,
    updatedBy: res.updatedBy,
  };
}

export async function saveBridgeState(
  state: AppState,
  options: {
    bridgeUrl?: string;
    expectedRevision?: number;
    reason?: string;
  } = {}
): Promise<{
  saved: boolean;
  revision: number;
  savedAt: string;
  backupFile?: string | null;
}> {
  const bridgeUrl = options.bridgeUrl || DEFAULT_BRIDGE_URL;
  const res = await fetch(`${bridgeUrl}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state,
      expectedRevision: options.expectedRevision,
      source: 'mcp',
      createBackup: true,
      backupReason: options.reason || 'mcp-apply',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    saved?: boolean;
    revision?: number;
    savedAt?: string;
    backupFile?: string | null;
    error?: string;
    currentRevision?: number;
  };
  if (res.status === 409) {
    throw new Error(
      `Revisionskonflikt: Der Plan wurde zwischenzeitlich geändert (erwartet Rev. ${options.expectedRevision}, aktuell Rev. ${data.currentRevision}). Bitte aktuellen Stand neu abrufen.`
    );
  }
  if (!res.ok) {
    throw new Error(data.error || `Speichern fehlgeschlagen (HTTP ${res.status})`);
  }
  return {
    saved: Boolean(data.saved),
    revision: Number(data.revision || 0),
    savedAt: String(data.savedAt || ''),
    backupFile: data.backupFile ?? null,
  };
}

export async function listBridgeBackups(bridgeUrl = DEFAULT_BRIDGE_URL): Promise<BackupEntry[]> {
  const res = await fetch(`${bridgeUrl}/api/state/backups`);
  const data = (await res.json().catch(() => ({}))) as { backups?: BackupEntry[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Backups konnten nicht geladen werden (HTTP ${res.status})`);
  }
  return data.backups || [];
}

export async function restoreBridgeBackup(
  filename?: string,
  bridgeUrl = DEFAULT_BRIDGE_URL
): Promise<{
  restoredFrom: string;
  safetyBackup: string | null;
  revision: number;
  updatedAt: string;
}> {
  const res = await fetch(`${bridgeUrl}/api/state/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filename ? { filename } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as {
    restoredFrom?: string;
    safetyBackup?: string | null;
    revision?: number;
    updatedAt?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Backup-Wiederherstellung fehlgeschlagen (HTTP ${res.status})`);
  }
  return {
    restoredFrom: String(data.restoredFrom || ''),
    safetyBackup: data.safetyBackup ?? null,
    revision: Number(data.revision || 0),
    updatedAt: String(data.updatedAt || ''),
  };
}

export function normalizeState(raw: Partial<AppState>): AppState {
  return {
    classes: (raw.classes || []).map((c) => ({
      ...c,
      gradeLevel: c.gradeLevel ?? inferGradeLevel(c.className),
    })),
    weeks: raw.weeks || [],
    exams: raw.exams || [],
    blockedDays: raw.blockedDays || {},
    holidayLabels: raw.holidayLabels || {},
    blockedClassDays: raw.blockedClassDays || {},
    selectedSubjects: raw.selectedSubjects || {},
    subjectTiming: raw.subjectTiming || {},
    classSubjectTiming: raw.classSubjectTiming || {},
    pdfSettings: raw.pdfSettings || {
      title: 'Klausurplanung',
      makeupExamInfo: '**',
      gradesDueDate: '',
    },
    solverSettings: { ...DEFAULT_SOLVER_SETTINGS, ...(raw.solverSettings || {}) },
    edupageMeta: raw.edupageMeta,
    reviewSync: raw.reviewSync,
  };
}

function getTimingPrefs(state: AppState): TimingPreferences {
  return {
    global: state.subjectTiming || {},
    byClass: state.classSubjectTiming || {},
  };
}

export function formatSlotInfo(week: Week | undefined, day: DayOfWeek | null): {
  weekId: string | null;
  weekNumber: number | null;
  weekType: 'A' | 'B' | null;
  day: DayOfWeek | null;
  dayGerman: string | null;
  dateISO: string | null;
  dateShort: string | null;
  label: string;
} {
  if (!week || !day) {
    return {
      weekId: null,
      weekNumber: null,
      weekType: null,
      day: null,
      dayGerman: null,
      dateISO: null,
      dateShort: null,
      label: 'Nicht platziert',
    };
  }
  const d = getWeekDayDate(week, day);
  const dateISO = formatISODate(d);
  const dateShort = formatShortDate(d);
  const weekType = week.weekType ?? null;
  const typeSuffix = weekType ? ` (${weekType})` : '';
  return {
    weekId: week.id,
    weekNumber: week.weekNumber,
    weekType,
    day,
    dayGerman: GERMAN_DAY_FULL[day],
    dateISO,
    dateShort,
    label: `KW ${week.weekNumber}${typeSuffix} · ${GERMAN_DAY_SHORT[day]} ${dateShort}`,
  };
}

export interface ScheduleDiagnostics {
  evaluation: ScheduleEvaluation;
  unassignedExams: Array<{
    examId: string;
    className: string;
    subject: string;
    gradeLevel: string;
    teachers: string[];
  }>;
  constraintViolations: Array<{
    examId: string;
    className: string;
    subject: string;
    slot: string;
    reason: string;
  }>;
  teacherCollisions: Array<{
    weekId: string;
    day: DayOfWeek;
    slot: string;
    teacher: string;
    exams: Array<{ examId: string; className: string; subject: string }>;
  }>;
  consecutiveDayPairs: Array<{
    className: string;
    first: { examId: string; subject: string; slot: string };
    second: { examId: string; subject: string; slot: string };
  }>;
}

export function collectScheduleDiagnostics(state: AppState): ScheduleDiagnostics {
  const settings = state.solverSettings || DEFAULT_SOLVER_SETTINGS;
  const timing = getTimingPrefs(state);
  const evaluation = evaluateSchedule(
    state.exams,
    state.classes,
    state.weeks,
    state.blockedDays,
    state.blockedClassDays,
    settings,
    timing
  );

  const classMap = new Map(state.classes.map((c) => [c.className, c]));
  const weekMap = new Map(state.weeks.map((w) => [w.id, w]));
  const weekIdxMap = new Map(state.weeks.map((w, idx) => [w.id, idx]));

  const unassignedExams: ScheduleDiagnostics['unassignedExams'] = [];
  const constraintViolations: ScheduleDiagnostics['constraintViolations'] = [];
  const slotTeacherExams = new Map<string, Array<{ examId: string; className: string; subject: string }>>();
  const assignedByClass = new Map<string, Array<{ exam: Exam; absDay: number; slot: string }>>();

  for (const exam of state.exams) {
    const cls = classMap.get(exam.className);
    const gradeLevel = getEffectiveGradeLevel(cls, exam.className);

    if (!exam.assignedWeekId || !exam.assignedDay) {
      unassignedExams.push({
        examId: exam.id,
        className: exam.className,
        subject: exam.subject,
        gradeLevel,
        teachers: getExamTeachersNormalized(exam, state.classes, state.weeks),
      });
      continue;
    }

    const week = weekMap.get(exam.assignedWeekId);
    const slotInfo = formatSlotInfo(week, exam.assignedDay);

    if (cls) {
      const check = validateMove(
        exam,
        exam.assignedWeekId,
        exam.assignedDay,
        state.exams,
        cls,
        state.weeks,
        state.blockedDays,
        state.blockedClassDays,
        settings,
        state.classes
      );
      if (!check.valid) {
        constraintViolations.push({
          examId: exam.id,
          className: exam.className,
          subject: exam.subject,
          slot: slotInfo.label,
          reason: check.reason || 'Regelverstoß',
        });
      }
    }

    if (week) {
      const teachers = getEffectiveExamTeachers(cls, exam.subject, exam.assignedDay, week.id);
      for (const teacher of teachers) {
        const key = `${exam.assignedWeekId}::${exam.assignedDay}::${teacher.trim().toUpperCase()}`;
        const list = slotTeacherExams.get(key) || [];
        list.push({ examId: exam.id, className: exam.className, subject: exam.subject });
        slotTeacherExams.set(key, list);
      }

      const wIdx = weekIdxMap.get(exam.assignedWeekId);
      if (wIdx !== undefined) {
        const absDay = wIdx * 5 + DAY_TO_INDEX[exam.assignedDay];
        const list = assignedByClass.get(exam.className) || [];
        list.push({ exam, absDay, slot: slotInfo.label });
        assignedByClass.set(exam.className, list);
      }
    }
  }

  const teacherCollisions: ScheduleDiagnostics['teacherCollisions'] = [];
  for (const [key, list] of slotTeacherExams.entries()) {
    if (list.length > 1) {
      const [weekId, dayStr, teacher] = key.split('::');
      const day = dayStr as DayOfWeek;
      teacherCollisions.push({
        weekId,
        day,
        slot: formatSlotInfo(weekMap.get(weekId), day).label,
        teacher,
        exams: list,
      });
    }
  }

  const consecutiveDayPairs: ScheduleDiagnostics['consecutiveDayPairs'] = [];
  for (const [className, items] of assignedByClass.entries()) {
    items.sort((a, b) => a.absDay - b.absDay);
    for (let i = 0; i < items.length - 1; i++) {
      const first = items[i];
      const second = items[i + 1];
      if (second.absDay - first.absDay === 1) {
        consecutiveDayPairs.push({
          className,
          first: { examId: first.exam.id, subject: first.exam.subject, slot: first.slot },
          second: { examId: second.exam.id, subject: second.exam.subject, slot: second.slot },
        });
      }
    }
  }

  return {
    evaluation,
    unassignedExams,
    constraintViolations,
    teacherCollisions,
    consecutiveDayPairs,
  };
}

export function buildPlanOverview(
  state: AppState,
  meta: { revision: number; updatedAt: string | null; updatedBy: string | null }
) {
  const diagnostics = collectScheduleDiagnostics(state);
  const weeks = state.weeks.map((w) => {
    const blocked = DAYS_OF_WEEK.filter((d) => state.blockedDays[w.id]?.[d]).map((d) => ({
      day: d,
      dayGerman: GERMAN_DAY_SHORT[d],
      dateISO: formatISODate(getWeekDayDate(w, d)),
      label: state.holidayLabels?.[w.id]?.[d] || 'Blockiert',
    }));
    const hasConcreteWeeklySchedules = state.classes.some((c) => Boolean(c.weeklySchedules?.[w.id]));
    return {
      id: w.id,
      weekNumber: w.weekNumber,
      year: w.year,
      weekType: w.weekType ?? null,
      hasConcreteWeeklySchedules,
      isBlocked: w.isBlocked,
      dateRange: getWeekDateRangeString(w),
      blockedDays: blocked,
    };
  });

  const classesSummary = state.classes
    .map((cls) => {
      const classExams = state.exams.filter((e) => e.className === cls.className);
      const assigned = classExams.filter((e) => e.assignedWeekId && e.assignedDay).length;
      const pinned = classExams.filter((e) => e.isPinned).length;
      const teachers = extractTeacherCodes([cls]);
      return {
        className: cls.className,
        gradeLevel: getEffectiveGradeLevel(cls, cls.className),
        selectedSubjectCount: (state.selectedSubjects[cls.className] || []).length,
        availableSubjectCount: getAllSubjectsForClass(cls).length,
        weeklyScheduleCount: Object.keys(cls.weeklySchedules || {}).length,
        examCount: classExams.length,
        assignedCount: assigned,
        unassignedCount: classExams.length - assigned,
        pinnedCount: pinned,
        teachers,
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className, 'de'));

  const reviewConfigured = Boolean(state.reviewSync?.planId && state.reviewSync?.adminToken);
  const teacherDirectory = extractTeacherOptions(state.classes);

  return {
    meta: {
      revision: meta.revision,
      updatedAt: meta.updatedAt,
      updatedBy: meta.updatedBy,
    },
    pdfSettings: state.pdfSettings,
    solverSettings: state.solverSettings || DEFAULT_SOLVER_SETTINGS,
    edupageMeta: state.edupageMeta
      ? {
          subdomain: state.edupageMeta.subdomain,
          lastSyncAt: state.edupageMeta.lastSyncAt,
          lastHolidaySyncAt: state.edupageMeta.lastHolidaySyncAt,
          weekAParity: state.edupageMeta.weekAParity ?? null,
          selectedClassCount: state.edupageMeta.selectedClassIds?.length ?? null,
        }
      : null,
    reviewSync: {
      configured: reviewConfigured,
      serverUrl: getEffectiveServerUrl(state.reviewSync?.serverUrl) || DEFAULT_REVIEW_SERVER_URL,
      planId: state.reviewSync?.planId || null,
      isActive: state.reviewSync?.isActive ?? null,
      lastPublishedAt: state.reviewSync?.lastPublishedAt || null,
    },
    weeks,
    classesSummary,
    allTeachers: teacherDirectory.map((t) => t.code),
    teacherDirectory,
    diagnostics,
  };
}

export function buildFullPlanData(
  state: AppState,
  filters: {
    classNames?: string[];
    subjects?: string[];
    teacherCode?: string;
    weekIds?: string[];
    onlyUnassigned?: boolean;
    includeSchedules?: boolean;
  } = {}
) {
  const classFilter = filters.classNames ? new Set(filters.classNames) : null;
  const subjectFilter = filters.subjects ? new Set(filters.subjects) : null;
  const weekFilter = filters.weekIds ? new Set(filters.weekIds) : null;
  const teacherUpper = filters.teacherCode?.trim().toUpperCase() || null;

  const classMap = new Map(state.classes.map((c) => [c.className, c]));
  const weekMap = new Map(state.weeks.map((w) => [w.id, w]));
  const settings = state.solverSettings || DEFAULT_SOLVER_SETTINGS;
  const timing = getTimingPrefs(state);

  const teacherClassSet = teacherUpper ? new Set(getTeacherClasses(state.classes, teacherUpper)) : null;

  const classes = state.classes
    .filter((c) => {
      if (classFilter && !classFilter.has(c.className)) return false;
      if (teacherClassSet && !teacherClassSet.has(c.className)) return false;
      return true;
    })
    .map((c) => {
      const filteredWeeklySchedules = c.weeklySchedules
        ? weekFilter
          ? Object.fromEntries(
              Object.entries(c.weeklySchedules).filter(([wId]) => weekFilter.has(wId))
            )
          : c.weeklySchedules
        : null;

      return {
        className: c.className,
        gradeLevel: getEffectiveGradeLevel(c, c.className),
        selectedSubjects: state.selectedSubjects[c.className] || [],
        availableSubjects: getAllSubjectsForClass(c),
        examTeacherBySubject: c.examTeacherBySubject || {},
        teacherNames: c.teacherNames || {},
        blockedClassDays: state.blockedClassDays[c.className] || {},
        ...(filters.includeSchedules !== false
          ? {
              subjects: c.subjects,
              weeklySchedules: filteredWeeklySchedules,
              subjectsB: c.subjectsB || null,
              subjectTeachers: c.subjectTeachers || {},
              subjectTeachersB: c.subjectTeachersB || {},
            }
          : {
              weeklyScheduleWeekIds: Object.keys(c.weeklySchedules || {}),
            }),
      };
    });

  const exams = state.exams
    .filter((e) => {
      if (classFilter && !classFilter.has(e.className)) return false;
      if (subjectFilter && !subjectFilter.has(e.subject)) return false;
      if (filters.onlyUnassigned && e.assignedWeekId && e.assignedDay) return false;
      if (weekFilter && e.assignedWeekId && !weekFilter.has(e.assignedWeekId)) return false;
      if (teacherUpper) {
        const teachers = getExamTeachersNormalized(e, state.classes, state.weeks);
        if (!teachers.includes(teacherUpper)) return false;
      }
      return true;
    })
    .map((e) => {
      const cls = classMap.get(e.className);
      const week = e.assignedWeekId ? weekMap.get(e.assignedWeekId) : undefined;
      const slot = formatSlotInfo(week, e.assignedDay);
      const teachers = getExamTeachersNormalized(e, state.classes, state.weeks);
      const validation =
        cls && e.assignedWeekId && e.assignedDay
          ? validateMove(
              e,
              e.assignedWeekId,
              e.assignedDay,
              state.exams,
              cls,
              state.weeks,
              state.blockedDays,
              state.blockedClassDays,
              settings,
              state.classes
            )
          : null;

      return {
        id: e.id,
        className: e.className,
        gradeLevel: getEffectiveGradeLevel(cls, e.className),
        subject: e.subject,
        durationMinutes: e.durationMinutes,
        isPinned: e.isPinned,
        assignedWeekId: e.assignedWeekId,
        assignedDay: e.assignedDay,
        slotLabel: slot.label,
        dateISO: slot.dateISO,
        teachers,
        timingPreference: getExamTimingPreference(e, timing),
        validation,
      };
    });

  return {
    weeks: state.weeks
      .filter((w) => !weekFilter || weekFilter.has(w.id))
      .map((w) => ({
        ...w,
        weekType: w.weekType ?? null,
        dateRange: getWeekDateRangeString(w),
        blockedDays: state.blockedDays[w.id] || {},
        holidayLabels: state.holidayLabels?.[w.id] || {},
      })),
    classes,
    exams,
    teacherDirectory: extractTeacherOptions(state.classes),
    subjectTiming: state.subjectTiming || {},
    classSubjectTiming: state.classSubjectTiming || {},
    solverSettings: settings,
    pdfSettings: state.pdfSettings,
  };
}

export async function getReviewInboxEnriched(
  state: AppState,
  filters: { statusFilter?: 'open' | 'done' | 'all'; teacherCode?: string } = {}
) {
  const sync = state.reviewSync;
  if (!sync?.planId || !sync?.adminToken) {
    throw new Error(
      'Für diesen Plan ist noch keine Kollegen-Abstimmung veröffentlicht (reviewSync.planId/adminToken fehlt).'
    );
  }

  const serverUrl = getEffectiveServerUrl(sync.serverUrl);
  const inbox = await fetchReviewInbox(serverUrl, sync.planId, sync.adminToken);
  const statusFilter = filters.statusFilter || 'all';
  const teacherFilter = filters.teacherCode?.trim().toUpperCase() || null;

  const examMap = new Map(state.exams.map((e) => [e.id, e]));
  const weekMap = new Map(state.weeks.map((w) => [w.id, w]));

  const teacherOptions = extractTeacherOptions(state.classes);
  const teacherOptionMap = new Map(teacherOptions.map((o) => [o.code, o]));
  const allTeacherCodes = teacherOptions.map((o) => o.code);
  const respondedCodes = new Set(inbox.submissions.map((s) => s.teacherCode.trim().toUpperCase()));
  const pendingTeacherCodes = allTeacherCodes.filter((c) => !respondedCodes.has(c));

  const matchesStatus = (resStatus: TicketResolutionStatus) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return resStatus === 'open';
    return resStatus !== 'open';
  };

  let openExamObjections = 0;
  let openDayWishes = 0;

  const submissions = inbox.submissions
    .filter((sub) => !teacherFilter || sub.teacherCode.trim().toUpperCase() === teacherFilter)
    .map((sub) => {
      const teacherUpper = sub.teacherCode.trim().toUpperCase();
      const examFeedback = (sub.examFeedback || [])
        .filter((ef: ReviewExamFeedback) => {
          if (ef.status === 'not_ok' && ef.resolutionStatus === 'open') openExamObjections++;
          return ef.status === 'not_ok' ? matchesStatus(ef.resolutionStatus) : statusFilter === 'all';
        })
        .map((ef: ReviewExamFeedback) => {
          const exam = examMap.get(ef.examId);
          const week = exam?.assignedWeekId ? weekMap.get(exam.assignedWeekId) : undefined;
          return {
            ...ef,
            currentExam: exam
              ? {
                  id: exam.id,
                  isPinned: exam.isPinned,
                  assignedWeekId: exam.assignedWeekId,
                  assignedDay: exam.assignedDay,
                  slotLabel: formatSlotInfo(week, exam.assignedDay).label,
                  teachers: getExamTeachersNormalized(exam, state.classes, state.weeks),
                }
              : null,
          };
        });

      const dayWishes = (sub.dayWishes || [])
        .filter((dw: ReviewDayWish) => {
          if (dw.resolutionStatus === 'open') openDayWishes++;
          return matchesStatus(dw.resolutionStatus);
        })
        .map((dw: ReviewDayWish) => {
          const week = weekMap.get(dw.weekId);
          return {
            ...dw,
            slotLabel: formatSlotInfo(week, dw.day).label,
            affectedClasses: dw.className
              ? [dw.className]
              : getTeacherClasses(state.classes, teacherUpper),
          };
        });

      return {
        id: sub.id,
        teacherCode: teacherUpper,
        teacherDisplayName: teacherOptionMap.get(teacherUpper)?.displayName || teacherUpper,
        teacherClasses: getTeacherClasses(state.classes, teacherUpper),
        overallStatus: sub.overallStatus,
        generalNote: sub.generalNote,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
        examFeedback,
        dayWishes,
      };
    });

  return {
    serverUrl,
    plan: inbox.plan,
    summary: {
      totalSubmissions: inbox.submissions.length,
      respondedTeachers: Array.from(respondedCodes).sort(),
      pendingTeacherCodes,
      openExamObjections,
      openDayWishes,
      totalOpenTickets: openExamObjections + openDayWishes,
    },
    submissions,
  };
}

function resolveExam(
  exams: Exam[],
  ref: { examId?: string; className?: string; subject?: string }
): Exam {
  if (ref.examId) {
    const found = exams.find((e) => e.id === ref.examId);
    if (!found) {
      throw new Error(`Klausur mit ID '${ref.examId}' nicht gefunden.`);
    }
    return found;
  }
  if (ref.className && ref.subject) {
    const found = exams.find(
      (e) => e.className === ref.className && e.subject === ref.subject
    );
    if (!found) {
      throw new Error(`Klausur '${ref.subject}' in Klasse '${ref.className}' nicht gefunden.`);
    }
    return found;
  }
  throw new Error("Bitte entweder 'examId' oder ('className' + 'subject') angeben.");
}

export function findValidSlotsForExam(
  state: AppState,
  params: {
    examId?: string;
    className?: string;
    subject?: string;
    weekIds?: string[];
    includeInvalidReasons?: boolean;
  }
) {
  const exam = resolveExam(state.exams, params);
  const cls = state.classes.find((c) => c.className === exam.className);
  if (!cls) {
    throw new Error(`Stundenplan für Klasse '${exam.className}' nicht gefunden.`);
  }

  const settings = state.solverSettings || DEFAULT_SOLVER_SETTINGS;
  const timing = getTimingPrefs(state);
  const grade = getEffectiveGradeLevel(cls, exam.className);
  const classMap = new Map(state.classes.map((c) => [c.className, c]));
  const weekFilter = params.weekIds ? new Set(params.weekIds) : null;
  const weekMap = new Map(state.weeks.map((w) => [w.id, w]));

  const sameGradeSameSubjectWeeks = new Set<string>();
  for (const other of state.exams) {
    if (other.id === exam.id || other.subject !== exam.subject || !other.assignedWeekId) continue;
    const otherCls = classMap.get(other.className);
    if (getEffectiveGradeLevel(otherCls, other.className) === grade) {
      sameGradeSameSubjectWeeks.add(other.assignedWeekId);
    }
  }

  const validSlots: Array<{
    weekId: string;
    weekNumber: number;
    weekType: 'A' | 'B' | null;
    day: DayOfWeek;
    slotLabel: string;
    dateISO: string;
    isCurrentSlot: boolean;
    periodCount: number;
    teachers: string[];
    sameGradeSubjectInWeek: boolean;
    warning: string | null;
    desirabilityScore: number;
  }> = [];

  const invalidReasons: Array<{
    weekId: string;
    day: DayOfWeek;
    slotLabel: string;
    reason: string;
  }> = [];

  const pref = getExamTimingPreference(exam, timing);

  for (let wIdx = 0; wIdx < state.weeks.length; wIdx++) {
    const week = state.weeks[wIdx];
    if (weekFilter && !weekFilter.has(week.id)) continue;

    for (const day of DAYS_OF_WEEK) {
      const check = validateMove(
        exam,
        week.id,
        day,
        state.exams,
        cls,
        state.weeks,
        state.blockedDays,
        state.blockedClassDays,
        settings,
        state.classes
      );
      const slotInfo = formatSlotInfo(week, day);

      if (!check.valid) {
        if (params.includeInvalidReasons) {
          invalidReasons.push({
            weekId: week.id,
            day,
            slotLabel: slotInfo.label,
            reason: check.reason || 'Ungültig',
          });
        }
        continue;
      }

      const periodCount = getSubjectPeriodCount(cls, exam.subject, day, week.id);
      const teachers = getEffectiveExamTeachers(cls, exam.subject, day, week.id);
      const sameGradeSubjectInWeek = sameGradeSameSubjectWeeks.has(week.id);

      let desirability = 100;
      if (check.warning) desirability -= 40;
      if (periodCount >= 2) desirability += 15;
      if (sameGradeSubjectInWeek) desirability += 20;
      if (pref === 'early' && state.weeks.length > 1) {
        desirability += Math.round(25 * (1 - wIdx / (state.weeks.length - 1)));
      } else if (pref === 'late' && state.weeks.length > 1) {
        desirability += Math.round(25 * (wIdx / (state.weeks.length - 1)));
      }

      validSlots.push({
        weekId: week.id,
        weekNumber: week.weekNumber,
        weekType: week.weekType ?? null,
        day,
        slotLabel: slotInfo.label,
        dateISO: slotInfo.dateISO || '',
        isCurrentSlot: exam.assignedWeekId === week.id && exam.assignedDay === day,
        periodCount,
        teachers,
        sameGradeSubjectInWeek,
        warning: check.warning || null,
        desirabilityScore: desirability,
      });
    }
  }

  validSlots.sort((a, b) => b.desirabilityScore - a.desirabilityScore);

  const currentWeek = exam.assignedWeekId ? weekMap.get(exam.assignedWeekId) : undefined;
  return {
    exam: {
      id: exam.id,
      className: exam.className,
      gradeLevel: grade,
      subject: exam.subject,
      isPinned: exam.isPinned,
      timingPreference: pref,
      currentSlot: formatSlotInfo(currentWeek, exam.assignedDay).label,
    },
    validSlotCount: validSlots.length,
    validSlots,
    ...(params.includeInvalidReasons ? { invalidReasons } : {}),
  };
}

export type PlanOperation =
  | {
      type: 'move_exam';
      examId?: string;
      className?: string;
      subject?: string;
      weekId: string | null;
      day: DayOfWeek | null;
      isPinned?: boolean;
      allowInvalid?: boolean;
    }
  | {
      type: 'set_exam_pinned';
      examId?: string;
      className?: string;
      subject?: string;
      isPinned: boolean;
    }
  | {
      type: 'set_exam_duration';
      examId?: string;
      className?: string;
      subject?: string;
      durationMinutes: number;
    }
  | {
      type: 'set_blocked_day';
      scope: 'global' | 'class';
      className?: string;
      weekId: string;
      day: DayOfWeek;
      blocked: boolean;
      label?: string;
    }
  | {
      type: 'set_week_blocked';
      weekId: string;
      isBlocked: boolean;
    }
  | {
      type: 'set_week_type';
      weekId: string;
      weekType: 'A' | 'B';
    }
  | {
      type: 'set_subject_timing';
      scope: 'global' | 'class';
      className?: string;
      subject: string;
      timing: SubjectTimingPreference;
    }
  | {
      type: 'set_exam_teacher';
      className: string;
      subject: string;
      teacher: string | null;
    }
  | {
      type: 'set_selected_subjects';
      className: string;
      subjects: string[];
    }
  | {
      type: 'set_class_grade_level';
      className: string;
      gradeLevel: string;
    }
  | {
      type: 'update_solver_settings';
      settings: Partial<SolverSettings>;
    }
  | {
      type: 'update_pdf_settings';
      settings: Partial<PdfSettings>;
    };

export interface ApplyOperationsOptions {
  operations: PlanOperation[];
  runAutoFixAfter?: boolean;
  runDistributeAfter?: boolean;
  strictValidation?: boolean;
}

export function applyOperationsToState(baseState: AppState, options: ApplyOperationsOptions) {
  const strict = options.strictValidation !== false;
  const before = normalizeState(structuredClone(baseState));
  const next = normalizeState(structuredClone(baseState));

  const diagnosticsBefore = collectScheduleDiagnostics(before);
  const warnings: string[] = [];
  const otherChanges: string[] = [];

  for (let idx = 0; idx < options.operations.length; idx++) {
    const op = options.operations[idx];
    const step = `Op #${idx + 1} (${op.type})`;

    switch (op.type) {
      case 'move_exam': {
        const exam = resolveExam(next.exams, op);
        const cls = next.classes.find((c) => c.className === exam.className);
        if (!cls) {
          throw new Error(`${step}: Klasse '${exam.className}' nicht gefunden.`);
        }

        if (op.weekId === null || op.day === null) {
          exam.assignedWeekId = null;
          exam.assignedDay = null;
          if (typeof op.isPinned === 'boolean') {
            exam.isPinned = op.isPinned;
          }
        } else {
          const check = validateMove(
            exam,
            op.weekId,
            op.day,
            next.exams,
            cls,
            next.weeks,
            next.blockedDays,
            next.blockedClassDays,
            next.solverSettings || DEFAULT_SOLVER_SETTINGS,
            next.classes
          );
          if (!check.valid && strict && !op.allowInvalid) {
            throw new Error(
              `${step}: Ungültige Verschiebung für ${exam.className} ${exam.subject} nach ${op.weekId} ${op.day}: ${check.reason}`
            );
          }
          if (!check.valid) {
            warnings.push(`${step} (${exam.className} ${exam.subject}): ${check.reason}`);
          } else if (check.warning) {
            warnings.push(`${step} (${exam.className} ${exam.subject}): ${check.warning}`);
          }
          exam.assignedWeekId = op.weekId;
          exam.assignedDay = op.day;
          if (typeof op.isPinned === 'boolean') {
            exam.isPinned = op.isPinned;
          }
        }
        break;
      }

      case 'set_exam_pinned': {
        const exam = resolveExam(next.exams, op);
        exam.isPinned = op.isPinned;
        break;
      }

      case 'set_exam_duration': {
        const exam = resolveExam(next.exams, op);
        if (!Number.isFinite(op.durationMinutes) || op.durationMinutes <= 0) {
          throw new Error(`${step}: Ungültige Dauer (${op.durationMinutes}).`);
        }
        exam.durationMinutes = Math.round(op.durationMinutes);
        break;
      }

      case 'set_blocked_day': {
        if (!next.weeks.some((w) => w.id === op.weekId)) {
          throw new Error(`${step}: Woche '${op.weekId}' nicht gefunden.`);
        }
        if (op.scope === 'global') {
          const prevWeek = next.blockedDays[op.weekId] || ({} as Record<DayOfWeek, boolean>);
          next.blockedDays[op.weekId] = { ...prevWeek, [op.day]: op.blocked };
          if (op.blocked && op.label) {
            next.holidayLabels = next.holidayLabels || {};
            next.holidayLabels[op.weekId] = {
              ...(next.holidayLabels[op.weekId] || {}),
              [op.day]: op.label,
            };
          } else if (!op.blocked && next.holidayLabels?.[op.weekId]?.[op.day]) {
            const copy = { ...next.holidayLabels[op.weekId] };
            delete copy[op.day];
            next.holidayLabels[op.weekId] = copy;
          }
          otherChanges.push(
            `Globaler Sperrtag ${op.weekId} ${GERMAN_DAY_SHORT[op.day]}: ${op.blocked ? 'gesperrt' : 'freigegeben'}${op.label ? ` (${op.label})` : ''}`
          );
        } else {
          if (!op.className) {
            throw new Error(`${step}: Für scope='class' muss 'className' angegeben sein.`);
          }
          const clsMap = next.blockedClassDays[op.className] || {};
          const wMap = clsMap[op.weekId] || ({} as Record<DayOfWeek, boolean>);
          next.blockedClassDays[op.className] = {
            ...clsMap,
            [op.weekId]: { ...wMap, [op.day]: op.blocked },
          };
          otherChanges.push(
            `Sperrtag ${op.className} ${op.weekId} ${GERMAN_DAY_SHORT[op.day]}: ${op.blocked ? 'gesperrt' : 'freigegeben'}`
          );
        }
        break;
      }

      case 'set_week_blocked': {
        const week = next.weeks.find((w) => w.id === op.weekId);
        if (!week) {
          throw new Error(`${step}: Woche '${op.weekId}' nicht gefunden.`);
        }
        week.isBlocked = op.isBlocked;
        otherChanges.push(`Woche ${week.id}: ${op.isBlocked ? 'komplett gesperrt' : 'freigegeben'}`);
        break;
      }

      case 'set_week_type': {
        const week = next.weeks.find((w) => w.id === op.weekId);
        if (!week) {
          throw new Error(`${step}: Woche '${op.weekId}' nicht gefunden.`);
        }
        week.weekType = op.weekType;
        otherChanges.push(`Woche ${week.id} auf ${op.weekType}-Woche gesetzt`);
        break;
      }

      case 'set_subject_timing': {
        if (op.scope === 'global') {
          next.subjectTiming = { ...(next.subjectTiming || {}), [op.subject]: op.timing };
          otherChanges.push(`Zeitpräferenz ${op.subject}: ${op.timing}`);
        } else {
          if (!op.className) {
            throw new Error(`${step}: Für scope='class' muss 'className' angegeben sein.`);
          }
          const existing = next.classSubjectTiming?.[op.className] || {};
          next.classSubjectTiming = {
            ...(next.classSubjectTiming || {}),
            [op.className]: { ...existing, [op.subject]: op.timing },
          };
          otherChanges.push(`Zeitpräferenz ${op.className} ${op.subject}: ${op.timing}`);
        }
        break;
      }

      case 'set_exam_teacher': {
        const cls = next.classes.find((c) => c.className === op.className);
        if (!cls) {
          throw new Error(`${step}: Klasse '${op.className}' nicht gefunden.`);
        }
        const map = { ...(cls.examTeacherBySubject || {}) };
        if (op.teacher === null || op.teacher.trim() === '') {
          delete map[op.subject];
          otherChanges.push(`Prüfungslehrkraft ${op.className} ${op.subject}: zurückgesetzt`);
        } else {
          map[op.subject] = op.teacher.trim();
          otherChanges.push(`Prüfungslehrkraft ${op.className} ${op.subject}: ${op.teacher.trim()}`);
        }
        cls.examTeacherBySubject = map;
        break;
      }

      case 'set_selected_subjects': {
        const cls = next.classes.find((c) => c.className === op.className);
        if (!cls) {
          throw new Error(`${step}: Klasse '${op.className}' nicht gefunden.`);
        }
        const unique = Array.from(new Set(op.subjects));
        const available = new Set(getAllSubjectsForClass(cls));
        if (available.size > 0) {
          for (const subject of unique) {
            if (!available.has(subject)) {
              warnings.push(
                `${step} (${op.className}): Fach '${subject}' kommt im Stundenplan von ${op.className} nicht vor.`
              );
            }
          }
        }
        next.selectedSubjects[op.className] = unique;
        const allowed = new Set(unique);

        next.exams = next.exams.filter(
          (e) => e.className !== op.className || allowed.has(e.subject)
        );
        for (const subject of unique) {
          const exists = next.exams.some(
            (e) => e.className === op.className && e.subject === subject
          );
          if (!exists) {
            next.exams.push({
              id: uuidv4(),
              className: op.className,
              subject,
              durationMinutes: 90,
              isPinned: false,
              assignedWeekId: null,
              assignedDay: null,
            });
          }
        }
        otherChanges.push(`Ausgewählte Fächer für ${op.className}: ${unique.join(', ') || '(keine)'}`);
        break;
      }

      case 'set_class_grade_level': {
        const cls = next.classes.find((c) => c.className === op.className);
        if (!cls) {
          throw new Error(`${step}: Klasse '${op.className}' nicht gefunden.`);
        }
        cls.gradeLevel = op.gradeLevel.trim();
        otherChanges.push(`Stufe für ${op.className}: ${cls.gradeLevel}`);
        break;
      }

      case 'update_solver_settings': {
        next.solverSettings = {
          ...(next.solverSettings || DEFAULT_SOLVER_SETTINGS),
          ...op.settings,
        };
        otherChanges.push(`Solver-Regeln aktualisiert: ${JSON.stringify(op.settings)}`);
        break;
      }

      case 'update_pdf_settings': {
        next.pdfSettings = {
          ...next.pdfSettings,
          ...op.settings,
        };
        otherChanges.push(`PDF-Einstellungen aktualisiert`);
        break;
      }
    }
  }

  const timingAfter = getTimingPrefs(next);
  const settingsAfter = next.solverSettings || DEFAULT_SOLVER_SETTINGS;

  if (options.runDistributeAfter) {
    next.exams = distributeExams(
      next.classes,
      next.weeks,
      next.blockedDays,
      next.selectedSubjects,
      next.blockedClassDays,
      next.exams,
      settingsAfter,
      timingAfter
    );
    otherChanges.push('Smart-Solver (distributeExams) ausgeführt');
  } else if (options.runAutoFixAfter) {
    next.exams = autoFix(
      next.exams,
      next.classes,
      next.weeks,
      next.blockedDays,
      next.blockedClassDays,
      settingsAfter,
      timingAfter
    );
    otherChanges.push('Auto-Korrektur (autoFix) ausgeführt');
  }

  const diagnosticsAfter = collectScheduleDiagnostics(next);

  const beforeExamMap = new Map(before.exams.map((e) => [e.id, e]));
  const afterExamMap = new Map(next.exams.map((e) => [e.id, e]));
  const beforeWeekMap = new Map(before.weeks.map((w) => [w.id, w]));
  const afterWeekMap = new Map(next.weeks.map((w) => [w.id, w]));

  const examDiffs: Array<{
    examId: string;
    className: string;
    subject: string;
    changeType: 'moved' | 'pinned_changed' | 'duration_changed' | 'added' | 'removed';
    before: {
      slot: string;
      weekId: string | null;
      day: DayOfWeek | null;
      isPinned: boolean;
      durationMinutes: number;
    } | null;
    after: {
      slot: string;
      weekId: string | null;
      day: DayOfWeek | null;
      isPinned: boolean;
      durationMinutes: number;
    } | null;
  }> = [];

  for (const afterExam of next.exams) {
    const beforeExam = beforeExamMap.get(afterExam.id);
    const afterSlot = formatSlotInfo(
      afterExam.assignedWeekId ? afterWeekMap.get(afterExam.assignedWeekId) : undefined,
      afterExam.assignedDay
    ).label;

    if (!beforeExam) {
      examDiffs.push({
        examId: afterExam.id,
        className: afterExam.className,
        subject: afterExam.subject,
        changeType: 'added',
        before: null,
        after: {
          slot: afterSlot,
          weekId: afterExam.assignedWeekId,
          day: afterExam.assignedDay,
          isPinned: afterExam.isPinned,
          durationMinutes: afterExam.durationMinutes,
        },
      });
      continue;
    }

    const beforeSlot = formatSlotInfo(
      beforeExam.assignedWeekId ? beforeWeekMap.get(beforeExam.assignedWeekId) : undefined,
      beforeExam.assignedDay
    ).label;

    const slotChanged =
      beforeExam.assignedWeekId !== afterExam.assignedWeekId ||
      beforeExam.assignedDay !== afterExam.assignedDay;
    const pinChanged = beforeExam.isPinned !== afterExam.isPinned;
    const durChanged = beforeExam.durationMinutes !== afterExam.durationMinutes;

    if (slotChanged || pinChanged || durChanged) {
      examDiffs.push({
        examId: afterExam.id,
        className: afterExam.className,
        subject: afterExam.subject,
        changeType: slotChanged ? 'moved' : pinChanged ? 'pinned_changed' : 'duration_changed',
        before: {
          slot: beforeSlot,
          weekId: beforeExam.assignedWeekId,
          day: beforeExam.assignedDay,
          isPinned: beforeExam.isPinned,
          durationMinutes: beforeExam.durationMinutes,
        },
        after: {
          slot: afterSlot,
          weekId: afterExam.assignedWeekId,
          day: afterExam.assignedDay,
          isPinned: afterExam.isPinned,
          durationMinutes: afterExam.durationMinutes,
        },
      });
    }
  }

  for (const beforeExam of before.exams) {
    if (!afterExamMap.has(beforeExam.id)) {
      const beforeSlot = formatSlotInfo(
        beforeExam.assignedWeekId ? beforeWeekMap.get(beforeExam.assignedWeekId) : undefined,
        beforeExam.assignedDay
      ).label;
      examDiffs.push({
        examId: beforeExam.id,
        className: beforeExam.className,
        subject: beforeExam.subject,
        changeType: 'removed',
        before: {
          slot: beforeSlot,
          weekId: beforeExam.assignedWeekId,
          day: beforeExam.assignedDay,
          isPinned: beforeExam.isPinned,
          durationMinutes: beforeExam.durationMinutes,
        },
        after: null,
      });
    }
  }

  return {
    nextState: next,
    warnings,
    diff: {
      examChangesCount: examDiffs.length,
      examChanges: examDiffs,
      otherChanges,
    },
    evaluationBefore: diagnosticsBefore.evaluation,
    evaluationAfter: diagnosticsAfter.evaluation,
    diagnosticsAfter,
  };
}

export async function resolveReviewTicketsForState(
  state: AppState,
  resolutions: Array<{
    itemType: 'exam' | 'wish';
    itemId: string;
    status: TicketResolutionStatus;
    note?: string;
  }>
) {
  const sync = state.reviewSync;
  if (!sync?.planId || !sync?.adminToken) {
    throw new Error(
      'Für diesen Plan ist noch keine Kollegen-Abstimmung veröffentlicht (reviewSync.planId/adminToken fehlt).'
    );
  }
  const serverUrl = getEffectiveServerUrl(sync.serverUrl);
  const results: Array<{ itemType: 'exam' | 'wish'; itemId: string; status: TicketResolutionStatus; ok: boolean }> = [];

  for (const item of resolutions) {
    await updateTicketResolution(
      serverUrl,
      sync.planId,
      sync.adminToken,
      item.itemType,
      item.itemId,
      item.status,
      item.note || ''
    );
    results.push({
      itemType: item.itemType,
      itemId: item.itemId,
      status: item.status,
      ok: true,
    });
  }

  return {
    serverUrl,
    planId: sync.planId,
    updatedCount: results.length,
    results,
  };
}
