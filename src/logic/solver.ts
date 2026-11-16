import { v4 as uuidv4 } from 'uuid';
import {
    type ClassSchedule,
    type DayOfWeek,
    DAYS_OF_WEEK,
    DEFAULT_SOLVER_SETTINGS,
    type Exam,
    type SolverSettings,
    type Week,
} from '../types';

export const MAX_EXAMS_PER_WEEK = 2;

const DAY_TO_INDEX: Record<DayOfWeek, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
};

/**
 * Infers the grade level ("Stufe") from a class name, e.g.:
 * "10A" -> "10", "11b" -> "11", "BG25a" -> "BG25", "ITA24-1" -> "ITA24", "Q1b" -> "Q1"
 */
export function inferGradeLevel(className: string): string {
    const trimmed = className.trim();
    if (!trimmed) return '';

    // Pure numeric grade prefix: e.g. "10A", "11-2", "12_b"
    const numericMatch = trimmed.match(/^(\d{1,2})([A-Za-z_-].*)?$/);
    if (numericMatch) {
        return numericMatch[1];
    }

    // Prefix + cohort digits + trailing class identifier: e.g. "BG25a", "ITA24-1", "HH23_2", "Q1a"
    const cohortMatch = trimmed.match(/^([A-Za-zÄÖÜäöüß]+\s*\d{1,4})(?:[-_ /.]*[A-Za-z0-9]+)?$/);
    if (cohortMatch) {
        // Only strip trailing suffix if there actually is a trailing letter or separator+suffix
        const stripped = trimmed.replace(/(?:[-_ /.]+[A-Za-z0-9]+|[A-Za-z])$/, '');
        if (stripped && stripped.length >= 2) {
            return stripped;
        }
    }

    return trimmed;
}

export function getEffectiveGradeLevel(schedule: ClassSchedule | undefined, className: string): string {
    if (schedule?.gradeLevel && schedule.gradeLevel.trim().length > 0) {
        return schedule.gradeLevel.trim();
    }
    return inferGradeLevel(className);
}

// Helper: Check if a subject is taught on a specific day
export function isSubjectTaughtOnDay(
    schedule: ClassSchedule,
    subject: string,
    day: DayOfWeek,
    weekType: 'A' | 'B' = 'A'
): boolean {
    const subjectsOnDay =
        weekType === 'B' && schedule.subjectsB
            ? schedule.subjectsB[day] || []
            : schedule.subjects[day] || [];

    return subjectsOnDay.includes(subject);
}

// Count how many periods a subject has on a given day (detects double lessons)
export function getSubjectPeriodCount(
    schedule: ClassSchedule,
    subject: string,
    day: DayOfWeek,
    weekType: 'A' | 'B' = 'A'
): number {
    const subjectsOnDay =
        weekType === 'B' && schedule.subjectsB
            ? schedule.subjectsB[day] || []
            : schedule.subjects[day] || [];

    return subjectsOnDay.filter((s) => s === subject).length;
}

// Extract teacher initials for a subject on a day
export function getTeachersForSubjectOnDay(
    schedule: ClassSchedule | undefined,
    subject: string,
    day: DayOfWeek,
    weekType: 'A' | 'B' = 'A'
): string[] {
    if (!schedule) return [];
    const map = weekType === 'B' && schedule.subjectTeachersB
        ? schedule.subjectTeachersB
        : schedule.subjectTeachers;
    return map?.[day]?.[subject] || [];
}

// Helper: Count exams for a class in a given week
export function countExamsInWeek(exams: Exam[], className: string, weekId: string): number {
    return exams.filter((e) => e.className === className && e.assignedWeekId === weekId).length;
}

export interface MoveValidationResult {
    valid: boolean;
    reason?: string;
    warning?: string;
}

