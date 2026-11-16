import {
  DAYS_OF_WEEK,
  type AppState,
  type ClassSchedule,
  type DayWishType,
  type Exam,
  type ExamChangePreference,
  type ExamFeedbackStatus,
  type ReviewPlanData,
  type ReviewPlanSnapshot,
  type ReviewSubmission,
  type TicketResolutionStatus,
  type Week,
} from '../types';
import { getTeachersForSubjectOnDay } from './solver';

export function getReviewPlanIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get('review');
  if (queryId && queryId.trim()) return queryId.trim();

  const match = window.location.pathname.match(/\/review\/([^/?#]+)/);
  if (match && match[1]) return decodeURIComponent(match[1]);

  return null;
}

export function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
}

export function getEffectiveServerUrl(configuredUrl?: string): string {
  const trimmed = (configuredUrl || '').trim().replace(/\/+$/, '');
  if (trimmed) return trimmed;
  const envUrl = (import.meta.env.VITE_REVIEW_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
  if (envUrl) return envUrl;
  if (typeof window !== 'undefined' && !isLocalDevHost()) {
    return window.location.origin;
  }
  return '';
}

export function buildReviewShareUrl(planId: string, serverUrl?: string): string {
  const base = getEffectiveServerUrl(serverUrl) || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/review/${encodeURIComponent(planId)}`;
}

export function buildReviewSnapshot(state: AppState): ReviewPlanSnapshot {
  return {
    classes: state.classes,
    weeks: state.weeks,
    exams: state.exams,
    blockedDays: state.blockedDays,
    blockedClassDays: state.blockedClassDays,
    selectedSubjects: state.selectedSubjects,
    pdfSettings: state.pdfSettings,
    solverSettings: state.solverSettings,
  };
}

function getClassTeacherMaps(cls: ClassSchedule) {
  const maps = [cls.subjectTeachers, cls.subjectTeachersB].filter(Boolean);
  if (cls.weeklySchedules) {
    for (const wData of Object.values(cls.weeklySchedules)) {
      if (wData.subjectTeachers) maps.push(wData.subjectTeachers);
    }
  }
  return maps;
}

export interface TeacherOption {
  code: string;
  displayName: string;
  fullName: string;
  surname: string;
}

const TEACHER_TITLE_RE = /\b(Prof\.|Dr\.|Dipl\.-\w+\.?|OStR|StR|StD|OStD|Frau|Herr)\b/gi;

export function extractTeacherSurname(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) {
    return trimmed.split(',')[0].trim();
  }
  const cleaned = trimmed.replace(TEACHER_TITLE_RE, '').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

export function formatTeacherDisplayName(code: string, rawFullName?: string): string {
  const cleanFull = (rawFullName || '').trim();
  if (!cleanFull) return code;
  if (cleanFull.includes(',')) {
    return cleanFull.toUpperCase() === code ? cleanFull : `${cleanFull} (${code})`;
  }
  const parts = cleanFull.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(' ');
    const formatted = `${last}, ${first}`;
    return cleanFull.toUpperCase() === code ? formatted : `${formatted} (${code})`;
  }
  return cleanFull.toUpperCase() === code ? cleanFull : `${cleanFull} (${code})`;
}

export function extractTeacherOptions(classes: ClassSchedule[]): TeacherOption[] {
  const rawByCode = new Map<string, string>();
  const fullNameByCode = new Map<string, string>();

  const registerCode = (rawTeacher: string, cls?: ClassSchedule) => {
    const rawTrimmed = rawTeacher.trim();
    const norm = rawTrimmed.toUpperCase();
    if (!norm) return;
    if (!rawByCode.has(norm)) {
      rawByCode.set(norm, rawTrimmed);
    }
    if (cls?.teacherNames) {
      for (const [k, v] of Object.entries(cls.teacherNames)) {
        if (k.trim().toUpperCase() === norm && v && v.trim()) {
          fullNameByCode.set(norm, v.trim());
          break;
        }
      }
    }
  };

  for (const cls of classes) {
    for (const map of getClassTeacherMaps(cls)) {
      if (!map) continue;
      for (const day of DAYS_OF_WEEK) {
        const dayMap = map[day];
        if (!dayMap) continue;
        for (const teachers of Object.values(dayMap)) {
          for (const t of teachers || []) {
            registerCode(t, cls);
          }
        }
      }
    }
    for (const t of Object.values(cls.examTeacherBySubject || {})) {
      if (t) registerCode(t, cls);
    }
  }

  const options: TeacherOption[] = [];
  for (const [code, rawLabel] of rawByCode.entries()) {
    const fullName = fullNameByCode.get(code) || (rawLabel !== code ? rawLabel : '');
    const nameForSort = fullName || rawLabel;
    const surname = extractTeacherSurname(nameForSort) || code;
    const displayName = formatTeacherDisplayName(code, fullName || (rawLabel !== code ? rawLabel : undefined));
    options.push({
      code,
      displayName,
      fullName: fullName || rawLabel,
      surname,
    });
  }

  return options.sort(
    (a, b) =>
      a.surname.localeCompare(b.surname, 'de', { sensitivity: 'base' }) ||
      a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' })
  );
}

export function extractTeacherCodes(classes: ClassSchedule[]): string[] {
  return extractTeacherOptions(classes).map((o) => o.code);
}

export function getExamTeachersNormalized(
  exam: Exam,
  classes: ClassSchedule[],
  weeks: Week[]
): string[] {
  const cls = classes.find((c) => c.className === exam.className);
  if (!cls) return [];

  const chosen = cls.examTeacherBySubject?.[exam.subject]?.trim().toUpperCase();
  if (chosen) return [chosen];

  if (exam.assignedWeekId && exam.assignedDay) {
    const week = weeks.find((w) => w.id === exam.assignedWeekId);
    const direct = getTeachersForSubjectOnDay(cls, exam.subject, exam.assignedDay, week?.id);
    if (direct.length > 0) {
      return direct.map((t) => t.trim().toUpperCase()).filter(Boolean);
    }
  }

  const all = new Set<string>();
  for (const map of getClassTeacherMaps(cls)) {
    if (!map) continue;
    for (const day of DAYS_OF_WEEK) {
      const teachers = map[day]?.[exam.subject];
      for (const t of teachers || []) {
        const norm = t.trim().toUpperCase();
        if (norm) all.add(norm);
      }
    }
  }
  return Array.from(all);
}

export function getTeacherClasses(classes: ClassSchedule[], teacherCode: string): string[] {
  const target = teacherCode.trim().toUpperCase();
  if (!target) return [];
  const result: string[] = [];

  for (const cls of classes) {
    let matches = false;
    for (const map of getClassTeacherMaps(cls)) {
      if (!map) continue;
      for (const day of DAYS_OF_WEEK) {
        const dayMap = map[day];
        if (!dayMap) continue;
        for (const teachers of Object.values(dayMap)) {
          if ((teachers || []).some((t) => t.trim().toUpperCase() === target)) {
            matches = true;
            break;
          }
        }
        if (matches) break;
      }
      if (matches) break;
    }
    if (matches) result.push(cls.className);
  }

  return result.sort((a, b) => a.localeCompare(b, 'de'));
}

export function getOrCreateReviewerToken(planId: string): string {
  const key = `klausurplaner_reviewer_${planId}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing && existing.length >= 8) return existing;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const created = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, created);
    return created;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function getSavedTeacherCode(planId: string): string {
  try {
    return localStorage.getItem(`klausurplaner_teacher_${planId}`) || '';
  } catch {
    return '';
  }
}

export function saveTeacherCode(planId: string, teacherCode: string): void {
  try {
    localStorage.setItem(`klausurplaner_teacher_${planId}`, teacherCode.trim().toUpperCase());
  } catch {
    // ignore storage quota errors
  }
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data as T;
}

export interface PublishPlanParams {
  serverUrl: string;
  planId?: string;
  adminToken?: string;
  title: string;
  passcode?: string;
  isActive?: boolean;
  snapshot: ReviewPlanSnapshot;
}

export interface PublishPlanResponse {
  planId: string;
  adminToken?: string;
  isActive: boolean;
  updatedAt: string;
}

export async function publishReviewPlan(params: PublishPlanParams): Promise<PublishPlanResponse> {
  const base = getEffectiveServerUrl(params.serverUrl);
  if (!base) {
    throw new Error('Bitte die Cloudflare-Pages-URL (z. B. https://klausurplaner.pages.dev) angeben.');
  }
  const headers: Record<string, string> = {};
  if (params.adminToken) {
    headers['X-Admin-Token'] = params.adminToken;
  }
  return apiFetch<PublishPlanResponse>(`${base}/api/review/plans`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      planId: params.planId,
      adminToken: params.adminToken,
      title: params.title,
      passcode: params.passcode,
      isActive: params.isActive,
      snapshot: params.snapshot,
    }),
  });
}

