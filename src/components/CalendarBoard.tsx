import React, { useMemo } from 'react';
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { type AppState, type DayOfWeek, DAYS_OF_WEEK, DEFAULT_SOLVER_SETTINGS, type Exam } from '../types';
import { ExamCard } from './ExamCard';
import { clsx } from 'clsx';
import { evaluateSchedule, getEffectiveGradeLevel, getTeachersForSubjectOnDay, validateMove } from '../logic/solver';
import { formatShortDate, getWeekDateRangeString, getWeekDayDate } from '../logic/dateUtils';
import { Ban, CheckCircle2, AlertTriangle, Users, Layers } from 'lucide-react';

interface DroppableCellProps {
    id: string;
    children: React.ReactNode;
    isBlocked: boolean;
    onClick?: () => void;
    isHighlight?: boolean;
}

function DroppableCell({
    id,
    children,
    isBlocked,
    onClick,
    isHighlight
}: DroppableCellProps) {
    const { setNodeRef, isOver } = useDroppable({
        id,
        disabled: isBlocked
    });

    const bgStyle = isBlocked
        ? 'repeating-linear-gradient(45deg, var(--bg-app), var(--bg-app) 10px, var(--bg-panel) 10px, var(--bg-panel) 20px)'
        : isHighlight
            ? 'rgba(34, 197, 94, 0.15)'
            : undefined;

    return (
        <div
            ref={setNodeRef}
            onClick={onClick}
            className={clsx(
                "calendar-cell",
                isBlocked && "blocked",
                isOver && !isBlocked && "drag-over",
            )}
            style={{
                width: '100%',
                height: '100%',
                minHeight: '64px',
                padding: '4px',
                background: bgStyle,
                borderRight: '1px solid var(--border-color)',
                borderBottom: '1px solid var(--border-color)',
                opacity: isBlocked ? 0.55 : 1,
                boxShadow: isHighlight ? 'inset 0 0 0 1px rgba(34, 197, 94, 0.35)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
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
}: CalendarBoardProps) {
    const [activeDraggable, setActiveDraggable] = React.useState<Exam | null>(null);
    const solverSettings = state.solverSettings || DEFAULT_SOLVER_SETTINGS;

    const evaluation = useMemo(
        () =>
            evaluateSchedule(
                state.exams,
                state.classes,
                state.weeks,
                state.blockedDays,
                state.blockedClassDays,
                solverSettings
            ),
        [state.exams, state.classes, state.weeks, state.blockedDays, state.blockedClassDays, solverSettings]
    );

    const handleDragStart = (event: DragStartEvent) => {
        setActiveDraggable(event.active.data.current?.exam || null);
    };

    const getCellId = (className: string, weekId: string, day: string) => `cell::${className}::${weekId}::${day}`;

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

    const totalDays = state.weeks.length * 5;
    const gridTemplateColumns = `160px repeat(${totalDays}, minmax(76px, 1fr))`;

    return (
        <DndContext onDragStart={handleDragStart} onDragEnd={onDragEnd}>
            {/* Solver Quality Bar */}
            {state.exams.length > 0 && (
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '1rem',
                        alignItems: 'center',
                        padding: '0.75rem 1rem',
                        marginTop: '1rem',
                        background: 'var(--bg-card)',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.85rem',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                        <CheckCircle2
                            size={16}
                            color={evaluation.unassignedExams === 0 ? 'var(--accent-success)' : 'var(--accent-warning)'}
                        />
                        <span>
                            Zugewiesen: {evaluation.assignedExams}/{evaluation.totalExams}
                        </span>
                    </div>

                    {evaluation.sameWeekGroupTotal > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                            <Layers size={15} color="var(--accent-primary)" />
                            <span>
                                Fach & Stufe in gleicher Woche: {evaluation.sameWeekGroupAligned}/{evaluation.sameWeekGroupTotal} ({evaluation.sameWeekGroupRate}%)
                            </span>
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: evaluation.consecutiveDayPairs > 0 ? 'var(--accent-warning)' : 'var(--text-secondary)' }}>
                        <span>Nachbartage (Klasse): {evaluation.consecutiveDayPairs}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: evaluation.teacherConflicts > 0 ? 'var(--accent-warning)' : 'var(--text-secondary)' }}>
                        <Users size={15} />
                        <span>Lehrkraft-Überschneidungen: {evaluation.teacherConflicts}</span>
                    </div>

                    {evaluation.constraintViolations > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-danger)', fontWeight: 600 }}>
                            <AlertTriangle size={15} />
                            <span>Regelverstöße: {evaluation.constraintViolations}</span>
                        </div>
                    )}

                    <div style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Tipp: Klick auf Datum im Kopf = Tag für alle Klassen sperren
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', alignItems: 'start', height: 'calc(100vh - 210px)' }}>

                {/* Main Grid Container */}
                <div className="card" style={{
                    flex: 1,
                    overflow: 'auto',
                    background: 'var(--bg-card)',
                    borderRadius: '8px',
                    height: '100%',
                    position: 'relative'
                }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: gridTemplateColumns,
                        minWidth: 'fit-content'
                    }}>

                        {/* --- Header Row 1 & 2 Corner: Klasse --- */}
                        <div style={{
                            position: 'sticky',
                            top: 0,
                            left: 0,
                            zIndex: 20,
                            background: 'var(--bg-card)',
                            borderBottom: '1px solid var(--border-color)',
                            borderRight: '1px solid var(--border-color)',
                            padding: '0.85rem 1rem',
                            fontWeight: 'bold',
                            gridColumn: '1 / 2',
                            gridRow: '1 / 3',
                            alignContent: 'center'
                        }}>
                            Klasse / Stufe
                        </div>

                        {/* --- Header Row 1: Weeks with real date range & Wochen-ID --- */}
                        {state.weeks.map((week, index) => (
                            <div key={week.id} style={{
                                gridColumn: `${2 + index * 5} / span 5`,
                                gridRow: '1 / 2',
                                textAlign: 'center',
                                padding: '0.45rem 0.5rem',
                                background: 'var(--bg-card)',
                                borderBottom: '1px solid var(--border-color)',
                                borderRight: '1px solid var(--border-color)',
                                position: 'sticky',
                                top: 0,
                                zIndex: 10,
                                height: '48px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                color: week.isBlocked ? 'var(--accent-danger)' : 'inherit'
                            }}>
                                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                                    KW {week.weekNumber}
                                </span>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    ({getWeekDateRangeString(week)})
                                </span>
                                <span
                                    style={{
                                        fontSize: '0.68rem',
                                        fontFamily: 'monospace',
                                        background: 'var(--bg-app)',
                                        color: 'var(--text-secondary)',
                                        padding: '1px 5px',
                                        borderRadius: '4px',
                                    }}
                                    title="Eindeutige Wochen-ID"
                                >
                                    {week.id}
                                </span>
                                <button
                                    onClick={() => onToggleWeekType?.(week.id)}
                                    style={{
                                        fontSize: '0.68rem',
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        background: week.weekType === 'A' ? 'var(--accent-primary)' : '#8b5cf6',
                                        color: 'white',
                                        fontWeight: 600,
                                    }}
                                    title="Wochentyp umschalten (A/B)"
                                >
                                    {week.weekType}
                                </button>
                            </div>
                        ))}

                        {/* --- Header Row 2: Days with real DD.MM. + Global Block Toggle --- */}
                        {state.weeks.map((week) => (
                            DAYS_OF_WEEK.map((day) => {
                                const dayDate = getWeekDayDate(week, day);
                                const isGlobalBlocked = !!state.blockedDays[week.id]?.[day] || week.isBlocked;
                                return (
                                    <div
                                        key={`${week.id}-${day}`}
                                        onClick={() => onToggleBlockGlobalDay?.(week.id, day)}
                                        title={isGlobalBlocked ? 'Tag global entsperren' : 'Tag für alle Klassen sperren'}
                                        style={{
                                            textAlign: 'center',
                                            fontSize: '0.74rem',
                                            padding: '4px 2px',
                                            borderBottom: '1px solid var(--border-color)',
                                            borderRight: '1px solid var(--border-color)',
                                            background: isGlobalBlocked ? 'rgba(239, 68, 68, 0.16)' : 'var(--bg-card)',
                                            color: isGlobalBlocked ? 'var(--accent-danger)' : 'var(--text-secondary)',
                                            position: 'sticky',
                                            top: '48px',
                                            zIndex: 10,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            lineHeight: 1.2,
                                        }}
                                    >
                                        <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            {GERMAN_DAY_SHORT[day]}
                                            {isGlobalBlocked && <Ban size={10} />}
                                        </span>
                                        <span style={{ fontSize: '0.68rem', opacity: 0.9 }}>
                                            {formatShortDate(dayDate)}
                                        </span>
                                    </div>
                                );
                            })
                        ))}

                        {/* --- Data Rows --- */}
                        {state.classes.map(cls => {
                            const grade = getEffectiveGradeLevel(cls, cls.className);
                            return (
                                <React.Fragment key={cls.className}>
                                    {/* Class Name Column */}
                                    <div style={{
                                        position: 'sticky',
                                        left: 0,
                                        zIndex: 5,
                                        background: 'var(--bg-panel)',
                                        borderBottom: '1px solid var(--border-color)',
                                        borderRight: '1px solid var(--border-color)',
                                        padding: '0.75rem 1rem',
                                        fontWeight: 600,
                                        alignContent: 'center'
                                    }}>
                                        <div>{cls.className}</div>
                                        {grade && (
                                            <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                                                Stufe {grade}
                                            </div>
                                        )}
                                    </div>

                                    {/* Day Cells */}
                                    {state.weeks.map(week => (
                                        DAYS_OF_WEEK.map(day => {
                                            const cellExams = state.exams.filter(e =>
                                                e.className === cls.className &&
                                                e.assignedWeekId === week.id &&
                                                e.assignedDay === day
                                            );

                                            const isBlocked =
                                                !!state.blockedDays[week.id]?.[day] ||
                                                week.isBlocked ||
                                                !!state.blockedClassDays?.[cls.className]?.[week.id]?.[day];

                                            const weekSubjects = (week.weekType === 'B' && cls.subjectsB)
                                                ? cls.subjectsB[day] || []
                                                : cls.subjects[day] || [];

                                            const isHighlight =
                                                !!activeDraggable &&
                                                activeDraggable.className === cls.className &&
                                                !isBlocked &&
                                                weekSubjects.includes(activeDraggable.subject);

                                            return (
                                                <div key={`${cls.className}-${week.id}-${day}`} style={{ overflow: 'hidden' }}>
                                                    <DroppableCell
                                                        id={getCellId(cls.className, week.id, day)}
                                                        isBlocked={isBlocked}
                                                        isHighlight={isHighlight}
                                                        onClick={() => onToggleBlockClassDay?.(cls.className, week.id, day)}
                                                    >
                                                        {cellExams.map(exam => {
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
                                                            const teachers = getTeachersForSubjectOnDay(
                                                                cls,
                                                                exam.subject,
                                                                day,
                                                                week.weekType
                                                            );
                                                            return (
                                                                <ExamCard
                                                                    key={exam.id}
                                                                    exam={exam}
                                                                    isValid={check.valid}
                                                                    validationReason={check.reason}
                                                                    validationWarning={check.warning}
                                                                    teachers={teachers}
                                                                    onTogglePin={onTogglePin}
                                                                />
                                                            );
                                                        })}
                                                    </DroppableCell>
                                                </div>
                                            );
                                        })
                                    ))}
                                </React.Fragment>
                            );
                        })}

                    </div>
                </div>

                {/* Sidebar: Unassigned */}
                <div className="card" style={{ width: '250px', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: '8px', padding: '1rem', height: '100%' }}>
                    <h3 style={{ marginBottom: '1rem', fontWeight: 600 }}>Nicht zugewiesen</h3>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        <SidebarDroppable>
                            {state.exams.filter(e => !e.assignedWeekId).map(exam => (
                                <div key={exam.id} style={{ marginBottom: '8px' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{exam.className}</div>
                                    <ExamCard exam={exam} />
                                </div>
                            ))}
                            {state.exams.filter(e => !e.assignedWeekId).length === 0 && (
                                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                                    Alle Klausuren zugewiesen!
                                </div>
                            )}
                        </SidebarDroppable>
                    </div>
                </div>

            </div>

            <DragOverlay>
                {activeDraggable ? <ExamCard exam={activeDraggable} isOverlay /> : null}
            </DragOverlay>
        </DndContext>
    );
}

function SidebarDroppable({ children }: { children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'unassigned'
    });

    return (
        <div ref={setNodeRef} style={{ minHeight: '100%', background: isOver ? 'var(--bg-panel)' : 'transparent', borderRadius: '4px', transition: 'background 0.2s' }}>
            {children}
        </div>
    );
}