export function validateMove(
    exam: Exam,
    targetWeekId: string,
    targetDay: DayOfWeek,
    allExams: Exam[],
    classSchedule: ClassSchedule,
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>> = {},
    settings: SolverSettings = DEFAULT_SOLVER_SETTINGS,
    allClasses: ClassSchedule[] = []
): MoveValidationResult {
    const maxPerWeek = settings.maxExamsPerWeek || MAX_EXAMS_PER_WEEK;

    // 1. Check if blocked
    const targetWeek = weeks.find((w) => w.id === targetWeekId);
    if (!targetWeek) {
        return { valid: false, reason: 'Zielwoche nicht gefunden.' };
    }
    if (targetWeek.isBlocked) {
        return { valid: false, reason: `KW ${targetWeek.weekNumber} ist komplett blockiert.` };
    }
    if (blockedDays[targetWeekId]?.[targetDay]) {
        return { valid: false, reason: 'Tag ist global blockiert (z. B. Feiertag/Konferenz).' };
    }
    if (blockedClassDays[exam.className]?.[targetWeekId]?.[targetDay]) {
        return { valid: false, reason: `Tag ist für ${exam.className} blockiert.` };
    }

    // 2. Check if subject is taught on that day
    if (!isSubjectTaughtOnDay(classSchedule, exam.subject, targetDay, targetWeek.weekType)) {
        return {
            valid: false,
            reason: `${exam.subject} wird am ${targetDay === 'Monday' ? 'Montag' : targetDay === 'Tuesday' ? 'Dienstag' : targetDay === 'Wednesday' ? 'Mittwoch' : targetDay === 'Thursday' ? 'Donnerstag' : 'Freitag'} in Woche ${targetWeek.weekType} nicht unterrichtet.`,
        };
    }

    // 3. Check max exams per week (exclude self)
    const otherExamsInWeek = allExams.filter(
        (e) => e.id !== exam.id && e.className === exam.className && e.assignedWeekId === targetWeekId
    );

    if (otherExamsInWeek.length >= maxPerWeek) {
        return {
            valid: false,
            reason: `Maximal ${maxPerWeek} Klausuren pro Woche für ${exam.className} erreicht.`,
        };
    }

    // 4. Check max 1 exam per day per class
    const examOnSameDay = otherExamsInWeek.find((e) => e.assignedDay === targetDay);
    if (examOnSameDay) {
        return {
            valid: false,
            reason: `Am selben Tag liegt bereits ${examOnSameDay.subject} in ${exam.className}.`,
        };
    }

    // 5. Soft warnings: Teacher collision or consecutive days
    const warnings: string[] = [];

    if (settings.avoidTeacherCollisions && allClasses.length > 0) {
        const myTeachers = getTeachersForSubjectOnDay(
            classSchedule,
            exam.subject,
            targetDay,
            targetWeek.weekType
        );
        if (myTeachers.length > 0) {
            const sameDayOtherExams = allExams.filter(
                (e) =>
                    e.id !== exam.id &&
                    e.className !== exam.className &&
                    e.assignedWeekId === targetWeekId &&
                    e.assignedDay === targetDay
            );
            for (const other of sameDayOtherExams) {
                const otherCls = allClasses.find((c) => c.className === other.className);
                const otherTeachers = getTeachersForSubjectOnDay(
                    otherCls,
                    other.subject,
                    targetDay,
                    targetWeek.weekType
                );
                const overlap = myTeachers.filter((t) => otherTeachers.includes(t));
                if (overlap.length > 0) {
                    warnings.push(
                        `Lehrkraft-Überschneidung (${overlap.join(', ')}) mit ${other.className} (${other.subject})`
                    );
                }
            }
        }
    }

    if (settings.avoidConsecutiveDays) {
        const targetWeekIdx = weeks.findIndex((w) => w.id === targetWeekId);
        const targetAbsDay = targetWeekIdx * 5 + DAY_TO_INDEX[targetDay];
        for (const other of allExams) {
            if (other.id === exam.id || other.className !== exam.className || !other.assignedWeekId || !other.assignedDay) {
                continue;
            }
            const otherWeekIdx = weeks.findIndex((w) => w.id === other.assignedWeekId);
            if (otherWeekIdx < 0) continue;
            const otherAbsDay = otherWeekIdx * 5 + DAY_TO_INDEX[other.assignedDay];
            if (Math.abs(targetAbsDay - otherAbsDay) === 1) {
                warnings.push(`Direkter Nachbartag zu ${other.subject}`);
                break;
            }
        }
    }

    return {
        valid: true,
        warning: warnings.length > 0 ? warnings.join(' • ') : undefined,
    };
}

