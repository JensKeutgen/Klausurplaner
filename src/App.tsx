import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type AppState,
  type ClassSchedule,
  type Week,
  type Exam,
  type BlockedDays,
  type BlockedClassDays,
  type DayOfWeek,
  type PdfSettings,
  type SolverSettings,
  type EdupageMeta,
  DEFAULT_SOLVER_SETTINGS,
} from './types';
import { distributeExams, autoFix, inferGradeLevel } from './logic/solver';
import { formatWeekId, getWeeksBetween } from './logic/dateUtils';
import { ImportSection } from './components/ImportSection';
import { ConfigSection } from './components/ConfigSection';
import { SubjectSelection } from './components/SubjectSelection';
import { ScheduleEditor } from './components/ScheduleEditor';
import { CalendarBoard } from './components/CalendarBoard';
import { generatePDF } from './logic/pdfGenerator';
import { Download, Sparkles, Upload, RotateCcw, ChevronDown, ChevronUp, HardDrive } from 'lucide-react';

function createDefaultWeeks(): Week[] {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 21);
  return getWeeksBetween(start, end);
}

const STORAGE_KEY = 'klausurplaner_v1';

const DEFAULT_PDF_SETTINGS: PdfSettings = {
  title: 'Klausurplanung 2026 – 1. Quartal',
  makeupExamInfo: '**',
  gradesDueDate: '27.10.',
};

/**
 * Normalizes loaded state (e.g. migrates legacy UUID week IDs to deterministic YYYY-KWxx IDs)
 * so existing assignments and blocked days are preserved.
 */
