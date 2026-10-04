const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', 'assets', 'logo.png');
const TEAL = '#2E9D91', ORANGE = '#F2541D', BLUE = '#4F71F2', INK = '#12181B', MUTED = '#6B7278', GOOD = '#1F8A5F', BAD = '#C0392B';

function modeLabel(p) {
  if (p.mode === 'domain') return 'Domain Practice \u2014 Domain ' + p.domain;
  if (p.mode === 'drill') return 'Quick Drill';
  return 'Full Mock Exam';
}

function header(doc, title, subtitle) {
  if (fs.existsSync(LOGO)) {
    try { doc.image(LOGO, 40, 32, { height: 26 }); } catch (e) {}
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('Learners Point Academy', 40, 64, { width: 300 });
  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(18).text(title, 40, 90);
  if (subtitle) doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(subtitle, 40, 114);
  doc.moveTo(40, 138).lineTo(555, 138).strokeColor('#DFE3E6').lineWidth(1).stroke();
  return 152;
}

function badgeFor(pct) {
  if (pct >= 85) return { label: 'Gold', color: '#B8860B', remark: 'Excellent grasp of AI governance across all four domains. Ready for certification-level scenarios.' };
  if (pct >= 70) return { label: 'Silver', color: '#6B7278', remark: 'Solid, consistent performance. A short review of the weaker domain below will round this out.' };
  if (pct >= 55) return { label: 'Bronze', color: '#C4762E', remark: 'A working foundation is there. Focused review of the lower-scoring domains is recommended before attempting again.' };
  return { label: 'Keep Practicing', color: BAD, remark: 'This is a starting point, not a verdict. Revisit the domain breakdown below and retake once each area feels steadier.' };
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('Unofficial practice report \u2014 Learners Point Academy \u2014 not affiliated with or endorsed by IAPP.', 40, 800, { width: 515, align: 'center' });
  }
}

function domainTable(doc, y, domStats, domainMeta) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('By domain', 40, y);
  y += 20;
  const order = ['I', 'II', 'III', 'IV'];
  order.forEach(d => {
    const s = domStats[d] || { correct: 0, total: 0 };
    if (!s.total) return;
    const pct = Math.round((s.correct / s.total) * 100);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Domain ' + d, 40, y, { width: 90 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(domainMeta[d].name, 130, y, { width: 260 });
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(s.correct + '/' + s.total + ' (' + pct + '%)', 400, y, { width: 120, align: 'right' });
    y += 18;
  });
  return y + 10;
}