export async function fetchReviewInbox(
  serverUrl: string,
  planId: string,
  adminToken: string
): Promise<{
  plan: { id: string; title: string; isActive: boolean; updatedAt: string };
  submissions: ReviewSubmission[];
}> {
  const base = getEffectiveServerUrl(serverUrl);
  if (!base) {
    throw new Error('Bitte die Cloudflare-Pages-URL angeben.');
  }
  return apiFetch(`${base}/api/review/plans/${encodeURIComponent(planId)}/inbox`, {
    method: 'GET',
    headers: { 'X-Admin-Token': adminToken },
  });
}

export async function updateTicketResolution(
  serverUrl: string,
  planId: string,
  adminToken: string,
  itemType: 'exam' | 'wish',
  itemId: string,
  resolutionStatus: TicketResolutionStatus,
  resolutionNote = ''
): Promise<{ ok: boolean }> {
  const base = getEffectiveServerUrl(serverUrl);
  return apiFetch(
    `${base}/api/review/plans/${encodeURIComponent(planId)}/items/${itemType}/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'X-Admin-Token': adminToken },
      body: JSON.stringify({ resolutionStatus, resolutionNote }),
    }
  );
}

export async function setReviewPlanStatus(
  serverUrl: string,
  planId: string,
  adminToken: string,
  isActive: boolean
): Promise<{ ok: boolean; isActive: boolean; updatedAt: string }> {
  const base = getEffectiveServerUrl(serverUrl);
  return apiFetch(`${base}/api/review/plans/${encodeURIComponent(planId)}/status`, {
    method: 'POST',
    headers: { 'X-Admin-Token': adminToken },
    body: JSON.stringify({ isActive }),
  });
}

export async function fetchPlanMeta(planId: string): Promise<{
  planId: string;
  title: string;
  isActive: boolean;
  updatedAt: string;
  unlocked: boolean;
}> {
  const base = getEffectiveServerUrl();
  return apiFetch(`${base}/api/review/plans/${encodeURIComponent(planId)}/meta`);
}

export async function unlockReviewPlan(planId: string, passcode: string): Promise<{ ok: boolean }> {
  const base = getEffectiveServerUrl();
  return apiFetch(`${base}/api/review/plans/${encodeURIComponent(planId)}/unlock`, {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export async function fetchColleaguePlan(
  planId: string,
  reviewerToken: string
): Promise<{ plan: ReviewPlanData; mySubmission: ReviewSubmission | null }> {
  const base = getEffectiveServerUrl();
  return apiFetch(`${base}/api/review/plans/${encodeURIComponent(planId)}`, {
    method: 'GET',
    headers: {
      'X-Reviewer-Token': reviewerToken,
    },
  });
}

export interface SubmitFeedbackPayload {
  teacherCode: string;
  reviewerToken: string;
  generalNote: string;
  examFeedback: Array<{
    examId: string;
    className: string;
    subject: string;
    status: ExamFeedbackStatus;
    preference: ExamChangePreference | null;
    note: string;
  }>;
  dayWishes: Array<{
    id?: string;
    weekId: string;
    day: string;
    className: string | null;
    wishType: DayWishType;
    note: string;
  }>;
}

export async function submitColleagueFeedback(
  planId: string,
  payload: SubmitFeedbackPayload
): Promise<{ ok: boolean; submission: ReviewSubmission }> {
  const base = getEffectiveServerUrl();
  return apiFetch(`${base}/api/review/plans/${encodeURIComponent(planId)}/submit`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
