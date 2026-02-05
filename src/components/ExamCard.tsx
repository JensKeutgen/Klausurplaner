import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Exam } from '../types';
import { Lock, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

interface ExamCardProps {
    exam: Exam;
    isOverlay?: boolean;
    isValid?: boolean;
    onTogglePin?: (id: string) => void;
}

export function ExamCard({ exam, isOverlay, isValid = true, onTogglePin }: ExamCardProps) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: exam.id,
        data: { exam }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 999 : undefined,
        opacity: isDragging && !isOverlay ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={clsx(
                "exam-card",
                !isValid && "invalid"
            )}
        // Inline styles for basic look, using classes for complex states if possible or simple styles
        >
            <div style={{
                background: !isValid ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-panel)',
                border: `1px solid ${!isValid ? 'var(--accent-danger)' : 'var(--border-color)'}`,
                padding: '8px',
                borderRadius: '4px',
                boxShadow: isOverlay ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
                marginBottom: '4px',
                fontSize: '0.85rem',
                position: 'relative',
                cursor: 'grab',
                display: 'flex', flexDirection: 'column', gap: '2px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{exam.subject}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {!isValid && <AlertTriangle size={14} color="var(--accent-danger)" />}
                        {onTogglePin && (
                            <div
                                onPointerDown={(e) => {
                                    e.stopPropagation(); // Prevent drag start
                                    onTogglePin(exam.id);
                                }}
                                className="pin-btn"
                                style={{ cursor: 'pointer', opacity: exam.isPinned ? 1 : 0.2 }}
                            >
                                <Lock size={14} color={exam.isPinned ? 'var(--accent-warning)' : 'currentColor'} />
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
