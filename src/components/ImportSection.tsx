import { useEffect, useMemo, useState } from 'react';
import {
    FileJson,
    Copy,
    Check,
    Play,
    RefreshCw,
    LogIn,
    LogOut,
    KeyRound,
    School,
    Search,
    CheckSquare,
    Square,
    AlertCircle,
    Calendar,
} from 'lucide-react';
import { LLM_PROMPT } from '../logic/prompt';
import { formatISODate, formatShortDate, getWeekDayDate, getWeeksBetween } from '../logic/dateUtils';
import type { BlockedClassDays, BlockedDays, ClassSchedule, EdupageMeta, HolidayLabels, Week } from '../types';

interface EdupageClassInfo {
    id: string;
    name: string;
    short: string;
    gradeLevel: string;
}

export interface EdupageCalendarPayload {
    blockedDays?: BlockedDays;
    holidayLabels?: HolidayLabels;
    blockedClassDays?: BlockedClassDays;
}

interface ImportSectionProps {
    weeks: Week[];
    onUpdateWeeks: (weeks: Week[]) => void;
    onImport: (schedules: ClassSchedule[], meta?: EdupageMeta, calendarSync?: EdupageCalendarPayload) => void;
    onLoginStateChange?: (loggedIn: boolean) => void;
    edupageMeta?: EdupageMeta;
    bridgeOnline: boolean;
    edupageApiAvailable: boolean;
}

