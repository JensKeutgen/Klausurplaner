export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export const DAYS_OF_WEEK: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export type SubjectTimingPreference = 'normal' | 'early' | 'late';

export interface ClassSchedule {
  className: string;
  gradeLevel?: string; // Stufe (e.g. "11", "BG25", "ITA24") - auto-inferred if omitted
  subjects: {
    [key in DayOfWeek]: string[]; // Array of subjects for that day (Week A default)
  };
  subjectsB?: {
    [key in DayOfWeek]: string[]; // Array of subjects for Week B
  };
  // Optional teacher labels per day -> subject (populated by EduPage import)
  subjectTeachers?: Partial<Record<DayOfWeek, Record<string, string[]>>>;
  subjectTeachersB?: Partial<Record<DayOfWeek, Record<string, string[]>>>;
  // Optional selected exam teacher per subject when multiple teachers teach the same subject
  examTeacherBySubject?: Record<string, string>;
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
  weekType: 'A' | 'B'; // A/B Week toggle
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
  weekAReferenceDate?: string;
  weekBReferenceDate?: string;
  weekAParity?: 'odd' | 'even';
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
}
