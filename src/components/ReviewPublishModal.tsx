import { useState } from 'react';
import type { AppState, ReviewSyncMeta } from '../types';
import {
  buildReviewShareUrl,
  buildReviewSnapshot,
  getEffectiveServerUrl,
  isLocalDevHost,
  publishReviewPlan,
  setReviewPlanStatus,
} from '../logic/reviewClient';
import { Check, Copy, Globe, Lock, Mail, RefreshCw, Share2, X } from 'lucide-react';

interface ReviewPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  appState: AppState;
  onUpdateReviewSync: (next: ReviewSyncMeta) => void;
  onRefreshInbox?: () => void;
}

export function ReviewPublishModal({
  isOpen,
  onClose,
  appState,
  onUpdateReviewSync,
  onRefreshInbox,
}: ReviewPublishModalProps) {
  const reviewSync = appState.reviewSync || {};
  const isLocal = isLocalDevHost();

  const [serverUrl, setServerUrl] = useState(
    reviewSync.serverUrl || getEffectiveServerUrl() || ''
  );
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'link' | 'mail' | null>(null);

  if (!isOpen) return null;

  const isPublished = Boolean(reviewSync.planId && reviewSync.adminToken);
  const shareUrl = isPublished
    ? buildReviewShareUrl(reviewSync.planId!, serverUrl || reviewSync.serverUrl)
    : '';

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!isPublished && passcode.trim().length < 4) {
      setError('Bitte vergib ein Kollegiums-Passwort mit mindestens 4 Zeichen.');
      return;
    }

    const effectiveUrl = getEffectiveServerUrl(serverUrl);
    if (!effectiveUrl) {
      setError('Bitte gib deine Cloudflare-Pages-URL ein (z. B. https://klausurplaner.pages.dev).');
      return;
    }

    setBusy(true);
    try {
      const res = await publishReviewPlan({
        serverUrl: effectiveUrl,
        planId: reviewSync.planId,
        adminToken: reviewSync.adminToken,
        title: appState.pdfSettings.title || 'Klausurplanung',
        passcode: passcode.trim() || undefined,
        snapshot: buildReviewSnapshot(appState),
      });

      onUpdateReviewSync({
        serverUrl: isLocal ? effectiveUrl : reviewSync.serverUrl,
        planId: res.planId,
        adminToken: res.adminToken || reviewSync.adminToken,
        lastPublishedAt: res.updatedAt,
        isActive: res.isActive,
      });

      setPasscode('');
      setSuccessMsg(
        isPublished
          ? 'Aktualisierter Plan wurde für die Kollegen veröffentlicht.'
          : 'Plan wurde veröffentlicht! Du kannst den Link jetzt kopieren.'
      );
      onRefreshInbox?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Veröffentlichung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async () => {
    if (!reviewSync.planId || !reviewSync.adminToken) return;
    setBusy(true);
    setError(null);
    try {
      const effectiveUrl = getEffectiveServerUrl(serverUrl || reviewSync.serverUrl);
      const nextActive = !(reviewSync.isActive ?? true);
      const res = await setReviewPlanStatus(
        effectiveUrl,
        reviewSync.planId,
        reviewSync.adminToken,
        nextActive
      );
      onUpdateReviewSync({
        ...reviewSync,
        serverUrl: isLocal ? effectiveUrl : reviewSync.serverUrl,
        isActive: res.isActive,
      });
      setSuccessMsg(res.isActive ? 'Abstimmung wieder geöffnet.' : 'Abstimmung geschlossen.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status konnte nicht geändert werden.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedType('link');
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleCopyMailTemplate = async () => {
    if (!shareUrl) return;
    const text = `Liebe Kolleginnen und Kollegen,

der Entwurf für "${appState.pdfSettings.title || 'Klausurplanung'}" ist fertig.
Bitte schaut kurz drüber und klickt unter folgendem Link an, ob eure Klausuren passen oder ob es Sperrtermine/Wünsche gibt:

Link: ${shareUrl}
Zugangscode: ${passcode.trim() ? passcode.trim() : '[hier dein festgelegtes Passwort eintragen]'}

Kurze Anleitung:
1. Code eingeben und eigenes Kürzel wählen
2. Bei euren Klausuren „Passt“ oder „Passt nicht“ klicken
3. Falls nötig im Kalender Tage markieren, die auf keinen Fall gehen
4. „Rückmeldung absenden“ klicken

Vielen Dank!`;
    await navigator.clipboard.writeText(text);
    setCopiedType('mail');
    setTimeout(() => setCopiedType(null), 2500);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '580px',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '1.5rem',
          boxShadow: 'var(--shadow-lg)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Share2 size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Für Kollegen zur Abstimmung freigeben</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}
          >
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Lädt den aktuellen Plan-Entwurf (ohne EduPage-Zugangsdaten) auf deinen Cloudflare-Review-Bereich hoch. Kollegen prüfen ihre Termine per Link + Code und tragen No-Go-Tage ein.
        </p>

        <form onSubmit={handlePublish} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {isLocal && (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.83rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                <Globe size={14} />
                Cloudflare-Pages-URL (für lokalen EduPage-Modus)
              </label>
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://klausurplaner.pages.dev"
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.83rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <Lock size={14} />
              {isPublished ? 'Neues Kollegiums-Passwort (optional, leer lassen = unverändert)' : 'Kollegiums-Passwort / Zugangscode'}
            </label>
            <input
              type="text"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder={isPublished ? 'Leer lassen, um aktuelles Passwort zu behalten' : 'z. B. Herbst2026'}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-app)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
              }}
            />
          </div>

          {error && (
            <div style={{ padding: '0.65rem 0.85rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-danger)', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}

          {successMsg && (
            <div style={{ padding: '0.65rem 0.85rem', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid var(--accent-success)', fontSize: '0.85rem' }}>
              {successMsg}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={busy || appState.classes.length === 0}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '0.65rem 1rem',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--accent-primary)',
                color: 'white',
                fontWeight: 600,
                fontSize: '0.9rem',
                opacity: busy ? 0.65 : 1,
              }}
            >
              <RefreshCw size={15} />
              {busy
                ? 'Veröffentliche...'
                : isPublished
                  ? 'Aktuellen Plan-Stand aktualisieren'
                  : 'Link jetzt erstellen & veröffentlichen'}
            </button>

            {isPublished && (
              <button
                type="button"
                disabled={busy}
                onClick={handleToggleActive}
                style={{
                  padding: '0.65rem 0.9rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: (reviewSync.isActive ?? true) ? 'var(--accent-warning)' : 'var(--accent-success)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                }}
              >
                {(reviewSync.isActive ?? true) ? 'Abstimmung schließen' : 'Wieder öffnen'}
              </button>
            )}
          </div>
        </form>

        {isPublished && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              Kollegen-Link (Status: {(reviewSync.isActive ?? true) ? 'Geöffnet ✓' : 'Geschlossen'})
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                type="text"
                readOnly
                value={shareUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.7rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.82rem',
                  fontFamily: 'monospace',
                }}
              />
              <button
                type="button"
                onClick={handleCopyLink}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '0.5rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                }}
              >
                {copiedType === 'link' ? <Check size={14} color="var(--accent-success)" /> : <Copy size={14} />}
                {copiedType === 'link' ? 'Kopiert' : 'Link'}
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyMailTemplate}
              style={{
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '0.55rem 0.85rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-app)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '0.83rem',
              }}
            >
              {copiedType === 'mail' ? <Check size={14} color="var(--accent-success)" /> : <Mail size={14} />}
              {copiedType === 'mail'
                ? 'E-Mail-Text in Zwischenablage kopiert ✓'
                : 'Fertige E-Mail-Vorlage für Kollegen kopieren'}
            </button>

            {reviewSync.lastPublishedAt && (
              <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Zuletzt veröffentlicht: {new Date(reviewSync.lastPublishedAt).toLocaleString('de-DE')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