interface CandidateSlot {
    weekIndex: number;
    weekId: string;
    dayIndex: number;
    day: DayOfWeek;
    weekType: 'A' | 'B';
    periodCount: number;
    teachers: string[];
}

export interface ScheduleEvaluation {
    totalExams: number;
    assignedExams: number;
    unassignedExams: number;
    sameWeekGroupTotal: number;
    sameWeekGroupAligned: number;
    sameWeekGroupRate: number;
    consecutiveDayPairs: number;
    teacherConflicts: number;
    constraintViolations: number;
    score: number;
}

export function evaluateSchedule(
    exams: Exam[],
    classes: ClassSchedule[],
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>> = {},
    settings: SolverSettings = DEFAULT_SOLVER_SETTINGS
): ScheduleEvaluation {
    const classMap = new Map(classes.map((c) => [c.className, c]));
    const weekIdxMap = new Map(weeks.map((w, idx) => [w.id, idx]));

    let assignedExams = 0;
    let constraintViolations = 0;
    let consecutiveDayPairs = 0;
    let teacherConflicts = 0;
    let score = 0;

    // Group by class to check spacing & weekly load
    const byClass = new Map<string, Exam[]>();
    // Group by (gradeLevel, subject) to check same-week grouping
    const byGradeSubject = new Map<string, Exam[]>();
    // Group by (weekId, day) for teacher collisions
    const bySlot = new Map<string, Exam[]>();

    for (const exam of exams) {
        const cls = classMap.get(exam.className);
        if (exam.assignedWeekId && exam.assignedDay && cls) {
            assignedExams++;
            score += 10000;

            const check = validateMove(
                exam,
                exam.assignedWeekId,
                exam.assignedDay,
                exams,
                cls,
                weeks,
                blockedDays,
                blockedClassDays,
                settings,
                classes
            );
            if (!check.valid) {
                constraintViolations++;
                score -= 5000;
            }

            const weekIdx = weekIdxMap.get(exam.assignedWeekId);
            if (weekIdx !== undefined) {
                const week = weeks[weekIdx];
                const pCount = getSubjectPeriodCount(cls, exam.subject, exam.assignedDay, week.weekType);
                if (pCount >= 2) {
                    score += 15;
                }
            }

            const list = byClass.get(exam.className) || [];
            list.push(exam);
            byClass.set(exam.className, list);

            const grade = getEffectiveGradeLevel(cls, exam.className);
            const gsKey = `${grade}::${exam.subject}`;
            const gsList = byGradeSubject.get(gsKey) || [];
            gsList.push(exam);
            byGradeSubject.set(gsKey, gsList);

            const slotKey = `${exam.assignedWeekId}::${exam.assignedDay}`;
            const slotList = bySlot.get(slotKey) || [];
            slotList.push(exam);
            bySlot.set(slotKey, slotList);
        } else {
            // Track unassigned in grade-subject group total too
            const grade = getEffectiveGradeLevel(cls, exam.className);
            const gsKey = `${grade}::${exam.subject}`;
            const gsList = byGradeSubject.get(gsKey) || [];
            gsList.push(exam);
            byGradeSubject.set(gsKey, gsList);
        }
    }

    // 1. Class spacing & weekly load balance
    for (const classExams of byClass.values()) {
        const absDays: number[] = [];
        const weekCounts = new Map<string, number>();

        for (const e of classExams) {
            if (!e.assignedWeekId || !e.assignedDay) continue;
            const wIdx = weekIdxMap.get(e.assignedWeekId);
            if (wIdx !== undefined) {
                absDays.push(wIdx * 5 + DAY_TO_INDEX[e.assignedDay]);
            }
            weekCounts.set(e.assignedWeekId, (weekCounts.get(e.assignedWeekId) || 0) + 1);
        }

        absDays.sort((a, b) => a - b);
        for (let i = 1; i < absDays.length; i++) {
            const diff = absDays[i] - absDays[i - 1];
            if (diff === 1) {
                consecutiveDayPairs++;
                if (settings.avoidConsecutiveDays) {
                    score -= 90;
                }
            } else if (diff === 2) {
                if (settings.avoidConsecutiveDays) {
                    score -= 10;
                }
            } else if (diff >= 3 && diff <= 4) {
                // Good spacing within the same week
                score += 20;
            }
        }

        for (const count of weekCounts.values()) {
            if (count > 1) {
                score -= 25 * count * (count - 1);
            }
        }
    }

    // 2. Same (gradeLevel, subject) in the same week (NO same-day coupling!)
    let sameWeekGroupTotal = 0;
    let sameWeekGroupAligned = 0;
    for (const groupExams of byGradeSubject.values()) {
        if (groupExams.length < 2) continue;
        sameWeekGroupTotal++;

        const assignedInGroup = groupExams.filter((e) => e.assignedWeekId);
        if (assignedInGroup.length < 2) continue;

        const weekCounts = new Map<string, number>();
        for (const e of assignedInGroup) {
            if (e.assignedWeekId) {
                weekCounts.set(e.assignedWeekId, (weekCounts.get(e.assignedWeekId) || 0) + 1);
            }
        }

        let maxInOneWeek = 0;
        for (const count of weekCounts.values()) {
            if (count > maxInOneWeek) maxInOneWeek = count;
            if (count >= 2 && settings.preferSameGradeSubjectSameWeek) {
                score += 150 * (count - 1);
            }
        }

        if (maxInOneWeek === groupExams.length) {
            sameWeekGroupAligned++;
            if (settings.preferSameGradeSubjectSameWeek) {
                score += 60;
            }
        }
    }

    // 3. Teacher collisions on the same day
    for (const [slotKey, slotExams] of bySlot.entries()) {
        if (slotExams.length < 2) continue;
        const [weekId, dayStr] = slotKey.split('::');
        const day = dayStr as DayOfWeek;
        const wIdx = weekIdxMap.get(weekId);
        const weekType = wIdx !== undefined ? weeks[wIdx].weekType : 'A';

        const teacherUsage = new Map<string, number>();
        for (const e of slotExams) {
            const cls = classMap.get(e.className);
            const teachers = getTeachersForSubjectOnDay(cls, e.subject, day, weekType);
            for (const t of new Set(teachers)) {
                teacherUsage.set(t, (teacherUsage.get(t) || 0) + 1);
            }
        }

        for (const count of teacherUsage.values()) {
            if (count >= 2) {
                teacherConflicts += count - 1;
                if (settings.avoidTeacherCollisions) {
                    score -= 260 * (count - 1);
                }
            }
        }
    }

    const sameWeekGroupRate =
        sameWeekGroupTotal > 0 ? Math.round((sameWeekGroupAligned / sameWeekGroupTotal) * 100) : 100;

    return {
        totalExams: exams.length,
        assignedExams,
        unassignedExams: exams.length - assignedExams,
        sameWeekGroupTotal,
        sameWeekGroupAligned,
        sameWeekGroupRate,
        consecutiveDayPairs,
        teacherConflicts,
        constraintViolations,
        score,
    };
}

