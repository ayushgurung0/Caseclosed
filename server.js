const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');
const path     = require('path');
const { customAlphabet } = require('nanoid');
const { db, nextId } = require('./database');

const app     = express();
const PORT    = process.env.PORT || 3000;
const genCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

// ── MIDDLEWARE ──────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'caseclosed-secret-change-in-prod',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── HELPERS ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function now() { return new Date().toISOString(); }
function isReleased(dt) { return new Date(dt) <= new Date(); }

// ── PUBLIC API ───────────────────────────────────────────

// GET /api/active-case
app.get('/api/active-case', (req, res) => {
  const c = db.get('cases').find({ status: 'active' }).value();
  if (!c) return res.json({ case: null });
  const suspects = db.get('suspects').filter({ case_id: c.id }).value();
  res.json({ case: { ...c, suspects } });
});

// POST /api/unlock
app.post('/api/unlock', (req, res) => {
  const raw = (req.body.code || '').toUpperCase().replace(/[-\s]/g, '');
  if (!raw) return res.status(400).json({ error: 'Please enter a code.' });

  const codeRow = db.get('codes').find(c => c.code.replace(/-/g,'') === raw).value();
  if (!codeRow) return res.status(400).json({ error: 'Invalid code. Check inside your evidence envelope.' });

  const alreadyUnlocked = db.get('unlocked').find({ session_id: req.sessionID, case_id: codeRow.case_id }).value();
  if (alreadyUnlocked) return res.json({ success: true, already: true, case_id: codeRow.case_id });

  if (codeRow.used && codeRow.pack_type === 'solo') {
    return res.status(400).json({ error: 'This code has already been used. Each solo kit has a unique code.' });
  }

  if (codeRow.pack_type === 'solo') {
    db.get('codes').find({ id: codeRow.id }).assign({ used: true, used_by: req.sessionID, used_at: now() }).write();
  }

  db.get('unlocked').push({ id: nextId('unlocked'), session_id: req.sessionID, case_id: codeRow.case_id, code_id: codeRow.id, detective_name: null, unlocked_at: now() }).write();
  res.json({ success: true, case_id: codeRow.case_id });
});

// GET /api/clues/:caseId
app.get('/api/clues/:caseId', (req, res) => {
  const caseId = parseInt(req.params.caseId);
  const unlocked = db.get('unlocked').find({ session_id: req.sessionID, case_id: caseId }).value();
  if (!unlocked) return res.status(403).json({ error: 'Not unlocked. Enter your kit code first.' });

  const allClues = db.get('clues').filter({ case_id: caseId }).sortBy('day_number').value();
  const clues = allClues.map(c => ({
    id: c.id, day_number: c.day_number, clue_type: c.clue_type,
    title: c.title, released_at: c.released_at,
    is_released: isReleased(c.released_at),
    content: isReleased(c.released_at) ? c.content : null,
  }));
  const row = db.get('unlocked').find({ session_id: req.sessionID, case_id: caseId }).value();
  res.json({ clues, detective_name: row?.detective_name || null });
});

// PATCH /api/unlock/:caseId/name
app.patch('/api/unlock/:caseId/name', (req, res) => {
  db.get('unlocked').find({ session_id: req.sessionID, case_id: parseInt(req.params.caseId) }).assign({ detective_name: req.body.name }).write();
  res.json({ success: true });
});

// POST /api/verdict
app.post('/api/verdict', (req, res) => {
  const { case_id, detective_name, contact, suspect_name, reasoning } = req.body;
  if (!case_id || !detective_name || !contact || !suspect_name || !reasoning)
    return res.status(400).json({ error: 'All fields are required.' });

  const cid = parseInt(case_id);
  if (!db.get('unlocked').find({ session_id: req.sessionID, case_id: cid }).value())
    return res.status(403).json({ error: 'You must unlock the case before submitting a verdict.' });

  if (db.get('verdicts').find({ session_id: req.sessionID, case_id: cid }).value())
    return res.status(400).json({ error: 'You have already submitted a verdict for this case.' });

  db.get('verdicts').push({ id: nextId('verdicts'), session_id: req.sessionID, case_id: cid, detective_name, contact, suspect_name, reasoning, is_correct: null, submitted_at: now() }).write();
  res.json({ success: true, message: 'Verdict submitted! Results revealed when the case closes.' });
});

// GET /api/leaderboard
app.get('/api/leaderboard', (req, res) => {
  const correct = db.get('verdicts').filter({ is_correct: true }).value();
  const tally = {};
  correct.forEach(v => {
    if (!tally[v.detective_name]) tally[v.detective_name] = { detective_name: v.detective_name, solved: 0, points: 0 };
    tally[v.detective_name].solved++;
    tally[v.detective_name].points += 1000;
  });
  const leaderboard = Object.values(tally).sort((a,b) => b.points - a.points).slice(0,10);
  res.json({ leaderboard });
});

// ── ADMIN API ────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const admin = db.get('admins').find({ username: req.body.username }).value();
  if (!admin || !bcrypt.compareSync(req.body.password, admin.password))
    return res.status(401).json({ error: 'Invalid credentials.' });
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ username: req.session.adminUsername }));

// Cases
app.get('/api/admin/cases', requireAdmin, (req, res) => {
  res.json({ cases: db.get('cases').orderBy('created_at','desc').value() });
});

