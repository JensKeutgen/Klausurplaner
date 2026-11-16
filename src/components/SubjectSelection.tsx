import { useMemo, useState } from 'react';
import { BookOpen, Check, Clock, Users, CheckSquare, Square } from 'lucide-react';
import type { ClassSchedule, SubjectTimingPreference } from '../types';
import { getAllTeachersForSubject, getEffectiveGradeLevel } from '../logic/solver';

interface SubjectSelectionProps {
    classes: ClassSchedule[];
    selectedSubjects: Record<string, string[]>;
    onUpdateSelection: (selection: Record<string, string[]>) => void;
    onUpdateClass: (updatedClass: ClassSchedule) => void;
    classSubjectTiming: Record<string, Record<string, SubjectTimingPreference>>;
    onUpdateClassSubjectTiming: (
        timing: Record<string, Record<string, SubjectTimingPreference>>
    ) => void;
}

export function SubjectSelection({
    classes,
    selectedSubjects,
    onUpdateSelection,
    onUpdateClass,
    classSubjectTiming,
    onUpdateClassSubjectTiming,
}: SubjectSelectionProps) {
    const [gradeFilter, setGradeFilter] = useState<string>('Alle');
    const [onlyMultiTeacher, setOnlyMultiTeacher] = useState(false);

    // Map className -> Set of taught subjects (A + B)
    const classTaughtMap = useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const cls of classes) {
            const set = new Set<string>([
                ...Object.values(cls.subjects).flat(),
                ...(cls.subjectsB ? Object.values(cls.subjectsB).flat() : []),
            ]);
            map.set(cls.className, set);
        }
        return map;
    }, [classes]);

    const grades = useMemo(() => {
        const set = new Set<string>();
        classes.forEach((c) => {
            const g = getEffectiveGradeLevel(c, c.className);
            if (g) set.add(g);
        });
        return ['Alle', ...Array.from(set).sort()];
    }, [classes]);

    const visibleClasses = useMemo(() => {
        return [...classes]
            .filter(
                (c) =>
                    gradeFilter === 'Alle' ||
                    getEffectiveGradeLevel(c, c.className) === gradeFilter
            )
            .sort((a, b) => {
                const ga = getEffectiveGradeLevel(a, a.className);
                const gb = getEffectiveGradeLevel(b, b.className);
                return ga !== gb
                    ? ga.localeCompare(gb)
                    : a.className.localeCompare(b.className);
            });
    }, [classes, gradeFilter]);

    const allSubjects = useMemo(() => {
        const set = new Set<string>();
        visibleClasses.forEach((c) => {
            classTaughtMap.get(c.className)?.forEach((s) => set.add(s));
        });
        let list = Array.from(set).sort();
        if (onlyMultiTeacher) {
            list = list.filter((sub) =>
                visibleClasses.some((cls) => getAllTeachersForSubject(cls, sub).length >= 2)
            );
        }
        return list;
    }, [visibleClasses, classTaughtMap, onlyMultiTeacher]);

    const globalSubjects = useMemo(() => {
        const set = new Set<string>();
        classes.forEach((c) => {
            classTaughtMap.get(c.className)?.forEach((s) => set.add(s));
        });
        return Array.from(set).sort();
    }, [classes, classTaughtMap]);

    // Count how many visible classes teach & selected each subject
    const subjectStats = useMemo(() => {
        const stats: Record<string, { taughtIn: number; selectedIn: number }> = {};
        for (const sub of globalSubjects) {
            let taughtIn = 0;
            let selectedIn = 0;
            for (const cls of visibleClasses) {
                if (classTaughtMap.get(cls.className)?.has(sub)) {
                    taughtIn++;
                    if ((selectedSubjects[cls.className] || []).includes(sub)) {
                        selectedIn++;
                    }
                }
            }
            stats[sub] = { taughtIn, selectedIn };
        }
        return stats;
    }, [globalSubjects, visibleClasses, classTaughtMap, selectedSubjects]);

    const multiTeacherCount = useMemo(() => {
        let count = 0;
        for (const cls of classes) {
            const subjs = classTaughtMap.get(cls.className) || new Set<string>();
            for (const sub of subjs) {
                if (getAllTeachersForSubject(cls, sub).length >= 2) {
                    count++;
                }
            }
        }
        return count;
    }, [classes, classTaughtMap]);

    const toggleCell = (className: string, subject: string) => {
        const current = selectedSubjects[className] || [];
        const exists = current.includes(subject);
        onUpdateSelection({
            ...selectedSubjects,
            [className]: exists
                ? current.filter((s) => s !== subject)
                : [...current, subject],
        });
    };

    const toggleSubjectForVisible = (subject: string) => {
        const stat = subjectStats[subject];
        const selectAll = !stat || stat.selectedIn < stat.taughtIn;
        const next = { ...selectedSubjects };
        for (const cls of visibleClasses) {
            if (!classTaughtMap.get(cls.className)?.has(subject)) continue;
            const current = next[cls.className] || [];
            if (selectAll) {
                if (!current.includes(subject)) next[cls.className] = [...current, subject];
            } else {
                next[cls.className] = current.filter((s) => s !== subject);
            }
        }
        onUpdateSelection(next);
    };

    const toggleClassAll = (className: string) => {
        const taught = Array.from(classTaughtMap.get(className) || []);
        const current = selectedSubjects[className] || [];
        onUpdateSelection({
            ...selectedSubjects,
            [className]: current.length === taught.length ? [] : taught,
        });
    };

    const setAllVisible = (selectAll: boolean) => {
        const next = { ...selectedSubjects };
        for (const cls of visibleClasses) {
            next[cls.className] = selectAll
                ? Array.from(classTaughtMap.get(cls.className) || [])
                : [];
        }
        onUpdateSelection(next);
    };

    const setClassTiming = (
        className: string,
        subject: string,
        pref: SubjectTimingPreference
    ) => {
        const prevClassMap = classSubjectTiming[className] || {};
        const nextClassMap = { ...prevClassMap };
        if (pref === 'normal') {
            delete nextClassMap[subject];
        } else {
            nextClassMap[subject] = pref;
        }
        const nextAll = { ...classSubjectTiming };
        if (Object.keys(nextClassMap).length === 0) {
            delete nextAll[className];
        } else {
            nextAll[className] = nextClassMap;
        }
        onUpdateClassSubjectTiming(nextAll);
    };

    const setExamTeacher = (cls: ClassSchedule, subject: string, teacher: string) => {
        const nextMap = { ...(cls.examTeacherBySubject || {}) };
        if (!teacher) {
            delete nextMap[subject];
        } else {
            nextMap[subject] = teacher;
        }
        onUpdateClass({
            ...cls,
            examTeacherBySubject: nextMap,
        });
    };

    if (classes.length === 0) {
        return (
            <div
                className="ui-card"
                style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}
            >
                Importiere zuerst Stundenpläne im Tab <strong>1. Import & Ferien</strong>, um
                Klausurfächer festzulegen.
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Top Card: Global 1-click Subject Toggle Strip */}
            <div className="ui-card" style={{ padding: '1.25rem' }}>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        marginBottom: '0.9rem',
                    }}
                >
                    <div>
                        <h3
                            style={{
                                fontSize: '1.05rem',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <BookOpen size={19} color="var(--accent-primary)" />
                            Fächer schnell für alle oder je Stufe schalten
                        </h3>
                        <p
                            style={{
                                fontSize: '0.82rem',
                                color: 'var(--text-secondary)',
                                marginTop: '2px',
                            }}
                        >
                            Ein Klick wählt ein Fach für{' '}
                            {gradeFilter === 'Alle' ? 'alle Klassen' : `Stufe ${gradeFilter}`} an
                            oder ab.
                        </p>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                        }}
                    >
                        <select
                            className="ui-input"
                            style={{ width: 'auto', fontSize: '0.82rem', padding: '5px 10px' }}
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
                        <button type="button" className="ui-btn" onClick={() => setAllVisible(true)}>
                            <CheckSquare size={14} /> Alle an
                        </button>
                        <button type="button" className="ui-btn" onClick={() => setAllVisible(false)}>
                            <Square size={14} /> Alle aus
                        </button>
                    </div>
                </div>

                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                    }}
                >
                    {globalSubjects.map((sub) => {
                        const stat = subjectStats[sub];
                        if (!stat || stat.taughtIn === 0) return null;
                        const allOn = stat.selectedIn === stat.taughtIn;
                        const someOn = stat.selectedIn > 0 && stat.selectedIn < stat.taughtIn;

                        return (
                            <button
                                key={sub}
                                type="button"
                                onClick={() => toggleSubjectForVisible(sub)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 10px',
                                    borderRadius: '8px',
                                    border: `1px solid ${
                                        allOn
                                            ? 'var(--accent-primary)'
                                            : someOn
                                              ? 'var(--accent-warning)'
                                              : 'var(--border-subtle)'
                                    }`,
                                    background: allOn ? 'var(--accent-soft)' : 'var(--bg-panel)',
                                    color: 'var(--text-primary)',
                                    fontWeight: 700,
                                    fontSize: '0.84rem',
                                }}
                                title="Für alle sichtbaren Klassen an-/abwählen"
                            >
                                <span
                                    style={{
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '4px',
                                        border: `1px solid ${
                                            allOn || someOn
                                                ? 'var(--accent-primary)'
                                                : 'var(--border-color)'
                                        }`,
                                        background: allOn
                                            ? 'var(--accent-primary)'
                                            : someOn
                                              ? 'var(--accent-warning)'
                                              : 'var(--bg-surface)',
                                        color: '#fff',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '0.7rem',
                                        flexShrink: 0,
                                    }}
                                >
                                    {allOn ? <Check size={11} /> : someOn ? '−' : null}
                                </span>
                                <span>{sub}</span>
                                <span
                                    style={{
                                        fontSize: '0.72rem',
                                        fontWeight: 500,
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    {stat.selectedIn}/{stat.taughtIn}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Matrix: Class x Subject + Per-Cell Early/Late Timing + Multi-Teacher selector */}
            <div className="ui-card" style={{ padding: '1.25rem' }}>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        marginBottom: '0.75rem',
                    }}
                >
                    <div>
                        <h3
                            style={{
                                fontSize: '1.05rem',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <Users size={19} color="var(--accent-primary)" />
                            Klassen × Fächer Matrix (Zeitwunsch Früh/Spät & Prüfende Lehrkraft)
                        </h3>
                        <p
                            style={{
                                fontSize: '0.82rem',
                                color: 'var(--text-secondary)',
                                marginTop: '2px',
                            }}
                        >
                            Wähle je Klasse und Fach einzeln <strong>Früh</strong> oder{' '}
                            <strong>Spät</strong> sowie bei mehreren Lehrkräften die prüfende
                            Lehrkraft.
                        </p>
                    </div>
                    {multiTeacherCount > 0 && (
                        <label
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.82rem',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={onlyMultiTeacher}
                                onChange={(e) => setOnlyMultiTeacher(e.target.checked)}
                            />
                            Nur Fächer mit mehreren Lehrkräften ({multiTeacherCount})
                        </label>
                    )}
                </div>

                <div
                    style={{
                        overflowX: 'auto',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                    }}
                >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr
                                style={{
                                    background: 'var(--bg-panel)',
                                    borderBottom: '1px solid var(--border-color)',
                                }}
                            >
                                <th
                                    style={{
                                        position: 'sticky',
                                        left: 0,
                                        zIndex: 3,
                                        background: 'var(--bg-panel)',
                                        textAlign: 'left',
                                        padding: '8px 12px',
                                        borderRight: '1px solid var(--border-color)',
                                        minWidth: '140px',
                                    }}
                                >
                                    Klasse / Stufe
                                </th>
                                {allSubjects.map((sub) => (
                                    <th
                                        key={sub}
                                        style={{
                                            padding: '6px 8px',
                                            textAlign: 'center',
                                            borderRight: '1px solid var(--border-subtle)',
                                            minWidth: '112px',
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => toggleSubjectForVisible(sub)}
                                        title={`Spalte "${sub}" für alle sichtbaren Klassen umschalten`}
                                    >
                                        <div style={{ fontWeight: 700 }}>{sub}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visibleClasses.map((cls) => {
                                const grade = getEffectiveGradeLevel(cls, cls.className);
                                const taughtSet =
                                    classTaughtMap.get(cls.className) || new Set<string>();
                                const selected = selectedSubjects[cls.className] || [];
                                const allRowSelected =
                                    taughtSet.size > 0 && selected.length === taughtSet.size;

                                return (
                                    <tr
                                        key={cls.className}
                                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                                    >
                                        <td
                                            style={{
                                                position: 'sticky',
                                                left: 0,
                                                zIndex: 2,
                                                background: 'var(--bg-surface)',
                                                padding: '8px 12px',
                                                borderRight: '1px solid var(--border-color)',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: '8px',
                                                }}
                                            >
                                                <div>
                                                    <div style={{ fontWeight: 700 }}>
                                                        {cls.className}
                                                    </div>
                                                    {grade && (
                                                        <div
                                                            style={{
                                                                fontSize: '0.7rem',
                                                                color: 'var(--text-muted)',
                                                            }}
                                                        >
                                                            Stufe {grade}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleClassAll(cls.className)}
                                                    style={{
                                                        border: '1px solid var(--border-subtle)',
                                                        background: 'var(--bg-panel)',
                                                        color: 'var(--text-secondary)',
                                                        borderRadius: '6px',
                                                        padding: '2px 6px',
                                                        fontSize: '0.7rem',
                                                    }}
                                                    title={
                                                        allRowSelected
                                                            ? 'Alle abwählen'
                                                            : 'Alle auswählen'
                                                    }
                                                >
                                                    {allRowSelected ? 'Keine' : 'Alle'}
                                                </button>
                                            </div>
                                        </td>

                                        {allSubjects.map((sub) => {
                                            const isTaught = taughtSet.has(sub);
                                            if (!isTaught) {
                                                return (
                                                    <td
                                                        key={sub}
                                                        style={{
                                                            textAlign: 'center',
                                                            color: 'var(--text-muted)',
                                                            borderRight:
                                                                '1px solid var(--border-subtle)',
                                                            background: 'var(--bg-app)',
                                                            opacity: 0.45,
                                                        }}
                                                    >
                                                        —
                                                    </td>
                                                );
                                            }

                                            const isChecked = selected.includes(sub);
                                            const teachers = getAllTeachersForSubject(cls, sub);
                                            const chosenTeacher =
                                                cls.examTeacherBySubject?.[sub] || '';
                                            const cellTiming: SubjectTimingPreference =
                                                classSubjectTiming[cls.className]?.[sub] ||
                                                'normal';

                                            return (
                                                <td
                                                    key={sub}
                                                    style={{
                                                        padding: '6px',
                                                        textAlign: 'center',
                                                        verticalAlign: 'middle',
                                                        borderRight:
                                                            '1px solid var(--border-subtle)',
                                                        background: isChecked
                                                            ? 'var(--accent-soft)'
                                                            : 'transparent',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                toggleCell(cls.className, sub)
                                                            }
                                                            style={{
                                                                width: '24px',
                                                                height: '24px',
                                                                borderRadius: '6px',
                                                                border: `1px solid ${
                                                                    isChecked
                                                                        ? 'var(--accent-primary)'
                                                                        : 'var(--border-color)'
                                                                }`,
                                                                background: isChecked
                                                                    ? 'var(--accent-primary)'
                                                                    : 'var(--bg-surface)',
                                                                color: '#ffffff',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                            }}
                                                            title={
                                                                isChecked
                                                                    ? `${sub} in ${cls.className} abwählen`
                                                                    : `${sub} in ${cls.className} auswählen`
                                                            }
                                                        >
                                                            {isChecked && <Check size={14} />}
                                                        </button>

                                                        {/* Per-class × per-subject Early / Normal / Late timing */}
                                                        {isChecked && (
                                                            <div
                                                                style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    borderRadius: '5px',
                                                                    border: '1px solid var(--border-color)',
                                                                    overflow: 'hidden',
                                                                    background: 'var(--bg-surface)',
                                                                }}
                                                                title={`Zeitwunsch für ${cls.className} · ${sub}`}
                                                            >
                                                                {(
                                                                    [
                                                                        'early',
                                                                        'normal',
                                                                        'late',
                                                                    ] as SubjectTimingPreference[]
                                                                ).map((mode) => {
                                                                    const active =
                                                                        cellTiming === mode;
                                                                    const label =
                                                                        mode === 'early'
                                                                            ? 'Früh'
                                                                            : mode === 'late'
                                                                              ? 'Spät'
                                                                              : '•';
                                                                    const activeBg =
                                                                        mode === 'early'
                                                                            ? 'var(--accent-success)'
                                                                            : mode === 'late'
                                                                              ? 'var(--accent-purple)'
                                                                              : 'var(--bg-panel)';
                                                                    const activeColor =
                                                                        mode === 'normal'
                                                                            ? 'var(--text-primary)'
                                                                            : '#fff';
                                                                    return (
                                                                        <button
                                                                            key={mode}
                                                                            type="button"
                                                                            onClick={() =>
                                                                                setClassTiming(
                                                                                    cls.className,
                                                                                    sub,
                                                                                    mode
                                                                                )
                                                                            }
                                                                            style={{
                                                                                border: 'none',
                                                                                padding: '2px 5px',
                                                                                fontSize: '0.67rem',
                                                                                fontWeight: active
                                                                                    ? 700
                                                                                    : 500,
                                                                                background: active
                                                                                    ? activeBg
                                                                                    : 'transparent',
                                                                                color: active
                                                                                    ? activeColor
                                                                                    : 'var(--text-muted)',
                                                                            }}
                                                                        >
                                                                            {label}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        {isChecked && teachers.length >= 2 && (
                                                            <select
                                                                value={chosenTeacher}
                                                                onChange={(e) =>
                                                                    setExamTeacher(
                                                                        cls,
                                                                        sub,
                                                                        e.target.value
                                                                    )
                                                                }
                                                                title="Mehrere Lehrkräfte gefunden: festlegen, bei wem die Klausur geschrieben wird"
                                                                style={{
                                                                    maxWidth: '108px',
                                                                    fontSize: '0.68rem',
                                                                    padding: '2px 4px',
                                                                    borderRadius: '5px',
                                                                    border: `1px solid ${
                                                                        chosenTeacher
                                                                            ? 'var(--accent-primary)'
                                                                            : 'var(--accent-warning)'
                                                                    }`,
                                                                    background: 'var(--bg-surface)',
                                                                    color: 'var(--text-primary)',
                                                                }}
                                                            >
                                                                <option value="">
                                                                    Alle ({teachers.length})
                                                                </option>
                                                                {teachers.map((t) => (
                                                                    <option key={t} value={t}>
                                                                        Nur: {t}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        )}

                                                        {isChecked && teachers.length === 1 && (
                                                            <span
                                                                style={{
                                                                    fontSize: '0.66rem',
                                                                    color: 'var(--text-muted)',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: '2px',
                                                                }}
                                                            >
                                                                {cellTiming !== 'normal' && (
                                                                    <Clock size={9} />
                                                                )}
                                                                {teachers[0]}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
