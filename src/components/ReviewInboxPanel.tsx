import { useMemo, useState } from 'react';
import type {
  AppState,
  DayOfWeek,
  Exam,
  ReviewDayWish,
  ReviewExamFeedback,
  ReviewSubmission,
  TicketResolutionStatus,
} from '../types';
import { extractTeacherCodes, getTeacherClasses } from '../logic/reviewClient';
import { formatShortDate, getWeekDayDate } from '../logic/dateUtils';
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Inbox,
  RefreshCw,
  Share2,
  Star,
  X,
} from 'lucide-react';

interface ReviewInboxPanelProps {
  appState: AppState;
  submissions: ReviewSubmission[];
  loading: boolean;
  error: string | null;
  isOpen: boolean;
  onToggleOpen: () => void;
  onRefresh: () => void;
  onOpenPublishModal: () => void;
  onUpdateResolution: (
    itemType: 'exam' | 'wish',
    itemId: string,
    status: TicketResolutionStatus,
    note?: string
  ) => Promise<void>;
  onApplyBlockedDay: (classNames: string[], weekId: string, day: DayOfWeek) => void;
  onHighlightExam: (examId: string | null) => void;
  highlightedExamId: string | null;
}

const GERMAN_DAY_SHORT: Record<DayOfWeek, string> = {
  Monday: 'Mo',
  Tuesday: 'Di',
  Wednesday: 'Mi',
  Thursday: 'Do',
  Friday: 'Fr',
};

const PREFERENCE_LABEL: Record<string, string> = {
  earlier: '← Lieber früher',
  later: '→ Lieber später',
  not_this_day: 'Nur dieser Tag geht nicht',
};

