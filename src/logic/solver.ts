import { v4 as uuidv4 } from 'uuid';
import { type ClassSchedule, type DayOfWeek, DAYS_OF_WEEK, type Exam, type Week } from '../types';

export const MAX_EXAMS_PER_WEEK = 2;

// Helper: Check if a subject is taught on a specific day
export function isSubjectTaughtOnDay(schedule: ClassSchedule, subject: string, day: DayOfWeek): boolean {
    const subjectsOnDay = schedule.subjects[day] || [];
    // Loose matching to handle potential minor naming diffs if needed, or strict. 
    // Going with strict includes check for now as LLM should be consistent.
    return subjectsOnDay.includes(subject);
}

// Helper: Count exams for a class in a given week
export function countExamsInWeek(exams: Exam[], className: string, weekId: string): number {
    return exams.filter(e => e.className === className && e.assignedWeekId === weekId).length;
}

export function validateMove(
    exam: Exam,
    targetWeekId: string,
    targetDay: DayOfWeek,
    allExams: Exam[],
    classSchedule: ClassSchedule,
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>> = {}
): { valid: boolean; reason?: string } {

    // 1. Check if blocked
    // 1. Check if blocked
    if (blockedDays[targetWeekId]?.[targetDay]) {
        return { valid: false, reason: 'Day is blocked by user (Global).' };
    }
    if (blockedClassDays[exam.className]?.[targetWeekId]?.[targetDay]) {
        return { valid: false, reason: 'Day is blocked for this class.' };
    }

    // 2. Check if subject is taught on that day
    if (!isSubjectTaughtOnDay(classSchedule, exam.subject, targetDay)) {
        return { valid: false, reason: `${exam.subject} is not taught on ${targetDay}.` };
    }

    // 3. Check max exams per week
    // Exclude self if already in that week
    const otherExamsInWeek = allExams.filter(
        e => e.id !== exam.id && e.className === exam.className && e.assignedWeekId === targetWeekId
    );

    if (otherExamsInWeek.length >= MAX_EXAMS_PER_WEEK) {
        return { valid: false, reason: `Max ${MAX_EXAMS_PER_WEEK} exams reached for this week.` };
    }

    // 4. Check if another exam for same class is on the same day? (Optional rule, usually max 1 per day)
    const examOnSameDay = otherExamsInWeek.find(e => e.assignedDay === targetDay);
    if (examOnSameDay) {
        return { valid: false, reason: 'Another exam is already scheduled for this day.' };
    }

    return { valid: true };
}

// Initial Greedy Distribution
export function distributeExams(
    classes: ClassSchedule[],
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    selectedSubjects: Record<string, string[]>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>> = {}
): Exam[] {
    const exams: Exam[] = [];

    // Create Exam objects for every subject for every class
    // Note: This assumes 1 exam per subject per semester/period.
    // In reality, we might need a list of which subjects need exams.
    // For now, let's assume ALL subjects in the schedule need 1 exam. 
    // OR we add a filtering step later. PROPOSAL: Just create them all, user can delete.

    // Actually, to make it smarter, we will iterate and try to place them.

    for (const cls of classes) {
        // Collect all unique subjects
        // Filter by selection
        const allowedSubjects = selectedSubjects[cls.className] || [];

        const uniqueSubjects = Array.from(new Set(
            Object.values(cls.subjects).flat()
        )).filter(s => allowedSubjects.includes(s));

        for (const subject of uniqueSubjects) {
            const exam: Exam = {
                id: uuidv4(),
                className: cls.className,
                subject,
                durationMinutes: 90,
                isPinned: false,
                assignedWeekId: null,
                assignedDay: null,
            };

            // Try to place it
            let placed = false;
            for (const week of weeks) {
                if (week.isBlocked) continue;

                // Randomize days order to avoid stacking everything on Mondays
                const shuffledDays = [...DAYS_OF_WEEK].sort(() => Math.random() - 0.5);

                for (const day of shuffledDays) {
                    // Temporarily add to list to check max constraints
                    // const currentExams = [...exams, exam];
                    // But since exam is not fully formed, we pass it explicitly or check manually.
                    // We'll use the validate logic but slightly modified for initial placement (ignoring self since self isn't in list yet)

                    // Check Blocked (Global)
                    if (blockedDays[week.id]?.[day]) continue;

                    // Check Blocked (Class Specific)
                    if (blockedClassDays[cls.className]?.[week.id]?.[day]) continue;

                    // Check Subject Taught
                    if (!isSubjectTaughtOnDay(cls, subject, day)) continue;

                    // Check Max exams
                    const weekExams = exams.filter(e => e.className === cls.className && e.assignedWeekId === week.id);
                    if (weekExams.length >= MAX_EXAMS_PER_WEEK) break; // Try next week if this week is full

                    // Check Same Day
                    if (weekExams.some(e => e.assignedDay === day)) continue;

                    // Place it
                    exam.assignedWeekId = week.id;
                    exam.assignedDay = day;
                    exams.push(exam);
                    placed = true;
                    break;
                }
                if (placed) break;
            }

            if (!placed) {
                // Add to unassigned
                exams.push(exam);
            }
        }
    }

    return exams;
}

export function autoFix(
    exams: Exam[],
    classes: ClassSchedule[],
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>> = {}
): Exam[] {
    // Simple retry logic: clear unpinned exams that have conflicts and try to place them again.
    // Or more aggressive: clear ALL unpinned exams and redistribute.

    // Let's go with: Keep valid pinned exams. Remove invalid or unassigned unpinned exams. Redistribute them.

    const pinnedExams = exams.filter(e => e.isPinned);
    const unpinned = exams.filter(e => !e.isPinned);

    // We actually need to re-verify if pinned exams are still valid? User might have pinned a conflict. 
    // Let's assume pinned means "FORCE".

    // We treat pinned as immutable constraints.

    const newExams = [...pinnedExams];

    // Sort unpinned by "difficulty" (subjects with fewer available days should go first)? 
    // For now simple sort.

    for (const exam of unpinned) {
        const cls = classes.find(c => c.className === exam.className);
        if (!cls) continue;

        // Reset placement
        exam.assignedWeekId = null;
        exam.assignedDay = null;

        let placed = false;
        for (const week of weeks) {
            if (week.isBlocked) continue;

            const shuffledDays = [...DAYS_OF_WEEK].sort(() => Math.random() - 0.5);

            for (const day of shuffledDays) {
                // Check Blocked
                if (blockedDays[week.id]?.[day]) continue;
                if (blockedClassDays[exam.className]?.[week.id]?.[day]) continue;

                // Check Subject Taught
                if (!isSubjectTaughtOnDay(cls, exam.subject, day)) continue;

                // Check Max exams (considering ALREADY placed in newExams)
                const currentWeekExams = newExams.filter(e => e.className === exam.className && e.assignedWeekId === week.id);
                if (currentWeekExams.length >= MAX_EXAMS_PER_WEEK) break;

                // Check Same Day
                if (currentWeekExams.some(e => e.assignedDay === day)) continue;

                // Place
                exam.assignedWeekId = week.id;
                exam.assignedDay = day;
                newExams.push(exam);
                placed = true;
                break;
            }
            if (placed) break;
        }

        if (!placed) {
            newExams.push(exam); // Add as unassigned
        }
    }

    return newExams;
}
