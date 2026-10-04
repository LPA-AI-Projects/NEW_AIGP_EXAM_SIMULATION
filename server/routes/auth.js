const express = require('express');
const router = express.Router();
const { pool, uuidv4 } = require('../db');

// ---- Learner: establish identity with just name + email, no password, no shared session ----
router.post('/learner/join', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'A name and a valid email address are required.' });
  }

  // Reuse an existing participant row for this email if they refresh/rejoin, so repeated
  // visits don't pile up duplicate rows. Their in-progress or completed attempt is preserved.
  const { rows: existing } = await pool.query(`SELECT * FROM participants WHERE email = $1 LIMIT 1`, [email]);
  let participant;
  if (existing.length) {
    participant = existing[0];
    await pool.query(`UPDATE participants SET name = $1, last_seen_at = now() WHERE id = $2`, [name, participant.id]);
  } else {
    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO participants (id, name, email) VALUES ($1,$2,$3) RETURNING *`,
      [id, name, email]
    );
    participant = rows[0];
  }
  req.session.participantId = participant.id;
  req.session.isTrainer = false;
  res.json({ ok: true, status: participant.status });
});

// ---- Trainer: single shared code, configurable via env var TRAINER_CODE ----
router.post('/trainer/login', (req, res) => {
  const code = String(req.body.code || '');
  const expected = process.env.TRAINER_CODE || '2468';
  if (code !== expected) return res.status(401).json({ error: 'Incorrect code.' });
  req.session.isTrainer = true;
  req.session.participantId = null;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