function buildCandidatesForExam(
    exam: Exam,
    cls: ClassSchedule,
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>>
): CandidateSlot[] {
    const candidates: CandidateSlot[] = [];

    weeks.forEach((week, weekIndex) => {
        if (week.isBlocked) return;
        DAYS_OF_WEEK.forEach((day, dayIndex) => {
            if (blockedDays[week.id]?.[day]) return;
            if (blockedClassDays[exam.className]?.[week.id]?.[day]) return;
            if (!isSubjectTaughtOnDay(cls, exam.subject, day, week.weekType)) return;

            const periodCount = getSubjectPeriodCount(cls, exam.subject, day, week.weekType);
            const teachers = getTeachersForSubjectOnDay(cls, exam.subject, day, week.weekType);

            candidates.push({
                weekIndex,
                weekId: week.id,
                dayIndex,
                day,
                weekType: week.weekType,
                periodCount,
                teachers,
            });
        });
    });

    return candidates;
}

function canPlaceHard(
    exam: Exam,
    slot: CandidateSlot,
    placedExams: Exam[],
    maxPerWeek: number
): boolean {
    let countInWeek = 0;
    for (const other of placedExams) {
        if (other.id === exam.id || other.className !== exam.className) continue;
        if (other.assignedWeekId === slot.weekId) {
            if (other.assignedDay === slot.day) return false;
            countInWeek++;
            if (countInWeek >= maxPerWeek) return false;
        }
    }
    return true;
}

