import { useState } from 'react';
import { FileJson, Copy, Check, Play, ChevronUp, ChevronDown } from 'lucide-react';
import { LLM_PROMPT } from '../logic/prompt';
import type { ClassSchedule } from '../types';

interface ImportSectionProps {
    onImport: (schedules: ClassSchedule[]) => void;
    isCollapsed: boolean;
    onToggle: () => void;
}

export function ImportSection({ onImport, isCollapsed, onToggle }: ImportSectionProps) {
    const [jsonText, setJsonText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(LLM_PROMPT);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleImport = () => {
        setError(null);
        try {
            if (!jsonText.trim()) {
                setError("Bitte erst JSON einfügen.");
                return;
            }

            const parsed = JSON.parse(jsonText);
            let schedules: ClassSchedule[] = [];

            if (Array.isArray(parsed)) {
                schedules = parsed;
            } else {
                schedules = [parsed];
            }

            // Basic validation
            const valid = schedules.every(s => s.className && s.subjects);
            if (!valid) {
                throw new Error("Ungültige Struktur. Erwarte Objekt(e) mit 'className' und 'subjects'.");
            }

            onImport(schedules);
            setJsonText('');
        } catch (err) {
            setError("Ungültiges JSON-Format. Bitte Eingabe prüfen.");
            console.error(err);
        }
    };

    return (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', background: 'var(--bg-card)', borderRadius: '8px', boxShadow: 'var(--shadow-md)', transition: 'all 0.3s' }}>
            <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isCollapsed ? 0 : '1rem', cursor: 'pointer' }}
                onClick={onToggle}
            >
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <FileJson size={24} className="text-accent" style={{ color: 'var(--accent-primary)' }} />
                    Stundenpläne importieren
                </h2>
                <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                    {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                </button>
            </div>

            {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        1. Kopiere den System-Prompt. 2. Lass dir von einem LLM aus deinen Stundenplan-Bildern ein JSON generieren. 3. Füge das JSON unten ein.
                    </p>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleCopyPrompt(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                background: 'transparent', color: 'var(--text-secondary)',
                                border: '1px solid var(--border-color)', padding: '0.5rem 1rem', borderRadius: '6px',
                                fontWeight: 500, transition: 'all 0.2s',
                                fontSize: '0.9rem'
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
                        onClick={(e) => e.stopPropagation()}
                        placeholder='JSON hier einfügen... z.B. { "className": "10A", "subjects": { ... } }'
                        style={{
                            width: '100%',
                            minHeight: '150px',
                            padding: '1rem',
                            background: 'var(--bg-app)',
                            border: `1px solid ${error ? 'var(--accent-danger)' : 'var(--border-color)'}`,
                            borderRadius: '6px',
                            color: 'var(--text-primary)',
                            fontFamily: 'monospace',
                            fontSize: '0.9rem',
                            resize: 'vertical'
                        }}
                    />

                    {error && (
                        <div style={{ color: 'var(--accent-danger)', fontSize: '0.875rem' }}>
                            {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleImport(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                background: 'var(--accent-primary)', color: 'white',
                                border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px',
                                fontWeight: 500, transition: 'background 0.2s',
                                fontSize: '1rem'
                            }}
                            className="hover-opacity"
                        >
                            <Play size={18} />
                            Daten importieren
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