app.post('/api/admin/cases', requireAdmin, (req, res) => {
  const { case_number, title, location, summary, status, prize_amount, closes_at, answer } = req.body;
  if (!case_number || !title) return res.status(400).json({ error: 'case_number and title required.' });
  if (db.get('cases').find({ case_number }).value()) return res.status(400).json({ error: 'Case number already exists.' });
  const id = nextId('cases');
  db.get('cases').push({ id, case_number, title, location: location||'Kathmandu', summary, status: status||'upcoming', prize_amount: parseInt(prize_amount)||3000, closes_at, answer: answer||null, created_at: now() }).write();
  res.json({ success: true, id });
});

app.patch('/api/admin/cases/:id', requireAdmin, (req, res) => {
  db.get('cases').find({ id: parseInt(req.params.id) }).assign(req.body).write();
  res.json({ success: true });
});

app.delete('/api/admin/cases/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('cases').remove({ id }).write();
  db.get('suspects').remove({ case_id: id }).write();
  db.get('clues').remove({ case_id: id }).write();
  db.get('codes').remove({ case_id: id }).write();
  res.json({ success: true });
});

// Clues
app.get('/api/admin/cases/:id/clues', requireAdmin, (req, res) => {
  res.json({ clues: db.get('clues').filter({ case_id: parseInt(req.params.id) }).sortBy('day_number').value() });
});

app.post('/api/admin/cases/:id/clues', requireAdmin, (req, res) => {
  const { day_number, clue_type, title, content, released_at } = req.body;
  const caseId = parseInt(req.params.id);
  if (db.get('clues').find({ case_id: caseId, day_number: parseInt(day_number) }).value())
    return res.status(400).json({ error: `Day ${day_number} clue already exists for this case.` });
  const id = nextId('clues');
  db.get('clues').push({ id, case_id: caseId, day_number: parseInt(day_number), clue_type, title, content, released_at }).write();
  res.json({ success: true, id });
});

app.patch('/api/admin/clues/:id', requireAdmin, (req, res) => {
  db.get('clues').find({ id: parseInt(req.params.id) }).assign(req.body).write();
  res.json({ success: true });
});

app.delete('/api/admin/clues/:id', requireAdmin, (req, res) => {
  db.get('clues').remove({ id: parseInt(req.params.id) }).write();
  res.json({ success: true });
});

// Suspects
app.get('/api/admin/cases/:id/suspects', requireAdmin, (req, res) => {
  res.json({ suspects: db.get('suspects').filter({ case_id: parseInt(req.params.id) }).value() });
});

app.post('/api/admin/cases/:id/suspects', requireAdmin, (req, res) => {
  const id = nextId('suspects');
  db.get('suspects').push({ id, case_id: parseInt(req.params.id), ...req.body, is_primary: req.body.is_primary ? 1 : 0 }).write();
  res.json({ success: true, id });
});

app.delete('/api/admin/suspects/:id', requireAdmin, (req, res) => {
  db.get('suspects').remove({ id: parseInt(req.params.id) }).write();
  res.json({ success: true });
});

// Codes
app.get('/api/admin/codes', requireAdmin, (req, res) => {
  const { case_id } = req.query;
  let codes = db.get('codes').value();
  if (case_id) codes = codes.filter(c => c.case_id === parseInt(case_id));
  const cases = db.get('cases').value();
  codes = codes.map(c => ({ ...c, case_title: cases.find(x => x.id === c.case_id)?.title || '—' }));
  res.json({ codes: codes.reverse() });
});

app.post('/api/admin/codes/generate', requireAdmin, (req, res) => {
  const { case_id, pack_type, count } = req.body;
  const n = Math.min(parseInt(count)||1, 200);
  const generated = [];
  for (let i = 0; i < n; i++) {
    const code = genCode();
    db.get('codes').push({ id: nextId('codes'), code, case_id: parseInt(case_id), pack_type: pack_type||'solo', used: false, used_by: null, used_at: null, created_at: now() }).write();
    generated.push(code);
  }
  res.json({ success: true, codes: generated });
});

app.delete('/api/admin/codes/:id', requireAdmin, (req, res) => {
  db.get('codes').remove({ id: parseInt(req.params.id) }).write();
  res.json({ success: true });
});

// Verdicts
app.get('/api/admin/verdicts', requireAdmin, (req, res) => {
  const { case_id } = req.query;
  let verdicts = db.get('verdicts').value();
  if (case_id) verdicts = verdicts.filter(v => v.case_id === parseInt(case_id));
  const cases = db.get('cases').value();
  verdicts = verdicts.map(v => ({ ...v, case_title: cases.find(x => x.id === v.case_id)?.title || '—' }));
  res.json({ verdicts: verdicts.reverse() });
});

app.patch('/api/admin/verdicts/:id/correct', requireAdmin, (req, res) => {
  db.get('verdicts').find({ id: parseInt(req.params.id) }).assign({ is_correct: req.body.is_correct ? true : false }).write();
  res.json({ success: true });
});

// Stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const cases    = db.get('cases').value();
  const codes    = db.get('codes').value();
  res.json({
    total_cases:    cases.length,
    active_cases:   cases.filter(c => c.status === 'active').length,
    total_codes:    codes.length,
    used_codes:     codes.filter(c => c.used).length,
    total_unlocks:  db.get('unlocked').value().length,
    total_verdicts: db.get('verdicts').value().length,
  });
});

// ── CATCH-ALL ────────────────────────────────────────────
app.get('/admin*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

module.exports = app;