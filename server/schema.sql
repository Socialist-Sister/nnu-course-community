PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS courses (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  nature TEXT NOT NULL,
  category TEXT NOT NULL,
  credits REAL CHECK(credits >= 0),
  hours REAL CHECK(hours >= 0)
);
CREATE TABLE IF NOT EXISTS semesters (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, captured_at TEXT NOT NULL,
  source_url TEXT NOT NULL, source_hash TEXT NOT NULL, page_count INTEGER NOT NULL
);
-- Workbook metadata is separate from captured teacher groups and review identities.
CREATE TABLE IF NOT EXISTS boya_courses (
  course_code TEXT NOT NULL REFERENCES courses(code),
  semester_id TEXT NOT NULL REFERENCES semesters(id),
  category_id TEXT NOT NULL, basis TEXT NOT NULL,
  delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('offline','online','interuniversity')),
  platform TEXT NOT NULL, school TEXT NOT NULL,
  source_file TEXT NOT NULL, source_sheet TEXT NOT NULL, source_rows TEXT NOT NULL,
  source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL, imported_at TEXT NOT NULL,
  PRIMARY KEY(course_code,semester_id)
);
-- A teaching group is the exact course-code/name/teacher-text combination requested by the user.
-- Multiple names and ranks are retained verbatim, never guessed to be individual identities.
CREATE TABLE IF NOT EXISTS teaching_groups (
  id TEXT PRIMARY KEY, course_code TEXT NOT NULL REFERENCES courses(code),
  course_name TEXT NOT NULL, teachers_raw TEXT NOT NULL, teachers_provided INTEGER NOT NULL CHECK(teachers_provided IN (0,1)),
  UNIQUE(course_code, course_name, teachers_raw)
);
CREATE TABLE IF NOT EXISTS course_snapshots (
  course_code TEXT NOT NULL REFERENCES courses(code), semester_id TEXT NOT NULL REFERENCES semesters(id),
  name TEXT NOT NULL, department TEXT NOT NULL, nature TEXT NOT NULL, category TEXT NOT NULL,
  credits REAL, hours REAL, PRIMARY KEY(course_code, semester_id)
);
CREATE TABLE IF NOT EXISTS offerings (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES teaching_groups(id),
  semester_id TEXT NOT NULL REFERENCES semesters(id), section_no TEXT NOT NULL,
  source_page INTEGER NOT NULL, source_row INTEGER NOT NULL, captured_at TEXT NOT NULL,
  UNIQUE(group_id, semester_id, section_no)
);
-- Empty in this catalog release. Account access and review submission will be added separately.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, public_name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  group_id TEXT NOT NULL REFERENCES teaching_groups(id), semester_id TEXT NOT NULL REFERENCES semesters(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), content TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 1 CHECK(anonymous IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','hidden')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id, group_id, semester_id)
);
CREATE INDEX IF NOT EXISTS idx_courses_department_category ON courses(department, category);
CREATE INDEX IF NOT EXISTS idx_groups_course ON teaching_groups(course_code);
CREATE INDEX IF NOT EXISTS idx_offerings_group_semester ON offerings(group_id, semester_id);
CREATE INDEX IF NOT EXISTS idx_reviews_group ON reviews(group_id, semester_id, status);
INSERT OR IGNORE INTO schema_migrations VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
