import React from 'react';
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { type AppState, type DayOfWeek, DAYS_OF_WEEK, type Exam } from '../types';
import { ExamCard } from './ExamCard';
import { clsx } from 'clsx';
import { validateMove } from '../logic/solver';

interface DroppableCellProps {
    id: string;
    children: React.ReactNode;
    isBlocked: boolean;
    onClick?: () => void;
    isHighlight?: boolean;
}

// Helper component for a droppable cell
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
            ? 'rgba(34, 197, 94, 0.15)' // Green tint
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
                minHeight: '60px',
                padding: '4px',
                background: bgStyle,
                borderRight: '1px solid var(--border-color)',
                borderBottom: '1px solid var(--border-color)',
                opacity: isBlocked ? 0.5 : 1,
                boxShadow: isHighlight ? 'inset 0 0 0 1px rgba(34, 197, 94, 0.3)' : 'none',
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
}

export function CalendarBoard({ state, onMoveExam, onTogglePin, onToggleBlockClassDay }: CalendarBoardProps) {
    const [activeDraggable, setActiveDraggable] = React.useState<Exam | null>(null);

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

    // Calculate grid columns: 150px (Class) + (Weeks * 5) * 1fr
    // Actually we want minmax for the days to ensure they don't get too small
    const totalDays = state.weeks.length * 5;
    const gridTemplateColumns = `150px repeat(${totalDays}, minmax(60px, 1fr))`;

    return (
        <DndContext onDragStart={handleDragStart} onDragEnd={onDragEnd}>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', alignItems: 'start', height: 'calc(100vh - 200px)' }}>

                {/* Main Grid Container */}
                <div className="card" style={{
                    flex: 1,
                    overflow: 'auto',
                    background: 'var(--bg-card)',
                    borderRadius: '8px',
                    height: '100%',
                    position: 'relative' // For sticky headers
                }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: gridTemplateColumns,
                        // gridTemplateRows: 'auto auto repeat(auto-fill, minmax(60px, 1fr))', // Dynamic rows
                        minWidth: 'fit-content' // Allow horizontal scroll if grid is too wide
                    }}>

                        {/* --- Header Row 1: Weeks --- */}
                        <div style={{
                            position: 'sticky',
                            top: 0,
                            left: 0,
                            zIndex: 20,
                            background: 'var(--bg-card)',
                            borderBottom: '1px solid var(--border-color)',
                            borderRight: '1px solid var(--border-color)',
                            padding: '1rem',
                            fontWeight: 'bold',
                            gridColumn: '1 / 2',
                            gridRow: '1 / 3', // Span 2 rows (covering Day header row height)
                            alignContent: 'center'
                        }}>
                            Klasse
                        </div>

                        {state.weeks.map((week, index) => (
                            <div key={week.id} style={{
                                gridColumn: `${2 + index * 5} / span 5`,
                                gridRow: '1 / 2',
                                textAlign: 'center',
                                padding: '0.5rem',
                                background: 'var(--bg-card)',
                                borderBottom: '1px solid var(--border-color)',
                                borderRight: '1px solid var(--border-color)',
                                position: 'sticky',
                                top: 0,
                                zIndex: 10,
                                color: week.isBlocked ? 'var(--accent-danger)' : 'inherit'
                            }}>
                                KW {week.weekNumber}
                            </div>
                        ))}

                        {/* --- Header Row 2: Days --- */}
                        {state.weeks.map((week) => (
                            DAYS_OF_WEEK.map((day) => (
                                <div key={`${week.id}-${day}`} style={{
                                    textAlign: 'center',
                                    fontSize: '0.75rem',
                                    padding: '4px',
                                    borderBottom: '1px solid var(--border-color)',
                                    borderRight: '1px solid var(--border-color)',
                                    background: 'var(--bg-card)',
                                    position: 'sticky',
                                    top: '36px', // Approx height of first header row. Caution: Magic number.
                                    zIndex: 10,
                                    opacity: 0.7
                                }}>
                                    {day === 'Tuesday' ? 'Di' : day === 'Wednesday' ? 'Mi' : day === 'Thursday' ? 'Do' : day.slice(0, 2)}
                                </div>
                            ))
                        ))}

                        {/* --- Data Rows --- */}
                        {state.classes.map(cls => (
                            <React.Fragment key={cls.className}>
                                {/* Class Name Column */}
                                <div style={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 5,
                                    background: 'var(--bg-panel)',
                                    borderBottom: '1px solid var(--border-color)',
                                    borderRight: '1px solid var(--border-color)',
                                    padding: '1rem',
                                    fontWeight: 600,
                                    alignContent: 'center'
                                }}>
                                    {cls.className}
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

                                        const isHighlight =
                                            !!activeDraggable &&
                                            activeDraggable.className === cls.className &&
                                            !isBlocked &&
                                            (cls.subjects[day] || []).includes(activeDraggable.subject);

                                        return (
                                            <div key={`${cls.className}-${week.id}-${day}`} style={{ overflow: 'hidden' }}>
                                                <DroppableCell
                                                    id={getCellId(cls.className, week.id, day)}
                                                    isBlocked={isBlocked}
                                                    isHighlight={isHighlight}
                                                    onClick={() => onToggleBlockClassDay?.(cls.className, week.id, day)}
                                                >
                                                    {cellExams.map(exam => {
                                                        const check = validateMove(exam, week.id, day, state.exams, cls, state.blockedDays);
                                                        return (
                                                            <ExamCard
                                                                key={exam.id}
                                                                exam={exam}
                                                                isValid={check.valid}
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
                        ))}

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
