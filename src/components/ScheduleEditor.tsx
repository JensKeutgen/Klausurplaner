import React from 'react';
import { Trash2, Calendar, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { type ClassSchedule, DAYS_OF_WEEK, type DayOfWeek } from '../types';
import { DndContext, useDraggable, useDroppable, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { getEffectiveGradeLevel } from '../logic/solver';

interface ScheduleEditorProps {
    classes: ClassSchedule[];
    onUpdateClass: (updatedClass: ClassSchedule) => void;
    isCollapsed: boolean;
    onToggle: () => void;
}

function DraggableSubject({ id, children, onDelete }: { id: string, children: React.ReactNode, onDelete: () => void }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        touchAction: 'none',
        zIndex: isDragging ? 999 : 'auto',
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <div
                style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--bg-app)', padding: '6px 10px', borderRadius: '4px',
                    fontSize: '0.9rem', border: '1px solid var(--border-color)',
                    cursor: 'grab'
                }}
                className="group"
            >
                <span>{children}</span>
                <button
                    onPointerDown={(e) => { e.stopPropagation(); onDelete(); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    className="hover-danger"
                    title="Fach von diesem Tag entfernen"
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
}

function DroppableDay({ id, children, isOverProp }: { id: string, children: React.ReactNode, isOverProp?: boolean }) {
    const { setNodeRef, isOver } = useDroppable({ id });

    return (
        <div
            ref={setNodeRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                minHeight: '30px',
                background: isOver || isOverProp ? 'var(--bg-panel)' : 'transparent',
                borderRadius: '8px',
                transition: 'background 0.2s',
                padding: '4px'
            }}
        >
            {children}
        </div>
    );
}

