const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbay-types-'));
process.env.DB_PATH = path.join(directory, 'database.sqlite');
// Simulate a pre-feature database with an existing business.
const legacy = new Database(process.env.DB_PATH);
legacy.exec(`CREATE TABLE businesses (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key TEXT NOT NULL UNIQUE,
  google_calendar_id TEXT NOT NULL, open_hour INTEGER DEFAULT 9,
  close_hour INTEGER DEFAULT 20, closed_day INTEGER DEFAULT 1,
  restaurant_info_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  menu_items_json TEXT NOT NULL DEFAULT '[]', code TEXT
);
INSERT INTO businesses (id,name,api_key,google_calendar_id,restaurant_info_json,code)
VALUES ('legacy','Legacy','legacy-key','','{}','OLD-1234');`);
legacy.close();
const db = require('../src/db/db');
const express = require('express');
const routes = require('../src/routes/businesses.routes');
require('../src/services/firebaseAdmin.service').verifyIdToken = async () => ({uid:'test-creator'});

test('migration and business type HTTP contract', async () => {
  assert.equal(db.prepare('SELECT business_type FROM businesses WHERE id = ?').get('legacy').business_type, null);
  // Running startup migrations again must be safe.
  delete require.cache[require.resolve('../src/db/db')];
  const reopened = require('../src/db/db');
  reopened.close();
  const app = express();
  app.use(express.json());
  app.use('/api/businesses', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/businesses`;
  const signup = body => fetch(`${base}/signup`, {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer test'}, body:JSON.stringify(body)});
  try {
    for (const businessType of ['Restaurant','Barbershop','Nail Salon','HVAC','Exterior Cleaning','Auto Detailing']) {
      const response = await signup({businessName:`Test ${businessType}`, businessType});
      assert.equal(response.status, 201);
      const business = await response.json();
      assert.equal(business.businessType, businessType);
      const lookup = await fetch(`${base}/by-code/${business.code}`);
      assert.equal(lookup.status, 200);
      assert.equal((await lookup.json()).businessType, businessType);
    }
    for (const businessType of ['Other', '', 123, {}, ['Restaurant']]) {
      assert.equal((await signup({businessName:'Invalid',businessType})).status, 400);
    }
    for (const body of [{businessName:'Older Client'}, {businessName:'Null Client', businessType:null}]) {
      const response = await signup(body);
      assert.equal(response.status,201);
      assert.equal((await response.json()).businessType,null);
    }
    const old = await fetch(`${base}/by-code/OLD-1234`);
    assert.equal((await old.json()).businessType,null);
    assert.equal((await fetch(`${base}/by-code/UNKNOWN`)).status,404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory, {recursive:true,force:true});
  }
});
