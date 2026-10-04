const fs = require('fs');
const path = require('path');

const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'questionBank.json'), 'utf8'));
const BY_ID = {};
BANK.forEach(q => { BY_ID[q.id] = q; });

const DOMAIN_META = {
  I: { name: 'Foundations of AI Governance', range: '16\u201320 on the real exam' },
  II: { name: 'Laws, Standards & Frameworks', range: '19\u201323 on the real exam' },
  III: { name: 'Governing AI Development', range: '21\u201325 on the real exam' },
  IV: { name: 'Governing AI Deployment & Use', range: '21\u201325 on the real exam' }
};
const DOM_ORDER = ['I', 'II', 'III', 'IV'];
const FULL_PROPORTION = { I: 21, II: 25, III: 27, IV: 27 }; // sums to 100, proportional to blueprint

function byId(id) { return BY_ID[id]; }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function domainUnits(domain) {
  const pool = BANK.filter(q => q.domain === domain);
  const seen = {};
  const units = [];
  pool.forEach(q => {
    if (q.scenario) {
      const key = 'S-' + q.scenario + '-' + q.domain;
      if (!seen[key]) { seen[key] = { ids: [] }; units.push(seen[key]); }
      seen[key].ids.push(q.id);
    } else {
      units.push({ ids: [q.id] });
    }
  });
  return units;
}

function drawDomain(domain, target) {
  const units = shuffle(domainUnits(domain));
  let out = [], total = 0;
  for (const u of units) {
    if (total >= target) break;
    if (total + u.ids.length <= target + 1 || total === 0) { out = out.concat(u.ids); total += u.ids.length; }
  }
  return out;
}

function groupByScenario(ids) {
  const clusters = [], seen = {};
  ids.forEach(id => {
    const q = byId(id);
    if (q.scenario) {
      const key = q.scenario + '-' + q.domain;
      if (!seen[key]) { seen[key] = []; clusters.push(seen[key]); }
      seen[key].push(id);
    } else {
      clusters.push([id]);
    }
  });
  const out = [], pushed = {};
  clusters.forEach(c => { const k = c.join(','); if (!pushed[k]) { pushed[k] = true; out.push(c); } });
  return out;
}

/** Full mock / quick drill: proportional draw across all four domains. */
function buildFullQueue(length) {
  const sumProp = DOM_ORDER.reduce((s, d) => s + FULL_PROPORTION[d], 0);
  const raw = {}; let used = 0;
  DOM_ORDER.forEach(d => { const v = Math.round(FULL_PROPORTION[d] / sumProp * length); raw[d] = v; used += v; });
  raw[DOM_ORDER[DOM_ORDER.length - 1]] += (length - used);
  let ids = [];
  DOM_ORDER.forEach(d => { ids = ids.concat(drawDomain(d, Math.max(0, raw[d]))); });
  const clusters = shuffle(groupByScenario(ids));
  let flat = [];
  clusters.forEach(c => { flat = flat.concat(c); });
  return flat;
}

/** Domain practice: draw only from one domain, up to its available pool. */
function buildDomainQueue(domain) {
  const ids = drawDomain(domain, 999); // 999 = "take the whole pool", pools are far smaller than this
  const clusters = shuffle(groupByScenario(ids));
  let flat = [];
  clusters.forEach(c => { flat = flat.concat(c); });
  return flat;
}

/** Builds a queue for any of the three self-serve modes. */
function buildQueueForMode(mode, opts) {
  opts = opts || {};
  if (mode === 'domain') return buildDomainQueue(opts.domain);
  if (mode === 'drill') return buildFullQueue(25);
  return buildFullQueue(opts.length || 25); // 'full'
}

/** Grade a single response. `given` is an array of letters (or the ordered sequence for 'order' type). */
function grade(question, given) {
  if (!given || !given.length) return false;
  if (question.type === 'order') return JSON.stringify(given) === JSON.stringify(question.correct);
  const a = given.slice().sort().join(',');
  const b = question.correct.slice().sort().join(',');
  return given.length === question.correct.length && a === b;
}

function publicQuestion(q) {
  // strip correct/rationale for the "in progress" view; sent separately after answering.
  // selectCount is safe to expose for multi-select (tells the learner how many to pick, not which ones).
  return {
    id: q.id, domain: q.domain, type: q.type,
    scenario: q.scenario, scenarioText: q.scenarioText,
    stem: q.stem, options: q.options,
    selectCount: q.type === 'multi' ? q.correct.length : undefined
  };
}

module.exports = { BANK, byId, DOMAIN_META, DOM_ORDER, buildQueueForMode, grade, publicQuestion };