export function ReviewInboxPanel({
  appState,
  submissions,
  loading,
  error,
  isOpen,
  onToggleOpen,
  onRefresh,
  onOpenPublishModal,
  onUpdateResolution,
  onApplyBlockedDay,
  onHighlightExam,
  highlightedExamId,
}: ReviewInboxPanelProps) {
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissNote, setDismissNote] = useState('');
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const allTeacherCodes = useMemo(
    () => extractTeacherCodes(appState.classes),
    [appState.classes]
  );

  const respondedCodes = useMemo(
    () => new Set(submissions.map((s) => s.teacherCode.trim().toUpperCase())),
    [submissions]
  );

  const pendingCodes = useMemo(
    () => allTeacherCodes.filter((c) => !respondedCodes.has(c)),
    [allTeacherCodes, respondedCodes]
  );

  const tickets = useMemo(() => {
    type Ticket =
      | { kind: 'exam'; teacherCode: string; submissionUpdatedAt: string; item: ReviewExamFeedback }
      | { kind: 'wish'; teacherCode: string; submissionUpdatedAt: string; item: ReviewDayWish };

    const list: Ticket[] = [];
    for (const sub of submissions) {
      for (const ef of sub.examFeedback || []) {
        if (ef.status === 'not_ok') {
          list.push({
            kind: 'exam',
            teacherCode: sub.teacherCode,
            submissionUpdatedAt: sub.updatedAt,
            item: ef,
          });
        }
      }
      for (const dw of sub.dayWishes || []) {
        list.push({
          kind: 'wish',
          teacherCode: sub.teacherCode,
          submissionUpdatedAt: sub.updatedAt,
          item: dw,
        });
      }
    }
    return list;
  }, [submissions]);

  const openCount = tickets.filter((t) => t.item.resolutionStatus === 'open').length;
  const doneCount = tickets.length - openCount;

  const filteredTickets = tickets.filter((t) => {
    if (filter === 'open') return t.item.resolutionStatus === 'open';
    if (filter === 'done') return t.item.resolutionStatus !== 'open';
    return true;
  });

  const formatExamCurrentSlot = (examId: string): string => {
    const exam: Exam | undefined = appState.exams.find((e) => e.id === examId);
    if (!exam || !exam.assignedWeekId || !exam.assignedDay) return 'Nicht im Plan';
    const week = appState.weeks.find((w) => w.id === exam.assignedWeekId);
    if (!week) return exam.assignedWeekId;
    return `${GERMAN_DAY_SHORT[exam.assignedDay]}, ${formatShortDate(getWeekDayDate(week, exam.assignedDay))} (KW ${week.weekNumber})`;
  };

  const formatWishSlot = (weekId: string, day: DayOfWeek): string => {
    const week = appState.weeks.find((w) => w.id === weekId);
    if (!week) return `${weekId} ${GERMAN_DAY_SHORT[day]}`;
    return `${GERMAN_DAY_SHORT[day]}, ${formatShortDate(getWeekDayDate(week, day))} (KW ${week.weekNumber})`;
  };

  const handleApplyWishBlock = async (teacherCode: string, wish: ReviewDayWish) => {
    setBusyItemId(wish.id);
    try {
      const targetClasses = wish.className
        ? [wish.className]
        : getTeacherClasses(appState.classes, teacherCode);

      if (targetClasses.length > 0) {
        onApplyBlockedDay(targetClasses, wish.weekId, wish.day);
      }

      const note =
        targetClasses.length > 0
          ? `Als Sperrtag übernommen (${targetClasses.join(', ')})`
          : 'Als erledigt markiert';

      await onUpdateResolution('wish', wish.id, 'applied', note);
    } finally {
      setBusyItemId(null);
    }
  };

  const handleMarkStatus = async (
    kind: 'exam' | 'wish',
    id: string,
    status: TicketResolutionStatus,
    note = ''
  ) => {
    setBusyItemId(id);
    try {
      await onUpdateResolution(kind, id, status, note);
      if (kind === 'exam' && highlightedExamId === id) {
        onHighlightExam(null);
      }
      setDismissingId(null);
      setDismissNote('');
    } finally {
      setBusyItemId(null);
    }
  };

  const isPublished = Boolean(appState.reviewSync?.planId && appState.reviewSync?.adminToken);

  return (
    <section
      style={{
        marginTop: '1.25rem',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.85rem 1.15rem',
          borderBottom: isOpen ? '1px solid var(--border-color)' : 'none',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <button
          type="button"
          onClick={onToggleOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          <Inbox size={18} color="var(--accent-primary)" />
          <span>Kollegen-Rückmeldungen</span>
          {isPublished && (
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '999px',
                background: openCount > 0 ? 'rgba(234, 179, 8, 0.18)' : 'rgba(34, 197, 94, 0.16)',
                color: openCount > 0 ? 'var(--accent-warning)' : 'var(--accent-success)',
                border: `1px solid ${openCount > 0 ? 'var(--accent-warning)' : 'var(--accent-success)'}`,
              }}
            >
              {openCount} offen · {submissions.length} Antworten
            </span>
          )}
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {isPublished && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '0.4rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-app)',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              <RefreshCw size={14} />
              {loading ? 'Lade...' : 'Aktualisieren'}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenPublishModal}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '0.4rem 0.85rem',
              borderRadius: '6px',
              border: '1px solid var(--accent-primary)',
              background: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--accent-primary)',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            <Share2 size={14} />
            {isPublished ? 'Link & Freigabe' : 'Zur Abstimmung freigeben'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div style={{ padding: '1rem 1.15rem' }}>
          {!isPublished ? (
            <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Noch kein Abstimmungs-Link erstellt. Klicke auf <strong>„Zur Abstimmung freigeben“</strong>, um einen geschützten Link für das Kollegium zu erzeugen.
            </div>
          ) : (
            <>
              {error && (
                <div style={{ padding: '0.6rem 0.85rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-danger)', fontSize: '0.84rem', marginBottom: '0.85rem' }}>
                  {error}
                </div>
              )}

              {/* Teacher Response Summary Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.9rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '4px' }}>
                  Rückmeldungen ({submissions.length}/{allTeacherCodes.length || submissions.length}):
                </span>
                {submissions.map((sub) => {
                  const subOpen =
                    (sub.examFeedback || []).filter((ef) => ef.status === 'not_ok' && ef.resolutionStatus === 'open').length +
                    (sub.dayWishes || []).filter((dw) => dw.resolutionStatus === 'open').length;
                  return (
                    <span
                      key={sub.id}
                      title={sub.generalNote || undefined}
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        background: subOpen > 0 ? 'rgba(234, 179, 8, 0.16)' : 'rgba(34, 197, 94, 0.16)',
                        color: subOpen > 0 ? 'var(--accent-warning)' : 'var(--accent-success)',
                        border: `1px solid ${subOpen > 0 ? 'var(--accent-warning)' : 'var(--accent-success)'}`,
                      }}
                    >
                      {subOpen > 0 ? `⚠ ${sub.teacherCode} (${subOpen})` : `✓ ${sub.teacherCode}`}
                    </span>
                  );
                })}
                {pendingCodes.length > 0 && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    · Ausstehend: {pendingCodes.join(', ')}
                  </span>
                )}
              </div>

              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: '0.45rem', marginBottom: '0.85rem' }}>
                {(
                  [
                    { key: 'open', label: `Offen (${openCount})` },
                    { key: 'done', label: `Erledigt (${doneCount})` },
                    { key: 'all', label: `Alle (${tickets.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    style={{
                      padding: '0.32rem 0.7rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      border: '1px solid var(--border-color)',
                      background: filter === tab.key ? 'var(--accent-primary)' : 'var(--bg-app)',
                      color: filter === tab.key ? 'white' : 'var(--text-secondary)',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Ticket List */}
              {filteredTickets.length === 0 ? (
                <div style={{ padding: '1rem', borderRadius: '8px', background: 'var(--bg-app)', color: 'var(--text-secondary)', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={16} color="var(--accent-success)" />
                  <span>
                    {filter === 'open'
                      ? 'Alle Rückmeldungen sind abgearbeitet.'
                      : 'Keine Einträge in dieser Ansicht.'}
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '340px', overflowY: 'auto' }}>
                  {filteredTickets.map((t) => {
                    const isExam = t.kind === 'exam';
                    const item = t.item;
                    const isBusy = busyItemId === item.id;

                    return (
                      <div
                        key={`${t.kind}-${item.id}`}
                        style={{
                          padding: '0.75rem 0.9rem',
                          borderRadius: '8px',
                          background: 'var(--bg-app)',
                          border:
                            item.resolutionStatus === 'open'
                              ? '1px solid var(--border-color)'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          opacity: item.resolutionStatus === 'open' ? 1 : 0.75,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '0.88rem' }}>
                              <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{t.teacherCode}</span>
                              {isExam ? (
                                <>
                                  <span style={{ fontWeight: 700 }}>
                                    {(t.item as ReviewExamFeedback).className} · {(t.item as ReviewExamFeedback).subject}
                                  </span>
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    (aktuell: {formatExamCurrentSlot((t.item as ReviewExamFeedback).examId)})
                                  </span>
                                  <span
                                    style={{
                                      fontSize: '0.74rem',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      background: 'rgba(239, 68, 68, 0.16)',
                                      color: 'var(--accent-danger)',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {PREFERENCE_LABEL[(t.item as ReviewExamFeedback).preference || 'not_this_day']}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '0.76rem',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      background:
                                        (t.item as ReviewDayWish).wishType === 'no_go'
                                          ? 'rgba(239, 68, 68, 0.16)'
                                          : 'rgba(59, 130, 246, 0.16)',
                                      color:
                                        (t.item as ReviewDayWish).wishType === 'no_go'
                                          ? 'var(--accent-danger)'
                                          : 'var(--accent-primary)',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {(t.item as ReviewDayWish).wishType === 'no_go' ? (
                                      <>
                                        <Ban size={12} /> Auf keinen Fall
                                      </>
                                    ) : (
                                      <>
                                        <Star size={12} /> Wunschtermin
                                      </>
                                    )}
                                  </span>
                                  <span style={{ fontWeight: 700 }}>
                                    {formatWishSlot((t.item as ReviewDayWish).weekId, (t.item as ReviewDayWish).day)}
                                  </span>
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {(t.item as ReviewDayWish).className
                                      ? `Klasse ${(t.item as ReviewDayWish).className}`
                                      : 'Alle Klassen der Lehrkraft'}
                                  </span>
                                </>
                              )}
                            </div>

                            {item.note && (
                              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                „{item.note}“
                              </div>
                            )}

                            {item.resolutionStatus !== 'open' && (
                              <div style={{ fontSize: '0.76rem', color: item.resolutionStatus === 'applied' ? 'var(--accent-success)' : 'var(--accent-warning)', marginTop: '2px' }}>
                                Status: {item.resolutionStatus === 'applied' ? 'Übernommen ✓' : 'Abgelehnt'}
                                {item.resolutionNote ? ` (${item.resolutionNote})` : ''}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {isExam && (
                              <button
                                type="button"
                                onClick={() => {
                                  const eid = (t.item as ReviewExamFeedback).examId;
                                  onHighlightExam(highlightedExamId === eid ? null : eid);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '0.32rem 0.6rem',
                                  borderRadius: '5px',
                                  border: '1px solid var(--border-color)',
                                  background:
                                    highlightedExamId === (t.item as ReviewExamFeedback).examId
                                      ? 'rgba(59, 130, 246, 0.25)'
                                      : 'var(--bg-panel)',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.78rem',
                                  fontWeight: 600,
                                }}
                              >
                                <Eye size={13} />
                                Im Plan zeigen
                              </button>
                            )}

                            {!isExam &&
                              (t.item as ReviewDayWish).wishType === 'no_go' &&
                              item.resolutionStatus === 'open' && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleApplyWishBlock(t.teacherCode, t.item as ReviewDayWish)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '0.32rem 0.65rem',
                                    borderRadius: '5px',
                                    border: '1px solid var(--accent-success)',
                                    background: 'rgba(34, 197, 94, 0.16)',
                                    color: 'var(--accent-success)',
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                  }}
                                >
                                  <Check size={13} />
                                  Sperrtag übernehmen
                                </button>
                              )}

                            {item.resolutionStatus === 'open' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleMarkStatus(t.kind, item.id, 'applied')}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '0.32rem 0.65rem',
                                    borderRadius: '5px',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-panel)',
                                    color: 'var(--accent-success)',
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                  }}
                                >
                                  <Check size={13} />
                                  Erledigt
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => {
                                    setDismissingId(dismissingId === item.id ? null : item.id);
                                    setDismissNote('');
                                  }}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '0.32rem 0.6rem',
                                    borderRadius: '5px',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-panel)',
                                    color: 'var(--text-secondary)',
                                    fontSize: '0.78rem',
                                  }}
                                >
                                  <X size={13} />
                                  Ablehnen
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleMarkStatus(t.kind, item.id, 'open')}
                                style={{
                                  padding: '0.3rem 0.6rem',
                                  borderRadius: '5px',
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--bg-panel)',
                                  color: 'var(--text-secondary)',
                                  fontSize: '0.75rem',
                                }}
                              >
                                Wieder öffnen
                              </button>
                            )}
                          </div>
                        </div>

                        {dismissingId === item.id && (
                          <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.55rem' }}>
                            <input
                              type="text"
                              value={dismissNote}
                              onChange={(e) => setDismissNote(e.target.value)}
                              placeholder="Kurzer Grund für den Kollegen (optional)..."
                              style={{
                                flex: 1,
                                padding: '0.35rem 0.6rem',
                                borderRadius: '5px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-panel)',
                                color: 'var(--text-primary)',
                                fontSize: '0.8rem',
                              }}
                            />
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleMarkStatus(t.kind, item.id, 'dismissed', dismissNote)}
                              style={{
                                padding: '0.35rem 0.7rem',
                                borderRadius: '5px',
                                border: 'none',
                                background: 'var(--accent-warning)',
                                color: '#1e293b',
                                fontWeight: 600,
                                fontSize: '0.78rem',
                              }}
                            >
                              Bestätigen
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* General Notes from submissions */}
              {submissions.some((s) => s.generalNote && s.generalNote.trim().length > 0) && (
                <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                    Allgemeine Hinweise:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.82rem' }}>
                    {submissions
                      .filter((s) => s.generalNote && s.generalNote.trim().length > 0)
                      .map((s) => (
                        <div key={`gn-${s.id}`}>
                          <strong style={{ color: 'var(--accent-primary)' }}>{s.teacherCode}:</strong> {s.generalNote}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