/** Individual participant report: score, badge, domain breakdown, full Q&A with rationale. */
function individualReportPDF({ participant, questions, responses, domainMeta }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  let y = header(doc, 'Simulation Report', modeLabel(participant) + '  \u2014  ' + new Date(participant.completed_at || Date.now()).toLocaleString());

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(participant.name, 40, y);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(participant.email, 40, y + 15);
  y += 40;

  const pct = participant.total ? Math.round((participant.score / participant.total) * 100) : 0;
  const badge = badgeFor(pct);
  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(28).text(participant.score + '/' + participant.total, 40, y);
  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(16).text(pct + '%', 180, y + 8);
  doc.roundedRect(400, y, 115, 26, 6).fillColor(badge.color).fill();
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text(badge.label, 400, y + 7, { width: 115, align: 'center' });
  y += 45;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(badge.remark, 40, y, { width: 475 });
  y += 40;

  const domStats = {};
  ['I', 'II', 'III', 'IV'].forEach(d => domStats[d] = { correct: 0, total: 0 });
  questions.forEach(q => { domStats[q.domain].total++; });
  responses.forEach(r => { const q = questions.find(x => x.id === r.question_id); if (q && effectiveCorrect(r)) domStats[q.domain].correct++; });
  y = domainTable(doc, y, domStats, domainMeta);

  doc.addPage();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('Question-by-question review', 40, 40);
  y = 65;
  questions.forEach((q, i) => {
    const r = responses.find(x => x.question_id === q.id);
    const ok = r ? effectiveCorrect(r) : false;
    if (y > 700) { doc.addPage(); y = 40; }
    doc.fillColor('#fff');
    doc.roundedRect(40, y, 20, 20, 4).fillColor(ok ? GOOD : (r ? BAD : '#B9BEC2')).fill();
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text(ok ? String.fromCharCode(0x2713) : (r ? String.fromCharCode(0x2717) : '-'), 40, y + 4, { width: 20, align: 'center' });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text('Q' + (i + 1) + '  \u00b7  Domain ' + q.domain, 68, y + 2, { width: 470 });
    y += 18;
    doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(q.stem, 40, y, { width: 495 });
    y += doc.heightOfString(q.stem, { width: 495 }) + 6;
    const givenText = r ? r.given.map(l => l + '. ' + (q.options[l] || '')).join('; ') : '(not answered)';
    const correctText = q.correct.map(l => l + '. ' + (q.options[l] || '')).join('; ');
    doc.fillColor(ok ? GOOD : BAD).font('Helvetica-Bold').fontSize(8.5).text('Your answer: ', 40, y, { continued: true }).font('Helvetica').fillColor(INK).text(givenText, { width: 495 });
    y += doc.heightOfString('Your answer: ' + givenText, { width: 495 }) + 3;
    if (!ok) {
      doc.fillColor(GOOD).font('Helvetica-Bold').fontSize(8.5).text('Correct answer: ', 40, y, { continued: true }).font('Helvetica').fillColor(INK).text(correctText, { width: 495 });
      y += doc.heightOfString('Correct answer: ' + correctText, { width: 495 }) + 3;
    }
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5).text('Why: ' + q.rationale, 40, y, { width: 495 });
    y += doc.heightOfString('Why: ' + q.rationale, { width: 495 }) + 16;
  });

  footer(doc);
  doc.end();
  return doc;
}


/** Compiled report across all participants. */
function compiledReportPDF({ participants, domainMeta }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  let y = header(doc, 'Compiled Simulation Report', new Date().toLocaleString());

  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(participants.length + ' participant(s)', 40, y);
  y += 24;

  const cols = [
    { k: 'name', label: 'Name', w: 95 },
    { k: 'email', label: 'Email', w: 125 },
    { k: 'mode', label: 'Mode', w: 70 },
    { k: 'status', label: 'Status', w: 60 },
    { k: 'score', label: 'Score', w: 50 },
    { k: 'pct', label: '%', w: 30 },
    { k: 'badge', label: 'Badge', w: 75 }
  ];
  let x = 40;
  doc.rect(40, y, 505, 20).fillColor(TEAL).fill();
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
  cols.forEach(c => { doc.text(c.label, x + 4, y + 6, { width: c.w - 8 }); x += c.w; });
  y += 20;

  participants.forEach((p, i) => {
    if (y > 780) { doc.addPage(); y = 40; }
    const pct = p.total ? Math.round((p.score / p.total) * 100) : 0;
    const badge = badgeFor(pct);
    doc.rect(40, y, 505, 20).fillColor(i % 2 ? '#F4F7FE' : '#FFFFFF').fill();
    x = 40;
    doc.fillColor(INK).font('Helvetica').fontSize(8);
    const modeShort = p.mode === 'domain' ? ('Domain ' + p.domain) : p.mode === 'drill' ? 'Quick Drill' : p.mode === 'full' ? 'Full Mock' : '\u2014';
    const badgeShort = badge.label === 'Keep Practicing' ? 'Practice' : badge.label;
    const row = { name: p.name, email: p.email, mode: modeShort, status: p.status, score: p.score + '/' + p.total, pct: pct + '%', badge: p.status === 'completed' ? badgeShort : '\u2014' };
    cols.forEach(c => { doc.text(String(row[c.k] || ''), x + 4, y + 6, { width: c.w - 8 }); x += c.w; });
    y += 20;
  });

  footer(doc);
  doc.end();
  return doc;
}

/** A response's effective correctness: trainer override wins if set. */
function effectiveCorrect(r) {
  return r.override_correct === null || r.override_correct === undefined ? r.is_correct : r.override_correct;
}

module.exports = { individualReportPDF, compiledReportPDF, badgeFor, effectiveCorrect, modeLabel };
