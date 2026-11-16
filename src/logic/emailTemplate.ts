import type { AppState, ClassSchedule, DayOfWeek } from '../types';
import { formatShortDate, getWeekDayDate } from './dateUtils';
import { getAllTeachersForSubject, getEffectiveExamTeachers } from './solver';

export const DEFAULT_EMAIL_DOMAIN = 'bk-tm.de';

const GERMAN_CHAR_MAP: Record<string, string> = {
    ä: 'ae',
    ö: 'oe',
    ü: 'ue',
    ß: 'ss',
    Ä: 'ae',
    Ö: 'oe',
    Ü: 'ue',
    ẞ: 'ss',
};

const GERMAN_DAY_SHORT: Record<DayOfWeek, string> = {
    Monday: 'Mo',
    Tuesday: 'Di',
    Wednesday: 'Mi',
    Thursday: 'Do',
    Friday: 'Fr',
};

/**
 * Converts a teacher name like "Frank Wächter" into "waechter@bk-tm.de".
 * Handles umlauts (ä->ae, ö->oe, ü->ue, ß->ss), titles ("Dr."), and "Nachname, Vorname".
 */
export function teacherNameToEmail(
    rawName: string,
    domain: string = DEFAULT_EMAIL_DOMAIN
): string {
    const trimmed = rawName.trim();
    if (!trimmed) return '';
    if (trimmed.includes('@')) return trimmed.toLowerCase();

    let lastName = trimmed;
    if (trimmed.includes(',')) {
        lastName = trimmed.split(',')[0].trim();
    } else {
        const cleaned = trimmed
            .replace(/\b(Prof\.|Dr\.|Dipl\.-\w+\.?|OStR|StR|StD|OStD)\b/gi, '')
            .trim();
        const parts = cleaned.split(/\s+/).filter(Boolean);
        lastName = parts.length > 0 ? parts[parts.length - 1] : trimmed;
    }

    const transliterated = lastName
        .replace(/[äöüßÄÖÜẞ]/g, (ch) => GERMAN_CHAR_MAP[ch] || ch)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');

    if (!transliterated) return '';
    return `${transliterated}@${domain}`;
}

export interface EmailRecipient {
    teacherName: string;
    email: string;
}

export interface ExamEmailEntry {
    className: string;
    subject: string;
    weekId: string;
    weekNumber: number;
    dateStr: string;
    dayShort: string;
    sortTimestamp: number;
    teachers: string[];
}

export type EmailGroupingMode = 'class' | 'date' | 'teacher';

export interface GeneratedEmailDraft {
    recipients: EmailRecipient[];
    recipientListSemicolon: string;
    recipientListComma: string;
    subjectLine: string;
    body: string;
    assignedEntries: ExamEmailEntry[];
}

function getExamTeachers(
    cls: ClassSchedule | undefined,
    subject: string,
    day: DayOfWeek | null,
    weekId?: string
): string[] {
    if (!cls) return [];
    if (day) {
        const effective = getEffectiveExamTeachers(cls, subject, day, weekId);
        if (effective.length > 0) return effective;
    }
    const chosen = cls.examTeacherBySubject?.[subject];
    if (chosen) return [chosen];
    return getAllTeachersForSubject(cls, subject);
}

export function collectEmailRecipients(
    state: AppState,
    domain: string = DEFAULT_EMAIL_DOMAIN
): EmailRecipient[] {
    const classMap = new Map(state.classes.map((c) => [c.className, c]));
    const weekMap = new Map(state.weeks.map((w) => [w.id, w]));
    const teacherSet = new Map<string, string>(); // email -> displayName

    const addTeacher = (cls: ClassSchedule | undefined, rawTeacher: string) => {
        const displayName = cls?.teacherNames?.[rawTeacher] || rawTeacher;
        const email = teacherNameToEmail(displayName, domain);
        if (email && !teacherSet.has(email)) {
            teacherSet.set(email, displayName);
        }
    };

    if (state.exams.length > 0) {
        for (const exam of state.exams) {
            const cls = classMap.get(exam.className);
            const week = exam.assignedWeekId ? weekMap.get(exam.assignedWeekId) : undefined;
            const teachers = getExamTeachers(
                cls,
                exam.subject,
                exam.assignedDay,
                week?.id
            );
            for (const t of teachers) {
                addTeacher(cls, t);
            }
        }
    } else {
        for (const cls of state.classes) {
            const subs = state.selectedSubjects[cls.className] || [];
            for (const sub of subs) {
                const teachers = getExamTeachers(cls, sub, null);
                for (const t of teachers) {
                    addTeacher(cls, t);
                }
            }
        }
    }

    return Array.from(teacherSet.entries())
        .map(([email, teacherName]) => ({ teacherName, email }))
        .sort((a, b) => a.email.localeCompare(b.email));
}

