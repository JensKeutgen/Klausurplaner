import React, { useMemo, useState } from 'react';
import {
    DndContext,
    DragOverlay,
    useDroppable,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import {
    type AppState,
    type DayOfWeek,
    DAYS_OF_WEEK,
    DEFAULT_SOLVER_SETTINGS,
    type Exam,
} from '../types';
import { ExamCard } from './ExamCard';
import { clsx } from 'clsx';
import {
    evaluateSchedule,
    getAllTeachersForSubject,
    getEffectiveExamTeachers,
    getEffectiveGradeLevel,
    getExamTimingPreference,
    isSubjectTaughtByExamTeacherOnDay,
    validateMove,
    type TimingPreferences,
} from '../logic/solver';
import { formatShortDate, getWeekDateRangeString, getWeekDayDate } from '../logic/dateUtils';
import {
    Ban,
    CheckCircle2,
    AlertTriangle,
    Users,
    Layers,
    Search,
    CalendarX2,
} from 'lucide-react';

interface DroppableCellProps {
    id: string;
    children: React.ReactNode;
    isBlocked: boolean;
    isHoliday?: boolean;
    holidayLabel?: string;
    onClick?: () => void;
    isHighlight?: boolean;
}

function DroppableCell({
    id,
    children,
    isBlocked,
    isHoliday,
    holidayLabel,
    onClick,
    isHighlight,
}: DroppableCellProps) {
    const { setNodeRef, isOver } = useDroppable({
        id,
        disabled: isBlocked,
    });

    const bgStyle = isBlocked
        ? isHoliday
            ? 'repeating-linear-gradient(45deg, var(--holiday-bg), var(--holiday-bg) 8px, var(--stripe-b) 8px, var(--stripe-b) 16px)'
            : 'repeating-linear-gradient(45deg, var(--stripe-a), var(--stripe-a) 8px, var(--stripe-b) 8px, var(--stripe-b) 16px)'
        : isHighlight
            ? 'var(--accent-success-soft)'
            : undefined;

    return (
        <div
            ref={setNodeRef}
            onClick={onClick}
            title={
                holidayLabel
                    ? `Schulfrei: ${holidayLabel} (Klick im Spaltenkopf zum Entsperren)`
                    : isBlocked
                        ? 'Tag gesperrt (Klick zum Freigeben)'
                        : 'Klick auf freie Fläche = Tag für Klasse sperren'
            }
            className={clsx(
                'calendar-cell',
                isBlocked && 'blocked',
                isOver && !isBlocked && 'drag-over'
            )}
            style={{
                width: '100%',
                height: '100%',
                minHeight: '62px',
                padding: '4px',
                background: bgStyle,
                borderRight: '1px solid var(--border-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
                opacity: isBlocked ? 0.72 : 1,
                boxShadow: isHighlight ? 'inset 0 0 0 1px var(--accent-success)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                cursor: 'pointer',
            }}
        >
            {children}
        </div>
    );
}

interface CalendarBoardProps {
    state: AppState;
    onMoveExam: (examId: string, weekId: string | null, day: DayOfWeek | null) => void;
    onTogglePin: (examId: string) => void;
    onToggleBlockClassDay?: (className: string, weekId: string, day: DayOfWeek) => void;
    onToggleBlockGlobalDay?: (weekId: string, day: DayOfWeek) => void;
    onToggleWeekType?: (weekId: string) => void;
    highlightedExamId?: string | null;
}

const GERMAN_DAY_SHORT: Record<DayOfWeek, string> = {
    Monday: 'Mo',
    Tuesday: 'Di',
    Wednesday: 'Mi',
    Thursday: 'Do',
    Friday: 'Fr',
};

export function CalendarBoard({
    state,
    onMoveExam,
    onTogglePin,
    onToggleBlockClassDay,
    onToggleBlockGlobalDay,
    onToggleWeekType,
    highlightedExamId,
}: CalendarBoardProps) {
    const [activeDraggable, setActiveDraggable] = useState<Exam | null>(null);
    const [gradeFilter, setGradeFilter] = useState<string>('Alle');
    const [searchQuery, setSearchQuery] = useState<string>('');

    const solverSettings = state.solverSettings || DEFAULT_SOLVER_SETTINGS;
    const timing: TimingPreferences = useMemo(
        () => ({
            global: state.subjectTiming,
            byClass: state.classSubjectTiming,
        }),
        [state.subjectTiming, state.classSubjectTiming]
    );

    const evaluation = useMemo(
        () =>
            evaluateSchedule(
                state.exams,
                state.classes,
                state.weeks,
                state.blockedDays,
                state.blockedClassDays,
                solverSettings,
                timing
            ),
        [
            state.exams,
            state.classes,
            state.weeks,
            state.blockedDays,
            state.blockedClassDays,
            solverSettings,
            timing,
        ]
    );

    const grades = useMemo(() => {
        const set = new Set<string>();
        state.classes.forEach((c) => {
            const g = getEffectiveGradeLevel(c, c.className);
            if (g) set.add(g);
        });
        return ['Alle', ...Array.from(set).sort()];
    }, [state.classes]);

    const normalizedQuery = searchQuery.trim().toLowerCase();

    const visibleClasses = useMemo(() => {
        return [...state.classes]
            .filter((c) => {
                const grade = getEffectiveGradeLevel(c, c.className);
                if (gradeFilter !== 'Alle' && grade !== gradeFilter) return false;
                if (!normalizedQuery) return true;
                if (c.className.toLowerCase().includes(normalizedQuery)) return true;
                if (grade.toLowerCase().includes(normalizedQuery)) return true;
                // Also match if any exam or subject of this class matches query
                const hasMatchingExam = state.exams.some(
                    (e) =>
                        e.className === c.className &&
                        e.subject.toLowerCase().includes(normalizedQuery)
                );
                return hasMatchingExam;
            })
            .sort((a, b) => {
                const ga = getEffectiveGradeLevel(a, a.className);
                const gb = getEffectiveGradeLevel(b, b.className);
                return ga !== gb ? ga.localeCompare(gb) : a.className.localeCompare(b.className);
            });
    }, [state.classes, state.exams, gradeFilter, normalizedQuery]);

    const visibleClassNames = useMemo(
        () => new Set(visibleClasses.map((c) => c.className)),
        [visibleClasses]
    );

    const classMap = useMemo(
        () => new Map(state.classes.map((c) => [c.className, c])),
        [state.classes]
    );

    const unassignedGrouped = useMemo(() => {
        const unassigned = state.exams.filter((e) => {
            if (e.assignedWeekId) return false;
            if (!visibleClassNames.has(e.className)) return false;
            if (
                normalizedQuery &&
                !e.className.toLowerCase().includes(normalizedQuery) &&
                !e.subject.toLowerCase().includes(normalizedQuery)
            ) {
                return false;
            }
            return true;
        });

        const groups = new Map<string, Exam[]>();
        for (const exam of unassigned) {
            const list = groups.get(exam.className) || [];
            list.push(exam);
            groups.set(exam.className, list);
        }
        return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [state.exams, visibleClassNames, normalizedQuery]);

    const totalUnassigned = useMemo(
        () => state.exams.filter((e) => !e.assignedWeekId).length,
        [state.exams]
    );

    const handleDragStart = (event: DragStartEvent) => {
        setActiveDraggable(event.active.data.current?.exam || null);
    };

    const getCellId = (className: string, weekId: string, day: string) =>
        `cell::${className}::${weekId}::${day}`;

    const parseCellId = (id: string) => {
        if (!id.startsWith('cell::')) return null;
        const parts = id.split('::');
        return { className: parts[1], weekId: parts[2], day: parts[3] as DayOfWeek };
    };

    const onDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveDraggable(null);
        if (!over) return;

        const exam = active.data.current?.exam as Exam;
        const dropId = over.id as string;

        if (dropId === 'unassigned') {
            onMoveExam(exam.id, null, null);
            return;
        }

        const parsed = parseCellId(dropId);
        if (parsed) {
            if (parsed.className !== exam.className) {
                return;
            }
            onMoveExam(exam.id, parsed.weekId, parsed.day);
        }
    };

    if (state.classes.length === 0) {
        return (
            <div className="ui-card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Noch keine Klassen geladen. Importiere im Tab <strong>1. Import & Ferien</strong> deine Stundenpläne, um den Klausurplan zu erstellen.
            </div>
        );
    }

    const totalDays = state.weeks.length * 5;
    const gridTemplateColumns = `150px repeat(${totalDays}, minmax(76px, 1fr))`;

    return (
        <DndContext onDragStart={handleDragStart} onDragEnd={onDragEnd}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Filter + Solver Quality Bar */}
                <div
                    className="ui-card"
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        alignItems: 'center',
                        padding: '0.65rem 1rem',
                        fontSize: '0.83rem',
                    }}
                >
                    {/* Filters */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <select
                            className="ui-input"
                            style={{ width: 'auto', fontSize: '0.8rem', padding: '5px 8px' }}
                            value={gradeFilter}
                            onChange={(e) => setGradeFilter(e.target.value)}
                            title="Nach Stufe filtern"
                        >
                            {grades.map((g) => (
                                <option key={g} value={g}>
                                    {g === 'Alle' ? 'Alle Stufen' : `Stufe ${g}`}
                                </option>
                            ))}
                        </select>
                        <div style={{ position: 'relative', width: '175px' }}>
                            <Search
                                size={13}
                                style={{
                                    position: 'absolute',
                                    left: '8px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: 'var(--text-muted)',
                                }}
                            />
                            <input
                                type="text"
                                className="ui-input"
                                placeholder="Klasse / Fach..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ padding: '5px 8px 5px 26px', fontSize: '0.8rem' }}
                            />
                        </div>
                    </div>

                    <div style={{ width: '1px', height: '22px', background: 'var(--border-subtle)' }} />

                    {/* Quality metrics */}
                    {state.exams.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', alignItems: 'center', flex: 1 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}>
                                <CheckCircle2
                                    size={15}
                                    color={evaluation.unassignedExams === 0 ? 'var(--accent-success)' : 'var(--accent-warning)'}
                                />
                                Zugewiesen: {evaluation.assignedExams}/{evaluation.totalExams}
                            </span>

                            {evaluation.sameWeekGroupTotal > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--text-primary)' }}>
                                    <Layers size={14} color="var(--accent-primary)" />
                                    Fach & Stufe gleich: <strong>{evaluation.sameWeekGroupAligned}/{evaluation.sameWeekGroupTotal}</strong> ({evaluation.sameWeekGroupRate}%)
                                </span>
                            )}

                            <span
                                style={{
                                    color: evaluation.consecutiveDayPairs > 0 ? 'var(--accent-warning)' : 'var(--text-secondary)',
                                }}
                            >
                                Nachbartage: <strong>{evaluation.consecutiveDayPairs}</strong>
                            </span>

                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    color: evaluation.teacherConflicts > 0 ? 'var(--accent-warning)' : 'var(--text-secondary)',
                                }}
                            >
                                <Users size={14} />
                                Lehrkräfte-Koll.: <strong>{evaluation.teacherConflicts}</strong>
                            </span>

                            {evaluation.constraintViolations > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent-danger)', fontWeight: 700 }}>
                                    <AlertTriangle size={14} />
                                    Verstöße: {evaluation.constraintViolations}
                                </span>
                            )}
                        </div>
                    ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                            Klicke oben rechts auf <strong>Verteilen</strong>, um die Klausuren automatisch einzuplanen.
                        </span>
                    )}

                    <div style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Klick auf Datum = global sperren · Klick auf A/B = Wochentyp
                    </div>
                </div>

                {/* Main Split: Left Unassigned Dock + Right Calendar Matrix */}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'stretch', height: 'calc(100vh - 196px)', minHeight: '460px' }}>
                    {/* Left Dock: Noch offen */}
                    <div
                        className="ui-card"
                        style={{
                            width: '240px',
                            flexShrink: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '0.75rem',
                            height: '100%',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Noch offen</span>
                            <span
                                style={{
                                    fontSize: '0.74rem',
                                    fontWeight: 700,
                                    padding: '1px 7px',
                                    borderRadius: '999px',
                                    background: totalUnassigned > 0 ? 'var(--accent-warning-soft)' : 'var(--accent-success-soft)',
                                    color: totalUnassigned > 0 ? 'var(--accent-warning)' : 'var(--accent-success)',
                                }}
                            >
                                {totalUnassigned}
                            </span>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '2px' }}>
                            <SidebarDroppable>
                                {unassignedGrouped.map(([clsName, list]) => {
                                    const cls = classMap.get(clsName);
                                    return (
                                        <div key={clsName} style={{ marginBottom: '0.75rem' }}>
                                            <div
                                                style={{
                                                    fontSize: '0.72rem',
                                                    fontWeight: 700,
                                                    color: 'var(--text-muted)',
                                                    marginBottom: '4px',
                                                    textTransform: 'uppercase',
                                                }}
                                            >
                                                {clsName}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {list.map((exam) => {
                                                    const chosen = cls?.examTeacherBySubject?.[exam.subject];
                                                    const teachers = chosen ? [chosen] : getAllTeachersForSubject(cls, exam.subject);
                                                    return (
                                                        <ExamCard
                                                            key={exam.id}
                                                            exam={exam}
                                                            isHighlighted={highlightedExamId === exam.id}
                                                            teachers={teachers}
                                                            hasChosenTeacher={Boolean(chosen)}
                                                            timingPref={getExamTimingPreference(exam, timing)}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}

                                {unassignedGrouped.length === 0 && (
                                    <div
                                        style={{
                                            padding: '1rem 0.5rem',
                                            textAlign: 'center',
                                            color: state.exams.length > 0 ? 'var(--accent-success)' : 'var(--text-muted)',
                                            fontSize: '0.82rem',
                                            fontWeight: state.exams.length > 0 ? 600 : 400,
                                        }}
                                    >
                                        {state.exams.length === 0
                                            ? 'Noch keine Klausuren erzeugt.'
                                            : totalUnassigned === 0
                                                ? 'Alle Klausuren zugewiesen!'
                                                : 'Keine offenen Klausuren im Filter.'}
                                    </div>
                                )}
                            </SidebarDroppable>
                        </div>
                    </div>

                    {/* Right Grid Container */}
                    <div
                        className="ui-card"
                        style={{
                            flex: 1,
                            overflow: 'auto',
                            height: '100%',
                            position: 'relative',
                        }}
                    >
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns,
                                minWidth: 'fit-content',
                            }}
                        >
                            {/* Corner Cell: Klasse / Stufe */}
                            <div
                                style={{
                                    position: 'sticky',
                                    top: 0,
                                    left: 0,
                                    zIndex: 25,
                                    background: 'var(--bg-panel)',
                                    borderBottom: '1px solid var(--border-color)',
                                    borderRight: '1px solid var(--border-color)',
                                    padding: '0.75rem 0.85rem',
                                    fontWeight: 700,
                                    fontSize: '0.85rem',
                                    gridColumn: '1 / 2',
                                    gridRow: '1 / 3',
                                    alignContent: 'center',
                                }}
                            >
                                Klasse / Stufe
                            </div>

                            {/* Header Row 1: Prominent KW + Date Range + Week ID + A/B Toggle */}
                            {state.weeks.map((week, index) => (
                                <div
                                    key={week.id}
                                    style={{
                                        gridColumn: `${2 + index * 5} / span 5`,
                                        gridRow: '1 / 2',
                                        textAlign: 'center',
                                        padding: '0.35rem 0.5rem',
                                        background: week.isBlocked ? 'var(--holiday-bg)' : 'var(--bg-panel)',
                                        borderBottom: '1px solid var(--border-subtle)',
                                        borderRight: '1px solid var(--border-color)',
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 15,
                                        height: '50px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '7px',
                                        color: week.isBlocked ? 'var(--holiday-text)' : 'var(--text-primary)',
                                    }}
                                >
                                    <span
                                        style={{
                                            fontWeight: 800,
                                            fontSize: '0.88rem',
                                            background: week.isBlocked ? 'var(--holiday-border)' : 'var(--accent-soft)',
                                            color: week.isBlocked ? '#fff' : 'var(--accent-primary)',
                                            padding: '2px 8px',
                                            borderRadius: '6px',
                                        }}
                                    >
                                        KW {week.weekNumber}
                                    </span>
                                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                        {getWeekDateRangeString(week)}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: '0.67rem',
                                            fontFamily: 'monospace',
                                            background: 'var(--bg-surface)',
                                            border: '1px solid var(--border-subtle)',
                                            color: 'var(--text-muted)',
                                            padding: '1px 5px',
                                            borderRadius: '4px',
                                        }}
                                        title="Eindeutige Wochen-ID"
                                    >
                                        {week.id}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onToggleWeekType?.(week.id)}
                                        style={{
                                            fontSize: '0.7rem',
                                            padding: '2px 7px',
                                            borderRadius: '5px',
                                            border: 'none',
                                            background: week.weekType === 'A' ? 'var(--accent-primary)' : 'var(--accent-purple)',
                                            color: '#fff',
                                            fontWeight: 700,
                                        }}
                                        title="Wochentyp umschalten (A/B)"
                                    >
                                        {week.weekType}
                                    </button>
                                </div>
                            ))}

                            {/* Header Row 2: Days + Date + Holiday Label + Global Block Toggle */}
                            {state.weeks.map((week) =>
                                DAYS_OF_WEEK.map((day) => {
                                    const dayDate = getWeekDayDate(week, day);
                                    const isGlobalBlocked = !!state.blockedDays[week.id]?.[day] || week.isBlocked;
                                    const holidayLabel = state.holidayLabels?.[week.id]?.[day];
                                    const isHoliday = Boolean(holidayLabel) && isGlobalBlocked;

                                    return (
                                        <div
                                            key={`${week.id}-${day}`}
                                            onClick={() => onToggleBlockGlobalDay?.(week.id, day)}
                                            title={
                                                holidayLabel
                                                    ? `${holidayLabel} — Klick zum Entsperren`
                                                    : isGlobalBlocked
                                                        ? 'Tag global entsperren'
                                                        : 'Tag für alle Klassen sperren'
                                            }
                                            style={{
                                                textAlign: 'center',
                                                fontSize: '0.73rem',
                                                padding: '4px 3px',
                                                borderBottom: '1px solid var(--border-color)',
                                                borderRight: '1px solid var(--border-subtle)',
                                                background: isHoliday
                                                    ? 'var(--holiday-bg)'
                                                    : isGlobalBlocked
                                                        ? 'var(--accent-danger-soft)'
                                                        : 'var(--bg-surface)',
                                                color: isHoliday
                                                    ? 'var(--holiday-text)'
                                                    : isGlobalBlocked
                                                        ? 'var(--accent-danger)'
                                                        : 'var(--text-secondary)',
                                                position: 'sticky',
                                                top: '50px',
                                                zIndex: 15,
                                                height: '44px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                lineHeight: 1.15,
                                            }}
                                        >
                                            <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                {GERMAN_DAY_SHORT[day]} {formatShortDate(dayDate)}
                                                {isHoliday ? <CalendarX2 size={10} /> : isGlobalBlocked ? <Ban size={10} /> : null}
                                            </span>
                                            {holidayLabel && isGlobalBlocked && (
                                                <span
                                                    style={{
                                                        fontSize: '0.62rem',
                                                        fontWeight: 600,
                                                        maxWidth: '68px',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {holidayLabel}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })
                            )}

                            {/* Data Rows */}
                            {visibleClasses.map((cls) => {
                                const grade = getEffectiveGradeLevel(cls, cls.className);
                                return (
                                    <React.Fragment key={cls.className}>
                                        {/* Sticky Left Class Column */}
                                        <div
                                            style={{
                                                position: 'sticky',
                                                left: 0,
                                                zIndex: 10,
                                                background: 'var(--bg-panel)',
                                                borderBottom: '1px solid var(--border-subtle)',
                                                borderRight: '1px solid var(--border-color)',
                                                padding: '0.6rem 0.85rem',
                                                fontWeight: 700,
                                                fontSize: '0.86rem',
                                                alignContent: 'center',
                                            }}
                                        >
                                            <div>{cls.className}</div>
                                            {grade && (
                                                <div style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                                                    Stufe {grade}
                                                </div>
                                            )}
                                        </div>

                                        {/* Day Cells */}
                                        {state.weeks.map((week) =>
                                            DAYS_OF_WEEK.map((day) => {
                                                const cellExams = state.exams.filter(
                                                    (e) =>
                                                        e.className === cls.className &&
                                                        e.assignedWeekId === week.id &&
                                                        e.assignedDay === day
                                                );

                                                const isGlobalBlocked = !!state.blockedDays[week.id]?.[day] || week.isBlocked;
                                                const isBlocked =
                                                    isGlobalBlocked ||
                                                    !!state.blockedClassDays?.[cls.className]?.[week.id]?.[day];
                                                const holidayLabel = state.holidayLabels?.[week.id]?.[day];
                                                const isHoliday = Boolean(holidayLabel) && isGlobalBlocked;

                                                const isHighlight =
                                                    !!activeDraggable &&
                                                    activeDraggable.className === cls.className &&
                                                    !isBlocked &&
                                                    isSubjectTaughtByExamTeacherOnDay(
                                                        cls,
                                                        activeDraggable.subject,
                                                        day,
                                                        week.weekType
                                                    );

                                                return (
                                                    <div key={`${cls.className}-${week.id}-${day}`} style={{ overflow: 'hidden' }}>
                                                        <DroppableCell
                                                            id={getCellId(cls.className, week.id, day)}
                                                            isBlocked={isBlocked}
                                                            isHoliday={isHoliday}
                                                            holidayLabel={isHoliday ? holidayLabel : undefined}
                                                            isHighlight={isHighlight}
                                                            onClick={() => onToggleBlockClassDay?.(cls.className, week.id, day)}
                                                        >
                                                            {cellExams.map((exam) => {
                                                                const check = validateMove(
                                                                    exam,
                                                                    week.id,
                                                                    day,
                                                                    state.exams,
                                                                    cls,
                                                                    state.weeks,
                                                                    state.blockedDays,
                                                                    state.blockedClassDays,
                                                                    solverSettings,
                                                                    state.classes
                                                                );
                                                                const teachers = getEffectiveExamTeachers(
                                                                    cls,
                                                                    exam.subject,
                                                                    day,
                                                                    week.weekType
                                                                );
                                                                const hasChosenTeacher = Boolean(
                                                                    cls.examTeacherBySubject?.[exam.subject]
                                                                );
                                                                return (
                                                                    <ExamCard
                                                                        key={exam.id}
                                                                        exam={exam}
                                                                        isValid={check.valid}
                                                                        isHighlighted={highlightedExamId === exam.id}
                                                                        validationReason={check.reason}
                                                                        validationWarning={check.warning}
                                                                        teachers={teachers}
                                                                        hasChosenTeacher={hasChosenTeacher}
                                                                        timingPref={getExamTimingPreference(exam, timing)}
                                                                        onTogglePin={onTogglePin}
                                                                    />
                                                                );
                                                            })}
                                                        </DroppableCell>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            <DragOverlay>
                {activeDraggable ? (
                    <ExamCard
                        exam={activeDraggable}
                        isOverlay
                        timingPref={getExamTimingPreference(activeDraggable, timing)}
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}

function SidebarDroppable({ children }: { children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'unassigned',
    });

    return (
        <div
            ref={setNodeRef}
            style={{
                minHeight: '100%',
                background: isOver ? 'var(--accent-soft)' : 'transparent',
                borderRadius: '6px',
                transition: 'background 0.15s',
            }}
        >
            {children}
        </div>
    );
}
