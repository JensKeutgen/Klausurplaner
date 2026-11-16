import React, { useMemo, useState } from 'react';
import { Trash2, Calendar, ChevronDown, ChevronRight, Search, Users } from 'lucide-react';
import { type ClassSchedule, DAYS_OF_WEEK, type DayOfWeek } from '../types';
import {
    DndContext,
    useDraggable,
    useDroppable,
    DragOverlay,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { getAllTeachersForSubject, getEffectiveGradeLevel } from '../logic/solver';

interface ScheduleEditorProps {
    classes: ClassSchedule[];
    onUpdateClass: (updatedClass: ClassSchedule) => void;
}

function DraggableSubject({
    id,
    children,
    onDelete,
    isPinnedTeacher,
}: {
    id: string;
    children: React.ReactNode;
    onDelete: () => void;
    isPinnedTeacher?: boolean;
}) {
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
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: isPinnedTeacher ? 'var(--accent-soft)' : 'var(--bg-surface)',
                    padding: '6px 9px',
                    borderRadius: '6px',
                    fontSize: '0.84rem',
                    border: `1px solid ${isPinnedTeacher ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    cursor: 'grab',
                    gap: '6px',
                }}
            >
                <span style={{ minWidth: 0 }}>{children}</span>
                <button
                    type="button"
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        flexShrink: 0,
                    }}
                    title="Fach von diesem Tag entfernen"
                >
                    <Trash2 size={13} />
                </button>
            </div>
        </div>
    );
}

function DroppableDay({ id, children }: { id: string; children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({ id });

    return (
        <div
            ref={setNodeRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                minHeight: '36px',
                background: isOver ? 'var(--accent-soft)' : 'var(--bg-panel)',
                borderRadius: '8px',
                border: `1px solid ${isOver ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                transition: 'background 0.15s, border-color 0.15s',
                padding: '6px',
            }}
        >
            {children}
        </div>
    );
}

const GERMAN_DAYS: Record<DayOfWeek, string> = {
    Monday: 'Montag',
    Tuesday: 'Dienstag',
    Wednesday: 'Mittwoch',
    Thursday: 'Donnerstag',
    Friday: 'Freitag',
};

