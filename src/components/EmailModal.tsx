import { useMemo, useState } from 'react';
import { X, Mail, Copy, Check, ExternalLink, Users } from 'lucide-react';
import type { AppState } from '../types';
import {
    buildEmailDraft,
    DEFAULT_EMAIL_DOMAIN,
    type EmailGroupingMode,
} from '../logic/emailTemplate';

interface EmailModalProps {
    state: AppState;
    onClose: () => void;
}

export function EmailModal({ state, onClose }: EmailModalProps) {
    const [domain, setDomain] = useState(DEFAULT_EMAIL_DOMAIN);
    const [grouping, setGrouping] = useState<EmailGroupingMode>('class');
    const [excludedEmails, setExcludedEmails] = useState<Set<string>>(() => new Set());
    const [copiedField, setCopiedField] = useState<'addresses' | 'body' | null>(null);

    const draft = useMemo(
        () =>
            buildEmailDraft(state, {
                domain: domain.trim() || DEFAULT_EMAIL_DOMAIN,
                grouping,
                excludedEmails,
            }),
        [state, domain, grouping, excludedEmails]
    );

    const [customSubject, setCustomSubject] = useState<string | null>(null);
    const [customBody, setCustomBody] = useState<string | null>(null);

    const subjectText = customSubject ?? draft.subjectLine;
    const bodyText = customBody ?? draft.body;

    const toggleRecipient = (email: string) => {
        setExcludedEmails((prev) => {
            const next = new Set(prev);
            if (next.has(email)) {
                next.delete(email);
            } else {
                next.add(email);
            }
            return next;
        });
    };

    const copyText = async (text: string, field: 'addresses' | 'body') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            // ignore clipboard errors
        }
    };

    const mailtoHref = `mailto:?bcc=${encodeURIComponent(
        draft.recipientListComma
    )}&subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(bodyText)}`;

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.55)',
                backdropFilter: 'blur(3px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                zIndex: 100,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="ui-card"
                style={{
                    width: '100%',
                    maxWidth: '780px',
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-lg)',
                }}
            >
                {/* Header */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '1rem 1.25rem',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: 'var(--bg-panel)',
                    }}
                >
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Mail size={18} color="var(--accent-primary)" />
                        E-Mail-Vorlage & Adressliste
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ui-btn"
                        style={{ padding: '5px 8px', border: 'none' }}
                        title="Schließen"
                    >
                        <X size={17} />
                    </button>
                </div>

                {/* Body */}
                <div
                    style={{
                        padding: '1.25rem',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem',
                    }}
                >
                    {/* Recipients Box */}
                    <div
                        style={{
                            padding: '0.85rem 1rem',
                            borderRadius: '10px',
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.65rem',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.86rem' }}>
                                <Users size={15} color="var(--accent-primary)" />
                                E-Mail-Adressen ({draft.recipients.length - excludedEmails.size}/{draft.recipients.length})
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Domain:</span>
                                <input
                                    type="text"
                                    className="ui-input"
                                    style={{ width: '120px', padding: '3px 8px', fontSize: '0.78rem' }}
                                    value={domain}
                                    onChange={(e) => setDomain(e.target.value)}
                                />
                                <button
                                    type="button"
                                    className="ui-btn ui-btn-primary"
                                    style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                                    disabled={!draft.recipientListSemicolon}
                                    onClick={() => copyText(draft.recipientListSemicolon, 'addresses')}
                                >
                                    {copiedField === 'addresses' ? <Check size={14} /> : <Copy size={14} />}
                                    {copiedField === 'addresses' ? 'Kopiert!' : 'Adressen kopieren'}
                                </button>
                            </div>
                        </div>

                        {draft.recipients.length > 0 ? (
                            <>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                    {draft.recipients.map((rec) => {
                                        const active = !excludedEmails.has(rec.email);
                                        return (
                                            <button
                                                key={rec.email}
                                                type="button"
                                                onClick={() => toggleRecipient(rec.email)}
                                                title={active ? 'Klicken zum Ausblenden' : 'Klicken zum Einschließen'}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                    padding: '3px 8px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.75rem',
                                                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                                    background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                                                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                                                    opacity: active ? 1 : 0.55,
                                                    textDecoration: active ? 'none' : 'line-through',
                                                }}
                                            >
                                                <strong>{rec.teacherName}</strong>
                                                <span style={{ color: active ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                                                    {rec.email}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <input
                                    type="text"
                                    readOnly
                                    value={draft.recipientListSemicolon}
                                    onClick={(e) => (e.target as HTMLInputElement).select()}
                                    className="ui-input"
                                    style={{ fontFamily: 'monospace', fontSize: '0.78rem', background: 'var(--bg-surface)' }}
                                    placeholder="Keine Empfänger aktiv"
                                />
                            </>
                        ) : (
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                Noch keine Lehrkräfte in den ausgewählten Klausuren gefunden. Importiere Stundenpläne über EduPage oder verteile Klausuren.
                            </div>
                        )}
                    </div>

                    {/* Grouping & Subject */}
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '240px' }}>
                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                Betreff
                            </label>
                            <input
                                type="text"
                                className="ui-input"
                                value={subjectText}
                                onChange={(e) => setCustomSubject(e.target.value)}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                Sortierung / Gruppierung
                            </label>
                            <div
                                style={{
                                    display: 'inline-flex',
                                    padding: '2px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-panel)',
                                    gap: '2px',
                                }}
                            >
                                {(
                                    [
                                        { id: 'class', label: 'Nach Klasse' },
                                        { id: 'date', label: 'Nach Datum' },
                                        { id: 'teacher', label: 'Nach Lehrkraft' },
                                    ] as { id: EmailGroupingMode; label: string }[]
                                ).map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => {
                                            setGrouping(opt.id);
                                            setCustomBody(null);
                                        }}
                                        style={{
                                            border: 'none',
                                            padding: '5px 9px',
                                            borderRadius: '6px',
                                            fontSize: '0.78rem',
                                            fontWeight: grouping === opt.id ? 700 : 500,
                                            background: grouping === opt.id ? 'var(--bg-surface)' : 'transparent',
                                            color: grouping === opt.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                            boxShadow: grouping === opt.id ? 'var(--shadow-sm)' : 'none',
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Message Textarea */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Nachrichtentext
                        </label>
                        <textarea
                            className="ui-input"
                            value={bodyText}
                            onChange={(e) => setCustomBody(e.target.value)}
                            style={{
                                minHeight: '230px',
                                fontFamily: 'inherit',
                                fontSize: '0.84rem',
                                lineHeight: 1.5,
                                resize: 'vertical',
                            }}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '0.6rem',
                        padding: '0.85rem 1.25rem',
                        borderTop: '1px solid var(--border-subtle)',
                        background: 'var(--bg-panel)',
                        flexWrap: 'wrap',
                    }}
                >
                    <button
                        type="button"
                        className="ui-btn"
                        onClick={() => copyText(`${subjectText}\n\n${bodyText}`, 'body')}
                    >
                        {copiedField === 'body' ? <Check size={15} color="var(--accent-success)" /> : <Copy size={15} />}
                        {copiedField === 'body' ? 'Vorlage kopiert!' : 'Vorlage kopieren'}
                    </button>
                    <a
                        href={mailtoHref}
                        className="ui-btn ui-btn-primary"
                        style={{ textDecoration: 'none' }}
                    >
                        <ExternalLink size={15} />
                        Im Mailprogramm öffnen
                    </a>
                </div>
            </div>
        </div>
    );
}
