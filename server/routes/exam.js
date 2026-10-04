const express = require('express');
const router = express.Router();
const { pool, uuidv4 } = require('../db');
const { byId, grade, publicQuestion, buildQueueForMode, DOMAIN_META, DOM_ORDER, BANK } = require('../examEngine');
const { individualReportPDF, badgeFor, effectiveCorrect } = require('../lib/pdf');
const { sendMail } = require('../lib/email');

async function requireParticipant(req, res, next) {
  const pid = req.session.participantId;
  if (!pid) return res.status(401).json({ error: 'Please join with your name and email first.' });
  const { rows } = await pool.query(`SELECT * FROM participants WHERE id = $1`, [pid]);
  if (!rows.length) return res.status(401).json({ error: 'Your session could not be found. Please rejoin.' });
  req.participant = rows[0];
  pool.query(`UPDATE participants SET last_seen_at = now() WHERE id = $1`, [pid]).catch(() => {});
  next();
}

router.get('/me', requireParticipant, async (req, res) => {
  const p = req.participant;
  res.json({
    name: p.name, email: p.email, status: p.status, mode: p.mode, domain: p.domain,
    curIndex: p.cur_index, totalQuestions: (p.queue || []).length
  });
});

// ---- Mode selection: the learner decides, not the trainer ----
router.post('/exam/start', requireParticipant, async (req, res) => {
  const p = req.participant;
  const mode = ['full', 'domain', 'drill'].includes(req.body.mode) ? req.body.mode : 'full';
  const domain = DOM_ORDER.includes(req.body.domain) ? req.body.domain : null;
  const length = [25, 50, 100].includes(parseInt(req.body.length, 10)) ? parseInt(req.body.length, 10) : 25;
  if (mode === 'domain' && !domain) return res.status(400).json({ error: 'Pick a domain for Domain Practice.' });

  const queue = buildQueueForMode(mode, { domain, length });
  if (!queue.length) return res.status(400).json({ error: 'No questions available for this selection.' });

  await pool.query(
    `UPDATE participants SET mode=$1, domain=$2, queue=$3::jsonb, status='in_progress',
       cur_index=0, score=0, total=$4, started_at=now(), completed_at=NULL
     WHERE id = $5`,
    [mode, domain, JSON.stringify(queue), queue.length, p.id]
  );
  await pool.query(`DELETE FROM responses WHERE participant_id = $1`, [p.id]); // clear any previous attempt's answers
  res.json({ ok: true, totalQuestions: queue.length });
});

// Any question in the queue can be fetched by its index, not just the "current" one —
// the learner can navigate freely. If it's already been answered, the response comes
// back too so the frontend can render it locked/read-only instead of answerable.
router.get('/exam/question/:idx', requireParticipant, async (req, res) => {
  const p = req.participant;
  const queue = p.queue || [];
  if (!queue.length) return res.status(409).json({ error: 'Pick a practice mode first.' });
  const idx = parseInt(req.params.idx, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= queue.length) return res.status(400).json({ error: 'Invalid question index.' });
  const qid = queue[idx];
  const q = byId(qid);
  const { rows } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 AND question_id = $2`, [p.id, qid]);
  const existing = rows[0] || null;
  res.json({
    index: idx, total: queue.length,
    question: publicQuestion(q), domainInfo: DOMAIN_META[q.domain],
    startedAt: p.started_at,
    answered: !!existing,
    yourAnswer: existing ? { given: existing.given, isCorrect: effectiveCorrect(existing) } : null,
    correct: existing ? q.correct : undefined, // only reveal once answered
    rationale: existing ? q.rationale : undefined
  });
});

router.post('/exam/answer', requireParticipant, async (req, res) => {
  const p = req.participant;
  const queue = p.queue || [];
  const idx = parseInt(req.body.index, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= queue.length) return res.status(400).json({ error: 'Invalid question index.' });
  const qid = queue[idx];
  const q = byId(qid);
  const given = Array.isArray(req.body.given) ? req.body.given : [];
  const isCorrect = grade(q, given);

  await pool.query(
    `INSERT INTO responses (id, participant_id, question_id, q_index, given, is_correct)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (participant_id, question_id) DO UPDATE SET given = EXCLUDED.given, is_correct = EXCLUDED.is_correct`,
    [uuidv4(), p.id, qid, idx, JSON.stringify(given), isCorrect]
  );
  const { rows: allResp } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1`, [p.id]);
  const score = allResp.filter(effectiveCorrect).length;
  await pool.query(`UPDATE participants SET cur_index = $1, score = $2 WHERE id = $3`, [idx, score, p.id]);

  res.json({ isCorrect, correct: q.correct, rationale: q.rationale });
});

