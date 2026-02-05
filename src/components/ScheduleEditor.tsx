import React from 'react';
import { Trash2, Calendar, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { type ClassSchedule, DAYS_OF_WEEK, type DayOfWeek } from '../types';
import { DndContext, useDraggable, useDroppable, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

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
                    onPointerDown={(e) => { e.stopPropagation(); onDelete(); }} // Use onPointerDown to prevent drag start
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
                minHeight: '30px', // Ensure drop target has height even if empty
                background: isOver || isOverProp ? 'var(--bg-panel)' : 'transparent',
                borderRadius: '44px',
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
    const [activeId, setActiveId] = React.useState<string | null>(null);
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
        setActiveId(event.active.id as string);
        // ID format: subject::{className}::{weekType}::{day}::{index}::{subjectName}
        // Actually, we can just pass the subject name in separate state or extract it from ID if we encode it.
        // Let's encode it at the end.
        const parts = (event.active.id as string).split('::');
        if (parts.length >= 6) {
            setActiveSubjectName(parts[5]);
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);
        setActiveSubjectName(null);

        if (!over) return;

        const activeIdStr = active.id as string;
        const overIdStr = over.id as string;

        // active: subject::{className}::{weekType}::{day}::{index}::{subjectName}
        // over: day::{className}::{weekType}::{day}

        const activeParts = activeIdStr.split('::');
        const overParts = overIdStr.split('::');

        if (activeParts.length < 5 || overParts.length < 4) return;

        const [_, srcClass, srcWeekType, srcDay, srcIndexStr] = activeParts;
        const [__, destClass, destWeekType, destDay] = overParts;

        if (srcClass !== destClass) return; // Prevent cross-class dragging for now
        if (srcWeekType !== destWeekType) return; // Prevent cross-week dragging for now

        if (srcDay === destDay) return; // Dropped on same day

        const cls = classes.find(c => c.className === srcClass);
        if (!cls) return;

        const srcIndex = parseInt(srcIndexStr);
        const newCls = { ...cls };
        const weekType = srcWeekType as 'A' | 'B';

        const subjectsMap = weekType === 'A'
            ? { ...newCls.subjects }
            : { ...(newCls.subjectsB || {}) };

        // Remove from source
        const sourceList = [...(subjectsMap[srcDay as DayOfWeek] || [])];
        const subject = sourceList[srcIndex];
        sourceList.splice(srcIndex, 1);
        subjectsMap[srcDay as DayOfWeek] = sourceList;

        // Add to dest
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

                            <DroppableDay
                                id={`day::${cls.className}::${weekType}::${day}`}
                            >
                                {(subjectsMap[day] || []).length === 0 && (
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic', pointerEvents: 'none' }}>-</span>
                                )}
                                {subjectsMap[day]?.map((subject, idx) => (
                                    <DraggableSubject
                                        key={`${weekType}-${day}-${idx}`}
                                        id={`subject::${cls.className}::${weekType}::${day}::${idx}::${subject}`}
                                        onDelete={() => removeSubject(cls.className, day, idx, weekType)}
                                    >
                                        {subject}
                                    </DraggableSubject>
                                ))}
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
                        Stundenpläne prüfen
                    </h2>
                    <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                        {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                    </button>
                </div>

                {!isCollapsed && (
                    <>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            Überprüfe die detaillierten Wochenpläne. Du kannst Fächer per Drag & Drop verschieben oder mit dem Mülleimer-Icon entfernen.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {classes.map(cls => {
                                const isExpanded = expandedClass === cls.className;
                                return (
                                    <div key={cls.className} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleExpand(cls.className); }}
                                            style={{
                                                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '1rem', background: 'var(--bg-panel)', border: 'none',
                                                color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer'
                                            }}
                                        >
                                            <span>{cls.className}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                {cls.subjectsB && (
                                                    <span style={{ fontSize: '0.75rem', background: 'var(--accent-secondary)', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>A/B Woche</span>
                                                )}
                                                {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                            </div>
                                        </button>

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