function scoreCandidateSlot(
    exam: Exam,
    slot: CandidateSlot,
    placedExams: Exam[],
    classMap: Map<string, ClassSchedule>,
    weekIdxMap: Map<string, number>,
    settings: SolverSettings
): number {
    let s = 0;
    const examCls = classMap.get(exam.className);
    const examGrade = getEffectiveGradeLevel(examCls, exam.className);
    const absDay = slot.weekIndex * 5 + slot.dayIndex;

    // 1. Prefer same week for same (Stufe, Fach) WITHOUT forcing same day
    if (settings.preferSameGradeSubjectSameWeek) {
        for (const other of placedExams) {
            if (other.id === exam.id || !other.assignedWeekId) continue;
            if (other.subject !== exam.subject) continue;
            const otherCls = classMap.get(other.className);
            const otherGrade = getEffectiveGradeLevel(otherCls, other.className);
            if (otherGrade === examGrade && other.assignedWeekId === slot.weekId) {
                s += 160;
                // Slight preference to NOT pile everything onto the exact same day if another day in that week is free (also avoids teacher clash)
                if (other.assignedDay === slot.day) {
                    s -= 5;
                }
            }
        }
    }

    // 2. Class spacing & weekly balance
    let weekCount = 0;
    for (const other of placedExams) {
        if (other.id === exam.id || other.className !== exam.className || !other.assignedWeekId || !other.assignedDay) {
            continue;
        }
        if (other.assignedWeekId === slot.weekId) {
            weekCount++;
        }
        const otherWIdx = weekIdxMap.get(other.assignedWeekId);
        if (otherWIdx !== undefined) {
            const otherAbsDay = otherWIdx * 5 + DAY_TO_INDEX[other.assignedDay];
            const diff = Math.abs(absDay - otherAbsDay);
            if (settings.avoidConsecutiveDays) {
                if (diff === 1) s -= 95;
                else if (diff === 2) s -= 12;
                else if (diff >= 3 && diff <= 4) s += 20;
            }
        }
    }
    s -= weekCount * 35;

    // 3. Teacher collision avoidance
    if (settings.avoidTeacherCollisions && slot.teachers.length > 0) {
        for (const other of placedExams) {
            if (
                other.id === exam.id ||
                other.className === exam.className ||
                other.assignedWeekId !== slot.weekId ||
                other.assignedDay !== slot.day
            ) {
                continue;
            }
            const otherCls = classMap.get(other.className);
            const otherTeachers = getTeachersForSubjectOnDay(otherCls, other.subject, slot.day, slot.weekType);
            if (slot.teachers.some((t) => otherTeachers.includes(t))) {
                s -= 260;
            }
        }
    }

    // 4. Double-lesson bonus
    if (slot.periodCount >= 2) {
        s += 15;
    }

    return s;
}

