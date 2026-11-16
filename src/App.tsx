import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    type AppState,
    type ClassSchedule,
    type Week,
    type Exam,
    type BlockedDays,
    type BlockedClassDays,
    type HolidayLabels,
    type DayOfWeek,
    type PdfSettings,
    type SolverSettings,
    type EdupageMeta,
    type SubjectTimingPreference,
    DEFAULT_SOLVER_SETTINGS,
} from './types';
import { distributeExams, autoFix, inferGradeLevel } from './logic/solver';
import { formatWeekId, getWeekTypeForNumber, getWeeksBetween } from './logic/dateUtils';
import { applyPublicHolidaysToWeeks, GERMAN_STATES, type GermanStateCode } from './logic/holidays';
import { ImportSection } from './components/ImportSection';
import { ConfigSection } from './components/ConfigSection';
import { SubjectSelection } from './components/SubjectSelection';
import { ScheduleEditor } from './components/ScheduleEditor';
import { CalendarBoard } from './components/CalendarBoard';
import { generatePDF } from './logic/pdfGenerator';
import {
    Download,
    Sparkles,
    Upload,
    RotateCcw,
    HardDrive,
    Sun,
    Moon,
    ChevronDown,
    Calendar as CalendarIcon,
    School,
    SlidersHorizontal,
    BookOpen,
    Wand2,
    FileDown,
} from 'lucide-react';

type WorkspaceTab = 'import' | 'subjects' | 'schedules' | 'calendar';
type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'klausurplaner_v1';
const THEME_STORAGE_KEY = 'klausurplaner_theme';

const DEFAULT_PDF_SETTINGS: PdfSettings = {
    title: 'Klausurplanung 2026 – 1. Quartal',
    makeupExamInfo: '**',
    gradesDueDate: '27.10.',
};

function createDefaultWeeks(weekAParity: 'odd' | 'even' = 'odd'): Week[] {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 21);
    return getWeeksBetween(start, end, [], { weekAParity });
}

function getInitialTheme(): ThemeMode {
    try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'dark' || saved === 'light') return saved;
    } catch {
        // ignore
    }
    return 'light';
}

/**
 * Normalizes loaded state (e.g. migrates legacy UUID week IDs to deterministic YYYY-KWxx IDs)
 * so existing assignments, blocked days, and holiday labels are preserved.
 */
function normalizeAppState(raw: Partial<AppState> | null | undefined): AppState {
    const parity = raw?.edupageMeta?.weekAParity ?? 'odd';
    const rawWeeks =
        Array.isArray(raw?.weeks) && raw.weeks.length > 0
            ? raw.weeks
            : createDefaultWeeks(parity);
    const weekIdMap = new Map<string, string>();
    const weeks: Week[] = rawWeeks.map((w) => {
        const canonicalId = formatWeekId(w.year, w.weekNumber);
        if (w.id !== canonicalId) {
            weekIdMap.set(w.id, canonicalId);
        }
        return {
            ...w,
            id: canonicalId,
            weekType: w.weekType === 'B' ? 'B' : 'A',
        };
    });

    const remapWeekId = (id: string | null): string | null => {
        if (!id) return null;
        return weekIdMap.get(id) || id;
    };

    const exams: Exam[] = (raw?.exams || []).map((e) => ({
        ...e,
        assignedWeekId: remapWeekId(e.assignedWeekId),
    }));

    const blockedDays: BlockedDays = {};
    for (const [wId, daysMap] of Object.entries(raw?.blockedDays || {})) {
        const mappedId = weekIdMap.get(wId) || wId;
        blockedDays[mappedId] = { ...(blockedDays[mappedId] || {}), ...daysMap };
    }

    const holidayLabels: HolidayLabels = {};
    for (const [wId, labelsMap] of Object.entries(raw?.holidayLabels || {})) {
        const mappedId = weekIdMap.get(wId) || wId;
        holidayLabels[mappedId] = { ...(holidayLabels[mappedId] || {}), ...labelsMap };
    }

    const blockedClassDays: BlockedClassDays = {};
    for (const [clsName, clsWeeks] of Object.entries(raw?.blockedClassDays || {})) {
        blockedClassDays[clsName] = {};
        for (const [wId, daysMap] of Object.entries(clsWeeks || {})) {
            const mappedId = weekIdMap.get(wId) || wId;
            blockedClassDays[clsName][mappedId] = {
                ...(blockedClassDays[clsName][mappedId] || {}),
                ...daysMap,
            };
        }
    }

    const classes: ClassSchedule[] = (raw?.classes || []).map((c) => ({
        ...c,
        gradeLevel: c.gradeLevel ?? inferGradeLevel(c.className),
    }));

    return {
        classes,
        weeks,
        exams,
        blockedDays,
        holidayLabels,
        blockedClassDays,
        selectedSubjects: raw?.selectedSubjects || {},
        subjectTiming: raw?.subjectTiming || {},
        classSubjectTiming: raw?.classSubjectTiming || {},
        pdfSettings: raw?.pdfSettings || DEFAULT_PDF_SETTINGS,
        solverSettings: { ...DEFAULT_SOLVER_SETTINGS, ...(raw?.solverSettings || {}) },
        edupageMeta: raw?.edupageMeta,
    };
}