function normalizeAppState(raw: Partial<AppState> | null | undefined): AppState {
  const rawWeeks = Array.isArray(raw?.weeks) && raw.weeks.length > 0 ? raw.weeks : createDefaultWeeks();
  const weekIdMap = new Map<string, string>();
  const weeks: Week[] = rawWeeks.map((w) => {
    const canonicalId = formatWeekId(w.year, w.weekNumber);
    if (w.id !== canonicalId) {
      weekIdMap.set(w.id, canonicalId);
    }
    return { ...w, id: canonicalId };
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

  const blockedClassDays: BlockedClassDays = {};
  for (const [clsName, clsWeeks] of Object.entries(raw?.blockedClassDays || {})) {
    blockedClassDays[clsName] = {};
    for (const [wId, daysMap] of Object.entries(clsWeeks || {})) {
      const mappedId = weekIdMap.get(wId) || wId;
      blockedClassDays[clsName][mappedId] = { ...(blockedClassDays[clsName][mappedId] || {}), ...daysMap };
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
    blockedClassDays,
    selectedSubjects: raw?.selectedSubjects || {},
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

  const [classes, setClasses] = useState<ClassSchedule[]>(initialState.classes);
  const [weeks, setWeeks] = useState<Week[]>(initialState.weeks);
  const [exams, setExams] = useState<Exam[]>(initialState.exams);
  const [blockedDays, setBlockedDays] = useState<BlockedDays>(initialState.blockedDays);
  const [blockedClassDays, setBlockedClassDays] = useState<BlockedClassDays>(initialState.blockedClassDays);
  const [selectedSubjects, setSelectedSubjects] = useState<Record<string, string[]>>(initialState.selectedSubjects);
  const [pdfSettings, setPdfSettings] = useState<PdfSettings>(initialState.pdfSettings);
  const [solverSettings, setSolverSettings] = useState<SolverSettings>(
    initialState.solverSettings || DEFAULT_SOLVER_SETTINGS
  );
  const [edupageMeta, setEdupageMeta] = useState<EdupageMeta | undefined>(initialState.edupageMeta);

  // Local bridge status & file persistence state
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [edupageApiAvailable, setEdupageApiAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'browser' | 'synced' | 'saving'>('browser');
  const hydratedFromDiskRef = useRef(false);

  // Collapse State
  const [collapsed, setCollapsed] = useState({
    import: false,
    config: false,
    schedule: false,
    subjects: false
  });

  const toggleCollapse = (section: keyof typeof collapsed) => {
    setCollapsed(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleAll = (shouldCollapse: boolean) => {
    setCollapsed({
      import: shouldCollapse,
      config: shouldCollapse,
      schedule: shouldCollapse,
      subjects: shouldCollapse
    });
  };

  const appState: AppState = useMemo(
    () => ({
      classes,
      weeks,
      exams,
      blockedDays,
      blockedClassDays,
      selectedSubjects,
      pdfSettings,
      solverSettings,
      edupageMeta,
    }),
    [classes, weeks, exams, blockedDays, blockedClassDays, selectedSubjects, pdfSettings, solverSettings, edupageMeta]
  );

  // Check local bridge health & hydrate from disk file if localStorage is empty
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
          // If localStorage had no classes yet, restore automatically from disk
          const hasLocalClasses = Boolean(localStorage.getItem(STORAGE_KEY) && JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')?.classes?.length);
          if (!hasLocalClasses) {
            const stateRes = await fetch('/api/state');
            if (stateRes.ok && !cancelled) {
              const payload = await stateRes.json();
              if (payload?.state) {
                const norm = normalizeAppState(payload.state);
                setClasses(norm.classes);
                setWeeks(norm.weeks);
                setExams(norm.exams);
                setBlockedDays(norm.blockedDays);
                setBlockedClassDays(norm.blockedClassDays);
                setSelectedSubjects(norm.selectedSubjects);
                setPdfSettings(norm.pdfSettings);
                if (norm.solverSettings) setSolverSettings(norm.solverSettings);
                if (norm.edupageMeta) setEdupageMeta(norm.edupageMeta);
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
  }, []);

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
    // Non-destructive merge: preserve existing gradeLevel edits
    setClasses(prev => {
      const updated = [...prev];
      for (const rawNew of schedules) {
        const newCls: ClassSchedule = {
          ...rawNew,
          gradeLevel: rawNew.gradeLevel || inferGradeLevel(rawNew.className),
        };
        const index = updated.findIndex(c => c.className === newCls.className);
        if (index >= 0) {
          updated[index] = {
            ...newCls,
            gradeLevel: updated[index].gradeLevel || newCls.gradeLevel,
          };
        } else {
          updated.push(newCls);
        }
      }
      return updated;
    });

    // Non-destructive subject selection: preserve unchecked subjects for existing classes,
    // auto-select only newly discovered subjects!
    setSelectedSubjects(prev => {
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
          const existingClass = classes.find((c) => c.className === cls.className);
          const oldAll = existingClass
            ? new Set([
                ...Object.values(existingClass.subjects).flat(),
                ...(existingClass.subjectsB ? Object.values(existingClass.subjectsB).flat() : []),
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
    }
  };

  const handleUpdateClass = (updatedClass: ClassSchedule) => {
    setClasses(prev => prev.map(c => c.className === updatedClass.className ? updatedClass : c));
  };

  const handleDistribute = () => {
    const newExams = distributeExams(
      classes,
      weeks,
      blockedDays,
      selectedSubjects,
      blockedClassDays,
      exams,
      solverSettings
    );
    setExams(newExams);
  };

  const handleAutoFix = () => {
    const fixed = autoFix(exams, classes, weeks, blockedDays, blockedClassDays, solverSettings);
    setExams(fixed);
  };

  const handleMoveExam = useCallback((examId: string, weekId: string | null, day: DayOfWeek | null) => {
    setExams(prev => prev.map(e => {
      if (e.id !== examId) return e;
      return { ...e, assignedWeekId: weekId, assignedDay: day };
    }));
  }, []);

  const handleTogglePin = (examId: string) => {
    setExams(prev => prev.map(e => e.id === examId ? { ...e, isPinned: !e.isPinned } : e));
  };

  const handleToggleBlockClassDay = (className: string, weekId: string, day: DayOfWeek) => {
    setBlockedClassDays(prev => {
      const classBlocks = prev[className] || {};
      const weekBlocks = classBlocks[weekId] || {};
      const isBlocked = weekBlocks[day];

      return {
        ...prev,
        [className]: {
          ...classBlocks,
          [weekId]: {
            ...weekBlocks,
            [day]: !isBlocked
          }
        }
      };
    });
  };

  const handleToggleBlockGlobalDay = (weekId: string, day: DayOfWeek) => {
    setBlockedDays(prev => {
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
    setWeeks(prev => prev.map(w => w.id === weekId ? { ...w, weekType: w.weekType === 'A' ? 'B' : 'A' } : w));
  };

  const handleUpdatePdfSettings = (settings: PdfSettings) => {
    setPdfSettings(settings);
  };

  const handleExport = () => {
    const data = appState;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'klausurplan.json';
    a.click();
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
          setClasses(norm.classes);
          setWeeks(norm.weeks);
          setExams(norm.exams);
          setBlockedDays(norm.blockedDays);
          setBlockedClassDays(norm.blockedClassDays);
          setSelectedSubjects(norm.selectedSubjects);
          setPdfSettings(norm.pdfSettings);
          if (norm.solverSettings) setSolverSettings(norm.solverSettings);
          if (norm.edupageMeta) setEdupageMeta(norm.edupageMeta);
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
    if (window.confirm('Möchtest du wirklich den gesamten Plan zurücksetzen? Alle ungesicherten Änderungen gehen verloren.')) {
      localStorage.removeItem(STORAGE_KEY);
      const fresh = normalizeAppState(null);
      setClasses(fresh.classes);
      setWeeks(fresh.weeks);
      setExams(fresh.exams);
      setBlockedDays(fresh.blockedDays);
      setBlockedClassDays(fresh.blockedClassDays);
      setSelectedSubjects(fresh.selectedSubjects);
      setPdfSettings(fresh.pdfSettings);
      setSolverSettings(DEFAULT_SOLVER_SETTINGS);
      setEdupageMeta(undefined);
      if (bridgeOnline) {
        fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: fresh }),
        }).catch(() => {});
      }
    }
  };

  const areAllCollapsed = Object.values(collapsed).every(Boolean);

  return (
    <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Klausurplaner AI
          </h1>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.75rem',
              padding: '3px 8px',
              borderRadius: '999px',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              color: saveStatus === 'synced' ? 'var(--accent-success)' : 'var(--text-secondary)',
            }}
            title={
              saveStatus === 'synced'
                ? 'Alle Änderungen werden automatisch im Browser und in server/data/klausurplan.json gespeichert.'
                : 'Alle Änderungen werden automatisch im Browser gespeichert.'
            }
          >
            <HardDrive size={12} />
            {saveStatus === 'saving'
              ? 'Speichere...'
              : saveStatus === 'synced'
                ? 'Auto-Save: Lokal + Datei ✓'
                : 'Auto-Save: Browser ✓'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => toggleAll(!areAllCollapsed)}
            style={{
              background: 'var(--bg-panel)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)',
              padding: '0.65rem 0.9rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.9rem'
            }}
            title={areAllCollapsed ? "Alle ausklappen" : "Alle einklappen"}
          >
            {areAllCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>

          <button
            onClick={handleReset}
            style={{
              background: 'var(--bg-panel)', color: 'var(--accent-danger)', border: '1px solid var(--border-color)',
              padding: '0.65rem 1.1rem', borderRadius: '6px', fontWeight: 600
            }}
            title="Alles zurücksetzen"
          >
            <RotateCcw size={17} style={{ marginRight: '6px', verticalAlign: 'text-bottom' }} />
            Reset
          </button>

          <label
            style={{
              background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
              padding: '0.65rem 1.1rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center'
            }}
          >
            <Upload size={17} style={{ marginRight: '6px' }} />
            Load JSON
            <input type="file" accept=".json" onChange={handleLoadPlan} style={{ display: 'none' }} />
          </label>

          <button
            onClick={handleExport}
            style={{
              background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
              padding: '0.65rem 1.1rem', borderRadius: '6px', fontWeight: 600
            }}
          >
            <Download size={17} style={{ marginRight: '6px', verticalAlign: 'text-bottom' }} />
            Save JSON
          </button>

          <button
            onClick={handleDistribute}
            disabled={classes.length === 0}
            className="btn-primary"
            style={{
              background: 'var(--accent-primary)', color: 'white', border: 'none',
              padding: '0.65rem 1.25rem', borderRadius: '6px', fontWeight: 600,
              opacity: classes.length === 0 ? 0.5 : 1
            }}
          >
            <Sparkles size={17} style={{ marginRight: '6px', verticalAlign: 'text-bottom' }} />
            Generate
          </button>

          <button
            onClick={handleAutoFix}
            disabled={exams.length === 0}
            style={{
              background: 'var(--bg-panel)', color: 'var(--accent-warning)', border: '1px solid var(--border-color)',
              padding: '0.65rem 1.1rem', borderRadius: '6px', fontWeight: 600,
              opacity: exams.length === 0 ? 0.5 : 1
            }}
          >
            Auto-Korrektur
          </button>

          <button
            onClick={() => generatePDF(appState)}
            disabled={classes.length === 0}
            style={{
              background: 'var(--bg-panel)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)',
              padding: '0.65rem 1.1rem', borderRadius: '6px', fontWeight: 600,
              opacity: classes.length === 0 ? 0.5 : 1
            }}
          >
            <Download size={17} style={{ marginRight: '6px', verticalAlign: 'text-bottom' }} />
            PDF
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        {/* Left Column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <ImportSection
            onImport={handleImport}
            edupageMeta={edupageMeta}
            bridgeOnline={bridgeOnline}
            edupageApiAvailable={edupageApiAvailable}
            isCollapsed={collapsed.import}
            onToggle={() => toggleCollapse('import')}
          />
          {classes.length > 0 && (
            <ScheduleEditor
              classes={classes}
              onUpdateClass={handleUpdateClass}
              isCollapsed={collapsed.schedule}
              onToggle={() => toggleCollapse('schedule')}
            />
          )}
        </div>

        {/* Right Column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <ConfigSection
            weeks={weeks}
            onUpdateWeeks={setWeeks}
            pdfSettings={pdfSettings}
            onUpdatePdfSettings={handleUpdatePdfSettings}
            solverSettings={solverSettings}
            onUpdateSolverSettings={setSolverSettings}
            isCollapsed={collapsed.config}
            onToggle={() => toggleCollapse('config')}
          />
          {classes.length > 0 && (
            <SubjectSelection
              classes={classes}
              selectedSubjects={selectedSubjects}
              onUpdateSelection={setSelectedSubjects}
              isCollapsed={collapsed.subjects}
              onToggle={() => toggleCollapse('subjects')}
            />
          )}
        </div>
      </div>

      <CalendarBoard
        state={appState}
        onMoveExam={handleMoveExam}
        onTogglePin={handleTogglePin}
        onToggleBlockClassDay={handleToggleBlockClassDay}
        onToggleBlockGlobalDay={handleToggleBlockGlobalDay}
        onToggleWeekType={handleToggleWeekType}
      />

      {classes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
          Bitte importiere deine Stundenpläne über EduPage oder JSON, um zu beginnen.
        </div>
      )}

    </div>
  );
}

export default App;
