import type { Week } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function getWeeksBetween(start: Date, end: Date): Week[] {
    const weeks: Week[] = [];
    const current = new Date(start);

    // Align to start of week (Monday)
    const day = current.getDay() || 7;
    if (day !== 1) current.setHours(-24 * (day - 1));

    const distinctWeeks = new Set<string>();

    while (current <= end) {
        const weekNum = getISOWeek(current);

        // Better ISO year logic:
        const d = new Date(current);
        d.setDate(d.getDate() + 3);
        const isoYear = d.getFullYear();

        const key = `${isoYear}-${weekNum}`;

        if (!distinctWeeks.has(key)) {
            distinctWeeks.add(key);
            weeks.push({
                id: uuidv4(),
                weekNumber: weekNum,
                year: isoYear,
                isBlocked: false,
                weekType: 'A'
            });
        }

        // Advance 1 week
        current.setDate(current.getDate() + 7);
    }

    return weeks;
}

export function isSameDay(d1: Date, d2: Date) {
    return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
}

export function isDateInRange(date: Date, start: Date | null, end: Date | null) {
    if (!start) return false;
    if (end) return date >= start && date <= end;
    return isSameDay(date, start);
}
