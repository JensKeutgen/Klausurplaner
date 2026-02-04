export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export const DAYS_OF_WEEK: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export interface ClassSchedule {
  className: string;
  subjects: {
    [key in DayOfWeek]: string[]; // Array of subjects for that day
  };
}

export interface Exam {
  id: string;
  className: string;
  subject: string;
  durationMinutes: number; // Default 90?
  isPinned: boolean;
  assignedWeekId: string | null;
  assignedDay: DayOfWeek | null;
}

export interface Week {
  id: string;
  weekNumber: number;
  year: number;
  isBlocked: boolean; // Entire week blocked
}

// Map of WeekId -> Day -> boolean (true if blocked globally)
export type BlockedDays = Record<string, Record<DayOfWeek, boolean>>;

// Map of ClassName -> WeekId -> Day -> boolean (true if blocked for that class)
export type BlockedClassDays = Record<string, Record<string, Record<DayOfWeek, boolean>>>;

export interface AppState {
  classes: ClassSchedule[];
  weeks: Week[];
  exams: Exam[];
  blockedDays: BlockedDays;
  blockedClassDays: BlockedClassDays;
}