export function buildEmailDraft(
    state: AppState,
    options?: {
        domain?: string;
        grouping?: EmailGroupingMode;
        excludedEmails?: Set<string>;
    }
): GeneratedEmailDraft {
    const domain = options?.domain || DEFAULT_EMAIL_DOMAIN;
    const grouping = options?.grouping || 'class';
    const excluded = options?.excludedEmails || new Set<string>();

    const classMap = new Map(state.classes.map((c) => [c.className, c]));
    const weekMap = new Map(state.weeks.map((w) => [w.id, w]));

    const recipients = collectEmailRecipients(state, domain);
    const assignedEntries: ExamEmailEntry[] = [];

    for (const exam of state.exams) {
        const cls = classMap.get(exam.className);
        const week = exam.assignedWeekId ? weekMap.get(exam.assignedWeekId) : undefined;
        const teachers = getExamTeachers(
            cls,
            exam.subject,
            exam.assignedDay,
            week?.id
        ).map((t) => cls?.teacherNames?.[t] || t);

        if (week && exam.assignedDay) {
            const d = getWeekDayDate(week, exam.assignedDay);
            assignedEntries.push({
                className: exam.className,
                subject: exam.subject,
                weekId: week.id,
                weekNumber: week.weekNumber,
                dateStr: formatShortDate(d) + d.getFullYear(),
                dayShort: GERMAN_DAY_SHORT[exam.assignedDay],
                sortTimestamp: d.getTime(),
                teachers,
            });
        }
    }

    const activeEmails = recipients
        .map((r) => r.email)
        .filter((email) => !excluded.has(email));

    const title = state.pdfSettings?.title?.trim() || 'Klausurplanung';
    const subjectLine = `Klausurplan: ${title}`;

    const lines: string[] = [
        'Liebe Kolleginnen und Kollegen,',
        '',
        `anbei die aktuelle Übersicht für die ${title}:`,
        '',
    ];

    if (assignedEntries.length === 0) {
        lines.push('(Noch keine Klausuren im Kalender zugewiesen.)');
    } else if (grouping === 'date') {
        const sorted = [...assignedEntries].sort((a, b) =>
            a.sortTimestamp !== b.sortTimestamp
                ? a.sortTimestamp - b.sortTimestamp
                : a.className.localeCompare(b.className)
        );
        let currentWeek = -1;
        for (const entry of sorted) {
            if (entry.weekNumber !== currentWeek) {
                if (currentWeek !== -1) lines.push('');
                lines.push(`--- KW ${entry.weekNumber} ---`);
                currentWeek = entry.weekNumber;
            }
            const tStr = entry.teachers.length > 0 ? ` (${entry.teachers.join(', ')})` : '';
            lines.push(`• ${entry.dayShort} ${entry.dateStr}: ${entry.className} – ${entry.subject}${tStr}`);
        }
    } else if (grouping === 'teacher') {
        const byTeacher = new Map<string, ExamEmailEntry[]>();
        for (const entry of assignedEntries) {
            const keys = entry.teachers.length > 0 ? entry.teachers : ['Ohne Zuordnung'];
            for (const t of keys) {
                const list = byTeacher.get(t) || [];
                list.push(entry);
                byTeacher.set(t, list);
            }
        }
        for (const t of Array.from(byTeacher.keys()).sort((a, b) => a.localeCompare(b))) {
            lines.push(`${t}:`);
            const list = (byTeacher.get(t) || []).sort((a, b) => a.sortTimestamp - b.sortTimestamp);
            for (const entry of list) {
                lines.push(`  • ${entry.dayShort} ${entry.dateStr} (KW ${entry.weekNumber}): ${entry.className} – ${entry.subject}`);
            }
            lines.push('');
        }
    } else {
        const byClass = new Map<string, ExamEmailEntry[]>();
        for (const entry of assignedEntries) {
            const list = byClass.get(entry.className) || [];
            list.push(entry);
            byClass.set(entry.className, list);
        }
        for (const clsName of Array.from(byClass.keys()).sort((a, b) => a.localeCompare(b))) {
            lines.push(`${clsName}:`);
            const list = (byClass.get(clsName) || []).sort((a, b) => a.sortTimestamp - b.sortTimestamp);
            for (const entry of list) {
                const tStr = entry.teachers.length > 0 ? ` (${entry.teachers.join(', ')})` : '';
                lines.push(`  • ${entry.dayShort} ${entry.dateStr} (KW ${entry.weekNumber}): ${entry.subject}${tStr}`);
            }
            lines.push('');
        }
    }

    if (state.pdfSettings?.gradesDueDate) {
        lines.push(`Noten eintragen bis: ${state.pdfSettings.gradesDueDate}`);
    }
    if (state.pdfSettings?.makeupExamInfo && state.pdfSettings.makeupExamInfo !== '**') {
        lines.push(`Nachschreibetermin: ${state.pdfSettings.makeupExamInfo}`);
    }

    lines.push('', 'Viele Grüße');

    return {
        recipients,
        recipientListSemicolon: activeEmails.join('; '),
        recipientListComma: activeEmails.join(', '),
        subjectLine,
        body: lines.join('\n'),
        assignedEntries,
    };
}
