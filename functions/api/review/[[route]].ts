interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface Env {
  DB: D1Database;
  SESSION_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: {
    route?: string | string[];
  };
}

interface PlanRow {
  id: string;
  title: string;
  passcode_hash: string;
  passcode_salt: string;
  admin_token_hash: string;
  snapshot_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface SubmissionRow {
  id: string;
  plan_id: string;
  teacher_code: string;
  reviewer_token_hash: string;
  overall_status: string;
  general_note: string;
  created_at: string;
  updated_at: string;
}

interface ExamFeedbackRow {
  id: string;
  submission_id: string;
  plan_id: string;
  exam_id: string;
  class_name: string;
  subject: string;
  status: string;
  preference: string | null;
  note: string;
  resolution_status: string;
  resolution_note: string;
  updated_at: string;
}

interface DayWishRow {
  id: string;
  submission_id: string;
  plan_id: string;
  week_id: string;
  day: string;
  class_name: string | null;
  wish_type: string;
  note: string;
  resolution_status: string;
  resolution_note: string;
  updated_at: string;
}

interface RateLimitRow {
  key: string;
  attempts: number;
  window_start: number;
  blocked_until: number;
}

const SESSION_COOKIE_NAME = 'kp_review_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPasscode(passcode: string, salt: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passcode),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return toBase64Url(new Uint8Array(bits));
}

async function signHmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