export function ScheduleEditor({ classes, onUpdateClass }: ScheduleEditorProps) {
    const [expandedClass, setExpandedClass] = useState<string | null>(null);
    const [activeSubjectName, setActiveSubjectName] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [gradeFilter, setGradeFilter] = useState('Alle');

    const grades = useMemo(() => {
        const set = new Set<string>();
        classes.forEach((c) => {
            const g = getEffectiveGradeLevel(c, c.className);
            if (g) set.add(g);
        });
        return ['Alle', ...Array.from(set).sort()];
    }, [classes]);

    const visibleClasses = useMemo(() => {
        const q = search.trim().toLowerCase();
        return [...classes]
            .filter((c) => {
                const g = getEffectiveGradeLevel(c, c.className);
                const matchesSearch = !q || c.className.toLowerCase().includes(q) || g.toLowerCase().includes(q);
                const matchesGrade = gradeFilter === 'Alle' || g === gradeFilter;
                return matchesSearch && matchesGrade;
            })
            .sort((a, b) => a.className.localeCompare(b.className));
    }, [classes, search, gradeFilter]);

    const toggleExpand = (className: string) => {
        setExpandedClass(expandedClass === className ? null : className);
    };

    const removeSubject = (
        className: string,
        day: DayOfWeek,
        subjectIndex: number,
        weekType: 'A' | 'B'
    ) => {
        const cls = classes.find((c) => c.className === className);
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

        const cls = classes.find((c) => c.className === srcClass);
        if (!cls) return;

        const srcIndex = parseInt(srcIndexStr, 10);
        const newCls = { ...cls };
        const weekType = srcWeekType as 'A' | 'B';

        const subjectsMap =
            weekType === 'A' ? { ...newCls.subjects } : { ...(newCls.subjectsB || {}) };

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
            <div style={{ marginBottom: '1rem' }}>
                <div
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: weekType === 'A' ? 'var(--accent-primary)' : 'var(--accent-purple)',
                        marginBottom: '0.5rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                    }}
                >
                    Woche {weekType}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem', minWidth: '620px' }}>
                    {DAYS_OF_WEEK.map((day) => (
                        <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div
                                style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    color: 'var(--text-secondary)',
                                    paddingBottom: '2px',
                                }}
                            >
                                {GERMAN_DAYS[day]}
                            </div>

                            <DroppableDay id={`day::${cls.className}::${weekType}::${day}`}>
                                {(subjectsMap[day] || []).length === 0 && (
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                        —
                                    </span>
                                )}
                                {subjectsMap[day]?.map((subject, idx) => {
                                    const teachers = (weekType === 'B' ? cls.subjectTeachersB : cls.subjectTeachers)?.[day]?.[subject] || [];
                                    const chosenTeacher = cls.examTeacherBySubject?.[subject];
                                    const isPinnedTeacher = Boolean(chosenTeacher && teachers.includes(chosenTeacher));
                                    return (
                                        <DraggableSubject
                                            key={`${weekType}-${day}-${idx}`}
                                            id={`subject::${cls.className}::${weekType}::${day}::${idx}::${subject}`}
                                            onDelete={() => removeSubject(cls.className, day, idx, weekType)}
                                            isPinnedTeacher={isPinnedTeacher}
                                        >
                                            <span>
                                                <strong>{subject}</strong>
                                                {teachers.length > 0 && (
                                                    <span
                                                        style={{
                                                            fontSize: '0.72rem',
                                                            color: isPinnedTeacher ? 'var(--accent-primary)' : 'var(--text-muted)',
                                                            marginLeft: '5px',
                                                            fontWeight: isPinnedTeacher ? 700 : 400,
                                                        }}
                                                    >
                                                        ({teachers.join(', ')})
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

    if (classes.length === 0) {
        return (
            <div className="ui-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Importiere zuerst Stundenpläne im Tab <strong>1. Import & Ferien</strong>, um sie hier zu prüfen oder anzupassen.
            </div>
        );
    }

    return (
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="ui-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Calendar size={19} color="var(--accent-primary)" />
                            Stundenpläne & Stufen prüfen ({classes.length} Klassen)
                        </h3>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            Klicke eine Klasse an, um Stunden per Drag & Drop zu verschieben. Die <strong>Stufe</strong> steuert gemeinsame Klausurwochen pro Fach.
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ position: 'relative', width: '190px' }}>
                            <Search
                                size={14}
                                style={{
                                    position: 'absolute',
                                    left: '9px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: 'var(--text-muted)',
                                }}
                            />
                            <input
                                type="text"
                                className="ui-input"
                                placeholder="Klasse suchen..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                style={{ paddingLeft: '28px', fontSize: '0.82rem' }}
                            />
                        </div>
                        <select
                            className="ui-input"
                            style={{ width: 'auto', fontSize: '0.82rem' }}
                            value={gradeFilter}
                            onChange={(e) => setGradeFilter(e.target.value)}
                        >
                            {grades.map((g) => (
                                <option key={g} value={g}>
                                    {g === 'Alle' ? 'Alle Stufen' : `Stufe ${g}`}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {visibleClasses.map((cls) => {
                        const isExpanded = expandedClass === cls.className;
                        const effectiveGrade = getEffectiveGradeLevel(cls, cls.className);
                        const pinnedEntries = Object.entries(cls.examTeacherBySubject || {});
                        const multiSubjects = Array.from(
                            new Set([
                                ...Object.values(cls.subjects).flat(),
                                ...(cls.subjectsB ? Object.values(cls.subjectsB).flat() : []),
                            ])
                        ).filter((s) => getAllTeachersForSubject(cls, s).length >= 2);

                        return (
                            <div
                                key={cls.className}
                                style={{
                                    border: `1px solid ${isExpanded ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                                    borderRadius: '10px',
                                    overflow: 'hidden',
                                    background: 'var(--bg-surface)',
                                }}
                            >
                                <div
                                    onClick={() => toggleExpand(cls.className)}
                                    style={{
                                        width: '100%',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '0.75rem 1rem',
                                        background: 'var(--bg-panel)',
                                        color: 'var(--text-primary)',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        gap: '0.75rem',
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{cls.className}</span>
                                        {cls.subjectsB && (
                                            <span
                                                style={{
                                                    fontSize: '0.7rem',
                                                    fontWeight: 700,
                                                    background: 'var(--accent-purple-soft)',
                                                    color: 'var(--accent-purple)',
                                                    padding: '2px 7px',
                                                    borderRadius: '999px',
                                                }}
                                            >
                                                A/B Woche
                                            </span>
                                        )}
                                        {pinnedEntries.length > 0 && (
                                            <span
                                                style={{
                                                    fontSize: '0.72rem',
                                                    color: 'var(--accent-primary)',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    background: 'var(--accent-soft)',
                                                    padding: '2px 7px',
                                                    borderRadius: '999px',
                                                }}
                                                title="Gewählte Klausur-Lehrkräfte (im Tab 2 änderbar)"
                                            >
                                                <Users size={11} />
                                                {pinnedEntries.map(([s, t]) => `${s}: ${t}`).join(' · ')}
                                            </span>
                                        )}
                                        {pinnedEntries.length === 0 && multiSubjects.length > 0 && (
                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                ({multiSubjects.length} Fächer mit mehreren Lehrkräften)
                                            </span>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                fontSize: '0.78rem',
                                                color: 'var(--text-secondary)',
                                            }}
                                        >
                                            <span>Stufe:</span>
                                            <input
                                                type="text"
                                                className="ui-input"
                                                value={cls.gradeLevel ?? effectiveGrade}
                                                onChange={(e) => onUpdateClass({ ...cls, gradeLevel: e.target.value })}
                                                title="Stufe für gemeinsame Wochen-Gruppierung bearbeiten"
                                                style={{
                                                    width: '72px',
                                                    padding: '3px 6px',
                                                    fontSize: '0.78rem',
                                                    textAlign: 'center',
                                                }}
                                            />
                                        </div>
                                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div style={{ padding: '1rem', overflowX: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
                                        {renderScheduleGrid(cls, 'A')}
                                        {cls.subjectsB && (
                                            <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '0.75rem 0' }} />
                                        )}
                                        {cls.subjectsB && renderScheduleGrid(cls, 'B')}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            <DragOverlay>
                {activeSubjectName ? (
                    <div
                        style={{
                            padding: '6px 10px',
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: '6px',
                            boxShadow: 'var(--shadow-lg)',
                            fontWeight: 700,
                        }}
                    >
                        {activeSubjectName}
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
