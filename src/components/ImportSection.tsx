import { useEffect, useMemo, useState } from 'react';
import {
    FileJson,
    Copy,
    Check,
    Play,
    ChevronUp,
    ChevronDown,
    RefreshCw,
    LogIn,
    LogOut,
    KeyRound,
    School,
    Search,
    CheckSquare,
    Square,
    AlertCircle,
} from 'lucide-react';
import { LLM_PROMPT } from '../logic/prompt';
import { formatISODate } from '../logic/dateUtils';
import type { ClassSchedule, EdupageMeta } from '../types';

interface EdupageClassInfo {
    id: string;
    name: string;
    short: string;
    gradeLevel: string;
}

interface ImportSectionProps {
    onImport: (schedules: ClassSchedule[], meta?: EdupageMeta) => void;
    edupageMeta?: EdupageMeta;
    bridgeOnline: boolean;
    edupageApiAvailable: boolean;
    isCollapsed: boolean;
    onToggle: () => void;
}

export function ImportSection({
    onImport,
    edupageMeta,
    bridgeOnline,
    edupageApiAvailable,
    isCollapsed,
    onToggle,
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

    const [weekADate, setWeekADate] = useState(() => formatISODate(new Date()));
    const [useWeekB, setUseWeekB] = useState(false);
    const [weekBDate, setWeekBDate] = useState(() => {
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
                }
            })
            .catch(() => {
                // Ignore if bridge not reachable
            });
        return () => {
            cancelled = true;
        };
    }, [bridgeOnline]);

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
            const matchesSearch = !q || c.name.toLowerCase().includes(q) || c.gradeLevel.toLowerCase().includes(q);
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
        e.stopPropagation();
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
            if (rememberCredentials && password) {
                setHasSavedPassword(true);
            }
            setPassword('');
            setEdupageStatus(`Verbunden mit ${data.subdomain}.edupage.org (${(data.classes || []).length} Klassen geladen).`);
        } catch (err: unknown) {
            setEdupageError(err instanceof Error ? err.message : 'Fehler bei der Anmeldung.');
        } finally {
            setLoadingLogin(false);
        }
    };

    const handleVerify2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
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
        const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedClassIds.includes(id));
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

            onImport(schedules, {
                subdomain: subdomain.trim(),
                username: username.trim(),
                lastSyncAt: data.fetchedAt || new Date().toISOString(),
                selectedClassIds,
            });

            const warnPart = data.errors && data.errors.length > 0 ? ` (${data.errors.length} Hinweise: ${data.errors.join('; ')})` : '';
            setEdupageStatus(`${schedules.length} Klassen-Stundenpläne importiert & automatisch gespeichert.${warnPart}`);
        } catch (err: unknown) {
            setEdupageError(err instanceof Error ? err.message : 'Fehler beim Abrufen der Stundenpläne.');
        } finally {
            setLoadingFetch(false);
        }
    };

    return (
        <div
            className="card"
            style={{
                padding: '1.5rem',
                marginBottom: '1.5rem',
                background: 'var(--bg-card)',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-md)',
                transition: 'all 0.3s',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: isCollapsed ? 0 : '1rem',
                    cursor: 'pointer',
                }}
                onClick={onToggle}
            >
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <School size={24} style={{ color: 'var(--accent-primary)' }} />
                    Stundenpläne importieren
                    {edupageMeta?.lastSyncAt && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '6px' }}>
                            (Sync: {new Date(edupageMeta.lastSyncAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })})
                        </span>
                    )}
                </h2>
                <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                    {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                </button>
            </div>

            {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} onClick={(e) => e.stopPropagation()}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                        <button
                            onClick={() => setActiveTab('edupage')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '0.5rem 1rem',
                                borderRadius: '6px',
                                border: '1px solid',
                                borderColor: activeTab === 'edupage' ? 'var(--accent-primary)' : 'var(--border-color)',
                                background: activeTab === 'edupage' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                color: activeTab === 'edupage' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: 600,
                                fontSize: '0.9rem',
                            }}
                        >
                            <School size={16} />
                            EduPage Direktimport
                        </button>
                        <button
                            onClick={() => setActiveTab('json')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '0.5rem 1rem',
                                borderRadius: '6px',
                                border: '1px solid',
                                borderColor: activeTab === 'json' ? 'var(--accent-primary)' : 'var(--border-color)',
                                background: activeTab === 'json' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                color: activeTab === 'json' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: 600,
                                fontSize: '0.9rem',
                            }}
                        >
                            <FileJson size={16} />
                            JSON / LLM-Import
                        </button>
                    </div>

                    {activeTab === 'edupage' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {!bridgeOnline ? (
                                <div
                                    style={{
                                        padding: '0.9rem 1rem',
                                        borderRadius: '6px',
                                        background: 'rgba(234, 179, 8, 0.12)',
                                        border: '1px solid var(--accent-warning)',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.88rem',
                                    }}
                                >
                                    <strong>Lokale EduPage-Bridge nicht aktiv.</strong> Starte die App lokal mit{' '}
                                    <code style={{ background: 'var(--bg-app)', padding: '2px 6px', borderRadius: '4px' }}>
                                        npm run dev:local
                                    </code>{' '}
                                    (einmalige Einrichtung: <code style={{ background: 'var(--bg-app)', padding: '2px 6px', borderRadius: '4px' }}>npm run setup:edupage</code>), um dich direkt mit deinem EduPage-Account anzumelden.
                                </div>
                            ) : !edupageApiAvailable ? (
                                <div
                                    style={{
                                        padding: '0.9rem 1rem',
                                        borderRadius: '6px',
                                        background: 'rgba(239, 68, 68, 0.12)',
                                        border: '1px solid var(--accent-danger)',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.88rem',
                                    }}
                                >
                                    <strong>Python-Paket fehlt:</strong> Bitte einmalig{' '}
                                    <code style={{ background: 'var(--bg-app)', padding: '2px 6px', borderRadius: '4px' }}>
                                        npm run setup:edupage
                                    </code>{' '}
                                    ausführen, damit <code style={{ background: 'var(--bg-app)', padding: '2px 6px', borderRadius: '4px' }}>edupage-api</code> installiert wird.
                                </div>
                            ) : !loggedIn && !needs2FA ? (
                                <form onSubmit={handleEdupageLogin} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                                Schul-Subdomain (aus URL)
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="z. B. meineschule"
                                                value={subdomain}
                                                onChange={(e) => setSubdomain(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '8px 10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border-color)',
                                                    background: 'var(--bg-app)',
                                                    color: 'var(--text-primary)',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                                Benutzername / E-Mail
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="EduPage Login"
                                                value={username}
                                                onChange={(e) => setUsername(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '8px 10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border-color)',
                                                    background: 'var(--bg-app)',
                                                    color: 'var(--text-primary)',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                                Passwort
                                            </label>
                                            <input
                                                type="password"
                                                placeholder={hasSavedPassword ? '•••••• (gespeichert)' : 'Passwort'}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '8px 10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border-color)',
                                                    background: 'var(--bg-app)',
                                                    color: 'var(--text-primary)',
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
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
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                background: 'var(--accent-primary)',
                                                color: 'white',
                                                border: 'none',
                                                padding: '0.6rem 1.25rem',
                                                borderRadius: '6px',
                                                fontWeight: 600,
                                                opacity: loadingLogin ? 0.6 : 1,
                                            }}
                                        >
                                            <LogIn size={16} />
                                            {loadingLogin ? 'Melde an...' : 'Mit EduPage verbinden'}
                                        </button>
                                    </div>
                                </form>
                            ) : needs2FA ? (
                                <form onSubmit={handleVerify2FA} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '220px' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                            2FA-Bestätigungscode
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Code aus E-Mail / Authenticator"
                                            value={twoFaCode}
                                            onChange={(e) => setTwoFaCode(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '8px 10px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--border-color)',
                                                background: 'var(--bg-app)',
                                                color: 'var(--text-primary)',
                                            }}
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={loadingLogin}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            background: 'var(--accent-primary)',
                                            color: 'white',
                                            border: 'none',
                                            padding: '0.6rem 1.25rem',
                                            borderRadius: '6px',
                                            fontWeight: 600,
                                        }}
                                    >
                                        <KeyRound size={16} />
                                        {loadingLogin ? 'Prüfe...' : 'Code bestätigen'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={loadingLogin}
                                        onClick={() => handle2faAction('check_confirmed')}
                                        style={{
                                            padding: '0.6rem 0.9rem',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-color)',
                                            background: 'var(--bg-app)',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.85rem',
                                        }}
                                    >
                                        App-Freigabe prüfen
                                    </button>
                                    <button
                                        type="button"
                                        disabled={loadingLogin}
                                        onClick={() => handle2faAction('send_email')}
                                        style={{
                                            padding: '0.6rem 0.9rem',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-color)',
                                            background: 'var(--bg-app)',
                                            color: 'var(--text-secondary)',
                                            fontSize: '0.85rem',
                                        }}
                                    >
                                        E-Mail-Code senden
                                    </button>
                                </form>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.88rem', color: 'var(--accent-success)', fontWeight: 600 }}>
                                            Verbunden mit {subdomain || 'EduPage'} ({username})
                                        </span>
                                        <button
                                            onClick={handleEdupageLogout}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                background: 'transparent',
                                                color: 'var(--text-secondary)',
                                                border: '1px solid var(--border-color)',
                                                padding: '0.35rem 0.75rem',
                                                borderRadius: '6px',
                                                fontSize: '0.8rem',
                                            }}
                                        >
                                            <LogOut size={14} />
                                            Trennen
                                        </button>
                                    </div>

                                    {/* Filter & search for classes */}
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                                            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                                            <input
                                                type="text"
                                                placeholder="Klassen / Bildungsgang filtern..."
                                                value={classSearch}
                                                onChange={(e) => setClassSearch(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '6px 10px 6px 30px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border-color)',
                                                    background: 'var(--bg-app)',
                                                    color: 'var(--text-primary)',
                                                    fontSize: '0.85rem',
                                                }}
                                            />
                                        </div>

                                        <select
                                            value={gradeFilter}
                                            onChange={(e) => setGradeFilter(e.target.value)}
                                            style={{
                                                padding: '6px 10px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--border-color)',
                                                background: 'var(--bg-app)',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.85rem',
                                            }}
                                        >
                                            {availableGrades.map((g) => (
                                                <option key={g} value={g}>
                                                    {g === 'Alle' ? 'Alle Stufen' : `Stufe ${g}`}
                                                </option>
                                            ))}
                                        </select>

                                        <button
                                            onClick={selectAllFiltered}
                                            style={{
                                                padding: '6px 10px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--border-color)',
                                                background: 'var(--bg-panel)',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.8rem',
                                            }}
                                        >
                                            Gefilterte an-/abwählen ({filteredClasses.length})
                                        </button>
                                    </div>

                                    {/* Class chips */}
                                    <div
                                        style={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: '0.45rem',
                                            maxHeight: '170px',
                                            overflowY: 'auto',
                                            padding: '0.5rem',
                                            background: 'var(--bg-app)',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-color)',
                                        }}
                                    >
                                        {filteredClasses.map((cls) => {
                                            const checked = selectedClassIds.includes(cls.id);
                                            return (
                                                <button
                                                    key={cls.id}
                                                    onClick={() => toggleClassSelection(cls.id)}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '5px',
                                                        padding: '4px 8px',
                                                        borderRadius: '4px',
                                                        border: '1px solid',
                                                        borderColor: checked ? 'var(--accent-primary)' : 'var(--border-color)',
                                                        background: checked ? 'rgba(59, 130, 246, 0.16)' : 'var(--bg-panel)',
                                                        color: checked ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                        fontSize: '0.82rem',
                                                    }}
                                                >
                                                    {checked ? <CheckSquare size={13} /> : <Square size={13} />}
                                                    {cls.name}
                                                </button>
                                            );
                                        })}
                                        {filteredClasses.length === 0 && (
                                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                Keine Klassen passend zum Filter gefunden.
                                            </span>
                                        )}
                                    </div>

                                    {/* Week A / B dates & options */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                                Referenzdatum Woche A
                                            </label>
                                            <input
                                                type="date"
                                                value={weekADate}
                                                onChange={(e) => setWeekADate(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '7px 10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border-color)',
                                                    background: 'var(--bg-app)',
                                                    color: 'var(--text-primary)',
                                                }}
                                            />
                                        </div>

                                        <div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={useWeekB}
                                                    onChange={(e) => setUseWeekB(e.target.checked)}
                                                />
                                                Auch Woche B abrufen
                                            </label>
                                            <input
                                                type="date"
                                                value={weekBDate}
                                                disabled={!useWeekB}
                                                onChange={(e) => setWeekBDate(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '7px 10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border-color)',
                                                    background: 'var(--bg-app)',
                                                    color: 'var(--text-primary)',
                                                    opacity: useWeekB ? 1 : 0.45,
                                                }}
                                            />
                                        </div>

                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer', paddingBottom: '6px' }}>
                                            <input
                                                type="checkbox"
                                                checked={useShortSubjects}
                                                onChange={(e) => setUseShortSubjects(e.target.checked)}
                                            />
                                            Fach-Kürzel verwenden (z. B. M, D)
                                        </label>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button
                                            onClick={handleFetchTimetables}
                                            disabled={loadingFetch || selectedClassIds.length === 0}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                background: 'var(--accent-primary)',
                                                color: 'white',
                                                border: 'none',
                                                padding: '0.7rem 1.35rem',
                                                borderRadius: '6px',
                                                fontWeight: 600,
                                                opacity: loadingFetch || selectedClassIds.length === 0 ? 0.55 : 1,
                                            }}
                                        >
                                            <RefreshCw size={16} />
                                            {loadingFetch
                                                ? 'Rufe Stundenpläne ab...'
                                                : `Stundenpläne abrufen (${selectedClassIds.length})`}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {edupageError && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-danger)', fontSize: '0.875rem' }}>
                                    <AlertCircle size={16} />
                                    {edupageError}
                                </div>
                            )}
                            {edupageStatus && (
                                <div style={{ color: 'var(--accent-success)', fontSize: '0.875rem' }}>{edupageStatus}</div>
                            )}
                        </div>
                    )}

                    {activeTab === 'json' && (
                        <>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                1. Kopiere den System-Prompt. 2. Lass dir von einem LLM aus deinen Stundenplan-Bildern ein JSON generieren. 3. Füge das JSON unten ein.
                            </p>

                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                <button
                                    onClick={handleCopyPrompt}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        background: 'transparent',
                                        color: 'var(--text-secondary)',
                                        border: '1px solid var(--border-color)',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '6px',
                                        fontWeight: 500,
                                        transition: 'all 0.2s',
                                        fontSize: '0.9rem',
                                    }}
                                    className="hover-border-accent"
                                >
                                    {copied ? <Check size={16} color="var(--accent-success)" /> : <Copy size={16} />}
                                    {copied ? 'Kopiert!' : 'LLM Prompt kopieren'}
                                </button>
                            </div>

                            <textarea
                                value={jsonText}
                                onChange={(e) => setJsonText(e.target.value)}
                                placeholder='JSON hier einfügen... z.B. { "className": "10A", "subjects": { ... } }'
                                style={{
                                    width: '100%',
                                    minHeight: '150px',
                                    padding: '1rem',
                                    background: 'var(--bg-app)',
                                    border: `1px solid ${jsonError ? 'var(--accent-danger)' : 'var(--border-color)'}`,
                                    borderRadius: '6px',
                                    color: 'var(--text-primary)',
                                    fontFamily: 'monospace',
                                    fontSize: '0.9rem',
                                    resize: 'vertical',
                                }}
                            />

                            {jsonError && <div style={{ color: 'var(--accent-danger)', fontSize: '0.875rem' }}>{jsonError}</div>}

                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={handleJsonImport}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        background: 'var(--accent-primary)',
                                        color: 'white',
                                        border: 'none',
                                        padding: '0.75rem 1.5rem',
                                        borderRadius: '6px',
                                        fontWeight: 500,
                                        transition: 'background 0.2s',
                                        fontSize: '1rem',
                                    }}
                                    className="hover-opacity"
                                >
                                    <Play size={18} />
                                    Daten importieren
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
