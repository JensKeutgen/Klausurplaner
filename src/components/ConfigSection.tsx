import { useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import type { Week } from '../types';
import { getWeeksBetween, isSameDay, isDateInRange } from '../logic/dateUtils';

interface ConfigSectionProps {
    weeks: Week[];
    onUpdateWeeks: (weeks: Week[]) => void;
}

export function ConfigSection({ weeks, onUpdateWeeks }: ConfigSectionProps) {
    const [currentMonth, setCurrentMonth] = useState(new Date());

    const [selectionStart, setSelectionStart] = useState<Date | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<Date | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);

    const handleDateClick = (date: Date) => {
        if (!selectionStart || (selectionStart && selectionEnd)) {
            // Start new selection
            setSelectionStart(date);
            setSelectionEnd(null);
        } else {
            // End selection
            if (date < selectionStart) {
                setSelectionStart(date);
                setSelectionEnd(selectionStart);
                updateWeeks(date, selectionStart);
            } else {
                setSelectionEnd(date);
                updateWeeks(selectionStart, date);
            }
        }
    };

    const updateWeeks = (start: Date, end: Date) => {
        // Generate weeks and update
        // Preserve blocked status if week number/year matches existing? 
        // For simplicity, just regen or try to merge. 
        // Merging is better to keep blocked user choices if possible, but IDs change.
        // Let's just regen for now, user can re-block.
        const newWeeks = getWeeksBetween(start, end);
        onUpdateWeeks(newWeeks);
    };

    const nextMonth = () => {
        const d = new Date(currentMonth);
        d.setMonth(d.getMonth() + 1);
        setCurrentMonth(d);
    };

    const prevMonth = () => {
        const d = new Date(currentMonth);
        d.setMonth(d.getMonth() - 1);
        setCurrentMonth(d);
    };

    const toggleBlockWeek = (id: string) => {
        onUpdateWeeks(weeks.map(w => w.id === id ? { ...w, isBlocked: !w.isBlocked } : w));
    };

    const renderMonth = (offset: number) => {
        const monthDate = new Date(currentMonth);
        monthDate.setMonth(monthDate.getMonth() + offset);

        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();

        const firstDay = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // 0 = Sunday, 1 = Monday. We want Monday start.
        let startDay = firstDay.getDay() - 1;
        if (startDay === -1) startDay = 6;

        const days = [];
        for (let i = 0; i < startDay; i++) {
            days.push(<div key={`empty-${i}`} />);
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const isSelected = isDateInRange(date, selectionStart, selectionEnd);
            const isStart = selectionStart && isSameDay(date, selectionStart);
            const isEnd = selectionEnd && isSameDay(date, selectionEnd);

            days.push(
                <div
                    key={d}
                    onClick={() => handleDateClick(date)}
                    style={{
                        padding: '8px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        borderRadius: '50%',
                        background: isStart || isEnd ? 'var(--accent-primary)' : isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                        color: isStart || isEnd ? 'white' : 'inherit',
                        fontWeight: isStart || isEnd ? 'bold' : 'normal',
                        fontSize: '0.9rem'
                    }}
                    className="hover-opacity"
                >
                    {d}
                </div>
            );
        }

        return (
            <div style={{ width: '300px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', fontWeight: 600 }}>
                    {monthDate.toLocaleString('de-DE', { month: 'long', year: 'numeric' })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    <div>Mo</div><div>Di</div><div>Mi</div><div>Do</div><div>Fr</div><div>Sa</div><div>So</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                    {days}
                </div>
            </div>
        );
    };

    return (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', background: 'var(--bg-card)', borderRadius: '8px', boxShadow: 'var(--shadow-md)', transition: 'all 0.3s' }}>
            <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isCollapsed ? 0 : '1rem', cursor: 'pointer' }}
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <CalendarIcon size={24} style={{ color: 'var(--accent-primary)' }} />
                    Klausurzeitraum auswählen
                </h2>
                <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                    {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                </button>
            </div>

            {!isCollapsed && (
                <>
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '2rem' }}>
                        <button onClick={(e) => { e.stopPropagation(); prevMonth(); }} style={{ background: 'none', border: 'none', color: 'var(--text-primary)' }}><ChevronLeft /></button>
                        {renderMonth(0)}
                        {renderMonth(1)}
                        <button onClick={(e) => { e.stopPropagation(); nextMonth(); }} style={{ background: 'none', border: 'none', color: 'var(--text-primary)' }}><ChevronRight /></button>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Ausgewählte Wochen</h3>
                        {weeks.length === 0 ? (
                            <p style={{ color: 'var(--text-secondary)' }}>Wähle ein Start- und Enddatum oben aus.</p>
                        ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                                {weeks.map(week => (
                                    <div
                                        key={week.id}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            background: week.isBlocked ? 'var(--bg-app)' : 'var(--bg-panel)',
                                            border: `1px solid ${week.isBlocked ? 'var(--accent-danger)' : 'var(--border-color)'}`,
                                            borderRadius: '6px',
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                            opacity: week.isBlocked ? 0.7 : 1
                                        }}
                                    >
                                        <span style={{ fontWeight: 500 }}>KW {week.weekNumber}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleBlockWeek(week.id); }}
                                            title="Woche blockieren"
                                            style={{ background: 'none', border: 'none', color: week.isBlocked ? 'var(--accent-danger)' : 'var(--text-secondary)', padding: '4px' }}
                                        >
                                            <AlertCircle size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