router.get('/exam/progress', requireParticipant, async (req, res) => {
  const p = req.participant;
  const queue = p.queue || [];
  const { rows } = await pool.query(`SELECT question_id FROM responses WHERE participant_id = $1`, [p.id]);
  const answeredSet = new Set(rows.map(r => r.question_id));
  const items = queue.map((qid, index) => ({ index, domain: byId(qid).domain, answered: answeredSet.has(qid) }));
  res.json({ items, total: queue.length });
});

router.post('/exam/finish', requireParticipant, async (req, res) => {
  const p = req.participant;
  const queue = p.queue || [];
  if (!queue.length) return res.status(409).json({ error: 'Pick a practice mode first.' });
  const { rows: allResp } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1`, [p.id]);
  const score = allResp.filter(effectiveCorrect).length;
  await pool.query(
    `UPDATE participants SET status = 'completed', score = $1, total = $2, completed_at = now() WHERE id = $3`,
    [score, queue.length, p.id]
  );
  autoEmailResult(p, queue, score).catch(err => console.error('[email] auto-send on completion failed:', err.message));
  res.json({ ok: true, score, total: queue.length });
});

router.get('/exam/result', requireParticipant, async (req, res) => {
  const p = req.participant;
  if (p.status !== 'completed') return res.status(409).json({ error: 'Not finished yet.' });
  const { rows: responses } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 ORDER BY q_index`, [p.id]);
  const queue = p.queue || [];
  const questions = queue.map(byId);
  const domStats = {};
  DOM_ORDER.forEach(d => domStats[d] = { correct: 0, total: 0 });
  questions.forEach(q => { domStats[q.domain].total++; });
  responses.forEach(r => { const q = byId(r.question_id); if (q && effectiveCorrect(r)) domStats[q.domain].correct++; });
  const pct = p.total ? Math.round((p.score / p.total) * 100) : 0;
  res.json({ score: p.score, total: p.total, pct, mode: p.mode, domain: p.domain, badge: badgeFor(pct), domStats, domainMeta: DOMAIN_META });
});

router.get('/exam/review', requireParticipant, async (req, res) => {
  const p = req.participant;
  if (p.status !== 'completed') return res.status(409).json({ error: 'Not finished yet.' });
  const { rows: responses } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 ORDER BY q_index`, [p.id]);
  const byQid = {}; responses.forEach(r => { byQid[r.question_id] = r; });
  const items = (p.queue || []).map((id, i) => {
    const q = byId(id);
    const r = byQid[id];
    return {
      index: i, id: q.id, domain: q.domain, stem: q.stem, scenarioText: q.scenarioText, type: q.type,
      options: q.options, correct: q.correct, rationale: q.rationale,
      given: r ? r.given : null, isCorrect: r ? effectiveCorrect(r) : false, answered: !!r
    };
  });
  res.json({ items });
});

router.get('/exam/report.pdf', requireParticipant, async (req, res) => {
  const p = req.participant;
  if (p.status !== 'completed') return res.status(409).send('Not finished yet.');
  const { rows: responses } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 ORDER BY q_index`, [p.id]);
  const queue = p.queue || [];
  const questions = queue.map(byId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="AIGP-report-${p.name.replace(/\W+/g, '-')}.pdf"`);
  const doc = individualReportPDF({ participant: p, questions, responses, domainMeta: DOMAIN_META });
  doc.pipe(res);
});

async function autoEmailResult(p, queue, score) {
  const { rows: responses } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 ORDER BY q_index`, [p.id]);
  const questions = queue.map(byId);
  const participantForPdf = { ...p, score, total: queue.length };
  const reportDoc = individualReportPDF({ participant: participantForPdf, questions, responses, domainMeta: DOMAIN_META });
  const reportBuf = await streamToBuffer(reportDoc);
  const pct = queue.length ? Math.round((score / queue.length) * 100) : 0;
  const badge = badgeFor(pct);
  await sendMail({
    to: p.email,
    subject: `Your AIGP ${modeLabel(p)} result: ${score}/${queue.length} (${badge.label})`,
    html: `<p>Hi ${p.name},</p><p>Thanks for completing the <strong>${modeLabel(p)}</strong> practice simulation. Your result is <strong>${score}/${queue.length} (${pct}%)</strong> &mdash; ${badge.label}.</p><p>${badge.remark}</p><p>Your full report is attached.</p><p>&mdash; Learners Point Academy</p>`,
    attachments: [
      { filename: `AIGP-report-${p.name.replace(/\W+/g, '-')}.pdf`, content: reportBuf }
    ]
  });
}
function streamToBuffer(doc) {
  return new Promise((resolve) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
function modeLabel(p) {
  if (p.mode === 'domain') return 'Domain Practice \u2014 Domain ' + p.domain;
  if (p.mode === 'drill') return 'Quick Drill';
  return 'Full Mock Exam';
}

module.exports = router;