function loadInitialState(): AppState {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return normalizeAppState(JSON.parse(saved));
        }
    } catch (err) {
        console.error('Fehler beim Laden aus localStorage:', err);
    }
    return normalizeAppState(null);
}

function App() {
    const initialState = useMemo(() => loadInitialState(), []);

    const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
    const [activeTab, setActiveTab] = useState<WorkspaceTab>(() =>
        initialState.classes.length > 0 ? 'calendar' : 'import'
    );
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    const [classes, setClasses] = useState<ClassSchedule[]>(initialState.classes);
    const [weeks, setWeeks] = useState<Week[]>(initialState.weeks);
    const [exams, setExams] = useState<Exam[]>(initialState.exams);
    const [blockedDays, setBlockedDays] = useState<BlockedDays>(initialState.blockedDays);
    const [holidayLabels, setHolidayLabels] = useState<HolidayLabels>(
        initialState.holidayLabels || {}
    );
    const [blockedClassDays, setBlockedClassDays] = useState<BlockedClassDays>(
        initialState.blockedClassDays
    );
    const [selectedSubjects, setSelectedSubjects] = useState<Record<string, string[]>>(
        initialState.selectedSubjects
    );
    const [subjectTiming, setSubjectTiming] = useState<Record<string, SubjectTimingPreference>>(
        initialState.subjectTiming || {}
    );
    const [classSubjectTiming, setClassSubjectTiming] = useState<
        Record<string, Record<string, SubjectTimingPreference>>
    >(initialState.classSubjectTiming || {});
    const [pdfSettings, setPdfSettings] = useState<PdfSettings>(initialState.pdfSettings);
    const [solverSettings, setSolverSettings] = useState<SolverSettings>(
        initialState.solverSettings || DEFAULT_SOLVER_SETTINGS
    );
    const [edupageMeta, setEdupageMeta] = useState<EdupageMeta | undefined>(
        initialState.edupageMeta
    );

    // Local bridge & EduPage sync state
    const [bridgeOnline, setBridgeOnline] = useState(false);
    const [edupageApiAvailable, setEdupageApiAvailable] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'browser' | 'synced' | 'saving'>('browser');
    const [edupageSyncLoading, setEdupageSyncLoading] = useState(false);
    const [edupageSyncMessage, setEdupageSyncMessage] = useState<string | null>(null);
    const hydratedFromDiskRef = useRef(false);

    // Apply Light/Dark theme attribute to <html>
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            // ignore
        }
    }, [theme]);

    // Close "Mehr" menu on outside click
    useEffect(() => {
        if (!moreMenuOpen) return;
        const onClick = (e: MouseEvent) => {
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
                setMoreMenuOpen(false);
            }
        };
        window.addEventListener('mousedown', onClick);
        return () => window.removeEventListener('mousedown', onClick);
    }, [moreMenuOpen]);

    const appState: AppState = useMemo(
        () => ({
            classes,
            weeks,
            exams,
            blockedDays,
            holidayLabels,
            blockedClassDays,
            selectedSubjects,
            subjectTiming,
            classSubjectTiming,
            pdfSettings,
            solverSettings,
            edupageMeta,
        }),
        [
            classes,
            weeks,
            exams,
            blockedDays,
            holidayLabels,
            blockedClassDays,
            selectedSubjects,
            subjectTiming,
            classSubjectTiming,
            pdfSettings,
            solverSettings,
            edupageMeta,
        ]
    );

    const applyNormalizedState = useCallback((norm: AppState) => {
        setClasses(norm.classes);
        setWeeks(norm.weeks);
        setExams(norm.exams);
        setBlockedDays(norm.blockedDays);
        setHolidayLabels(norm.holidayLabels || {});
        setBlockedClassDays(norm.blockedClassDays);
        setSelectedSubjects(norm.selectedSubjects);
        setSubjectTiming(norm.subjectTiming || {});
        setClassSubjectTiming(norm.classSubjectTiming || {});
        setPdfSettings(norm.pdfSettings);
        setSolverSettings(norm.solverSettings || DEFAULT_SOLVER_SETTINGS);
        setEdupageMeta(norm.edupageMeta);
    }, []);

    // Check local bridge health & hydrate from disk file if localStorage has no classes yet
    useEffect(() => {
        let cancelled = false;
        fetch('/api/health')
            .then((r) => (r.ok ? r.json() : null))
            .then(async (health) => {
                if (!health || cancelled) return;
                setBridgeOnline(true);
                setEdupageApiAvailable(!!health.edupageAvailable);

                if (health.hasSavedState && !hydratedFromDiskRef.current) {
                    hydratedFromDiskRef.current = true;
                    const hasLocalClasses = Boolean(
                        localStorage.getItem(STORAGE_KEY) &&
                            JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')?.classes?.length
                    );
                    if (!hasLocalClasses) {
                        const stateRes = await fetch('/api/state');
                        if (stateRes.ok && !cancelled) {
                            const payload = await stateRes.json();
                            if (payload?.state) {
                                const norm = normalizeAppState(payload.state);
                                applyNormalizedState(norm);
                            }
                        }
                    }
                }
                if (!cancelled) setSaveStatus('synced');
            })
            .catch(() => {
                if (!cancelled) {
                    setBridgeOnline(false);
                    setSaveStatus('browser');
                }
            });
        return () => {
            cancelled = true;
        };
    }, [applyNormalizedState]);

    // Auto-save effect: immediate localStorage + debounced local file sync when bridge is online
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
        } catch (err) {
            console.error('localStorage save failed:', err);
        }

        if (!bridgeOnline) {
            return;
        }

        const timer = setTimeout(() => {
            setSaveStatus('saving');
            fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: appState }),
            })
                .then((r) => {
                    if (r.ok) setSaveStatus('synced');
                })
                .catch(() => {
                    setSaveStatus('browser');
                });
        }, 250);

        return () => clearTimeout(timer);
    }, [appState, bridgeOnline]);

    const handleImport = (schedules: ClassSchedule[], meta?: EdupageMeta) => {
        const previousClasses = classes;

        // Non-destructive merge: preserve gradeLevel and examTeacherBySubject edits
        setClasses((prev) => {
            const updated = [...prev];
            for (const rawNew of schedules) {
                const newCls: ClassSchedule = {
                    ...rawNew,
                    gradeLevel: rawNew.gradeLevel || inferGradeLevel(rawNew.className),
                };
                const index = updated.findIndex((c) => c.className === newCls.className);
                if (index >= 0) {
                    updated[index] = {
                        ...newCls,
                        gradeLevel: updated[index].gradeLevel || newCls.gradeLevel,
                        examTeacherBySubject: updated[index].examTeacherBySubject,
                    };
                } else {
                    updated.push(newCls);
                }
            }
            return updated;
        });

        // Non-destructive subject selection: preserve unchecked subjects for existing classes
        setSelectedSubjects((prev) => {
            const next = { ...prev };
            for (const cls of schedules) {
                const allNew = Array.from(
                    new Set([
                        ...Object.values(cls.subjects).flat(),
                        ...(cls.subjectsB ? Object.values(cls.subjectsB).flat() : []),
                    ])
                );
                if (!(cls.className in prev)) {
                    next[cls.className] = allNew;
                } else {
                    const existingClass = previousClasses.find((c) => c.className === cls.className);
                    const oldAll = existingClass
                        ? new Set([
                              ...Object.values(existingClass.subjects).flat(),
                              ...(existingClass.subjectsB
                                  ? Object.values(existingClass.subjectsB).flat()
                                  : []),
                          ])
                        : new Set<string>();
                    const kept = (prev[cls.className] || []).filter((s) => allNew.includes(s));
                    const brandNew = allNew.filter((s) => !oldAll.has(s) && !kept.includes(s));
                    next[cls.className] = [...kept, ...brandNew];
                }
            }
            return next;
        });

        if (meta) {
            setEdupageMeta((prev) => ({ ...(prev || {}), ...meta }));
            if (meta.weekAParity) {
                const parity = meta.weekAParity;
                setWeeks((prev) =>
                    prev.map((w) => ({
                        ...w,
                        weekType: getWeekTypeForNumber(w.weekNumber, parity),
                    }))
                );
            }
        }
    };

    const handleUpdateClass = (updatedClass: ClassSchedule) => {
        setClasses((prev) =>
            prev.map((c) => (c.className === updatedClass.className ? updatedClass : c))
        );
    };

    const handleUpdateWeekAParity = (parity: 'odd' | 'even') => {
        setEdupageMeta((prev) => ({ ...(prev || {}), weekAParity: parity }));
    };

    const handleApplyStateHolidays = (stateCode: GermanStateCode) => {
        const res = applyPublicHolidaysToWeeks(weeks, stateCode, blockedDays, holidayLabels);
        setBlockedDays(res.blockedDays);
        setHolidayLabels(res.holidayLabels);
        const stateLabel = GERMAN_STATES.find((s) => s.code === stateCode)?.label || stateCode;
        setEdupageSyncMessage(
            res.addedCount > 0
                ? `${res.addedCount} gesetzliche Feiertage (${stateLabel}) im Zeitraum gesperrt.`
                : `Keine weiteren gesetzlichen Feiertage (${stateLabel}) im gewählten Zeitraum offen.`
        );
    };

    const handleSyncEdupageCalendar = async () => {
        if (!bridgeOnline || weeks.length === 0) return;
        setEdupageSyncLoading(true);
        setEdupageSyncMessage(null);
        try {
            const res = await fetch('/api/edupage/sync-calendar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    weeks: weeks.map((w) => ({
                        id: w.id,
                        year: w.year,
                        weekNumber: w.weekNumber,
                    })),
                    referenceSchedules: classes.map((c) => ({
                        className: c.className,
                        subjects: c.subjects,
                        subjectsB: c.subjectsB,
                    })),
                    classIds: edupageMeta?.selectedClassIds || [],
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'EduPage-Kalenderabgleich fehlgeschlagen.');
            }

            const newBlocked = (data.blockedDays || {}) as BlockedDays;
            const newLabels = (data.holidayLabels || {}) as HolidayLabels;
            const detectedWeekTypes = (data.weekTypes || {}) as Record<string, 'A' | 'B'>;

            setBlockedDays((prev) => {
                const next = { ...prev };
                for (const [wid, dMap] of Object.entries(newBlocked)) {
                    next[wid] = { ...(next[wid] || {}), ...dMap };
                }
                return next;
            });

            setHolidayLabels((prev) => {
                const next = { ...prev };
                for (const [wid, lMap] of Object.entries(newLabels)) {
                    next[wid] = { ...(next[wid] || {}), ...lMap };
                }
                return next;
            });

            const updatedAbCount = Object.keys(detectedWeekTypes).length;
            if (updatedAbCount > 0) {
                setWeeks((prev) =>
                    prev.map((w) =>
                        detectedWeekTypes[w.id] ? { ...w, weekType: detectedWeekTypes[w.id] } : w
                    )
                );
            }

            setEdupageMeta((prev) => ({
                ...(prev || {}),
                lastHolidaySyncAt: new Date().toISOString(),
            }));

            const holCount = Number(data.detectedHolidayCount || 0);
            const activeDays = Number(data.activeSchoolDaysFound || 0);
            if (activeDays === 0 && holCount === 0) {
                setEdupageSyncMessage(
                    'Hinweis: Für diesen Zeitraum sind in EduPage noch keine Unterrichts-/Ferienereignisse veröffentlicht.'
                );
            } else {
                setEdupageSyncMessage(
                    `EduPage-Sync fertig: ${holCount} schulfreie Tage/Ferien übernommen` +
                        (updatedAbCount > 0
                            ? `, ${updatedAbCount} Wochen automatisch auf A/B geprüft.`
                            : '.')
                );
            }
        } catch (err: unknown) {
            setEdupageSyncMessage(
                err instanceof Error ? err.message : 'Fehler beim EduPage-Abgleich.'
            );
        } finally {
            setEdupageSyncLoading(false);
        }
    };

    const handleDistribute = () => {
        const newExams = distributeExams(
            classes,
            weeks,
            blockedDays,
            selectedSubjects,
            blockedClassDays,
            exams,
            solverSettings,
            { global: subjectTiming, byClass: classSubjectTiming }
        );
        setExams(newExams);
        setActiveTab('calendar');
    };

    const handleAutoFix = () => {
        const fixed = autoFix(
            exams,
            classes,
            weeks,
            blockedDays,
            blockedClassDays,
            solverSettings,
            { global: subjectTiming, byClass: classSubjectTiming }
        );
        setExams(fixed);
        setActiveTab('calendar');
    };

    const handleMoveExam = useCallback(
        (examId: string, weekId: string | null, day: DayOfWeek | null) => {
            setExams((prev) =>
                prev.map((e) => {
                    if (e.id !== examId) return e;
                    return { ...e, assignedWeekId: weekId, assignedDay: day };
                })
            );
        },
        []
    );

    const handleTogglePin = (examId: string) => {
        setExams((prev) =>
            prev.map((e) => (e.id === examId ? { ...e, isPinned: !e.isPinned } : e))
        );
    };

    const handleToggleBlockClassDay = (className: string, weekId: string, day: DayOfWeek) => {
        setBlockedClassDays((prev) => {
            const classBlocks = prev[className] || {};
            const weekBlocks = classBlocks[weekId] || {};
            const isBlocked = weekBlocks[day];

            return {
                ...prev,
                [className]: {
                    ...classBlocks,
                    [weekId]: {
                        ...weekBlocks,
                        [day]: !isBlocked,
                    },
                },
            };
        });
    };

    const handleToggleBlockGlobalDay = (weekId: string, day: DayOfWeek) => {
        setBlockedDays((prev) => {
            const weekBlocks = prev[weekId] || ({} as Record<DayOfWeek, boolean>);
            return {
                ...prev,
                [weekId]: {
                    ...weekBlocks,
                    [day]: !weekBlocks[day],
                },
            };
        });
    };

    const handleToggleWeekType = (weekId: string) => {
        setWeeks((prev) =>
            prev.map((w) =>
                w.id === weekId ? { ...w, weekType: w.weekType === 'A' ? 'B' : 'A' } : w
            )
        );
    };

    const handleExport = () => {
        const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'klausurplan.json';
        a.click();
        setMoreMenuOpen(false);
    };

    const handleLoadPlan = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target?.result as string);
                if (json.classes && json.weeks) {
                    const norm = normalizeAppState(json);
                    applyNormalizedState(norm);
                    setMoreMenuOpen(false);
                } else {
                    alert('Ungültige Datei-Struktur');
                }
            } catch (err) {
                console.error(err);
                alert('Fehler beim Laden der Datei');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const handleReset = () => {
        if (
            window.confirm(
                'Möchtest du wirklich den gesamten Plan zurücksetzen? Alle ungesicherten Änderungen gehen verloren.'
            )
        ) {
            localStorage.removeItem(STORAGE_KEY);
            const fresh = normalizeAppState(null);
            applyNormalizedState(fresh);
            setEdupageSyncMessage(null);
            setMoreMenuOpen(false);
            if (bridgeOnline) {
                fetch('/api/state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: fresh }),
                }).catch(() => {});
            }
        }
    };

    const assignedCount = exams.filter((e) => e.assignedWeekId).length;
    const totalSelectedSubjects = Object.values(selectedSubjects).reduce(
        (acc, list) => acc + list.length,
        0
    );

    const tabs: {
        id: WorkspaceTab;
        label: string;
        badge?: string;
        icon: React.ReactNode;
    }[] = [
        {
            id: 'import',
            label: '1. Import & Ferien',
            badge: weeks.length > 0 ? `${weeks.length} Wo.` : undefined,
            icon: <School size={15} />,
        },
        {
            id: 'subjects',
            label: '2. Fächer & Regeln',
            badge: totalSelectedSubjects > 0 ? `${totalSelectedSubjects}` : undefined,
            icon: <SlidersHorizontal size={15} />,
        },
        {
            id: 'schedules',
            label: '3. Stundenpläne',
            badge: classes.length > 0 ? `${classes.length}` : undefined,
            icon: <BookOpen size={15} />,
        },
        {
            id: 'calendar',
            label: '4. Klausurplan',
            badge: exams.length > 0 ? `${assignedCount}/${exams.length}` : undefined,
            icon: <CalendarIcon size={15} />,
        },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {/* Sticky Top Bar */}
            <header
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 40,
                    background: 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-sm)',
                    padding: '0.6rem 1.25rem',
                }}
            >
                <div
                    style={{
                        maxWidth: '1760px',
                        margin: '0 auto',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.85rem',
                        flexWrap: 'wrap',
                    }}
                >
                    {/* Left: Title & Auto-save pill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h1
                            style={{
                                fontSize: '1.2rem',
                                fontWeight: 800,
                                letterSpacing: '-0.02em',
                                color: 'var(--text-primary)',
                            }}
                        >
                            Klausurplaner
                        </h1>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                padding: '3px 8px',
                                borderRadius: '999px',
                                background: 'var(--bg-panel)',
                                border: '1px solid var(--border-subtle)',
                                color:
                                    saveStatus === 'synced'
                                        ? 'var(--accent-success)'
                                        : 'var(--text-muted)',
                            }}
                            title={
                                saveStatus === 'synced'
                                    ? 'Automatisch im Browser und in server/data/klausurplan.json gespeichert.'
                                    : 'Automatisch im Browser gespeichert.'
                            }
                        >
                            <HardDrive size={11} />
                            {saveStatus === 'saving'
                                ? 'Speichere...'
                                : saveStatus === 'synced'
                                  ? 'Lokal + Datei ✓'
                                  : 'Browser ✓'}
                        </span>
                    </div>

                    {/* Center: 4 Workspace Tabs */}
                    <nav
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '3px',
                            borderRadius: '10px',
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border-subtle)',
                            flexWrap: 'wrap',
                        }}
                    >
                        {tabs.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 11px',
                                        borderRadius: '7px',
                                        border: 'none',
                                        background: isActive ? 'var(--bg-surface)' : 'transparent',
                                        color: isActive
                                            ? 'var(--accent-primary)'
                                            : 'var(--text-secondary)',
                                        boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                                        fontWeight: isActive ? 700 : 600,
                                        fontSize: '0.82rem',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {tab.icon}
                                    <span>{tab.label}</span>
                                    {tab.badge && (
                                        <span
                                            style={{
                                                fontSize: '0.68rem',
                                                fontWeight: 700,
                                                padding: '0 6px',
                                                borderRadius: '999px',
                                                background: isActive
                                                    ? 'var(--accent-soft)'
                                                    : 'var(--border-subtle)',
                                                color: isActive
                                                    ? 'var(--accent-primary)'
                                                    : 'var(--text-muted)',
                                            }}
                                        >
                                            {tab.badge}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    {/* Right: Primary Actions + Theme Toggle + Mehr */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={handleDistribute}
                            disabled={classes.length === 0}
                            className="ui-btn ui-btn-primary"
                            title="Klausuren automatisch mit dem Smart-Solver verteilen"
                        >
                            <Sparkles size={15} />
                            Verteilen
                        </button>

                        <button
                            type="button"
                            onClick={handleAutoFix}
                            disabled={exams.length === 0}
                            className="ui-btn"
                            title="Ungültige oder offene Klausuren automatisch nachkorrigieren"
                        >
                            <Wand2 size={15} color="var(--accent-warning)" />
                            Auto-Korrektur
                        </button>

                        <button
                            type="button"
                            onClick={() => generatePDF(appState)}
                            disabled={classes.length === 0}
                            className="ui-btn"
                            title="Übersicht als PDF herunterladen"
                        >
                            <FileDown size={15} color="var(--accent-primary)" />
                            PDF
                        </button>

                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                            className="ui-btn"
                            style={{ padding: '7px 9px' }}
                            title={theme === 'light' ? 'Dunkelmodus aktivieren' : 'Hellmodus aktivieren'}
                        >
                            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                        </button>

                        <div ref={moreMenuRef} style={{ position: 'relative' }}>
                            <button
                                type="button"
                                onClick={() => setMoreMenuOpen((o) => !o)}
                                className="ui-btn"
                            >
                                Mehr
                                <ChevronDown size={14} />
                            </button>

                            {moreMenuOpen && (
                                <div
                                    className="ui-card"
                                    style={{
                                        position: 'absolute',
                                        right: 0,
                                        top: 'calc(100% + 6px)',
                                        minWidth: '190px',
                                        padding: '6px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '2px',
                                        boxShadow: 'var(--shadow-lg)',
                                        zIndex: 60,
                                    }}
                                >
                                    <label
                                        className="ui-btn"
                                        style={{
                                            border: 'none',
                                            justifyContent: 'flex-start',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <Upload size={14} />
                                        JSON laden
                                        <input
                                            type="file"
                                            accept=".json"
                                            onChange={handleLoadPlan}
                                            style={{ display: 'none' }}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleExport}
                                        className="ui-btn"
                                        style={{ border: 'none', justifyContent: 'flex-start' }}
                                    >
                                        <Download size={14} />
                                        JSON speichern
                                    </button>
                                    <div
                                        style={{
                                            height: '1px',
                                            background: 'var(--border-subtle)',
                                            margin: '4px 0',
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleReset}
                                        className="ui-btn"
                                        style={{
                                            border: 'none',
                                            justifyContent: 'flex-start',
                                            color: 'var(--accent-danger)',
                                        }}
                                    >
                                        <RotateCcw size={14} />
                                        Alles zurücksetzen
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Workspace Content */}
            <main
                style={{
                    flex: 1,
                    width: '100%',
                    maxWidth: '1760px',
                    margin: '0 auto',
                    padding: '1rem 1.25rem 1.5rem',
                }}
            >
                {activeTab === 'import' && (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
                            gap: '1.25rem',
                            alignItems: 'start',
                        }}
                    >
                        <ImportSection
                            onImport={handleImport}
                            edupageMeta={edupageMeta}
                            bridgeOnline={bridgeOnline}
                            edupageApiAvailable={edupageApiAvailable}
                        />
                        <ConfigSection
                            section="period"
                            weeks={weeks}
                            onUpdateWeeks={setWeeks}
                            blockedDays={blockedDays}
                            holidayLabels={holidayLabels}
                            weekAParity={edupageMeta?.weekAParity || 'odd'}
                            onUpdateWeekAParity={handleUpdateWeekAParity}
                            onApplyStateHolidays={handleApplyStateHolidays}
                            onSyncEdupageCalendar={handleSyncEdupageCalendar}
                            edupageSyncLoading={edupageSyncLoading}
                            edupageSyncMessage={edupageSyncMessage}
                            bridgeOnline={bridgeOnline}
                            pdfSettings={pdfSettings}
                            onUpdatePdfSettings={setPdfSettings}
                            solverSettings={solverSettings}
                            onUpdateSolverSettings={setSolverSettings}
                        />
                    </div>
                )}

                {activeTab === 'subjects' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <SubjectSelection
                            classes={classes}
                            selectedSubjects={selectedSubjects}
                            onUpdateSelection={setSelectedSubjects}
                            onUpdateClass={handleUpdateClass}
                            subjectTiming={subjectTiming}
                            onUpdateSubjectTiming={setSubjectTiming}
                        />
                        <ConfigSection
                            section="rules"
                            weeks={weeks}
                            onUpdateWeeks={setWeeks}
                            blockedDays={blockedDays}
                            pdfSettings={pdfSettings}
                            onUpdatePdfSettings={setPdfSettings}
                            solverSettings={solverSettings}
                            onUpdateSolverSettings={setSolverSettings}
                        />
                    </div>
                )}

                {activeTab === 'schedules' && (
                    <ScheduleEditor classes={classes} onUpdateClass={handleUpdateClass} />
                )}

                {activeTab === 'calendar' && (
                    <CalendarBoard
                        state={appState}
                        onMoveExam={handleMoveExam}
                        onTogglePin={handleTogglePin}
                        onToggleBlockClassDay={handleToggleBlockClassDay}
                        onToggleBlockGlobalDay={handleToggleBlockGlobalDay}
                        onToggleWeekType={handleToggleWeekType}
                    />
                )}
            </main>
        </div>
    );
}

export default App;
