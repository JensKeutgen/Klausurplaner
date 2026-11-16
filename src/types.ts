export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export const DAYS_OF_WEEK: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export type SubjectTimingPreference = 'normal' | 'early' | 'late';

export interface WeekScheduleData {
  subjects: {
    [key in DayOfWeek]: string[];
  };
  subjectTeachers?: Partial<Record<DayOfWeek, Record<string, string[]>>>;
  /** Reason if class has no regular lessons on a specific day (e.g. Ferien, Ausflug, Kein Unterricht) */
  freeDays?: Partial<Record<DayOfWeek, string>>;
}

export interface ClassSchedule {
  className: string;
  gradeLevel?: string; // Stufe (e.g. "11", "BG25", "ITA24", "AIT1") - auto-inferred if omitted
  subjects: {
    [key in DayOfWeek]: string[]; // Default / fallback schedule
  };
  /** Concrete per-week schedule fetched from EduPage keyed by Week.id (e.g. "2026-KW46") */
  weeklySchedules?: Record<string, WeekScheduleData>;
  subjectsB?: {
    [key in DayOfWeek]: string[]; // Legacy optional fallback
  };
  // Optional teacher labels per day -> subject (populated by EduPage import)
  subjectTeachers?: Partial<Record<DayOfWeek, Record<string, string[]>>>;
  subjectTeachersB?: Partial<Record<DayOfWeek, Record<string, string[]>>>;
  // Optional selected exam teacher per subject when multiple teachers teach the same subject
  examTeacherBySubject?: Record<string, string>;
  // Optional mapping teacher short/label -> full name (e.g. "WAE" -> "Frank Wächter")
  teacherNames?: Record<string, string>;
}

export interface Exam {
  id: string;
  className: string;
  subject: string;
  durationMinutes: number; // Default 90
  isPinned: boolean;
  assignedWeekId: string | null;
  assignedDay: DayOfWeek | null;
}

export interface Week {
  id: string; // Deterministic Wochen-ID, e.g. "2026-KW45"
  weekNumber: number;
  year: number;
  isBlocked: boolean; // Entire week blocked
  weekType?: 'A' | 'B'; // Legacy optional field (unused when concrete weeklySchedules exist)
}

// Map of WeekId -> Day -> boolean (true if blocked globally)
export type BlockedDays = Record<string, Record<DayOfWeek, boolean>>;

// Map of WeekId -> Day -> string (holiday / block label, e.g. "Herbstferien")
export type HolidayLabels = Record<string, Partial<Record<DayOfWeek, string>>>;

// Map of ClassName -> WeekId -> Day -> boolean (true if blocked for that class)
export type BlockedClassDays = Record<string, Record<string, Record<DayOfWeek, boolean>>>;

export interface PdfSettings {
  title: string;
  makeupExamInfo: string;
  gradesDueDate: string;
}

export interface SolverSettings {
  maxExamsPerWeek: number;
  keepPinnedOnDistribute: boolean;
  preferSameGradeSubjectSameWeek: boolean;
  avoidConsecutiveDays: boolean;
  avoidTeacherCollisions: boolean;
}

export const DEFAULT_SOLVER_SETTINGS: SolverSettings = {
  maxExamsPerWeek: 2,
  keepPinnedOnDistribute: true,
  preferSameGradeSubjectSameWeek: true,
  avoidConsecutiveDays: true,
  avoidTeacherCollisions: true,
};

export interface EdupageMeta {
  subdomain?: string;
  username?: string;
  lastSyncAt?: string;
  lastHolidaySyncAt?: string;
  selectedClassIds?: string[];
  useShortSubjects?: boolean;
  weekAReferenceDate?: string;
  weekBReferenceDate?: string;
  weekAParity?: 'odd' | 'even';
}

export interface ReviewSyncMeta {
  serverUrl?: string; // Optional when running locally on dev:local
  planId?: string;
  adminToken?: string;
  lastPublishedAt?: string;
  isActive?: boolean;
}

export type ExamFeedbackStatus = 'ok' | 'not_ok';
export type ExamChangePreference = 'earlier' | 'later' | 'not_this_day';
export type DayWishType = 'no_go' | 'prefer';
export type TicketResolutionStatus = 'open' | 'applied' | 'dismissed';

export interface ReviewExamFeedback {
  id: string;
  examId: string;
  className: string;
  subject: string;
  status: ExamFeedbackStatus;
  preference: ExamChangePreference | null;
  note: string;
  resolutionStatus: TicketResolutionStatus;
  resolutionNote: string;
  updatedAt?: string;
}

export interface ReviewDayWish {
  id: string;
  weekId: string;
  day: DayOfWeek;
  className: string | null; // null = gilt für alle Klassen der Lehrkraft
  wishType: DayWishType;
  note: string;
  resolutionStatus: TicketResolutionStatus;
  resolutionNote: string;
  updatedAt?: string;
}

export interface ReviewSubmission {
  id: string;
  planId: string;
  teacherCode: string;
  overallStatus: 'ok' | 'has_requests';
  generalNote: string;
  createdAt: string;
  updatedAt: string;
  examFeedback: ReviewExamFeedback[];
  dayWishes: ReviewDayWish[];
}

export interface ReviewPlanSnapshot {
  classes: ClassSchedule[];
  weeks: Week[];
  exams: Exam[];
  blockedDays: BlockedDays;
  blockedClassDays: BlockedClassDays;
  selectedSubjects: Record<string, string[]>;
  pdfSettings: PdfSettings;
  solverSettings?: SolverSettings;
}

export interface ReviewPlanData {
  id: string;
  title: string;
  isActive: boolean;
  updatedAt: string;
  snapshot: ReviewPlanSnapshot;
}

export interface AppState {
  classes: ClassSchedule[];
  weeks: Week[];
  exams: Exam[];
  blockedDays: BlockedDays;
  holidayLabels?: HolidayLabels;
  blockedClassDays: BlockedClassDays;
  selectedSubjects: Record<string, string[]>;
  subjectTiming?: Record<string, SubjectTimingPreference>;
  classSubjectTiming?: Record<string, Record<string, SubjectTimingPreference>>;
  pdfSettings: PdfSettings;
  solverSettings?: SolverSettings;
  edupageMeta?: EdupageMeta;
  reviewSync?: ReviewSyncMeta;
}

