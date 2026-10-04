const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { byId, BANK, DOMAIN_META, DOM_ORDER } = require('../examEngine');
const { individualReportPDF, compiledReportPDF, badgeFor, effectiveCorrect } = require('../lib/pdf');
const { sendMail } = require('../lib/email');

function requireTrainer(req, res, next) {
  if (!req.session.isTrainer) return res.status(401).json({ error: 'Trainer login required.' });
  next();
}
router.use(requireTrainer);

router.get('/participants', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, mode, domain, status, cur_index, score, total, queue, joined_at, started_at, completed_at, last_seen_at
     FROM participants ORDER BY joined_at ASC`
  );
  const participants = rows.map(p => ({
    ...p,
    pct: p.total ? Math.round((p.score / p.total) * 100) : 0,
    progressPct: (p.queue || []).length ? Math.round((p.cur_index / (p.queue || []).length) * 100) : 0,
    totalQuestions: (p.queue || []).length,
    badge: p.status === 'completed' ? badgeFor(p.total ? Math.round((p.score / p.total) * 100) : 0).label : null
  }));
  res.json({ participants, emailEnabled: require('../lib/email').emailEnabled });
});

// Reference answer key: the full question bank, grouped by domain (there's no single shared
// exam anymore, since every learner draws their own queue).
router.get('/answerkey', async (req, res) => {
  const byDomain = {};
  DOM_ORDER.forEach(d => byDomain[d] = []);
  BANK.forEach(q => byDomain[q.domain].push(q));
  res.json({ domains: DOM_ORDER.map(d => ({ domain: d, meta: DOMAIN_META[d], questions: byDomain[d] })), total: BANK.length });
});

router.get('/participant/:id', async (req, res) => {
  const { rows: pRows } = await pool.query(`SELECT * FROM participants WHERE id = $1`, [req.params.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Not found.' });
  const p = pRows[0];
  const { rows: responses } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 ORDER BY q_index`, [p.id]);
  const byQid = {}; responses.forEach(r => { byQid[r.question_id] = r; });
  const items = (p.queue || []).map((id, i) => {
    const q = byId(id);
    const r = byQid[id];
    return {
      index: i + 1, id: q.id, domain: q.domain, stem: q.stem, options: q.options, correct: q.correct, rationale: q.rationale,
      given: r ? r.given : null, isCorrect: r ? r.is_correct : null,
      overrideCorrect: r ? r.override_correct : null,
      effectiveCorrect: r ? effectiveCorrect(r) : null,
      answered: !!r
    };
  });
  const pct = p.total ? Math.round((p.score / p.total) * 100) : 0;
  res.json({
    participant: { id: p.id, name: p.name, email: p.email, mode: p.mode, domain: p.domain, status: p.status, score: p.score, total: p.total, pct, badge: badgeFor(pct) },
    items
  });
});

router.post('/participant/:id/override', async (req, res) => {
  const { question_id, correct } = req.body; // correct: true | false | null (null clears the override)
  const p = req.params.id;
  await pool.query(
    `UPDATE responses SET override_correct = $1, overridden_at = now() WHERE participant_id = $2 AND question_id = $3`,
    [correct === null ? null : !!correct, p, question_id]
  );
  const { rows: allResp } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1`, [p]);
  const score = allResp.filter(effectiveCorrect).length;
  await pool.query(`UPDATE participants SET score = $1 WHERE id = $2`, [score, p]);
  res.json({ ok: true, score });
});

router.get('/report.pdf', async (req, res) => {
  const { rows: participants } = await pool.query(`SELECT * FROM participants ORDER BY joined_at ASC`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="AIGP-compiled-report.pdf"`);
  const doc = compiledReportPDF({ participants, domainMeta: DOMAIN_META });
  doc.pipe(res);
});

router.get('/participant/:id/report.pdf', async (req, res) => {
  const { rows: pRows } = await pool.query(`SELECT * FROM participants WHERE id = $1`, [req.params.id]);
  if (!pRows.length) return res.status(404).send('Not found.');
  const p = pRows[0];
  const { rows: responses } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 ORDER BY q_index`, [p.id]);
  const questions = (p.queue || []).map(byId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="AIGP-report-${p.name.replace(/\W+/g, '-')}.pdf"`);
  const doc = individualReportPDF({ participant: p, questions, responses, domainMeta: DOMAIN_META });
  doc.pipe(res);
});

router.post('/participant/:id/resend', async (req, res) => {
  const { rows: pRows } = await pool.query(`SELECT * FROM participants WHERE id = $1`, [req.params.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Not found.' });
  const p = pRows[0];
  if (p.status !== 'completed') return res.status(400).json({ error: 'This participant has not completed a simulation yet.' });
  const { rows: responses } = await pool.query(`SELECT * FROM responses WHERE participant_id = $1 ORDER BY q_index`, [p.id]);
  const questions = (p.queue || []).map(byId);

  const { individualReportPDF: reportFn } = require('../lib/pdf');
  const reportDoc = reportFn({ participant: p, questions, responses, domainMeta: DOMAIN_META });
  const reportBuf = await streamToBuffer(reportDoc);
  const pct = p.total ? Math.round((p.score / p.total) * 100) : 0;
  const badge = badgeFor(pct);

  const result = await sendMail({
    to: p.email,
    subject: `Your updated AIGP result: ${p.score}/${p.total} (${badge.label})`,
    html: `<p>Hi ${p.name},</p><p>Your updated result is <strong>${p.score}/${p.total} (${pct}%)</strong> &mdash; ${badge.label}.</p><p>Your full report is attached.</p><p>&mdash; Learners Point Academy</p>`,
    attachments: [
      { filename: `AIGP-report-${p.name.replace(/\W+/g, '-')}.pdf`, content: reportBuf }
    ]
  });
  res.json(result);
});

router.post('/reset', async (req, res) => {
  await pool.query(`DELETE FROM participants`); // responses cascade-delete with them
  res.json({ ok: true });
});

function streamToBuffer(doc) {
  return new Promise((resolve) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

module.exports = router;
