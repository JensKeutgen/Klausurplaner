-- D1 Schema für den Klausurplaner-Abstimmungsbereich

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  passcode_hash TEXT NOT NULL,
  passcode_salt TEXT NOT NULL,
  admin_token_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  teacher_code TEXT NOT NULL,
  reviewer_token_hash TEXT NOT NULL,
  overall_status TEXT NOT NULL DEFAULT 'ok',
  general_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_plan_reviewer
  ON submissions(plan_id, reviewer_token_hash);

CREATE INDEX IF NOT EXISTS idx_submissions_plan_teacher
  ON submissions(plan_id, teacher_code);

CREATE TABLE IF NOT EXISTS exam_feedback (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  class_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL, -- 'ok' | 'not_ok'
  preference TEXT,      -- 'earlier' | 'later' | 'not_this_day' | NULL
  note TEXT NOT NULL DEFAULT '',
  resolution_status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'applied' | 'dismissed'
  resolution_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exam_feedback_plan
  ON exam_feedback(plan_id, submission_id);

CREATE TABLE IF NOT EXISTS day_wishes (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  day TEXT NOT NULL,
  class_name TEXT,      -- NULL = alle eigenen Klassen
  wish_type TEXT NOT NULL, -- 'no_go' | 'prefer'
  note TEXT NOT NULL DEFAULT '',
  resolution_status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'applied' | 'dismissed'
  resolution_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_day_wishes_plan
  ON day_wishes(plan_id, submission_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
