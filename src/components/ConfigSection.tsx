import { useState } from 'react';
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    FileText,
    Sliders,
    Ban,
    Sparkles,
} from 'lucide-react';
import type { BlockedDays, HolidayLabels, PdfSettings, SolverSettings, Week } from '../types';
import {
    getISOWeek,
    getWeekDateRangeString,
    getWeekDayDate,
    getWeeksBetween,
    isDateInRange,
    isSameDay,
} from '../logic/dateUtils';

interface ConfigSectionProps {
    section?: 'period' | 'rules' | 'all';
    weeks: Week[];
    onUpdateWeeks: (weeks: Week[]) => void;
    blockedDays: BlockedDays;
    holidayLabels?: HolidayLabels;
    edupageSyncLoading?: boolean;
    edupageSyncMessage?: string | null;
    pdfSettings: PdfSettings;
    onUpdatePdfSettings: (settings: PdfSettings) => void;
    solverSettings: SolverSettings;
    onUpdateSolverSettings: (settings: SolverSettings) => void;
}

export function ConfigSection({
    section = 'all',
    weeks,
    onUpdateWeeks,
    blockedDays,
    holidayLabels = {},
    edupageSyncLoading = false,
    edupageSyncMessage = null,
    pdfSettings,
    onUpdatePdfSettings,
    solverSettings,
    onUpdateSolverSettings,
}: ConfigSectionProps) {
    const [currentMonth, setCurrentMonth] = useState(() => {
        if (weeks.length > 0) {
            return getWeekDayDate(weeks[0], 0);
        }
        return new Date();
    });
    const [pendingStart, setPendingStart] = useState<Date | null>(null);

    const selectionStart =
        pendingStart ?? (weeks.length > 0 ? getWeekDayDate(weeks[0], 0) : null);
    const selectionEnd = pendingStart
        ? null
        : weeks.length > 0
          ? getWeekDayDate(weeks[weeks.length - 1], 4)
          : null;

    const updateWeeks = (start: Date, end: Date) => {
        const newWeeks = getWeeksBetween(start, end, weeks);
        onUpdateWeeks(newWeeks);
    };

    const handleDateClick = (date: Date) => {
        if (!pendingStart) {
            setPendingStart(date);
        } else {
            if (date < pendingStart) {
                updateWeeks(date, pendingStart);
            } else {
                updateWeeks(pendingStart, date);
            }
            setPendingStart(null);
        }
    };

    const nextMonth = () => {
        const d = new Date(currentMonth);
        d.setMonth(d.getMonth() + 1);
        setCurrentMonth(d);
    };

    const prevMonth = () => {
        const d = new Date(currentMonth);
        d.setMonth(d.getMonth() - 1);
        setCurrentMonth(d);
    };

    const toggleBlockWeek = (id: string) => {
        onUpdateWeeks(weeks.map((w) => (w.id === id ? { ...w, isBlocked: !w.isBlocked } : w)));
    };

    const renderMonth = (offset: number) => {
        const monthDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();

        const firstDay = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let startDay = firstDay.getDay() - 1;
        if (startDay === -1) startDay = 6;

        // Build rows of 7 cells so each week row displays its exact ISO KW on the left
        const totalSlots = Math.ceil((startDay + daysInMonth) / 7) * 7;
        const rows: { kw: number; cells: Array<Date | null> }[] = [];

        for (let rowStart = 0; rowStart < totalSlots; rowStart += 7) {
            const cells: Array<Date | null> = [];
            let sampleDate: Date | null = null;
            for (let col = 0; col < 7; col++) {
                const dayNum = rowStart + col - startDay + 1;
                if (dayNum >= 1 && dayNum <= daysInMonth) {
                    const d = new Date(year, month, dayNum);
                    cells.push(d);
                    if (!sampleDate) sampleDate = d;
                } else {
                    cells.push(null);
                }
            }
            const kw = sampleDate ? getISOWeek(sampleDate) : 0;
            rows.push({ kw, cells });
        }

        return (
            <div style={{ width: '278px', background: 'var(--bg-panel)', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ textAlign: 'center', marginBottom: '0.6rem', fontWeight: 700, fontSize: '0.9rem' }}>
                    {monthDate.toLocaleString('de-DE', { month: 'long', year: 'numeric' })}
                </div>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '34px repeat(7, 1fr)',
                        gap: '3px',
                        textAlign: 'center',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        marginBottom: '4px',
                    }}
                >
                    <div>KW</div>
                    <div>Mo</div>
                    <div>Di</div>
                    <div>Mi</div>
                    <div>Do</div>
                    <div>Fr</div>
                    <div>Sa</div>
                    <div>So</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {rows.map((row, rIdx) => (
                        <div
                            key={`${year}-${month}-r${rIdx}`}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '34px repeat(7, 1fr)',
                                gap: '3px',
                                alignItems: 'center',
                            }}
                        >
                            <div
                                style={{
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    fontFamily: 'monospace',
                                    color: 'var(--accent-primary)',
                                    background: 'var(--accent-soft)',
                                    borderRadius: '4px',
                                    textAlign: 'center',
                                    padding: '3px 2px',
                                }}
                                title={`Kalenderwoche ${row.kw}`}
                            >
                                {row.kw}
                            </div>
                            {row.cells.map((date, cIdx) => {
                                if (!date) return <div key={`e-${cIdx}`} />;
                                const isSelected = isDateInRange(date, selectionStart, selectionEnd);
                                const isStart = selectionStart && isSameDay(date, selectionStart);
                                const isEnd = selectionEnd && isSameDay(date, selectionEnd);
                                const isWeekend = cIdx >= 5;

                                return (
                                    <button
                                        key={date.getDate()}
                                        type="button"
                                        onClick={() => handleDateClick(date)}
                                        style={{
                                            padding: '5px 0',
                                            textAlign: 'center',
                                            border: 'none',
                                            borderRadius: '6px',
                                            background: isStart || isEnd
                                                ? 'var(--accent-primary)'
                                                : isSelected
                                                    ? 'var(--accent-soft)'
                                                    : 'transparent',
                                            color: isStart || isEnd
                                                ? '#ffffff'
                                                : isWeekend
                                                    ? 'var(--text-muted)'
                                                    : 'var(--text-primary)',
                                            fontWeight: isStart || isEnd ? 700 : 500,
                                            fontSize: '0.8rem',
                                        }}
                                        className="hover-opacity"
                                    >
                                        {date.getDate()}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const showPeriod = section === 'all' || section === 'period';
    const showRules = section === 'all' || section === 'rules';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {showPeriod && (
                <div className="ui-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CalendarIcon size={19} color="var(--accent-primary)" />
                                Klausurzeitraum, Kalenderwochen & Ferien
                            </h3>
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                Start- und Enddatum anklicken – die <strong>KW</strong> steht links neben jeder Woche.
                            </p>
                        </div>
                        {weeks.length > 0 && (
                            <span
                                style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    padding: '4px 10px',
                                    borderRadius: '999px',
                                    background: 'var(--accent-soft)',
                                    color: 'var(--accent-primary)',
                                }}
                            >
                                {weeks.length} Wochen (KW {weeks[0].weekNumber} – KW {weeks[weeks.length - 1].weekNumber})
                            </span>
                        )}
                    </div>

                    {/* Month Pickers with KW column */}
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
                        <button type="button" className="ui-btn" style={{ padding: '6px' }} onClick={prevMonth} title="Vorheriger Monat">
                            <ChevronLeft size={16} />
                        </button>
                        {renderMonth(0)}
                        {renderMonth(1)}
                        <button type="button" className="ui-btn" style={{ padding: '6px' }} onClick={nextMonth} title="Nächster Monat">
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    {(edupageSyncLoading || edupageSyncMessage) && (
                        <div
                            style={{
                                fontSize: '0.82rem',
                                padding: '0.55rem 0.85rem',
                                borderRadius: '8px',
                                background: edupageSyncLoading ? 'var(--accent-soft)' : 'var(--accent-success-soft)',
                                color: 'var(--text-primary)',
                                border: `1px solid ${edupageSyncLoading ? 'var(--accent-primary)' : 'var(--accent-success)'}`,
                            }}
                        >
                            {edupageSyncLoading
                                ? 'Rufe Ferien, schulfreie Tage & A/B-Wochen automatisch aus EduPage ab...'
                                : edupageSyncMessage}
                        </div>
                    )}

                    {/* Week Cards */}
                    <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                            Wochen im Zeitraum (Klick auf A/B wechselt den Wochentyp)
                        </div>
                        {weeks.length === 0 ? (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Wähle oben ein Start- und Enddatum aus.</p>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '0.5rem' }}>
                                {weeks.map((week) => {
                                    const blockedDayNames = Object.entries(blockedDays[week.id] || {})
                                        .filter(([, v]) => v)
                                        .map(([d]) => holidayLabels[week.id]?.[d as keyof typeof holidayLabels[string]] || d);
                                    const allDaysBlocked = blockedDayNames.length >= 5;

                                    return (
                                        <div
                                            key={week.id}
                                            style={{
                                                padding: '0.55rem 0.7rem',
                                                background: week.isBlocked || allDaysBlocked ? 'var(--holiday-bg)' : 'var(--bg-panel)',
                                                border: `1px solid ${week.isBlocked ? 'var(--accent-danger)' : allDaysBlocked ? 'var(--holiday-border)' : 'var(--border-color)'}`,
                                                borderRadius: '8px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: '6px',
                                            }}
                                        >
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>KW {week.weekNumber}</span>
                                                </div>
                                                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                                    {getWeekDateRangeString(week)}
                                                </span>
                                                <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                                    {week.id}
                                                    {blockedDayNames.length > 0 ? ` · ${blockedDayNames.length} frei` : ''}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleBlockWeek(week.id)}
                                                title={week.isBlocked ? 'Woche freigeben' : 'Ganze Woche sperren'}
                                                style={{
                                                    background: week.isBlocked ? 'var(--accent-danger-soft)' : 'transparent',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    color: week.isBlocked ? 'var(--accent-danger)' : 'var(--text-muted)',
                                                    padding: '5px',
                                                    display: 'flex',
                                                }}
                                            >
                                                <Ban size={15} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showRules && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
                    {/* Solver Settings Card */}
                    <div className="ui-card" style={{ padding: '1.25rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.85rem' }}>
                            <Sliders size={18} color="var(--accent-primary)" />
                            Smart-Solver Regeln
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', fontSize: '0.86rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                <label style={{ fontWeight: 500 }}>Max. Klausuren / Woche / Klasse</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={5}
                                    className="ui-input"
                                    style={{ width: '64px', textAlign: 'center', padding: '4px 6px' }}
                                    value={solverSettings.maxExamsPerWeek}
                                    onChange={(e) =>
                                        onUpdateSolverSettings({
                                            ...solverSettings,
                                            maxExamsPerWeek: Math.max(1, Math.min(5, Number(e.target.value) || 2)),
                                        })
                                    }
                                />
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={solverSettings.preferSameGradeSubjectSameWeek}
                                    onChange={(e) =>
                                        onUpdateSolverSettings({ ...solverSettings, preferSameGradeSubjectSameWeek: e.target.checked })
                                    }
                                />
                                Gleiches Fach & gleiche Stufe in dieselbe Woche (ohne Tageskopplung)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={solverSettings.avoidConsecutiveDays}
                                    onChange={(e) =>
                                        onUpdateSolverSettings({ ...solverSettings, avoidConsecutiveDays: e.target.checked })
                                    }
                                />
                                Aufeinanderfolgende Klausurtage einer Klasse vermeiden
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={solverSettings.keepPinnedOnDistribute}
                                    onChange={(e) =>
                                        onUpdateSolverSettings({ ...solverSettings, keepPinnedOnDistribute: e.target.checked })
                                    }
                                />
                                Gepinnte Klausuren beim Neu-Verteilen beibehalten
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={solverSettings.avoidTeacherCollisions}
                                    onChange={(e) =>
                                        onUpdateSolverSettings({ ...solverSettings, avoidTeacherCollisions: e.target.checked })
                                    }
                                />
                                Lehrkraft-Überschneidungen am selben Tag vermeiden
                            </label>
                        </div>
                        <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Sparkles size={14} color="var(--accent-primary)" />
                            Berücksichtigt auch gewählte Prüfungs-Lehrkräfte und „Früh / Spät“-Wünsche.
                        </div>
                    </div>

                    {/* PDF Settings Card */}
                    <div className="ui-card" style={{ padding: '1.25rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.85rem' }}>
                            <FileText size={18} color="var(--accent-primary)" />
                            PDF-Export Einstellungen
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.82rem', fontWeight: 600 }}>Titel im PDF</label>
                                <input
                                    type="text"
                                    className="ui-input"
                                    value={pdfSettings.title}
                                    onChange={(e) => onUpdatePdfSettings({ ...pdfSettings, title: e.target.value })}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.82rem', fontWeight: 600 }}>Nachschreibetermin (Fußzeile)</label>
                                <input
                                    type="text"
                                    className="ui-input"
                                    value={pdfSettings.makeupExamInfo}
                                    onChange={(e) => onUpdatePdfSettings({ ...pdfSettings, makeupExamInfo: e.target.value })}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.82rem', fontWeight: 600 }}>Noten eintragen (Datum)</label>
                                <input
                                    type="text"
                                    className="ui-input"
                                    value={pdfSettings.gradesDueDate}
                                    onChange={(e) => onUpdatePdfSettings({ ...pdfSettings, gradesDueDate: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