async function createSessionToken(planId: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${planId}.${exp}`;
  const sig = await signHmac(payload, secret);
  return `${payload}.${sig}`;
}

async function verifySessionToken(token: string, expectedPlanId: string, secret: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [planId, expStr, sig] = parts;
  if (planId !== expectedPlanId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expectedSig = await signHmac(`${planId}.${expStr}`, secret);
  return constantTimeEqual(sig, expectedSig);
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    result[key] = decodeURIComponent(val);
  }
  return result;
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  const requestUrl = new URL(request.url);
  const defaultLocalOrigins = [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:8788',
    'http://localhost:8788',
  ];
  const extraOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const isAllowed =
    origin === requestUrl.origin ||
    defaultLocalOrigins.includes(origin) ||
    extraOrigins.includes(origin);

  if (!isAllowed) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, X-Reviewer-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  request: Request,
  env: Env,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      ...getCorsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function getSessionSecret(env: Env, plan: PlanRow): string {
  return env.SESSION_SECRET || plan.admin_token_hash;
}

async function verifyAdmin(request: Request, plan: PlanRow): Promise<boolean> {
  const token = request.headers.get('X-Admin-Token')?.trim();
  if (!token) return false;
  const hash = await sha256Hex(token);
  return constantTimeEqual(hash, plan.admin_token_hash);
}

async function verifyColleagueSession(request: Request, env: Env, plan: PlanRow): Promise<boolean> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (!sessionToken) return false;
  return verifySessionToken(sessionToken, plan.id, getSessionSecret(env, plan));
}

function serializeSubmission(
  sub: SubmissionRow,
  examFeedback: ExamFeedbackRow[],
  dayWishes: DayWishRow[]
) {
  return {
    id: sub.id,
    planId: sub.plan_id,
    teacherCode: sub.teacher_code,
    overallStatus: sub.overall_status as 'ok' | 'has_requests',
    generalNote: sub.general_note,
    createdAt: sub.created_at,
    updatedAt: sub.updated_at,
    examFeedback: examFeedback.map((ef) => ({
      id: ef.id,
      examId: ef.exam_id,
      className: ef.class_name,
      subject: ef.subject,
      status: ef.status as 'ok' | 'not_ok',
      preference: (ef.preference || null) as 'earlier' | 'later' | 'not_this_day' | null,
      note: ef.note,
      resolutionStatus: ef.resolution_status as 'open' | 'applied' | 'dismissed',
      resolutionNote: ef.resolution_note,
      updatedAt: ef.updated_at,
    })),
    dayWishes: dayWishes.map((dw) => ({
      id: dw.id,
      weekId: dw.week_id,
      day: dw.day,
      className: dw.class_name,
      wishType: dw.wish_type as 'no_go' | 'prefer',
      note: dw.note,
      resolutionStatus: dw.resolution_status as 'open' | 'applied' | 'dismissed',
      resolutionNote: dw.resolution_note,
      updatedAt: dw.updated_at,
    })),
  };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...getCorsHeaders(request, env),
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (!env.DB) {
    return jsonResponse(
      500,
      { error: 'Cloudflare D1-Datenbank (Binding "DB") ist noch nicht konfiguriert.' },
      request,
      env
    );
  }

  const routeParts = Array.isArray(params.route)
    ? params.route.filter(Boolean)
    : typeof params.route === 'string'
      ? params.route.split('/').filter(Boolean)
      : [];

  // POST /api/review/plans -> Publish or update plan
  if (request.method === 'POST' && routeParts.length === 1 && routeParts[0] === 'plans') {
    const body = await readJson<{
      planId?: string;
      adminToken?: string;
      title?: string;
      passcode?: string;
      isActive?: boolean;
      snapshot?: unknown;
    }>(request);

    if (!body || !body.snapshot || typeof body.snapshot !== 'object') {
      return jsonResponse(400, { error: 'Ungültige Plan-Daten.' }, request, env);
    }

    const now = new Date().toISOString();
    const title = (body.title || 'Klausurplanung').trim() || 'Klausurplanung';
    const snapshotJson = JSON.stringify(body.snapshot);

    if (body.planId) {
      const existing = await env.DB.prepare('SELECT * FROM plans WHERE id = ?')
        .bind(body.planId)
        .first<PlanRow>();

      if (!existing) {
        return jsonResponse(404, { error: 'Veröffentlichter Plan nicht gefunden.' }, request, env);
      }

      const providedAdminToken = request.headers.get('X-Admin-Token')?.trim() || body.adminToken?.trim();
      if (!providedAdminToken) {
        return jsonResponse(401, { error: 'Admin-Token fehlt.' }, request, env);
      }
      const providedHash = await sha256Hex(providedAdminToken);
      if (!constantTimeEqual(providedHash, existing.admin_token_hash)) {
        return jsonResponse(403, { error: 'Ungültiges Admin-Token.' }, request, env);
      }

      let passcodeHash = existing.passcode_hash;
      let passcodeSalt = existing.passcode_salt;
      if (body.passcode && body.passcode.trim().length > 0) {
        if (body.passcode.trim().length < 4) {
          return jsonResponse(400, { error: 'Passcode muss mindestens 4 Zeichen haben.' }, request, env);
        }
        passcodeSalt = randomToken(16);
        passcodeHash = await hashPasscode(body.passcode.trim(), passcodeSalt);
      }

      const isActive = typeof body.isActive === 'boolean' ? (body.isActive ? 1 : 0) : existing.is_active;

      await env.DB.prepare(
        `UPDATE plans
         SET title = ?, passcode_hash = ?, passcode_salt = ?, snapshot_json = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(title, passcodeHash, passcodeSalt, snapshotJson, isActive, now, existing.id)
        .run();

      return jsonResponse(
        200,
        {
          planId: existing.id,
          isActive: isActive === 1,
          updatedAt: now,
        },
        request,
        env
      );
    }

    const passcode = body.passcode?.trim() || '';
    if (passcode.length < 4) {
      return jsonResponse(400, { error: 'Bitte ein Kollegiums-Passwort mit mindestens 4 Zeichen vergeben.' }, request, env);
    }

    const planId = randomToken(16);
    const adminToken = randomToken(24);
    const adminTokenHash = await sha256Hex(adminToken);
    const passcodeSalt = randomToken(16);
    const passcodeHash = await hashPasscode(passcode, passcodeSalt);

    await env.DB.prepare(
      `INSERT INTO plans (id, title, passcode_hash, passcode_salt, admin_token_hash, snapshot_json, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(planId, title, passcodeHash, passcodeSalt, adminTokenHash, snapshotJson, now, now)
      .run();

    return jsonResponse(
      201,
      {
        planId,
        adminToken,
        isActive: true,
        updatedAt: now,
      },
      request,
      env
    );
  }

  // Routes starting with /api/review/plans/:planId/...
  if (routeParts.length >= 2 && routeParts[0] === 'plans') {
    const planId = routeParts[1];
    const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ?')
      .bind(planId)
      .first<PlanRow>();

    if (!plan) {
      return jsonResponse(404, { error: 'Plan wurde nicht gefunden oder wurde gelöscht.' }, request, env);
    }

    // GET /api/review/plans/:planId/meta
    if (request.method === 'GET' && routeParts.length === 3 && routeParts[2] === 'meta') {
      const unlocked = await verifyColleagueSession(request, env, plan);
      return jsonResponse(
        200,
        {
          planId: plan.id,
          title: plan.title,
          isActive: plan.is_active === 1,
          updatedAt: plan.updated_at,
          unlocked,
        },
        request,
        env
      );
    }

    // POST /api/review/plans/:planId/unlock
    if (request.method === 'POST' && routeParts.length === 3 && routeParts[2] === 'unlock') {
      const body = await readJson<{ passcode?: string }>(request);
      const passcode = body?.passcode?.trim() || '';
      if (!passcode) {
        return jsonResponse(400, { error: 'Bitte Passcode eingeben.' }, request, env);
      }

      const ip = getClientIp(request);
      const rateKey = `${ip}:${plan.id}`;
      const nowMs = Date.now();
      const limitRow = await env.DB.prepare('SELECT * FROM rate_limits WHERE key = ?')
        .bind(rateKey)
        .first<RateLimitRow>();

      if (limitRow && limitRow.blocked_until > nowMs) {
        const waitMinutes = Math.ceil((limitRow.blocked_until - nowMs) / 60000);
        return jsonResponse(
          429,
          { error: `Zu viele Fehlversuche. Bitte in ca. ${waitMinutes} Min. erneut versuchen.` },
          request,
          env
        );
      }

      const candidateHash = await hashPasscode(passcode, plan.passcode_salt);
      const isValid = constantTimeEqual(candidateHash, plan.passcode_hash);

      if (!isValid) {
        const isSameWindow = limitRow && nowMs - limitRow.window_start < RATE_LIMIT_WINDOW_MS;
        const attempts = isSameWindow ? limitRow.attempts + 1 : 1;
        const windowStart = isSameWindow ? limitRow.window_start : nowMs;
        const blockedUntil = attempts >= RATE_LIMIT_MAX_ATTEMPTS ? nowMs + RATE_LIMIT_WINDOW_MS : 0;

        await env.DB.prepare(
          `INSERT INTO rate_limits (key, attempts, window_start, blocked_until)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, window_start = excluded.window_start, blocked_until = excluded.blocked_until`
        )
          .bind(rateKey, attempts, windowStart, blockedUntil)
          .run();

        return jsonResponse(401, { error: 'Falscher Zugangscode.' }, request, env);
      }

      if (limitRow) {
        await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(rateKey).run();
      }

      const sessionToken = await createSessionToken(plan.id, getSessionSecret(env, plan));
      const isHttps = new URL(request.url).protocol === 'https:';
      const cookieParts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${SESSION_TTL_SECONDS}`,
      ];
      if (isHttps) cookieParts.push('Secure');

      return jsonResponse(
        200,
        { ok: true },
        request,
        env,
        { 'Set-Cookie': cookieParts.join('; ') }
      );
    }

    // GET /api/review/plans/:planId (Colleague fetches plan + ONLY their own submission)
    if (request.method === 'GET' && routeParts.length === 2) {
      const hasSession = await verifyColleagueSession(request, env, plan);
      const isAdmin = await verifyAdmin(request, plan);

      if (!hasSession && !isAdmin) {
        return jsonResponse(401, { error: 'Bitte zuerst den Zugangscode eingeben.' }, request, env);
      }

      let mySubmission = null;
      const reviewerToken = request.headers.get('X-Reviewer-Token')?.trim();
      if (reviewerToken) {
        const reviewerHash = await sha256Hex(reviewerToken);
        const sub = await env.DB.prepare(
          'SELECT * FROM submissions WHERE plan_id = ? AND reviewer_token_hash = ?'
        )
          .bind(plan.id, reviewerHash)
          .first<SubmissionRow>();

        if (sub) {
          const efRes = await env.DB.prepare(
            'SELECT * FROM exam_feedback WHERE submission_id = ? ORDER BY updated_at ASC'
          )
            .bind(sub.id)
            .all<ExamFeedbackRow>();
          const dwRes = await env.DB.prepare(
            'SELECT * FROM day_wishes WHERE submission_id = ? ORDER BY updated_at ASC'
          )
            .bind(sub.id)
            .all<DayWishRow>();
          mySubmission = serializeSubmission(sub, efRes.results || [], dwRes.results || []);
        }
      }

      return jsonResponse(
        200,
        {
          plan: {
            id: plan.id,
            title: plan.title,
            isActive: plan.is_active === 1,
            updatedAt: plan.updated_at,
            snapshot: JSON.parse(plan.snapshot_json),
          },
          mySubmission,
        },
        request,
        env
      );
    }

    // POST /api/review/plans/:planId/submit (Colleague submits/updates their own feedback)
    if (request.method === 'POST' && routeParts.length === 3 && routeParts[2] === 'submit') {
      const hasSession = await verifyColleagueSession(request, env, plan);
      if (!hasSession) {
        return jsonResponse(401, { error: 'Sitzung abgelaufen. Bitte Zugangscode erneut eingeben.' }, request, env);
      }
      if (plan.is_active !== 1) {
        return jsonResponse(403, { error: 'Die Abstimmung für diesen Plan ist bereits geschlossen.' }, request, env);
      }

      const body = await readJson<{
        teacherCode?: string;
        reviewerToken?: string;
        generalNote?: string;
        examFeedback?: Array<{
          examId: string;
          className: string;
          subject: string;
          status: 'ok' | 'not_ok';
          preference?: 'earlier' | 'later' | 'not_this_day' | null;
          note?: string;
        }>;
        dayWishes?: Array<{
          id?: string;
          weekId: string;
          day: string;
          className?: string | null;
          wishType: 'no_go' | 'prefer';
          note?: string;
        }>;
      }>(request);

      const teacherCode = (body?.teacherCode || '').trim().toUpperCase();
      const reviewerToken = (body?.reviewerToken || '').trim();
      if (!teacherCode || teacherCode.length > 32) {
        return jsonResponse(400, { error: 'Bitte ein gültiges Lehrkraft-Kürzel angeben.' }, request, env);
      }
      if (!reviewerToken || reviewerToken.length < 8) {
        return jsonResponse(400, { error: 'Reviewer-Token fehlt.' }, request, env);
      }

      const reviewerHash = await sha256Hex(reviewerToken);
      const now = new Date().toISOString();
      const generalNote = (body?.generalNote || '').trim().slice(0, 1000);
      const examFeedbackInput = Array.isArray(body?.examFeedback) ? body.examFeedback : [];
      const dayWishesInput = Array.isArray(body?.dayWishes) ? body.dayWishes : [];

      const hasRequests =
        examFeedbackInput.some((ef) => ef.status === 'not_ok') || dayWishesInput.length > 0;
      const overallStatus = hasRequests ? 'has_requests' : 'ok';

      let existingSub = await env.DB.prepare(
        'SELECT * FROM submissions WHERE plan_id = ? AND reviewer_token_hash = ?'
      )
        .bind(plan.id, reviewerHash)
        .first<SubmissionRow>();

      const existingExamByExamId = new Map<string, ExamFeedbackRow>();
      const existingWishByKey = new Map<string, DayWishRow>();

      if (existingSub) {
        const efOld = await env.DB.prepare('SELECT * FROM exam_feedback WHERE submission_id = ?')
          .bind(existingSub.id)
          .all<ExamFeedbackRow>();
        for (const row of efOld.results || []) {
          existingExamByExamId.set(row.exam_id, row);
        }

        const dwOld = await env.DB.prepare('SELECT * FROM day_wishes WHERE submission_id = ?')
          .bind(existingSub.id)
          .all<DayWishRow>();
        for (const row of dwOld.results || []) {
          existingWishByKey.set(row.id, row);
          existingWishByKey.set(`${row.week_id}::${row.day}::${row.class_name || ''}`, row);
        }

        await env.DB.prepare(
          `UPDATE submissions
           SET teacher_code = ?, overall_status = ?, general_note = ?, updated_at = ?
           WHERE id = ?`
        )
          .bind(teacherCode, overallStatus, generalNote, now, existingSub.id)
          .run();
      } else {
        const subId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO submissions (id, plan_id, teacher_code, reviewer_token_hash, overall_status, general_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(subId, plan.id, teacherCode, reviewerHash, overallStatus, generalNote, now, now)
          .run();
        existingSub = {
          id: subId,
          plan_id: plan.id,
          teacher_code: teacherCode,
          reviewer_token_hash: reviewerHash,
          overall_status: overallStatus,
          general_note: generalNote,
          created_at: now,
          updated_at: now,
        };
      }

      const statements: D1PreparedStatement[] = [
        env.DB.prepare('DELETE FROM exam_feedback WHERE submission_id = ?').bind(existingSub.id),
        env.DB.prepare('DELETE FROM day_wishes WHERE submission_id = ?').bind(existingSub.id),
      ];

      for (const ef of examFeedbackInput) {
        const status = ef.status === 'not_ok' ? 'not_ok' : 'ok';
        const preference = status === 'not_ok' ? ef.preference || 'not_this_day' : null;
        const note = (ef.note || '').trim().slice(0, 500);
        const prev = existingExamByExamId.get(ef.examId);
        const unchanged =
          prev &&
          prev.status === status &&
          (prev.preference || null) === preference &&
          prev.note === note;

        const resolutionStatus = unchanged ? prev.resolution_status : 'open';
        const resolutionNote = unchanged ? prev.resolution_note : '';
        const itemId = prev?.id || crypto.randomUUID();

        statements.push(
          env.DB.prepare(
            `INSERT INTO exam_feedback
             (id, submission_id, plan_id, exam_id, class_name, subject, status, preference, note, resolution_status, resolution_note, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            itemId,
            existingSub.id,
            plan.id,
            ef.examId,
            ef.className,
            ef.subject,
            status,
            preference,
            note,
            resolutionStatus,
            resolutionNote,
            now
          )
        );
      }

      for (const dw of dayWishesInput) {
        const wishType = dw.wishType === 'prefer' ? 'prefer' : 'no_go';
        const className = dw.className ? dw.className.trim() : null;
        const note = (dw.note || '').trim().slice(0, 500);
        const prev =
          (dw.id ? existingWishByKey.get(dw.id) : undefined) ||
          existingWishByKey.get(`${dw.weekId}::${dw.day}::${className || ''}`);

        const unchanged =
          prev &&
          prev.wish_type === wishType &&
          (prev.class_name || null) === className &&
          prev.note === note;

        const resolutionStatus = unchanged ? prev.resolution_status : 'open';
        const resolutionNote = unchanged ? prev.resolution_note : '';
        const itemId = prev?.id || dw.id || crypto.randomUUID();

        statements.push(
          env.DB.prepare(
            `INSERT INTO day_wishes
             (id, submission_id, plan_id, week_id, day, class_name, wish_type, note, resolution_status, resolution_note, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            itemId,
            existingSub.id,
            plan.id,
            dw.weekId,
            dw.day,
            className,
            wishType,
            note,
            resolutionStatus,
            resolutionNote,
            now
          )
        );
      }

      await env.DB.batch(statements);

      const savedEf = await env.DB.prepare('SELECT * FROM exam_feedback WHERE submission_id = ?')
        .bind(existingSub.id)
        .all<ExamFeedbackRow>();
      const savedDw = await env.DB.prepare('SELECT * FROM day_wishes WHERE submission_id = ?')
        .bind(existingSub.id)
        .all<DayWishRow>();

      return jsonResponse(
        200,
        {
          ok: true,
          submission: serializeSubmission(existingSub, savedEf.results || [], savedDw.results || []),
        },
        request,
        env
      );
    }

    // GET /api/review/plans/:planId/inbox (Planner only)
    if (request.method === 'GET' && routeParts.length === 3 && routeParts[2] === 'inbox') {
      if (!(await verifyAdmin(request, plan))) {
        return jsonResponse(403, { error: 'Ungültiges Admin-Token.' }, request, env);
      }

      const subsRes = await env.DB.prepare(
        'SELECT * FROM submissions WHERE plan_id = ? ORDER BY updated_at DESC'
      )
        .bind(plan.id)
        .all<SubmissionRow>();

      const efRes = await env.DB.prepare('SELECT * FROM exam_feedback WHERE plan_id = ?')
        .bind(plan.id)
        .all<ExamFeedbackRow>();

      const dwRes = await env.DB.prepare('SELECT * FROM day_wishes WHERE plan_id = ?')
        .bind(plan.id)
        .all<DayWishRow>();

      const efBySub = new Map<string, ExamFeedbackRow[]>();
      for (const row of efRes.results || []) {
        const arr = efBySub.get(row.submission_id) || [];
        arr.push(row);
        efBySub.set(row.submission_id, arr);
      }

      const dwBySub = new Map<string, DayWishRow[]>();
      for (const row of dwRes.results || []) {
        const arr = dwBySub.get(row.submission_id) || [];
        arr.push(row);
        dwBySub.set(row.submission_id, arr);
      }

      const submissions = (subsRes.results || []).map((sub) =>
        serializeSubmission(sub, efBySub.get(sub.id) || [], dwBySub.get(sub.id) || [])
      );

      return jsonResponse(
        200,
        {
          plan: {
            id: plan.id,
            title: plan.title,
            isActive: plan.is_active === 1,
            updatedAt: plan.updated_at,
          },
          submissions,
        },
        request,
        env
      );
    }

    // PATCH /api/review/plans/:planId/items/:itemType/:itemId (Planner only)
    if (
      request.method === 'PATCH' &&
      routeParts.length === 5 &&
      routeParts[2] === 'items' &&
      (routeParts[3] === 'exam' || routeParts[3] === 'wish')
    ) {
      if (!(await verifyAdmin(request, plan))) {
        return jsonResponse(403, { error: 'Ungültiges Admin-Token.' }, request, env);
      }

      const itemType = routeParts[3];
      const itemId = routeParts[4];
      const body = await readJson<{
        resolutionStatus?: 'open' | 'applied' | 'dismissed';
        resolutionNote?: string;
      }>(request);

      const resolutionStatus = body?.resolutionStatus;
      if (resolutionStatus !== 'open' && resolutionStatus !== 'applied' && resolutionStatus !== 'dismissed') {
        return jsonResponse(400, { error: 'Ungültiger Status.' }, request, env);
      }

      const resolutionNote = (body?.resolutionNote || '').trim().slice(0, 500);
      const now = new Date().toISOString();
      const table = itemType === 'exam' ? 'exam_feedback' : 'day_wishes';

      await env.DB.prepare(
        `UPDATE ${table}
         SET resolution_status = ?, resolution_note = ?, updated_at = ?
         WHERE id = ? AND plan_id = ?`
      )
        .bind(resolutionStatus, resolutionNote, now, itemId, plan.id)
        .run();

      return jsonResponse(200, { ok: true, resolutionStatus, resolutionNote }, request, env);
    }

    // POST /api/review/plans/:planId/status (Admin toggles active/closed)
    if (request.method === 'POST' && routeParts.length === 3 && routeParts[2] === 'status') {
      if (!(await verifyAdmin(request, plan))) {
        return jsonResponse(403, { error: 'Ungültiges Admin-Token.' }, request, env);
      }
      const body = await readJson<{ isActive?: boolean }>(request);
      if (typeof body?.isActive !== 'boolean') {
        return jsonResponse(400, { error: 'isActive (boolean) erforderlich.' }, request, env);
      }
      const now = new Date().toISOString();
      await env.DB.prepare('UPDATE plans SET is_active = ?, updated_at = ? WHERE id = ?')
        .bind(body.isActive ? 1 : 0, now, plan.id)
        .run();

      return jsonResponse(200, { ok: true, isActive: body.isActive, updatedAt: now }, request, env);
    }
  }

  return jsonResponse(404, { error: 'Route nicht gefunden.' }, request, env);
}