function runSingleSolverPass(
    fixedExams: Exam[],
    variableTemplates: Exam[],
    candidatesById: Map<string, CandidateSlot[]>,
    groupSizeById: Map<string, number>,
    classes: ClassSchedule[],
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>>,
    settings: SolverSettings,
    randomizeTieBreak: boolean
): { exams: Exam[]; evaluation: ScheduleEvaluation } {
    const classMap = new Map(classes.map((c) => [c.className, c]));
    const weekIdxMap = new Map(weeks.map((w, idx) => [w.id, idx]));
    const maxPerWeek = settings.maxExamsPerWeek || MAX_EXAMS_PER_WEEK;

    const fixedClone = fixedExams.map((e) => ({ ...e }));
    const varExams = variableTemplates.map((e) => ({
        ...e,
        assignedWeekId: null as string | null,
        assignedDay: null as DayOfWeek | null,
    }));

    // MRV ordering: fewest candidates first, then larger (Stufe, Fach) groups first
    const orderedVars = [...varExams].sort((a, b) => {
        const candA = candidatesById.get(a.id)?.length || 0;
        const candB = candidatesById.get(b.id)?.length || 0;
        if (candA !== candB) return candA - candB;

        const grpA = groupSizeById.get(a.id) || 1;
        const grpB = groupSizeById.get(b.id) || 1;
        if (grpA !== grpB) return grpB - grpA;

        return randomizeTieBreak ? Math.random() - 0.5 : a.className.localeCompare(b.className);
    });

    const allWorking: Exam[] = [...fixedClone];

    // Phase 1: Guided Greedy Placement with 1-step ejection fallback
    for (const exam of orderedVars) {
        const candidates = candidatesById.get(exam.id) || [];
        const validSlots = candidates.filter((slot) => canPlaceHard(exam, slot, allWorking, maxPerWeek));

        if (validSlots.length > 0) {
            const scored = validSlots.map((slot) => ({
                slot,
                score:
                    scoreCandidateSlot(exam, slot, allWorking, classMap, weekIdxMap, settings) +
                    (randomizeTieBreak ? (Math.random() - 0.5) * 28 : 0),
            }));
            scored.sort((a, b) => b.score - a.score);
            const chosen = scored[0].slot;
            exam.assignedWeekId = chosen.weekId;
            exam.assignedDay = chosen.day;
            allWorking.push(exam);
        } else {
            // Try 1-step ejection: move a conflicting unpinned exam in the same class to another free slot
            let ejectedPlaced = false;
            const sameClassVars = allWorking.filter(
                (other) => !other.isPinned && other.className === exam.className && other.assignedWeekId
            );

            for (const targetSlot of candidates) {
                // Find blocking exams in same class for targetSlot
                const blockers = sameClassVars.filter(
                    (other) =>
                        other.assignedWeekId === targetSlot.weekId &&
                        (other.assignedDay === targetSlot.day ||
                            sameClassVars.filter((x) => x.assignedWeekId === targetSlot.weekId).length >= maxPerWeek)
                );
                if (blockers.length === 0) continue;

                for (const blocker of blockers) {
                    const prevW = blocker.assignedWeekId;
                    const prevD = blocker.assignedDay;
                    const blockerCandidates = candidatesById.get(blocker.id) || [];
                    const altSlots = blockerCandidates.filter(
                        (s) =>
                            (s.weekId !== prevW || s.day !== prevD) &&
                            s.weekId !== targetSlot.weekId &&
                            canPlaceHard(blocker, s, allWorking, maxPerWeek)
                    );
                    if (altSlots.length > 0) {
                        const alt = altSlots[0];
                        blocker.assignedWeekId = alt.weekId;
                        blocker.assignedDay = alt.day;
                        if (canPlaceHard(exam, targetSlot, allWorking, maxPerWeek)) {
                            exam.assignedWeekId = targetSlot.weekId;
                            exam.assignedDay = targetSlot.day;
                            allWorking.push(exam);
                            ejectedPlaced = true;
                            break;
                        } else {
                            blocker.assignedWeekId = prevW;
                            blocker.assignedDay = prevD;
                        }
                    }
                }
                if (ejectedPlaced) break;
            }

            if (!ejectedPlaced) {
                allWorking.push(exam);
            }
        }
    }

    // Phase 2: Local Search Refinement (Relocate + Swap within class)
    let currentEval = evaluateSchedule(
        allWorking,
        classes,
        weeks,
        blockedDays,
        blockedClassDays,
        settings
    );

    const maxRefinePasses = 3;
    for (let pass = 0; pass < maxRefinePasses; pass++) {
        let improved = false;

        // 2a. Relocate single variable exam to a strictly better slot
        for (const exam of orderedVars) {
            const candidates = candidatesById.get(exam.id) || [];
            const origW = exam.assignedWeekId;
            const origD = exam.assignedDay;

            let bestW = origW;
            let bestD = origD;
            let bestScore = currentEval.score;

            for (const slot of candidates) {
                if (slot.weekId === origW && slot.day === origD) continue;
                if (!canPlaceHard(exam, slot, allWorking, maxPerWeek)) continue;

                exam.assignedWeekId = slot.weekId;
                exam.assignedDay = slot.day;

                const nextEval = evaluateSchedule(
                    allWorking,
                    classes,
                    weeks,
                    blockedDays,
                    blockedClassDays,
                    settings
                );

                if (nextEval.score > bestScore) {
                    bestScore = nextEval.score;
                    bestW = slot.weekId;
                    bestD = slot.day;
                    currentEval = nextEval;
                    improved = true;
                }
            }

            exam.assignedWeekId = bestW;
            exam.assignedDay = bestD;
        }

        // 2b. Swap two variable exams of the same class if strictly better
        for (let i = 0; i < orderedVars.length; i++) {
            const a = orderedVars[i];
            if (!a.assignedWeekId || !a.assignedDay) continue;
            const candA = candidatesById.get(a.id) || [];

            for (let j = i + 1; j < orderedVars.length; j++) {
                const b = orderedVars[j];
                if (b.className !== a.className || !b.assignedWeekId || !b.assignedDay) continue;
                if (a.assignedWeekId === b.assignedWeekId && a.assignedDay === b.assignedDay) continue;

                const candB = candidatesById.get(b.id) || [];
                const aCanTakeB = candA.some((s) => s.weekId === b.assignedWeekId && s.day === b.assignedDay);
                const bCanTakeA = candB.some((s) => s.weekId === a.assignedWeekId && s.day === a.assignedDay);
                if (!aCanTakeB || !bCanTakeA) continue;

                const aW: string = a.assignedWeekId;
                const aD: DayOfWeek = a.assignedDay;
                const bW: string = b.assignedWeekId;
                const bD: DayOfWeek = b.assignedDay;

                a.assignedWeekId = bW;
                a.assignedDay = bD;
                b.assignedWeekId = aW;
                b.assignedDay = aD;

                const nextEval = evaluateSchedule(
                    allWorking,
                    classes,
                    weeks,
                    blockedDays,
                    blockedClassDays,
                    settings
                );

                if (nextEval.score > currentEval.score) {
                    currentEval = nextEval;
                    improved = true;
                } else {
                    a.assignedWeekId = aW;
                    a.assignedDay = aD;
                    b.assignedWeekId = bW;
                    b.assignedDay = bD;
                }
            }
        }

        if (!improved) break;
    }

    return { exams: allWorking, evaluation: currentEval };
}

