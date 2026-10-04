async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch('/api' + path, Object.assign({ credentials: 'same-origin' }, opts));
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) { const err = new Error(data.error || 'Request failed'); err.status = res.status; err.data = data; throw err; }
  return data;
}
function injectTopbar(subtitle) {
  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML =
    '<div class="brand"><img src="/assets/logo.png" alt="Learners Point"><div><div class="name">' +
    (subtitle || 'AIGP Exam Simulation') + '</div><div class="sub">Learners Point Academy</div></div></div>' +
    '<div class="row" id="topbarRight"></div>';
  document.body.insertBefore(bar, document.body.firstChild);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '\u2014'; }
