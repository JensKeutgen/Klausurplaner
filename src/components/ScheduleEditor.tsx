import React, { useMemo, useState } from 'react';
import { Trash2, Calendar, ChevronDown, ChevronRight, Search, Users } from 'lucide-react';
import { type ClassSchedule, DAYS_OF_WEEK, type DayOfWeek, type Week } from '../types';
import {
    DndContext,
    useDraggable,
    useDroppable,
    DragOverlay,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { getAllSubjectsForClass, getAllTeachersForSubject, getEffectiveGradeLevel } from '../logic/solver';
import { getWeekDateRangeString } from '../logic/dateUtils';

interface ScheduleEditorProps {
    classes: ClassSchedule[];
    weeks?: Week[];
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

export function ScheduleEditor({ classes, weeks = [], onUpdateClass }: ScheduleEditorProps) {
    const [expandedClass, setExpandedClass] = useState<string | null>(null);
    const [selectedWeekByClass, setSelectedWeekByClass] = useState<Record<string, string>>({});
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

    const getActiveWeekKey = (cls: ClassSchedule): string => {
        const saved = selectedWeekByClass[cls.className];
        if (saved && (saved === 'default' || cls.weeklySchedules?.[saved])) {
            return saved;
        }
        const weekIds = Object.keys(cls.weeklySchedules || {});
        if (weekIds.length > 0) {
            const firstInOrder = weeks.find((w) => cls.weeklySchedules?.[w.id])?.id;
            return firstInOrder || weekIds[0];
        }
        return 'default';
    };

    const toggleExpand = (className: string) => {
        setExpandedClass(expandedClass === className ? null : className);
    };

    const removeSubject = (
        className: string,
        day: DayOfWeek,
        subjectIndex: number,
        weekKey: string
    ) => {
        const cls = classes.find((c) => c.className === className);
        if (!cls) return;

        const newCls = { ...cls };

        if (weekKey === 'default') {
            const newSubjects = { ...newCls.subjects };
            const daySubjects = [...(newSubjects[day] || [])];
            daySubjects.splice(subjectIndex, 1);
            newSubjects[day] = daySubjects;
            newCls.subjects = newSubjects;
        } else if (newCls.weeklySchedules?.[weekKey]) {
            const nextWeekly = { ...newCls.weeklySchedules };
            const wData = { ...nextWeekly[weekKey], subjects: { ...nextWeekly[weekKey].subjects } };
            const daySubjects = [...(wData.subjects[day] || [])];
            daySubjects.splice(subjectIndex, 1);
            wData.subjects[day] = daySubjects;
            nextWeekly[weekKey] = wData;
            newCls.weeklySchedules = nextWeekly;
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

        const [, srcClass, srcWeekKey, srcDay, srcIndexStr] = activeParts;
        const [, destClass, destWeekKey, destDay] = overParts;

        if (srcClass !== destClass) return;
        if (srcWeekKey !== destWeekKey) return;
        if (srcDay === destDay) return;

        const cls = classes.find((c) => c.className === srcClass);
        if (!cls) return;

        const srcIndex = parseInt(srcIndexStr, 10);
        const newCls = { ...cls };

        if (srcWeekKey === 'default') {
            const subjectsMap = { ...newCls.subjects };
            const sourceList = [...(subjectsMap[srcDay as DayOfWeek] || [])];
            const subject = sourceList[srcIndex];
            sourceList.splice(srcIndex, 1);
            subjectsMap[srcDay as DayOfWeek] = sourceList;

            const destList = [...(subjectsMap[destDay as DayOfWeek] || [])];
            destList.push(subject);
            subjectsMap[destDay as DayOfWeek] = destList;
            newCls.subjects = subjectsMap;
        } else if (newCls.weeklySchedules?.[srcWeekKey]) {
            const nextWeekly = { ...newCls.weeklySchedules };
            const wData = { ...nextWeekly[srcWeekKey], subjects: { ...nextWeekly[srcWeekKey].subjects } };
            const sourceList = [...(wData.subjects[srcDay as DayOfWeek] || [])];
            const subject = sourceList[srcIndex];
            sourceList.splice(srcIndex, 1);
            wData.subjects[srcDay as DayOfWeek] = sourceList;

            const destList = [...(wData.subjects[destDay as DayOfWeek] || [])];
            destList.push(subject);
            wData.subjects[destDay as DayOfWeek] = destList;
            nextWeekly[srcWeekKey] = wData;
            newCls.weeklySchedules = nextWeekly;
        }

        onUpdateClass(newCls);
    };

    const renderScheduleGrid = (cls: ClassSchedule, weekKey: string) => {
        const weekData = weekKey !== 'default' ? cls.weeklySchedules?.[weekKey] : null;
        const subjectsMap = weekData ? weekData.subjects : cls.subjects;
        const teachersMap = weekData ? weekData.subjectTeachers : cls.subjectTeachers;
        const freeDaysMap = weekData?.freeDays;
        if (!subjectsMap) return null;

        return (
            <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem', minWidth: '620px' }}>
                    {DAYS_OF_WEEK.map((day) => {
                        const freeReason = freeDaysMap?.[day];
                        return (
                            <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div
                                    style={{
                                        fontSize: '0.78rem',
                                        fontWeight: 700,
                                        color: freeReason ? 'var(--holiday-text)' : 'var(--text-secondary)',
                                        paddingBottom: '2px',
                                    }}
                                >
                                    {GERMAN_DAYS[day]}
                                </div>

                                <DroppableDay id={`day::${cls.className}::${weekKey}::${day}`}>
                                    {(subjectsMap[day] || []).length === 0 && (
                                        <span
                                            style={{
                                                fontSize: '0.76rem',
                                                color: freeReason ? 'var(--holiday-text)' : 'var(--text-muted)',
                                                fontStyle: 'italic',
                                            }}
                                        >
                                            {freeReason || '—'}
                                        </span>
                                    )}
                                    {subjectsMap[day]?.map((subject, idx) => {
                                        const teachers = teachersMap?.[day]?.[subject] || [];
                                        const chosenTeacher = cls.examTeacherBySubject?.[subject];
                                        const isPinnedTeacher = Boolean(chosenTeacher && teachers.includes(chosenTeacher));
                                        return (
                                            <DraggableSubject
                                                key={`${weekKey}-${day}-${idx}`}
                                                id={`subject::${cls.className}::${weekKey}::${day}::${idx}::${subject}`}
                                                onDelete={() => removeSubject(cls.className, day, idx, weekKey)}
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
                        );
                    })}
                </div>
            </div>
        );
    };

    if (classes.length === 0) {
        return (
            <div className="ui-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Importiere zuerst Stundenpläne im Tab <strong>1. Import & Zeitraum</strong>, um sie hier zu prüfen oder anzupassen.
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
                            Wähle eine Klasse, um ihren konkreten Unterricht pro Kalenderwoche (inkl. schulfreier Tage) einzusehen oder per Drag & Drop anzupassen.
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
                        const multiSubjects = getAllSubjectsForClass(cls).filter(
                            (s) => getAllTeachersForSubject(cls, s).length >= 2
                        );

                        const fetchedWeekIds = Object.keys(cls.weeklySchedules || {});
                        const orderedWeeks = weeks.filter((w) => cls.weeklySchedules?.[w.id]);
                        const weekOptions =
                            orderedWeeks.length > 0
                                ? orderedWeeks
                                : fetchedWeekIds.map((id) => ({
                                      id,
                                      weekNumber: Number(id.split('KW')[1]) || 0,
                                      year: Number(id.split('-')[0]) || 2026,
                                      isBlocked: false,
                                  }));
                        const activeWeekKey = getActiveWeekKey(cls);

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
                                        {fetchedWeekIds.length > 0 && (
                                            <span
                                                style={{
                                                    fontSize: '0.7rem',
                                                    fontWeight: 700,
                                                    background: 'var(--accent-soft)',
                                                    color: 'var(--accent-primary)',
                                                    padding: '2px 7px',
                                                    borderRadius: '999px',
                                                }}
                                            >
                                                {fetchedWeekIds.length} Wochen exakt
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
                                        {weekOptions.length > 0 && (
                                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
                                                {weekOptions.map((w) => {
                                                    const active = activeWeekKey === w.id;
                                                    return (
                                                        <button
                                                            key={w.id}
                                                            type="button"
                                                            onClick={() =>
                                                                setSelectedWeekByClass((prev) => ({
                                                                    ...prev,
                                                                    [cls.className]: w.id,
                                                                }))
                                                            }
                                                            style={{
                                                                padding: '4px 10px',
                                                                borderRadius: '6px',
                                                                fontSize: '0.76rem',
                                                                fontWeight: active ? 700 : 500,
                                                                border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                                                background: active ? 'var(--accent-soft)' : 'var(--bg-panel)',
                                                                color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                                            }}
                                                        >
                                                            KW {w.weekNumber}{' '}
                                                            <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>
                                                                ({getWeekDateRangeString(w)})
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        {renderScheduleGrid(cls, activeWeekKey)}
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
