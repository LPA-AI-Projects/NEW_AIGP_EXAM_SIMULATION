const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set. Add a Postgres database in Railway and it will be injected automatically.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
});

const { v4: uuidv4 } = require('uuid');

async function init() {
  // IDs are generated in application code (uuidv4), not DB-side, so this works on any
  // Postgres provider without needing the pgcrypto extension or superuser rights.
  //
  // No "sessions" table: there is no shared, trainer-configured exam anymore. Each
  // learner picks their own mode/length and gets their own independently-drawn queue,
  // stored directly on their participant row.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participants (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      mode TEXT,                          -- 'full' | 'domain' | 'drill', NULL until they start
      domain TEXT,                        -- 'I'..'IV' when mode = 'domain', else NULL
      status TEXT NOT NULL DEFAULT 'profile_set', -- profile_set | in_progress | completed
      cur_index INT NOT NULL DEFAULT 0,
      score INT NOT NULL DEFAULT 0,
      total INT NOT NULL DEFAULT 0,
      queue JSONB NOT NULL DEFAULT '[]',  -- this participant's own drawn question-id order
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id UUID PRIMARY KEY,
      participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      q_index INT NOT NULL,
      given JSONB NOT NULL DEFAULT '[]',
      is_correct BOOLEAN NOT NULL,
      override_correct BOOLEAN,          -- trainer manual override, NULL = no override
      overridden_at TIMESTAMPTZ,
      answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(participant_id, question_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_responses_participant ON responses(participant_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email);`);

  // --- lightweight migration for anyone redeploying over an older (pre-self-serve) database ---
  await pool.query(`ALTER TABLE participants DROP COLUMN IF EXISTS session_id;`).catch(() => {});
  await pool.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS mode TEXT;`).catch(() => {});
  await pool.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS domain TEXT;`).catch(() => {});
  await pool.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS queue JSONB NOT NULL DEFAULT '[]';`).catch(() => {});
  await pool.query(`DROP TABLE IF EXISTS sessions CASCADE;`).catch(() => {});
}

module.exports = { pool, init, uuidv4 };
