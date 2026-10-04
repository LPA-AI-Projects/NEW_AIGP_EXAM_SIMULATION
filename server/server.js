require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { pool, init } = require('./db');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy; needed for secure cookies to work correctly

app.use(express.json());
app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'aigp-sim-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
    sameSite: 'lax',
    // 'auto' asks express-session to look at the actual request (respecting the
    // trust proxy setting above) rather than a static NODE_ENV check. That means
    // this works correctly both in local HTTP development and behind Railway's
    // HTTPS-terminating proxy, without needing NODE_ENV or FORCE_HTTPS juggling.
    secure: 'auto'
  }
}));

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/exam'));
app.use('/api/trainer', require('./routes/trainer'));

app.use(express.static(path.join(__dirname, '..', 'public')));

// simple SPA-ish fallback for direct navigation to known routes
const pages = ['mode-select', 'exam', 'results', 'review', 'dashboard'];
pages.forEach(p => {
  app.get('/' + p, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', p + '.html')));
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
init()
  .then(() => {
    app.listen(PORT, () => console.log(`AIGP simulator listening on :${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
