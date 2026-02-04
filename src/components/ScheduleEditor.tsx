import React from 'react';
import { Trash2, Calendar, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { type ClassSchedule, DAYS_OF_WEEK, type DayOfWeek } from '../types';

interface ScheduleEditorProps {
    classes: ClassSchedule[];
    onUpdateClass: (updatedClass: ClassSchedule) => void;
}

export function ScheduleEditor({ classes, onUpdateClass }: ScheduleEditorProps) {
    const [expandedClass, setExpandedClass] = React.useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = React.useState(false);

    const toggleExpand = (className: string) => {
        setExpandedClass(expandedClass === className ? null : className);
    };

    const removeSubject = (className: string, day: DayOfWeek, subjectIndex: number) => {
        const cls = classes.find(c => c.className === className);
        if (!cls) return;

        const newSubjects = { ...cls.subjects };
        const daySubjects = [...(newSubjects[day] || [])];

        daySubjects.splice(subjectIndex, 1);
        newSubjects[day] = daySubjects;

        onUpdateClass({ ...cls, subjects: newSubjects });
    };

    return (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', background: 'var(--bg-card)', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}>
            <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isCollapsed ? 0 : '1rem', cursor: 'pointer' }}
                onClick={() => setIsCollapsed(!isCollapsed)}
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
                        Überprüfe die detaillierten Wochenpläne. Klicke auf das 'Löschen'-Icon, um ein Fach von einem bestimmten Tag zu entfernen (z.B. wenn dort keine Klausur geschrieben werden soll).
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
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                    </button>

                                    {isExpanded && (
                                        <div style={{ padding: '1rem', overflowX: 'auto' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', minWidth: '600px' }}>
                                                {DAYS_OF_WEEK.map(day => (
                                                    <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                                                            {day.replace('Monday', 'Montag').replace('Tuesday', 'Dienstag').replace('Wednesday', 'Mittwoch').replace('Thursday', 'Donnerstag').replace('Friday', 'Freitag').slice(0, 2)}
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                            {(cls.subjects[day] || []).length === 0 && (
                                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>-</span>
                                                            )}
                                                            {cls.subjects[day]?.map((subject, idx) => (
                                                                <div
                                                                    key={`${day}-${idx}`}
                                                                    style={{
                                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                                        background: 'var(--bg-app)', padding: '6px 10px', borderRadius: '4px',
                                                                        fontSize: '0.9rem', border: '1px solid var(--border-color)'
                                                                    }}
                                                                    className="group"
                                                                >
                                                                    <span>{subject}</span>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); removeSubject(cls.className, day, idx); }}
                                                                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                                                                        className="hover-danger"
                                                                        title="Fach von diesem Tag entfernen"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
