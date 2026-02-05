import { useMemo } from 'react';
import { BookOpen, CheckSquare, Square, ChevronUp, ChevronDown } from 'lucide-react';
import type { ClassSchedule } from '../types';

interface SubjectSelectionProps {
    classes: ClassSchedule[];
    selectedSubjects: Record<string, string[]>; // className -> subject[]
    onUpdateSelection: (selection: Record<string, string[]>) => void;
    isCollapsed: boolean;
    onToggle: () => void;
}

export function SubjectSelection({ classes, selectedSubjects, onUpdateSelection, isCollapsed, onToggle }: SubjectSelectionProps) {

    // Extract all unique subjects per class
    const classSubjects = useMemo(() => {
        const map: Record<string, string[]> = {};
        for (const cls of classes) {
            const unique = Array.from(new Set(
                Object.values(cls.subjects).flat()
            )).sort();
            map[cls.className] = unique;
        }
        return map;
    }, [classes]);

    const toggleSubject = (className: string, subject: string) => {
        const currentSelected = selectedSubjects[className] || [];
        const isSelected = currentSelected.includes(subject);

        let newClassSelected;
        if (isSelected) {
            newClassSelected = currentSelected.filter(s => s !== subject);
        } else {
            newClassSelected = [...currentSelected, subject];
        }

        onUpdateSelection({
            ...selectedSubjects,
            [className]: newClassSelected
        });
    };

    const toggleClassAll = (className: string) => {
        const allSubjects = classSubjects[className] || [];
        const currentSelected = selectedSubjects[className] || [];

        if (currentSelected.length === allSubjects.length) {
            // Unselect all
            onUpdateSelection({
                ...selectedSubjects,
                [className]: []
            });
        } else {
            // Select all
            onUpdateSelection({
                ...selectedSubjects,
                [className]: allSubjects
            });
        }
    };

    return (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', background: 'var(--bg-card)', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}>
            <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isCollapsed ? 0 : '1rem', cursor: 'pointer' }}
                onClick={onToggle}
            >
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <BookOpen size={24} style={{ color: 'var(--accent-primary)' }} />
                    Klausurfächer auswählen
                </h2>
                <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                    {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                </button>
            </div>

            {!isCollapsed && (
                <>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                        Entferne den Haken bei Fächern, in denen keine Klausur geschrieben werden soll.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                        {classes.map(cls => {
                            const allSubjects = classSubjects[cls.className] || [];
                            const selected = selectedSubjects[cls.className] || [];
                            const isAllSelected = selected.length === allSubjects.length;

                            return (
                                <div key={cls.className} style={{ background: 'var(--bg-panel)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                    <div
                                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}
                                    >
                                        <span style={{ fontWeight: 600 }}>{cls.className}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleClassAll(cls.className); }}
                                            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer' }}
                                            className="hover-opacity"
                                        >
                                            {isAllSelected ? 'Alle abwählen' : 'Alle auswählen'}
                                        </button>
                                    </div>

                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {allSubjects.map(sub => {
                                            const isChecked = selected.includes(sub);
                                            return (
                                                <button
                                                    key={sub}
                                                    onClick={(e) => { e.stopPropagation(); toggleSubject(cls.className, sub); }}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                        padding: '4px 8px',
                                                        borderRadius: '4px',
                                                        border: '1px solid',
                                                        borderColor: isChecked ? 'var(--accent-primary)' : 'var(--border-color)',
                                                        background: isChecked ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                                        color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                        fontSize: '0.85rem',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.1s'
                                                    }}
                                                >
                                                    {isChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                                                    {sub}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
