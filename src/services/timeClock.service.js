const db=require('../db/db');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

function clockError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

function hasPIN(uid) {
  return Boolean(db.prepare('SELECT 1 FROM clock_pins WHERE uid=?').get(uid));
}

function validPIN(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

function setPIN(uid, pin, recentlySignedIn) {
  if (!validPIN(pin)) throw clockError(400, 'Enter a six-digit clock code.');
  if (hasPIN(uid) && !recentlySignedIn) {
    throw clockError(403, 'Sign out and back in before resetting your clock code.');
  }
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(pin, salt, 32).toString('hex');
  db.prepare('INSERT INTO clock_pins(uid,salt,digest) VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET salt=excluded.salt,digest=excluded.digest').run(uid, salt, digest);
}

function verifyPIN(uid, pin) {
  const record = db.prepare('SELECT salt,digest FROM clock_pins WHERE uid=?').get(uid);
  if (!record) throw clockError(409, 'Set up your clock code in the updated WorkBay app.');
  if (!validPIN(pin) || !timingSafeEqual(scryptSync(pin, record.salt, 32), Buffer.from(record.digest, 'hex'))) {
    throw clockError(403, 'Incorrect clock code.');
  }
}
function get(businessId,uid){const row=db.prepare('SELECT clock_in FROM clock_sessions WHERE business_id=? AND uid=? AND clock_out IS NULL').get(businessId,uid);return {clockIn:row?.clock_in||null,hasClockPIN:hasPIN(uid)};}
function change(businessId,uid,action){
 if(!['in','out'].includes(action)){const e=new Error('Choose clock in or clock out.');e.status=400;e.publicMessage=e.message;throw e;}
 return db.transaction(()=>{
 const now=new Date().toISOString();
 if(action==='in')db.prepare('INSERT OR IGNORE INTO clock_sessions(business_id,uid,clock_in) VALUES(?,?,?)').run(businessId,uid,now);
 else db.prepare('UPDATE clock_sessions SET clock_out=? WHERE business_id=? AND uid=? AND clock_out IS NULL').run(now,businessId,uid);
 return get(businessId,uid);
 })();
}
module.exports={get,change,setPIN,verifyPIN};

function weeklyHours(businessId, weeksAgo, now = new Date()) {
  const { toUtcDate, BUSINESS_TIMEZONE } = require('./googleCalendar.service');
  const localDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const monday = new Date(localDate + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7 - weeksAgo * 7);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const startDate = monday.toISOString().slice(0, 10);
  const endDate = nextMonday.toISOString().slice(0, 10);
  const start = toUtcDate(startDate + 'T00:00:00', BUSINESS_TIMEZONE);
  const end = toUtcDate(endDate + 'T00:00:00', BUSINESS_TIMEZONE);
  const rows = db.prepare(`
    SELECT m.uid, p.first_name, p.last_name, c.id, c.clock_in, c.clock_out
    FROM business_members m
    LEFT JOIN user_profiles p ON p.uid = m.uid
    LEFT JOIN clock_sessions c ON c.business_id = m.business_id AND c.uid = m.uid
      AND c.clock_in < ? AND (c.clock_out IS NULL OR c.clock_out > ?)
    WHERE m.business_id = ?
    ORDER BY p.first_name, p.last_name, m.uid, c.clock_in DESC
  `).all(end.toISOString(), start.toISOString(), businessId);
  const employees = new Map();
  for (const row of rows) {
    if (!employees.has(row.uid)) {
      employees.set(row.uid, {
        uid: row.uid,
        name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed team member',
        totalSeconds: 0,
        shifts: [],
      });
    }
    if (row.id == null) continue;
    const employee = employees.get(row.uid);
    const from = Math.max(Date.parse(row.clock_in), start.getTime());
    const until = Math.min(row.clock_out ? Date.parse(row.clock_out) : now.getTime(), end.getTime(), now.getTime());
    const seconds = Math.max(0, Math.floor((until - from) / 1000));
    if (!Number.isFinite(seconds) || until < from) continue;
    employee.totalSeconds += seconds;
    employee.shifts.push({ id: row.id, clockIn: row.clock_in, clockOut: row.clock_out, seconds });
  }
  const members = [...employees.values()];
  return {
    startDate, endDate, timeZone: BUSINESS_TIMEZONE, employees: members,
    totalSeconds: members.reduce((total, member) => total + member.totalSeconds, 0),
  };
}

module.exports.weeklyHours = weeklyHours;
