import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { type AppState, type ClassSchedule, type Week, type Exam, type BlockedDays, type BlockedClassDays, type DayOfWeek } from './types';
import { distributeExams, autoFix } from './logic/solver';
import { ImportSection } from './components/ImportSection';
import { ConfigSection } from './components/ConfigSection';
import { SubjectSelection } from './components/SubjectSelection';
import { ScheduleEditor } from './components/ScheduleEditor';
import { CalendarBoard } from './components/CalendarBoard';
import { generatePDF } from './logic/pdfGenerator';
import { Download, Sparkles, Upload, RotateCcw } from 'lucide-react';

// Default initial weeks
const INITIAL_WEEKS: Week[] = [
  { id: uuidv4(), weekNumber: 45, year: 2024, isBlocked: false },
  { id: uuidv4(), weekNumber: 46, year: 2024, isBlocked: false },
  { id: uuidv4(), weekNumber: 47, year: 2024, isBlocked: false },
  { id: uuidv4(), weekNumber: 48, year: 2024, isBlocked: false },
];

const STORAGE_KEY = 'klausurplaner_v1';

function App() {
  // Initialize state from localStorage if available
  const [classes, setClasses] = useState<ClassSchedule[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).classes : [];
  });
  const [weeks, setWeeks] = useState<Week[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).weeks : INITIAL_WEEKS;
  });
  const [exams, setExams] = useState<Exam[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).exams : [];
  });
  const [blockedDays, setBlockedDays] = useState<BlockedDays>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).blockedDays : {};
  });
  const [blockedClassDays, setBlockedClassDays] = useState<BlockedClassDays>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).blockedClassDays : {};
  });
  const [selectedSubjects, setSelectedSubjects] = useState<Record<string, string[]>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).selectedSubjects : {};
  });

  const appState: AppState = { classes, weeks, exams, blockedDays, blockedClassDays, selectedSubjects };

  // Auto-save effect
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }, [classes, weeks, exams, blockedDays, blockedClassDays, selectedSubjects]);

  const handleImport = (schedules: ClassSchedule[]) => {
    setClasses(prev => {
      const updated = [...prev];
      for (const newCls of schedules) {
        const index = updated.findIndex(c => c.className === newCls.className);
        if (index >= 0) {
          updated[index] = newCls;
        } else {
          updated.push(newCls);
        }
      }
      return updated;
    });

    setSelectedSubjects(prev => {
      const next = { ...prev };
      for (const cls of schedules) {
        const unique = Array.from(new Set(Object.values(cls.subjects).flat()));
        next[cls.className] = unique;
      }
      return next;
    });
  };

  const handleUpdateClass = (updatedClass: ClassSchedule) => {
    setClasses(prev => prev.map(c => c.className === updatedClass.className ? updatedClass : c));
  };

  const handleDistribute = () => {
    // Initial Fresh Distribution
    const newExams = distributeExams(classes, weeks, blockedDays, selectedSubjects, blockedClassDays);
    setExams(newExams);
  };

  const handleAutoFix = () => {
    const fixed = autoFix(exams, classes, weeks, blockedDays, blockedClassDays);
    setExams(fixed);
  };

  const handleMoveExam = useCallback((examId: string, weekId: string | null, day: DayOfWeek | null) => {
    setExams(prev => prev.map(e => {
      if (e.id !== examId) return e;
      if (e.isPinned && (weekId !== e.assignedWeekId || day !== e.assignedDay)) {
        return { ...e, assignedWeekId: weekId, assignedDay: day };
      }
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
        // Validate minimally?
        if (json.classes && json.weeks) {
          setClasses(json.classes);
          setWeeks(json.weeks);
          setExams(json.exams || []);
          setBlockedDays(json.blockedDays || {});
          setBlockedClassDays(json.blockedClassDays || {});
          setSelectedSubjects(json.selectedSubjects || {});
        } else {
          alert('Ungültige Datei-Struktur');
        }
      } catch (err) {
        console.error(err);
        alert('Fehler beim Laden der Datei');
      }
    };
    reader.readAsText(file);
    // Reset value so same file can be selected again
    event.target.value = '';
  };

  const handleReset = () => {
    if (window.confirm('Möchtest du wirklich den gesamten Plan zurücksetzen? Alle unsicheren Änderungen gehen verloren.')) {
      localStorage.removeItem(STORAGE_KEY);
      setClasses([]);
      setWeeks(INITIAL_WEEKS);
      setExams([]);
      setBlockedDays({});
      setBlockedClassDays({});
      setSelectedSubjects({});
      window.location.reload(); // Hard reset to ensure clean state
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Klausurplaner AI
        </h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={handleReset}
            style={{
              background: 'var(--bg-panel)', color: 'var(--accent-danger)', border: '1px solid var(--border-color)',
              padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600
            }}
            title="Alles zurücksetzen"
          >
            <RotateCcw size={18} style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
            Reset
          </button>

          <label
            style={{
              background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
              padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center'
            }}
          >
            <Upload size={18} style={{ marginRight: '8px' }} />
            Load JSON
            <input type="file" accept=".json" onChange={handleLoadPlan} style={{ display: 'none' }} />
          </label>

          <button
            onClick={handleExport}
            style={{
              background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
              padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600
            }}
          >
            <Download size={18} style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
            Save JSON
          </button>

          <div style={{ width: '1px', background: 'var(--border-color)', margin: '0 0.5rem' }}></div>

          <button
            onClick={handleDistribute}
            disabled={classes.length === 0}
            className="btn-primary"
            style={{
              background: 'var(--accent-primary)', color: 'white', border: 'none',
              padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600,
              opacity: classes.length === 0 ? 0.5 : 1
            }}
          >
            <Sparkles size={18} style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
            Generate
          </button>

          <button
            onClick={handleAutoFix}
            disabled={exams.length === 0}
            style={{
              background: 'var(--bg-panel)', color: 'var(--accent-warning)', border: '1px solid var(--border-color)',
              padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600
            }}
          >
            Auto-Korrektur
          </button>

          <button
            onClick={() => generatePDF({ classes, weeks, exams, blockedDays, blockedClassDays, selectedSubjects })}
            disabled={classes.length === 0}
            style={{
              background: 'var(--bg-panel)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)',
              padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600
            }}
          >
            <Download size={18} style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
            PDF
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        <ImportSection onImport={handleImport} />
        <ConfigSection weeks={weeks} onUpdateWeeks={setWeeks} />
      </div>

      {classes.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
            <ScheduleEditor
              classes={classes}
              onUpdateClass={handleUpdateClass}
            />
            <SubjectSelection
              classes={classes}
              selectedSubjects={selectedSubjects}
              onUpdateSelection={setSelectedSubjects}
            />
          </div>

          <CalendarBoard
            state={appState}
            onMoveExam={handleMoveExam}
            onTogglePin={handleTogglePin}
            onToggleBlockClassDay={handleToggleBlockClassDay}
          />
        </>
      )}

      {classes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
          Bitte importiere deine Stundenpläne (JSON), um zu beginnen.
        </div>
      )}

    </div>
  );
}

export default App;
