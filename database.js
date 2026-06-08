const low    = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path   = require('path');
const bcrypt = require('bcryptjs');
const { customAlphabet } = require('nanoid');

const alpha  = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const adapter = new FileSync(path.join(__dirname, 'caseclosed.json'));
const db      = low(adapter);

// ── SCHEMA DEFAULTS ──────────────────────────────────────
db.defaults({
  cases:    [],
  suspects: [],
  clues:    [],
  codes:    [],
  unlocked: [],
  verdicts: [],
  admins:   [],
  _seq: { cases: 1, suspects: 1, clues: 1, codes: 1, unlocked: 1, verdicts: 1, admins: 1 }
}).write();

// ── ID HELPER ─────────────────────────────────────────────
function nextId(table) {
  const id = db.get(`_seq.${table}`).value();
  db.set(`_seq.${table}`, id + 1).write();
  return id;
}

// ── SEED ADMIN ────────────────────────────────────────────
const adminExists = db.get('admins').find({ username: 'admin' }).value();
if (!adminExists) {
  db.get('admins').push({
    id: nextId('admins'),
    username: 'admin',
    password: bcrypt.hashSync('admin123', 10),
    created_at: new Date().toISOString()
  }).write();
  console.log('✓ Default admin created: admin / admin123');
}

// ── SEED DEMO CASE ────────────────────────────────────────
const caseExists = db.get('cases').value().length > 0;
if (!caseExists) {
  const closeDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
  const caseId    = nextId('cases');

  db.get('cases').push({
    id: caseId,
    case_number:  'CC-024',
    title:        'The Thamel Midnight Murder',
    location:     'Thamel, Kathmandu',
    summary:      'At 1:14 AM on Friday, Bikram Thapa — owner of the jazz bar "The Blue Note" — was found dead in the venue\'s back office. Blunt force trauma. Three people had keys.',
    status:       'active',
    prize_amount: 3000,
    closes_at:    closeDate,
    answer:       'Rajan Maharjan',
    created_at:   new Date().toISOString()
  }).write();

  // Suspects
  [
    { name: 'Aditya Khatri',   role: 'Business Partner', motive: 'Unresolved debt dispute. Rs. 4 lakh allegedly owed. Heated argument two days prior.', is_primary: 1 },
    { name: 'Priya Shrestha',  role: 'Ex-girlfriend',    motive: 'Bar tab terminated that evening. Seen arguing with Bikram near closing time.',         is_primary: 0 },
    { name: 'Rajan Maharjan',  role: 'Head Bartender',   motive: 'Fired the previous week. Still had a spare key. Told staff he had "unfinished business."', is_primary: 0 },
  ].forEach(s => {
    db.get('suspects').push({ id: nextId('suspects'), case_id: caseId, ...s }).write();
  });

  // Clues
  const now = Date.now();
  [
    { day: 1, type: 'case_file',  title: 'Case File',        released: new Date(now - 3*86400000).toISOString(),
      content: `<p><strong>Victim:</strong> Bikram Thapa, 44. Owner of The Blue Note jazz bar, Thamel. Found by cleaning staff at 7:20 AM. Time of death: 12:30 AM – 2:00 AM.</p><p><strong>Cause of death:</strong> Single blunt force trauma to the back of the head. No forced entry. Both doors locked from inside.</p><p class="hl">"Whoever did this had a key — and knew exactly where they were going." — Investigating Officer</p><p style="font-size:0.65rem;color:rgba(107,99,88,0.5)">📦 Your physical kit includes CCTV printouts, suspect dossiers, and the brass weapon prop.</p>` },
    { day: 2, type: 'news',       title: 'Breaking News',    released: new Date(now - 2*86400000).toISOString(),
      content: `<p><strong>Kantipur Post — Tuesday Edition</strong></p><p class="hl">"Records show The Blue Note was co-owned by a silent third partner holding 35% who had been seeking to dissolve the partnership for three months."</p><p>CCTV from a neighbouring shop captured an unidentified figure near the rear entrance at approximately <strong>12:42 AM</strong>.</p>` },
    { day: 3, type: 'interview',  title: 'Witness Interview', released: new Date(now - 1*86400000).toISOString(),
      content: `<p><strong>Transcript — Witness A (identity withheld)</strong></p><p><strong>Officer:</strong> Did you see who entered?</p><p><strong>Witness A:</strong> I saw them. I recognised them. But I'm not saying the name on record. Not yet.</p><p class="hl">"They were carrying something wrapped in cloth. Flat. About this long." [Witness indicates approximately 30–40cm]</p>` },
    { day: 4, type: 'court',      title: 'Court Hearing',    released: new Date(now + 1*86400000).toISOString(),
      content: `<p>Court hearing transcript. Alibi statements filed. Someone's story won't match the timestamps.</p>` },
    { day: 7, type: 'verdict',    title: 'Case Closes',      released: closeDate,
      content: `<p>Submit your verdict before the deadline. First correct solver wins.</p>` },
  ].forEach(c => {
    db.get('clues').push({ id: nextId('clues'), case_id: caseId, day_number: c.day, clue_type: c.type, title: c.title, content: c.content, released_at: c.released }).write();
  });

  // Demo codes
  ['DEMO12', 'TEST99', 'SQUAD1', alpha(), alpha(), alpha(), alpha(), alpha()].forEach((code, i) => {
    db.get('codes').push({ id: nextId('codes'), code, case_id: caseId, pack_type: i < 2 ? 'solo' : i === 2 ? 'squad' : 'solo', used: false, used_by: null, used_at: null, created_at: new Date().toISOString() }).write();
  });

  console.log('✓ Demo case seeded — try codes: DEMO12 or TEST99');
}

module.exports = { db, nextId };
