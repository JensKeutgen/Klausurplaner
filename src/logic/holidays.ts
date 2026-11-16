import { DAYS_OF_WEEK, type BlockedDays, type DayOfWeek, type HolidayLabels, type Week } from '../types';
import { formatISODate, getWeekDayDate } from './dateUtils';

export type GermanStateCode =
    | 'NW'
    | 'BW'
    | 'BY'
    | 'BE'
    | 'BB'
    | 'HB'
    | 'HH'
    | 'HE'
    | 'MV'
    | 'NI'
    | 'RP'
    | 'SL'
    | 'SN'
    | 'ST'
    | 'SH'
    | 'TH';

export const GERMAN_STATES: { code: GermanStateCode; label: string }[] = [
    { code: 'NW', label: 'Nordrhein-Westfalen (NRW)' },
    { code: 'BW', label: 'Baden-Württemberg' },
    { code: 'BY', label: 'Bayern' },
    { code: 'BE', label: 'Berlin' },
    { code: 'BB', label: 'Brandenburg' },
    { code: 'HB', label: 'Bremen' },
    { code: 'HH', label: 'Hamburg' },
    { code: 'HE', label: 'Hessen' },
    { code: 'MV', label: 'Mecklenburg-Vorpommern' },
    { code: 'NI', label: 'Niedersachsen' },
    { code: 'RP', label: 'Rheinland-Pfalz' },
    { code: 'SL', label: 'Saarland' },
    { code: 'SN', label: 'Sachsen' },
    { code: 'ST', label: 'Sachsen-Anhalt' },
    { code: 'SH', label: 'Schleswig-Holstein' },
    { code: 'TH', label: 'Thüringen' },
];

function getEasterSunday(year: number): Date {
    // Anonymous Gregorian Gauss algorithm
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
    const res = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    res.setDate(res.getDate() + days);
    return res;
}

export function getPublicHolidaysForYear(year: number, state: GermanStateCode): Map<string, string> {
    const map = new Map<string, string>();
    const add = (d: Date, name: string) => map.set(formatISODate(d), name);

    const easter = getEasterSunday(year);

    // Nationwide
    add(new Date(year, 0, 1), 'Neujahr');
    add(addDays(easter, -2), 'Karfreitag');
    add(addDays(easter, 1), 'Ostermontag');
    add(new Date(year, 4, 1), 'Tag der Arbeit');
    add(addDays(easter, 39), 'Christi Himmelfahrt');
    add(addDays(easter, 50), 'Pfingstmontag');
    add(new Date(year, 9, 3), 'Tag der Deutschen Einheit');
    add(new Date(year, 11, 25), '1. Weihnachtstag');
    add(new Date(year, 11, 26), '2. Weihnachtstag');

    // State-specific
    if (['BW', 'BY', 'ST'].includes(state)) {
        add(new Date(year, 0, 6), 'Heilige Drei Könige');
    }
    if (['BE', 'MV'].includes(state)) {
        add(new Date(year, 2, 8), 'Internationaler Frauentag');
    }
    if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(state)) {
        add(addDays(easter, 60), 'Fronleichnam');
    }
    if (['BY', 'SL'].includes(state)) {
        add(new Date(year, 7, 15), 'Mariä Himmelfahrt');
    }
    if (state === 'TH') {
        add(new Date(year, 8, 20), 'Weltkindertag');
    }
    if (['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'].includes(state)) {
        add(new Date(year, 9, 31), 'Reformationstag');
    }
    if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(state)) {
        add(new Date(year, 10, 1), 'Allerheiligen');
    }
    if (state === 'SN') {
        // Buß- und Bettag: Wednesday before Nov 23
        const nov23 = new Date(year, 10, 23);
        const wd = nov23.getDay(); // 0=Sun..6=Sat
        const offset = ((wd + 4) % 7) + 1;
        add(addDays(nov23, -offset), 'Buß- und Bettag');
    }

    return map;
}

export function applyPublicHolidaysToWeeks(
    weeks: Week[],
    state: GermanStateCode,
    existingBlockedDays: BlockedDays,
    existingLabels: HolidayLabels = {}
): { blockedDays: BlockedDays; holidayLabels: HolidayLabels; addedCount: number } {
    const years = Array.from(
        new Set(weeks.flatMap((w) => [getWeekDayDate(w, 0).getFullYear(), getWeekDayDate(w, 4).getFullYear()]))
    );
    const holidayLookup = new Map<string, string>();
    for (const y of years) {
        for (const [iso, label] of getPublicHolidaysForYear(y, state)) {
            holidayLookup.set(iso, label);
        }
    }

    const nextBlocked: BlockedDays = { ...existingBlockedDays };
    const nextLabels: HolidayLabels = { ...existingLabels };
    let addedCount = 0;

    for (const week of weeks) {
        for (const day of DAYS_OF_WEEK) {
            const iso = formatISODate(getWeekDayDate(week, day));
            const holidayName = holidayLookup.get(iso);
            if (!holidayName) continue;

            const prevDayMap = nextBlocked[week.id] || ({} as Record<DayOfWeek, boolean>);
            if (!prevDayMap[day]) {
                addedCount++;
            }
            nextBlocked[week.id] = {
                ...prevDayMap,
                [day]: true,
            };
            nextLabels[week.id] = {
                ...(nextLabels[week.id] || {}),
                [day]: holidayName,
            };
        }
    }

    return { blockedDays: nextBlocked, holidayLabels: nextLabels, addedCount };
}