function solveExams(
    fixedExams: Exam[],
    variableExams: Exam[],
    classes: ClassSchedule[],
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>>,
    settings: SolverSettings
): Exam[] {
    const classMap = new Map(classes.map((c) => [c.className, c]));
    const candidatesById = new Map<string, CandidateSlot[]>();

    // Compute group sizes for (gradeLevel, subject)
    const allExams = [...fixedExams, ...variableExams];
    const groupCounts = new Map<string, number>();
    for (const e of allExams) {
        const cls = classMap.get(e.className);
        const grade = getEffectiveGradeLevel(cls, e.className);
        const key = `${grade}::${e.subject}`;
        groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
    }

    const groupSizeById = new Map<string, number>();
    for (const e of variableExams) {
        const cls = classMap.get(e.className);
        if (cls) {
            candidatesById.set(
                e.id,
                buildCandidatesForExam(e, cls, weeks, blockedDays, blockedClassDays)
            );
        } else {
            candidatesById.set(e.id, []);
        }
        const grade = getEffectiveGradeLevel(cls, e.className);
        groupSizeById.set(e.id, groupCounts.get(`${grade}::${e.subject}`) || 1);
    }

    const numRestarts = variableExams.length > 0 ? 45 : 1;
    let bestResult: { exams: Exam[]; evaluation: ScheduleEvaluation } | null = null;

    for (let i = 0; i < numRestarts; i++) {
        const res = runSingleSolverPass(
            fixedExams,
            variableExams,
            candidatesById,
            groupSizeById,
            classes,
            weeks,
            blockedDays,
            blockedClassDays,
            settings,
            i > 0
        );

        if (!bestResult || res.evaluation.score > bestResult.evaluation.score) {
            bestResult = res;
        }
    }

    return bestResult ? bestResult.exams : [...fixedExams, ...variableExams];
}

