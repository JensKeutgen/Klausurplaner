import type { DayOfWeek, Week } from '../types';

export function formatWeekId(year: number, weekNumber: number): string {
    return `${year}-KW${String(weekNumber).padStart(2, '0')}`;
}

export function getISOWeekAndYear(date: Date): { weekNumber: number; year: number } {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const isoYear = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const weekNumber = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { weekNumber, year: isoYear };
}

export function getISOWeek(date: Date): number {
    return getISOWeekAndYear(date).weekNumber;
}

/**
 * Returns a local Date representing Monday of the given ISO week & year.
 */
export function getDateOfIsoWeek(weekNumber: number, year: number): Date {
    // Jan 4 is always in ISO week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7; // 1=Mon..7=Sun
    const mondayWeek1UTC = new Date(jan4);
    mondayWeek1UTC.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
    const targetUTC = new Date(mondayWeek1UTC);
    targetUTC.setUTCDate(mondayWeek1UTC.getUTCDate() + (weekNumber - 1) * 7);
    return new Date(targetUTC.getUTCFullYear(), targetUTC.getUTCMonth(), targetUTC.getUTCDate());
}

const DAY_INDEX_MAP: Record<DayOfWeek, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
};

export function getWeekDayDate(week: Pick<Week, 'weekNumber' | 'year'>, day: DayOfWeek | number): Date {
    const offset = typeof day === 'number' ? day : DAY_INDEX_MAP[day];
    const monday = getDateOfIsoWeek(week.weekNumber, week.year);
    const result = new Date(monday);
    result.setDate(monday.getDate() + offset);
    return result;
}

export function formatShortDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.`;
}

export function formatISODate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function getWeekDateRangeString(week: Pick<Week, 'weekNumber' | 'year'>): string {
    const mon = getWeekDayDate(week, 0);
    const fri = getWeekDayDate(week, 4);
    return `${formatShortDate(mon)}–${formatShortDate(fri)}`;
}

export function inferWeekParityFromDate(dateInput: Date | string): 'odd' | 'even' {
    const d = typeof dateInput === 'string'
        ? (() => {
            const [y, m, day] = dateInput.split('-').map(Number);
            return new Date(y, (m || 1) - 1, day || 1);
        })()
        : dateInput;
    const { weekNumber } = getISOWeekAndYear(d);
    return weekNumber % 2 === 1 ? 'odd' : 'even';
}

export function getWeekTypeForNumber(weekNumber: number, weekAParity: 'odd' | 'even' = 'odd'): 'A' | 'B' {
    const isOdd = weekNumber % 2 === 1;
    if (weekAParity === 'odd') {
        return isOdd ? 'A' : 'B';
    }
    return isOdd ? 'B' : 'A';
}

export function getWeeksBetween(
    start: Date,
    end: Date,
    existingWeeks: Week[] = [],
    options?: { weekAParity?: 'odd' | 'even' }
): Week[] {
    const weeks: Week[] = [];
    const current = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const parity = options?.weekAParity ?? 'odd';

    // Align to Monday of start week
    const day = current.getDay() || 7;
    if (day !== 1) {
        current.setDate(current.getDate() - (day - 1));
    }

    const endNormalized = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const distinctWeeks = new Set<string>();

    // Map existing weeks by year-weekNumber to preserve isBlocked & weekType
    const existingByKey = new Map<string, Week>();
    for (const w of existingWeeks) {
        existingByKey.set(`${w.year}-${w.weekNumber}`, w);
    }

    while (current <= endNormalized) {
        const { weekNumber, year } = getISOWeekAndYear(current);
        const key = `${year}-${weekNumber}`;

        if (!distinctWeeks.has(key)) {
            distinctWeeks.add(key);
            const prev = existingByKey.get(key);
            weeks.push({
                id: formatWeekId(year, weekNumber),
                weekNumber,
                year,
                isBlocked: prev ? prev.isBlocked : false,
                weekType: prev ? prev.weekType : getWeekTypeForNumber(weekNumber, parity),
            });
        }

        current.setDate(current.getDate() + 7);
    }

    return weeks;
}

export type WeekABPatternMode =
    | 'odd-A'
    | 'even-A'
    | 'alternate-start-A'
    | 'alternate-start-B'
    | 'flip';

export function applyWeekABPattern(weeks: Week[], mode: WeekABPatternMode): Week[] {
    let altIndex = 0;
    return weeks.map((w) => {
        if (mode === 'odd-A') {
            return { ...w, weekType: getWeekTypeForNumber(w.weekNumber, 'odd') };
        }
        if (mode === 'even-A') {
            return { ...w, weekType: getWeekTypeForNumber(w.weekNumber, 'even') };
        }
        if (mode === 'flip') {
            return { ...w, weekType: w.weekType === 'A' ? 'B' : 'A' };
        }
        // alternate-start-A / alternate-start-B: skip completely blocked weeks when counting school weeks
        if (w.isBlocked) {
            return w;
        }
        const startWithA = mode === 'alternate-start-A';
        const weekType: 'A' | 'B' = (altIndex % 2 === 0) === startWithA ? 'A' : 'B';
        altIndex++;
        return { ...w, weekType };
    });
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
