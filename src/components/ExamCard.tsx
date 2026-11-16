import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Exam } from '../types';
import { Lock, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

interface ExamCardProps {
    exam: Exam;
    isOverlay?: boolean;
    isValid?: boolean;
    validationReason?: string;
    validationWarning?: string;
    teachers?: string[];
    onTogglePin?: (id: string) => void;
}

export function ExamCard({
    exam,
    isOverlay,
    isValid = true,
    validationReason,
    validationWarning,
    teachers,
    onTogglePin,
}: ExamCardProps) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: exam.id,
        data: { exam }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 999 : undefined,
        opacity: isDragging && !isOverlay ? 0.5 : 1,
    };

    const tooltip = !isValid
        ? validationReason || 'Ungültige Platzierung'
        : validationWarning || undefined;

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            title={tooltip}
            className={clsx(
                "exam-card",
                !isValid && "invalid"
            )}
        >
            <div style={{
                background: !isValid
                    ? 'rgba(239, 68, 68, 0.14)'
                    : validationWarning
                        ? 'rgba(234, 179, 8, 0.08)'
                        : 'var(--bg-panel)',
                border: `1px solid ${!isValid ? 'var(--accent-danger)' : validationWarning ? 'var(--accent-warning)' : 'var(--border-color)'}`,
                padding: '6px 8px',
                borderRadius: '4px',
                boxShadow: isOverlay ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
                marginBottom: '2px',
                fontSize: '0.82rem',
                position: 'relative',
                cursor: 'grab',
                display: 'flex', flexDirection: 'column', gap: '2px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{exam.subject}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {!isValid && (
                            <span title={validationReason}>
                                <AlertTriangle size={13} color="var(--accent-danger)" />
                            </span>
                        )}
                        {isValid && validationWarning && (
                            <span title={validationWarning}>
                                <AlertTriangle size={13} color="var(--accent-warning)" />
                            </span>
                        )}
                        {onTogglePin && (
                            <div
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    onTogglePin(exam.id);
                                }}
                                className="pin-btn"
                                title={exam.isPinned ? 'Klausur lösen' : 'Klausur anheften (Pin)'}
                                style={{ cursor: 'pointer', opacity: exam.isPinned ? 1 : 0.25 }}
                            >
                                <Lock size={13} color={exam.isPinned ? 'var(--accent-warning)' : 'currentColor'} />
                            </div>
                        )}
                    </div>
                </div>
                {teachers && teachers.length > 0 && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        {teachers.join(', ')}
                    </div>
                )}
            </div>
        </div>
    );
}