// Smart Initial Distribution (keeps pinned exams if configured)
export function distributeExams(
    classes: ClassSchedule[],
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    selectedSubjects: Record<string, string[]>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>> = {},
    existingExams: Exam[] = [],
    settings: SolverSettings = DEFAULT_SOLVER_SETTINGS
): Exam[] {
    const fixedExams: Exam[] = [];
    const variableExams: Exam[] = [];

    const existingMap = new Map<string, Exam>();
    for (const e of existingExams) {
        existingMap.set(`${e.className}::${e.subject}`, e);
    }

    for (const cls of classes) {
        const allowedSubjects = selectedSubjects[cls.className] || [];
        const subjectsA = Object.values(cls.subjects).flat();
        const subjectsB = cls.subjectsB ? Object.values(cls.subjectsB).flat() : [];

        const uniqueSubjects = Array.from(new Set([...subjectsA, ...subjectsB])).filter((s) =>
            allowedSubjects.includes(s)
        );

        for (const subject of uniqueSubjects) {
            const prev = existingMap.get(`${cls.className}::${subject}`);
            if (settings.keepPinnedOnDistribute && prev && prev.isPinned && prev.assignedWeekId && prev.assignedDay) {
                fixedExams.push({ ...prev });
            } else {
                variableExams.push({
                    id: prev ? prev.id : uuidv4(),
                    className: cls.className,
                    subject,
                    durationMinutes: prev ? prev.durationMinutes : 90,
                    isPinned: false,
                    assignedWeekId: null,
                    assignedDay: null,
                });
            }
        }
    }

    return solveExams(fixedExams, variableExams, classes, weeks, blockedDays, blockedClassDays, settings);
}

// Re-optimizes unpinned exams around pinned constraints
export function autoFix(
    exams: Exam[],
    classes: ClassSchedule[],
    weeks: Week[],
    blockedDays: Record<string, Record<DayOfWeek, boolean>>,
    blockedClassDays: Record<string, Record<string, Record<DayOfWeek, boolean>>> = {},
    settings: SolverSettings = DEFAULT_SOLVER_SETTINGS
): Exam[] {
    const pinnedExams = exams.filter((e) => e.isPinned && e.assignedWeekId && e.assignedDay);
    const unpinned = exams.filter((e) => !(e.isPinned && e.assignedWeekId && e.assignedDay));

    return solveExams(pinnedExams, unpinned, classes, weeks, blockedDays, blockedClassDays, settings);
}
