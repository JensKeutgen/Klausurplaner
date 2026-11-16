import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Exam, SubjectTimingPreference } from '../types';
import { Lock, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

interface ExamCardProps {
    exam: Exam;
    isOverlay?: boolean;
    isValid?: boolean;
    validationReason?: string;
    validationWarning?: string;
    teachers?: string[];
    hasChosenTeacher?: boolean;
    timingPref?: SubjectTimingPreference;
    onTogglePin?: (id: string) => void;
}

export function ExamCard({
    exam,
    isOverlay,
    isValid = true,
    validationReason,
    validationWarning,
    teachers,
    hasChosenTeacher,
    timingPref = 'normal',
    onTogglePin,
}: ExamCardProps) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: exam.id,
        data: { exam }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 999 : undefined,
        opacity: isDragging && !isOverlay ? 0.4 : 1,
    };

    const tooltip = !isValid
        ? validationReason || 'Ungültige Platzierung'
        : validationWarning || undefined;

    const bg = !isValid
        ? 'var(--accent-danger-soft)'
        : validationWarning
            ? 'var(--accent-warning-soft)'
            : exam.isPinned
                ? 'var(--accent-soft)'
                : 'var(--bg-surface)';

    const borderColor = !isValid
        ? 'var(--accent-danger)'
        : validationWarning
            ? 'var(--accent-warning)'
            : exam.isPinned
                ? 'var(--accent-primary)'
                : 'var(--border-color)';

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            title={tooltip}
            className={clsx('exam-card', !isValid && 'invalid')}
            onClick={(e) => e.stopPropagation()}
        >
            <div
                style={{
                    background: bg,
                    border: `1px solid ${borderColor}`,
                    borderLeft: `3px solid ${!isValid ? 'var(--accent-danger)' : validationWarning ? 'var(--accent-warning)' : 'var(--accent-primary)'}`,
                    padding: '4px 6px',
                    borderRadius: '6px',
                    boxShadow: isOverlay ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
                    fontSize: '0.8rem',
                    position: 'relative',
                    cursor: 'grab',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                        <span
                            style={{
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {exam.subject}
                        </span>
                        {timingPref !== 'normal' && (
                            <span
                                style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    padding: '0 4px',
                                    borderRadius: '4px',
                                    background: timingPref === 'early' ? 'var(--accent-success-soft)' : 'var(--accent-purple-soft)',
                                    color: timingPref === 'early' ? 'var(--accent-success)' : 'var(--accent-purple)',
                                    flexShrink: 0,
                                }}
                                title={timingPref === 'early' ? 'Zeitwunsch: Früh' : 'Zeitwunsch: Spät'}
                            >
                                {timingPref === 'early' ? 'Früh' : 'Spät'}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                        {!isValid && (
                            <span title={validationReason}>
                                <AlertTriangle size={12} color="var(--accent-danger)" />
                            </span>
                        )}
                        {isValid && validationWarning && (
                            <span title={validationWarning}>
                                <AlertTriangle size={12} color="var(--accent-warning)" />
                            </span>
                        )}
                        {onTogglePin && (
                            <button
                                type="button"
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    onTogglePin(exam.id);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                title={exam.isPinned ? 'Fixierung lösen' : 'Termin fixieren (Pin)'}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '1px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: exam.isPinned ? 1 : 0.35,
                                    color: exam.isPinned ? 'var(--accent-primary)' : 'var(--text-muted)',
                                }}
                            >
                                <Lock size={12} />
                            </button>
                        )}
                    </div>
                </div>
                {teachers && teachers.length > 0 && (
                    <div
                        style={{
                            fontSize: '0.68rem',
                            color: hasChosenTeacher ? 'var(--accent-primary)' : 'var(--text-muted)',
                            fontWeight: hasChosenTeacher ? 600 : 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {teachers.join(', ')}
                    </div>
                )}
            </div>
        </div>
    );
}
