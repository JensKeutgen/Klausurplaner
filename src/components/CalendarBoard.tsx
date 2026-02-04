import React from 'react';
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { type AppState, type DayOfWeek, DAYS_OF_WEEK, type Exam } from '../types';
import { ExamCard } from './ExamCard';
import { clsx } from 'clsx';
import { validateMove } from '../logic/solver';

interface CalendarBoardProps {
    state: AppState;
    onMoveExam: (examId: string, weekId: string | null, day: DayOfWeek | null) => void;
    onTogglePin: (examId: string) => void;
}

// Helper component for a droppable cell
function DroppableCell({
    id,
    children,
    isBlocked,
    onClick,
    isHighlight
}: {
    id: string,
    children: React.ReactNode,
    isBlocked: boolean,
    onClick?: () => void,
    isHighlight?: boolean
}) {
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
                minWidth: '50px',
                minHeight: '60px',
                padding: '4px',
                background: bgStyle,
                borderRight: '1px solid var(--border-color)',
                borderBottom: '1px solid var(--border-color)',
                opacity: isBlocked ? 0.5 : 1,
                boxShadow: isHighlight ? 'inset 0 0 0 1px rgba(34, 197, 94, 0.3)' : 'none'
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



    // Using a saver parser
    const getCellId = (className: string, weekId: string, day: string) => `cell::${className}::${weekId}::${day}`;

    const parseCellId = (id: string) => {
        if (!id.startsWith('cell::')) return null;
        const parts = id.split('::');
        return { className: parts[1], weekId: parts[2], day: parts[3] as DayOfWeek };
    };

    // Custom onDragEnd wrapper to use the parser
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
            // Verify class match (Constraint: Can only drop into own class row)
            if (parsed.className !== exam.className) {
                // Reject drop (visually handled by not doing anything, or show error?)
                // Ideally UI prevents this, but here we just ignore.
                return;
            }
            onMoveExam(exam.id, parsed.weekId, parsed.day);
        }
    };

    return (
        <DndContext onDragStart={handleDragStart} onDragEnd={onDragEnd}>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', alignItems: 'start' }}>

                {/* Main Grid */}
                <div className="card" style={{ flex: 1, overflow: 'auto', background: 'var(--bg-card)', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ minWidth: 'fit-content' }}>

                        {/* Header Container */}
                        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)' }}>
                            {/* Weeks Header */}
                            <div style={{ display: 'flex' }}>
                                <div style={{ width: '150px', flexShrink: 0, padding: '1rem', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', fontWeight: 'bold' }}>
                                    Klasse
                                </div>
                                {state.weeks.map(week => (
                                    <div key={week.id} style={{ flex: 1, borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'center' }}>
                                        <div style={{ padding: '0.5rem', background: week.isBlocked ? 'rgba(239, 68, 68, 0.1)' : 'transparent', color: week.isBlocked ? 'var(--accent-danger)' : 'inherit' }}>
                                            KW {week.weekNumber}
                                        </div>
                                        <div style={{ display: 'flex' }}>
                                            {DAYS_OF_WEEK.map(day => (
                                                <div key={day} style={{ flex: 1, minWidth: '50px', fontSize: '0.75rem', padding: '4px', borderRight: '1px solid var(--border-color)', opacity: 0.7 }}>
                                                    {day.replace('Monday', 'Mo').replace('Tuesday', 'Di').replace('Wednesday', 'Mi').replace('Thursday', 'Do').replace('Friday', 'Fr')}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Rows */}
                        {state.classes.map(cls => (
                            <div key={cls.className} style={{ display: 'flex' }}>
                                {/* Row Header */}
                                <div style={{ width: '150px', flexShrink: 0, padding: '1rem', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', fontWeight: 600, background: 'var(--bg-panel)', position: 'sticky', left: 0, zIndex: 5 }}>
                                    {cls.className}
                                </div>

                                {/* Cells */}
                                {state.weeks.map(week => (
                                    <div key={week.id} style={{ flex: 1, display: 'flex' }}>
                                        {DAYS_OF_WEEK.map(day => {
                                            // Find exams in this cell
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

                                            // Validation check for exams in this cell
                                            // We check if the exam placed here is valid

                                            return (
                                                <div key={day} style={{ flex: 1, minWidth: '50px' }}>
                                                    <DroppableCell
                                                        id={getCellId(cls.className, week.id, day)}
                                                        isBlocked={isBlocked}
                                                        isHighlight={isHighlight}
                                                        onClick={() => onToggleBlockClassDay?.(cls.className, week.id, day)}
                                                    >
                                                        {cellExams.map(exam => {
                                                            // Validate this specific exam
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
                                        })}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Sidebar: Unassigned */}
                <div className="card" style={{ width: '250px', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: '8px', padding: '1rem' }}>
                    <h3 style={{ marginBottom: '1rem', fontWeight: 600 }}>Nicht zugewiesen</h3>

                    {/* Drop Zone for Unassigning */}
                    {/* We make the whole list droppable to "Unassign" */}
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
