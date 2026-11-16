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
import { formatISODate, getISOWeek, inferWeekParityFromDate } from '../logic/dateUtils';
import type { ClassSchedule, EdupageMeta } from '../types';

interface EdupageClassInfo {
    id: string;
    name: string;
    short: string;
    gradeLevel: string;
}

interface ImportSectionProps {
    onImport: (schedules: ClassSchedule[], meta?: EdupageMeta) => void;
    onLoginStateChange?: (loggedIn: boolean) => void;
    edupageMeta?: EdupageMeta;
    bridgeOnline: boolean;
    edupageApiAvailable: boolean;
}

function getKWLabel(isoDate: string): string {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return '';
    const kw = getISOWeek(new Date(y, m - 1, d));
    return `KW ${kw} (${kw % 2 === 1 ? 'ungerade' : 'gerade'})`;
}

export function ImportSection({
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

    const [weekADate, setWeekADate] = useState(
        () => edupageMeta?.weekAReferenceDate || formatISODate(new Date())
    );
    const [useWeekB, setUseWeekB] = useState(() => Boolean(edupageMeta?.weekBReferenceDate));
    const [weekBDate, setWeekBDate] = useState(() => {
        if (edupageMeta?.weekBReferenceDate) return edupageMeta.weekBReferenceDate;
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return formatISODate(d);
    });
    const [useShortSubjects, setUseShortSubjects] = useState(true);

    const [loadingLogin, setLoadingLogin] = useState(false);
    const [loadingFetch, setLoadingFetch] = useState(false);
    const [edupageError, setEdupageError] = useState<string | null>(null);
    const [edupageStatus, setEdupageStatus] = useState<string | null>(null);

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
        setEdupageError(null);
        setEdupageStatus(null);
        setLoadingFetch(true);
        try {
            const res = await fetch('/api/edupage/fetch-timetables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    classIds: selectedClassIds,
                    weekADate,
                    weekBDate: useWeekB ? weekBDate : null,
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

            const weekAParity: 'odd' | 'even' =
                data.weekAParity === 'even' || data.weekAParity === 'odd'
                    ? data.weekAParity
                    : inferWeekParityFromDate(weekADate);

            onImport(schedules, {
                subdomain: subdomain.trim(),
                username: username.trim(),
                lastSyncAt: data.fetchedAt || new Date().toISOString(),
                selectedClassIds,
                weekAReferenceDate: weekADate,
                weekBReferenceDate: useWeekB ? weekBDate : undefined,
                weekAParity,
            });

            const warnPart =
                data.errors && data.errors.length > 0
                    ? ` (${data.errors.length} Hinweise: ${data.errors.join('; ')})`
                    : '';
            setEdupageStatus(
                `${schedules.length} Klassen-Stundenpläne importiert & A/B-Muster (${weekAParity === 'odd' ? 'Ungerade KW = A' : 'Gerade KW = A'}) übernommen.${warnPart}`
            );
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
                            {edupageMeta.weekAParity && (
                                <>
                                    {' '}
                                    · Woche A ={' '}
                                    {edupageMeta.weekAParity === 'odd' ? 'Ungerade KW' : 'Gerade KW'}
                                </>
                            )}
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

                            {/* Week A / B dates & options */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                                <div>
                                    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            <Calendar size={12} /> Referenzdatum Woche A
                                        </span>
                                        <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                                            {getKWLabel(weekADate)}
                                        </span>
                                    </label>
                                    <input
                                        type="date"
                                        className="ui-input"
                                        value={weekADate}
                                        onChange={(e) => setWeekADate(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                            <input
                                                type="checkbox"
                                                checked={useWeekB}
                                                onChange={(e) => setUseWeekB(e.target.checked)}
                                            />
                                            Auch Woche B abrufen
                                        </span>
                                        {useWeekB && (
                                            <span style={{ color: 'var(--accent-purple)', fontWeight: 700 }}>
                                                {getKWLabel(weekBDate)}
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="date"
                                        className="ui-input"
                                        value={weekBDate}
                                        disabled={!useWeekB}
                                        onChange={(e) => setWeekBDate(e.target.value)}
                                        style={{ opacity: useWeekB ? 1 : 0.45 }}
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

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    Ferien, schulfreie Tage & A/B-Wochen werden für den Klausurzeitraum automatisch mit abgerufen.
                                </span>
                                <button
                                    type="button"
                                    onClick={handleFetchTimetables}
                                    disabled={loadingFetch || selectedClassIds.length === 0}
                                    className="ui-btn ui-btn-primary"
                                >
                                    <RefreshCw size={15} />
                                    {loadingFetch
                                        ? 'Rufe Stundenpläne ab...'
                                        : `Stundenpläne abrufen (${selectedClassIds.length})`}
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