export function ImportSection({
    weeks,
    onUpdateWeeks,
    onImport,
    onLoginStateChange,
    edupageMeta,
    bridgeOnline,
    edupageApiAvailable,
}: ImportSectionProps) {
    const [activeTab, setActiveTab] = useState<'edupage' | 'json'>('edupage');

    // JSON import state
    const [jsonText, setJsonText] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // EduPage state
    const [subdomain, setSubdomain] = useState(edupageMeta?.subdomain || '');
    const [username, setUsername] = useState(edupageMeta?.username || '');
    const [password, setPassword] = useState('');
    const [rememberCredentials, setRememberCredentials] = useState(true);
    const [hasSavedPassword, setHasSavedPassword] = useState(false);

    const [loggedIn, setLoggedIn] = useState(false);
    const [needs2FA, setNeeds2FA] = useState(false);
    const [twoFaCode, setTwoFaCode] = useState('');
    const [edupageClasses, setEdupageClasses] = useState<EdupageClassInfo[]>([]);
    const [selectedClassIds, setSelectedClassIds] = useState<string[]>(edupageMeta?.selectedClassIds || []);
    const [classSearch, setClassSearch] = useState('');
    const [gradeFilter, setGradeFilter] = useState<string>('Alle');
    const [useShortSubjects, setUseShortSubjects] = useState(true);

    const [loadingLogin, setLoadingLogin] = useState(false);
    const [loadingFetch, setLoadingFetch] = useState(false);
    const [edupageError, setEdupageError] = useState<string | null>(null);
    const [edupageStatus, setEdupageStatus] = useState<string | null>(null);

    const periodStartIso = useMemo(
        () => (weeks.length > 0 ? formatISODate(getWeekDayDate(weeks[0], 'Monday')) : formatISODate(new Date())),
        [weeks]
    );
    const periodEndIso = useMemo(
        () =>
            weeks.length > 0
                ? formatISODate(getWeekDayDate(weeks[weeks.length - 1], 'Friday'))
                : formatISODate(new Date()),
        [weeks]
    );

    const handlePeriodRangeChange = (nextStartIso: string, nextEndIso: string) => {
        if (!nextStartIso || !nextEndIso) return;
        const [sy, sm, sd] = nextStartIso.split('-').map(Number);
        const [ey, em, ed] = nextEndIso.split('-').map(Number);
        if (!sy || !sm || !sd || !ey || !em || !ed) return;
        const startD = new Date(sy, sm - 1, sd);
        const endD = new Date(ey, em - 1, ed);
        if (endD < startD) {
            onUpdateWeeks(getWeeksBetween(startD, startD, weeks));
        } else {
            onUpdateWeeks(getWeeksBetween(startD, endD, weeks));
        }
    };

    // Load saved EduPage config / active session from local bridge
    useEffect(() => {
        if (!bridgeOnline) return;
        let cancelled = false;
        fetch('/api/edupage/config')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data || cancelled) return;
                if (data.subdomain) setSubdomain((prev) => prev || data.subdomain);
                if (data.username) setUsername((prev) => prev || data.username);
                if (typeof data.rememberCredentials === 'boolean') {
                    setRememberCredentials(data.rememberCredentials);
                }
                setHasSavedPassword(!!data.hasSavedPassword);
                if (data.loggedIn && Array.isArray(data.classes)) {
                    setLoggedIn(true);
                    setEdupageClasses(data.classes);
                    onLoginStateChange?.(true);
                }
            })
            .catch(() => {
                // Ignore if bridge not reachable
            });
        return () => {
            cancelled = true;
        };
    }, [bridgeOnline, onLoginStateChange]);

    const availableGrades = useMemo(() => {
        const set = new Set<string>();
        edupageClasses.forEach((c) => {
            if (c.gradeLevel) set.add(c.gradeLevel);
        });
        return ['Alle', ...Array.from(set).sort()];
    }, [edupageClasses]);

    const filteredClasses = useMemo(() => {
        const q = classSearch.trim().toLowerCase();
        return edupageClasses.filter((c) => {
            const matchesSearch =
                !q ||
                c.name.toLowerCase().includes(q) ||
                c.gradeLevel.toLowerCase().includes(q);
            const matchesGrade = gradeFilter === 'Alle' || c.gradeLevel === gradeFilter;
            return matchesSearch && matchesGrade;
        });
    }, [edupageClasses, classSearch, gradeFilter]);

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(LLM_PROMPT);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleJsonImport = () => {
        setJsonError(null);
        try {
            if (!jsonText.trim()) {
                setJsonError('Bitte erst JSON einfügen.');
                return;
            }
            const parsed = JSON.parse(jsonText);
            const schedules: ClassSchedule[] = Array.isArray(parsed) ? parsed : [parsed];
            const valid = schedules.every((s) => s.className && s.subjects);
            if (!valid) {
                throw new Error("Ungültige Struktur. Erwarte Objekt(e) mit 'className' und 'subjects'.");
            }
            onImport(schedules);
            setJsonText('');
        } catch (err) {
            setJsonError('Ungültiges JSON-Format. Bitte Eingabe prüfen.');
            console.error(err);
        }
    };

    const handleEdupageLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setEdupageError(null);
        setEdupageStatus(null);
        setLoadingLogin(true);

        try {
            const res = await fetch('/api/edupage/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subdomain: subdomain.trim(),
                    username: username.trim(),
                    password,
                    useSavedPassword: !password && hasSavedPassword,
                    rememberCredentials,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Anmeldung fehlgeschlagen.');
            }

            if (data.status === '2fa_required') {
                setNeeds2FA(true);
                setEdupageStatus(data.message || 'Bitte 2FA-Code eingeben.');
                return;
            }

            setNeeds2FA(false);
            setLoggedIn(true);
            setEdupageClasses(data.classes || []);
            onLoginStateChange?.(true);
            if (rememberCredentials && password) {
                setHasSavedPassword(true);
            }
            setPassword('');
            setEdupageStatus(
                `Verbunden mit ${data.subdomain}.edupage.org (${(data.classes || []).length} Klassen geladen).`
            );
        } catch (err: unknown) {
            setEdupageError(err instanceof Error ? err.message : 'Fehler bei der Anmeldung.');
        } finally {
            setLoadingLogin(false);
        }
    };

    const handleVerify2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        setEdupageError(null);
        setLoadingLogin(true);
        try {
            const res = await fetch('/api/edupage/2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: twoFaCode.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '2FA-Prüfung fehlgeschlagen.');
            }
            setNeeds2FA(false);
            setTwoFaCode('');
            setLoggedIn(true);
            setEdupageClasses(data.classes || []);
            onLoginStateChange?.(true);
            setEdupageStatus(`2FA bestätigt (${(data.classes || []).length} Klassen geladen).`);
        } catch (err: unknown) {
            setEdupageError(err instanceof Error ? err.message : '2FA fehlgeschlagen.');
        } finally {
            setLoadingLogin(false);
        }
    };

    const handle2faAction = async (action: 'check_confirmed' | 'send_email') => {
        setEdupageError(null);
        setLoadingLogin(true);
        try {
            const res = await fetch('/api/edupage/2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '2FA-Aktion fehlgeschlagen.');
            }
            if (data.status === 'email_sent') {
                setEdupageStatus(data.message || 'Bestätigungscode wurde per E-Mail gesendet.');
                return;
            }
            setNeeds2FA(false);
            setTwoFaCode('');
            setLoggedIn(true);
            setEdupageClasses(data.classes || []);
            onLoginStateChange?.(true);
            setEdupageStatus(`2FA bestätigt (${(data.classes || []).length} Klassen geladen).`);
        } catch (err: unknown) {
            setEdupageError(err instanceof Error ? err.message : '2FA fehlgeschlagen.');
        } finally {
            setLoadingLogin(false);
        }
    };

    const handleEdupageLogout = async () => {
        try {
            await fetch('/api/edupage/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clearSaved: false }),
            });
        } catch {
            // ignore
        }
        setLoggedIn(false);
        onLoginStateChange?.(false);
        setNeeds2FA(false);
        setEdupageClasses([]);
        setEdupageStatus(null);
    };

    const toggleClassSelection = (id: string) => {
        setSelectedClassIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const selectAllFiltered = () => {
        const filteredIds = filteredClasses.map((c) => c.id);
        const allSelected =
            filteredIds.length > 0 && filteredIds.every((id) => selectedClassIds.includes(id));
        if (allSelected) {
            setSelectedClassIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
        } else {
            setSelectedClassIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
        }
    };

    const handleFetchTimetables = async () => {
        if (selectedClassIds.length === 0) {
            setEdupageError('Bitte mindestens eine Klasse auswählen.');
            return;
        }
        if (weeks.length === 0) {
            setEdupageError('Bitte zuerst einen gültigen Klausurzeitraum festlegen.');
            return;
        }
        setEdupageError(null);
        setEdupageStatus(null);
        setLoadingFetch(true);
        try {
            const res = await fetch('/api/edupage/fetch-timetables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    classIds: selectedClassIds,
                    weeks: weeks.map((w) => ({
                        id: w.id,
                        year: w.year,
                        weekNumber: w.weekNumber,
                    })),
                    useShortSubjects,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Stundenpläne konnten nicht abgerufen werden.');
            }
            const schedules: ClassSchedule[] = data.schedules || [];
            if (schedules.length === 0) {
                throw new Error('Keine Stundenpläne gefunden.');
            }

            const blockedDays = (data.blockedDays || {}) as BlockedDays;
            const holidayLabels = (data.holidayLabels || {}) as HolidayLabels;
            const blockedClassDays = (data.blockedClassDays || {}) as BlockedClassDays;

            onImport(
                schedules,
                {
                    subdomain: subdomain.trim(),
                    username: username.trim(),
                    lastSyncAt: data.fetchedAt || new Date().toISOString(),
                    lastHolidaySyncAt: data.fetchedAt || new Date().toISOString(),
                    selectedClassIds,
                    useShortSubjects,
                },
                { blockedDays, holidayLabels, blockedClassDays }
            );

            const globalHolCount = Object.values(blockedDays).reduce(
                (acc, dayMap) => acc + Object.values(dayMap).filter(Boolean).length,
                0
            );
            const classFreeCount = Object.values(blockedClassDays).reduce(
                (acc, wMap) =>
                    acc +
                    Object.values(wMap).reduce(
                        (a2, dMap) => a2 + Object.values(dMap).filter(Boolean).length,
                        0
                    ),
                0
            );
            const activeDays = Number(data.activeSchoolDaysFound || 0);
            const warnPart =
                data.errors && data.errors.length > 0
                    ? ` (${data.errors.length} Hinweise: ${data.errors.join('; ')})`
                    : '';

            if (activeDays === 0) {
                setEdupageStatus(
                    `${schedules.length} Klassen abgerufen – Hinweis: Für diesen Zeitraum sind in EduPage noch keine Unterrichtsstunden hinterlegt.${warnPart}`
                );
            } else {
                setEdupageStatus(
                    `${schedules.length} Klassen über ${weeks.length} Wochen abgerufen · ${globalHolCount} schulfreie Tage/Ferien, ${classFreeCount} klassenbezogene freie Tage (z. B. Ausflug) gesperrt.${warnPart}`
                );
            }
        } catch (err: unknown) {
            setEdupageError(
                err instanceof Error ? err.message : 'Fehler beim Abrufen der Stundenpläne.'
            );
        } finally {
            setLoadingFetch(false);
        }
    };

    return (
        <div className="ui-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <School size={19} color="var(--accent-primary)" />
                        Stundenpläne aus EduPage oder JSON importieren
                    </h3>
                    {edupageMeta?.lastSyncAt && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Letzter Abruf:{' '}
                            {new Date(edupageMeta.lastSyncAt).toLocaleString('de-DE', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                            })}
                        </p>
                    )}
                </div>

                {/* Mode switch */}
                <div
                    style={{
                        display: 'inline-flex',
                        padding: '3px',
                        borderRadius: '10px',
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-subtle)',
                        gap: '2px',
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setActiveTab('edupage')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '5px 10px',
                            borderRadius: '7px',
                            border: 'none',
                            background: activeTab === 'edupage' ? 'var(--bg-surface)' : 'transparent',
                            color: activeTab === 'edupage' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            boxShadow: activeTab === 'edupage' ? 'var(--shadow-sm)' : 'none',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                        }}
                    >
                        <School size={15} />
                        EduPage Direktimport
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('json')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '5px 10px',
                            borderRadius: '7px',
                            border: 'none',
                            background: activeTab === 'json' ? 'var(--bg-surface)' : 'transparent',
                            color: activeTab === 'json' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            boxShadow: activeTab === 'json' ? 'var(--shadow-sm)' : 'none',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                        }}
                    >
                        <FileJson size={15} />
                        JSON / LLM-Import
                    </button>
                </div>
            </div>

            {activeTab === 'edupage' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {!bridgeOnline ? (
                        <div
                            style={{
                                padding: '0.85rem 1rem',
                                borderRadius: '8px',
                                background: 'var(--accent-warning-soft)',
                                border: '1px solid var(--accent-warning)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem',
                            }}
                        >
                            <strong>Lokale EduPage-Bridge nicht aktiv.</strong> Starte die App lokal mit{' '}
                            <code style={{ background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>
                                npm run dev:local
                            </code>{' '}
                            (einmalig: <code style={{ background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>npm run setup:edupage</code>), um dich direkt bei EduPage anzumelden.
                        </div>
                    ) : !edupageApiAvailable ? (
                        <div
                            style={{
                                padding: '0.85rem 1rem',
                                borderRadius: '8px',
                                background: 'var(--accent-danger-soft)',
                                border: '1px solid var(--accent-danger)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem',
                            }}
                        >
                            <strong>Python-Paket fehlt:</strong> Bitte einmalig{' '}
                            <code style={{ background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>
                                npm run setup:edupage
                            </code>{' '}
                            ausführen, damit <code style={{ background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>edupage-api</code> installiert wird.
                        </div>
                    ) : !loggedIn && !needs2FA ? (
                        <form onSubmit={handleEdupageLogin} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                        Schul-Subdomain
                                    </label>
                                    <input
                                        type="text"
                                        className="ui-input"
                                        placeholder="z. B. meineschule"
                                        value={subdomain}
                                        onChange={(e) => setSubdomain(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                        Benutzername / E-Mail
                                    </label>
                                    <input
                                        type="text"
                                        className="ui-input"
                                        placeholder="EduPage Login"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                        Passwort
                                    </label>
                                    <input
                                        type="password"
                                        className="ui-input"
                                        placeholder={hasSavedPassword ? '•••••• (gespeichert)' : 'Passwort'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={rememberCredentials}
                                        onChange={(e) => setRememberCredentials(e.target.checked)}
                                    />
                                    Zugangsdaten lokal speichern (nur auf diesem Rechner)
                                </label>

                                <button
                                    type="submit"
                                    disabled={loadingLogin}
                                    className="ui-btn ui-btn-primary"
                                >
                                    <LogIn size={16} />
                                    {loadingLogin ? 'Melde an...' : 'Mit EduPage verbinden'}
                                </button>
                            </div>
                        </form>
                    ) : needs2FA ? (
                        <form onSubmit={handleVerify2FA} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '220px' }}>
                                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                    2FA-Bestätigungscode
                                </label>
                                <input
                                    type="text"
                                    className="ui-input"
                                    placeholder="Code aus E-Mail / Authenticator"
                                    value={twoFaCode}
                                    onChange={(e) => setTwoFaCode(e.target.value)}
                                />
                            </div>
                            <button type="submit" disabled={loadingLogin} className="ui-btn ui-btn-primary">
                                <KeyRound size={15} />
                                {loadingLogin ? 'Prüfe...' : 'Code bestätigen'}
                            </button>
                            <button
                                type="button"
                                disabled={loadingLogin}
                                onClick={() => handle2faAction('check_confirmed')}
                                className="ui-btn"
                            >
                                App-Freigabe prüfen
                            </button>
                            <button
                                type="button"
                                disabled={loadingLogin}
                                onClick={() => handle2faAction('send_email')}
                                className="ui-btn"
                            >
                                E-Mail-Code senden
                            </button>
                        </form>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.86rem', color: 'var(--accent-success)', fontWeight: 700 }}>
                                    Verbunden mit {subdomain || 'EduPage'} ({username})
                                </span>
                                <button type="button" onClick={handleEdupageLogout} className="ui-btn" style={{ padding: '4px 10px', fontSize: '0.78rem' }}>
                                    <LogOut size={14} />
                                    Trennen
                                </button>
                            </div>

                            {/* Filter & search for classes */}
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                                    <Search
                                        size={14}
                                        style={{
                                            position: 'absolute',
                                            left: '10px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            color: 'var(--text-muted)',
                                        }}
                                    />
                                    <input
                                        type="text"
                                        className="ui-input"
                                        placeholder="Klassen / Bildungsgang filtern..."
                                        value={classSearch}
                                        onChange={(e) => setClassSearch(e.target.value)}
                                        style={{ paddingLeft: '30px', fontSize: '0.84rem' }}
                                    />
                                </div>

                                <select
                                    className="ui-input"
                                    style={{ width: 'auto', fontSize: '0.84rem' }}
                                    value={gradeFilter}
                                    onChange={(e) => setGradeFilter(e.target.value)}
                                >
                                    {availableGrades.map((g) => (
                                        <option key={g} value={g}>
                                            {g === 'Alle' ? 'Alle Stufen' : `Stufe ${g}`}
                                        </option>
                                    ))}
                                </select>

                                <button type="button" className="ui-btn" onClick={selectAllFiltered} style={{ fontSize: '0.8rem' }}>
                                    Gefilterte an-/abwählen ({filteredClasses.length})
                                </button>
                            </div>

                            {/* Class chips */}
                            <div
                                style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '0.4rem',
                                    maxHeight: '170px',
                                    overflowY: 'auto',
                                    padding: '0.6rem',
                                    background: 'var(--bg-panel)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-subtle)',
                                }}
                            >
                                {filteredClasses.map((cls) => {
                                    const checked = selectedClassIds.includes(cls.id);
                                    return (
                                        <button
                                            key={cls.id}
                                            type="button"
                                            onClick={() => toggleClassSelection(cls.id)}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                padding: '4px 9px',
                                                borderRadius: '6px',
                                                border: '1px solid',
                                                borderColor: checked ? 'var(--accent-primary)' : 'var(--border-color)',
                                                background: checked ? 'var(--accent-soft)' : 'var(--bg-surface)',
                                                color: checked ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                                fontWeight: checked ? 700 : 500,
                                                fontSize: '0.8rem',
                                            }}
                                        >
                                            {checked ? <CheckSquare size={13} /> : <Square size={13} />}
                                            {cls.name}
                                        </button>
                                    );
                                })}
                                {filteredClasses.length === 0 && (
                                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                        Keine Klassen passend zum Filter gefunden.
                                    </span>
                                )}
                            </div>

                            {/* Klausurzeitraum wählen -> konkreter Wochen-Abruf */}
                            <div
                                style={{
                                    padding: '0.75rem 0.9rem',
                                    borderRadius: '8px',
                                    background: 'var(--bg-surface)',
                                    border: '1px solid var(--border-subtle)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.65rem',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <Calendar size={14} color="var(--accent-primary)" />
                                        Klausurzeitraum für den Abruf
                                    </span>
                                    {weeks.length > 0 && (
                                        <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                                            KW {weeks[0].weekNumber}–{weeks[weeks.length - 1].weekNumber} ({weeks.length}{' '}
                                            {weeks.length === 1 ? 'Woche' : 'Wochen'} ·{' '}
                                            {formatShortDate(getWeekDayDate(weeks[0], 'Monday'))}–
                                            {formatShortDate(getWeekDayDate(weeks[weeks.length - 1], 'Friday'))})
                                        </span>
                                    )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                            Von (Startdatum)
                                        </label>
                                        <input
                                            type="date"
                                            className="ui-input"
                                            value={periodStartIso}
                                            onChange={(e) => handlePeriodRangeChange(e.target.value, periodEndIso)}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                            Bis (Enddatum)
                                        </label>
                                        <input
                                            type="date"
                                            className="ui-input"
                                            value={periodEndIso}
                                            onChange={(e) => handlePeriodRangeChange(periodStartIso, e.target.value)}
                                        />
                                    </div>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem', color: 'var(--text-secondary)', cursor: 'pointer', paddingBottom: '7px' }}>
                                        <input
                                            type="checkbox"
                                            checked={useShortSubjects}
                                            onChange={(e) => setUseShortSubjects(e.target.checked)}
                                        />
                                        Fach-Kürzel verwenden (z. B. M, D)
                                    </label>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    Jede Woche wird exakt abgerufen: welche Fächer wann stattfinden und an welchen Tagen eine Klasse keinen Unterricht hat (Ferien, Feiertage, Ausflüge).
                                </span>
                                <button
                                    type="button"
                                    onClick={handleFetchTimetables}
                                    disabled={loadingFetch || selectedClassIds.length === 0 || weeks.length === 0}
                                    className="ui-btn ui-btn-primary"
                                >
                                    <RefreshCw size={15} />
                                    {loadingFetch
                                        ? `Rufe ${weeks.length} Wochen ab...`
                                        : `Unterricht für Zeitraum abrufen (${selectedClassIds.length})`}
                                </button>
                            </div>
                        </div>
                    )}

                    {edupageError && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                            <AlertCircle size={15} />
                            {edupageError}
                        </div>
                    )}
                    {edupageStatus && (
                        <div style={{ color: 'var(--accent-success)', fontSize: '0.85rem', fontWeight: 600 }}>
                            {edupageStatus}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'json' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        1. Prompt kopieren. 2. Stundenplan-Bilder per KI in JSON umwandeln. 3. JSON unten einfügen und importieren.
                    </p>

                    <div>
                        <button type="button" onClick={handleCopyPrompt} className="ui-btn">
                            {copied ? <Check size={15} color="var(--accent-success)" /> : <Copy size={15} />}
                            {copied ? 'Prompt kopiert!' : 'LLM Prompt kopieren'}
                        </button>
                    </div>

                    <textarea
                        value={jsonText}
                        onChange={(e) => setJsonText(e.target.value)}
                        placeholder='JSON hier einfügen... z.B. { "className": "10A", "subjects": { ... } }'
                        className="ui-input"
                        style={{
                            minHeight: '140px',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            resize: 'vertical',
                            borderColor: jsonError ? 'var(--accent-danger)' : undefined,
                        }}
                    />

                    {jsonError && <div style={{ color: 'var(--accent-danger)', fontSize: '0.85rem' }}>{jsonError}</div>}

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={handleJsonImport} className="ui-btn ui-btn-primary">
                            <Play size={15} />
                            Daten importieren
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