export function ScheduleEditor({ classes, onUpdateClass, isCollapsed, onToggle }: ScheduleEditorProps) {
    const [expandedClass, setExpandedClass] = React.useState<string | null>(null);
    const [activeSubjectName, setActiveSubjectName] = React.useState<string | null>(null);

    const toggleExpand = (className: string) => {
        setExpandedClass(expandedClass === className ? null : className);
    };

    const removeSubject = (className: string, day: DayOfWeek, subjectIndex: number, weekType: 'A' | 'B') => {
        const cls = classes.find(c => c.className === className);
        if (!cls) return;

        const newCls = { ...cls };

        if (weekType === 'A') {
            const newSubjects = { ...newCls.subjects };
            const daySubjects = [...(newSubjects[day] || [])];
            daySubjects.splice(subjectIndex, 1);
            newSubjects[day] = daySubjects;
            newCls.subjects = newSubjects;
        } else {
            if (!newCls.subjectsB) return;
            const newSubjectsB = { ...newCls.subjectsB };
            const daySubjects = [...(newSubjectsB[day] || [])];
            daySubjects.splice(subjectIndex, 1);
            newSubjectsB[day] = daySubjects;
            newCls.subjectsB = newSubjectsB;
        }

        onUpdateClass(newCls);
    };

    const handleDragStart = (event: DragStartEvent) => {
        const parts = (event.active.id as string).split('::');
        if (parts.length >= 6) {
            setActiveSubjectName(parts[5]);
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveSubjectName(null);
        if (!over) return;

        const activeParts = (active.id as string).split('::');
        const overParts = (over.id as string).split('::');

        if (activeParts.length < 5 || overParts.length < 4) return;

        const [, srcClass, srcWeekType, srcDay, srcIndexStr] = activeParts;
        const [, destClass, destWeekType, destDay] = overParts;

        if (srcClass !== destClass) return;
        if (srcWeekType !== destWeekType) return;
        if (srcDay === destDay) return;

        const cls = classes.find(c => c.className === srcClass);
        if (!cls) return;

        const srcIndex = parseInt(srcIndexStr);
        const newCls = { ...cls };
        const weekType = srcWeekType as 'A' | 'B';

        const subjectsMap = weekType === 'A'
            ? { ...newCls.subjects }
            : { ...(newCls.subjectsB || {}) };

        const sourceList = [...(subjectsMap[srcDay as DayOfWeek] || [])];
        const subject = sourceList[srcIndex];
        sourceList.splice(srcIndex, 1);
        subjectsMap[srcDay as DayOfWeek] = sourceList;

        const destList = [...(subjectsMap[destDay as DayOfWeek] || [])];
        destList.push(subject);
        subjectsMap[destDay as DayOfWeek] = destList;

        if (weekType === 'A') {
            newCls.subjects = subjectsMap as Record<DayOfWeek, string[]>;
        } else {
            newCls.subjectsB = subjectsMap as Record<DayOfWeek, string[]>;
        }

        onUpdateClass(newCls);
    };

    const renderScheduleGrid = (cls: ClassSchedule, weekType: 'A' | 'B') => {
        const subjectsMap = weekType === 'A' ? cls.subjects : cls.subjectsB;
        if (!subjectsMap) return null;

        return (
            <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Woche {weekType}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', minWidth: '600px' }}>
                    {DAYS_OF_WEEK.map(day => (
                        <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                                {day.replace('Monday', 'Montag').replace('Tuesday', 'Dienstag').replace('Wednesday', 'Mittwoch').replace('Thursday', 'Donnerstag').replace('Friday', 'Freitag').slice(0, 2)}
                            </div>

                            <DroppableDay id={`day::${cls.className}::${weekType}::${day}`}>
                                {(subjectsMap[day] || []).length === 0 && (
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic', pointerEvents: 'none' }}>-</span>
                                )}
                                {subjectsMap[day]?.map((subject, idx) => {
                                    const teachers = (weekType === 'B' ? cls.subjectTeachersB : cls.subjectTeachers)?.[day]?.[subject];
                                    return (
                                        <DraggableSubject
                                            key={`${weekType}-${day}-${idx}`}
                                            id={`subject::${cls.className}::${weekType}::${day}::${idx}::${subject}`}
                                            onDelete={() => removeSubject(cls.className, day, idx, weekType)}
                                        >
                                            <span>
                                                {subject}
                                                {teachers && teachers.length > 0 && (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                                                        ({teachers.join(',')})
                                                    </span>
                                                )}
                                            </span>
                                        </DraggableSubject>
                                    );
                                })}
                            </DroppableDay>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', background: 'var(--bg-card)', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}>
                <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isCollapsed ? 0 : '1rem', cursor: 'pointer' }}
                    onClick={onToggle}
                >
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                        <Calendar size={24} style={{ color: 'var(--accent-primary)' }} />
                        Stundenpläne & Stufen prüfen
                    </h2>
                    <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                        {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                    </button>
                </div>

                {!isCollapsed && (
                    <>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            Überprüfe die Wochenpläne und die automatisch erkannte <strong>Stufe</strong> (für gemeinsame Klausurwochen pro Fach).
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {classes.map(cls => {
                                const isExpanded = expandedClass === cls.className;
                                const effectiveGrade = getEffectiveGradeLevel(cls, cls.className);
                                return (
                                    <div key={cls.className} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                        <div
                                            onClick={(e) => { e.stopPropagation(); toggleExpand(cls.className); }}
                                            style={{
                                                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '0.85rem 1rem', background: 'var(--bg-panel)',
                                                color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', gap: '0.75rem'
                                            }}
                                        >
                                            <span>{cls.className}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <div
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}
                                                >
                                                    <span>Stufe:</span>
                                                    <input
                                                        type="text"
                                                        value={cls.gradeLevel ?? effectiveGrade}
                                                        onChange={(e) => onUpdateClass({ ...cls, gradeLevel: e.target.value })}
                                                        title="Stufe für gemeinsame Wochen-Gruppierung bearbeiten"
                                                        style={{
                                                            width: '68px',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            border: '1px solid var(--border-color)',
                                                            background: 'var(--bg-app)',
                                                            color: 'var(--text-primary)',
                                                            fontSize: '0.78rem',
                                                            textAlign: 'center',
                                                        }}
                                                    />
                                                </div>
                                                {cls.subjectsB && (
                                                    <span style={{ fontSize: '0.75rem', background: '#8b5cf6', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>A/B Woche</span>
                                                )}
                                                {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div style={{ padding: '1rem', overflowX: 'auto' }}>
                                                {renderScheduleGrid(cls, 'A')}
                                                {cls.subjectsB && <div style={{ height: '1px', background: 'var(--border-color)', margin: '1rem 0' }}></div>}
                                                {cls.subjectsB && renderScheduleGrid(cls, 'B')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
            <DragOverlay>
                {activeSubjectName ? (
                    <div
                        style={{
                            padding: '6px 10px',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: '4px',
                            boxShadow: 'var(--shadow-lg)',
                            fontWeight: 600
                        }}
                    >
                        {activeSubjectName}
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
