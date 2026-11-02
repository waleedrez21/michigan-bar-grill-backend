const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbay-team-'));
process.env.DB_PATH = path.join(directory, 'database.sqlite');
const db = require('../src/db/db');
require('../src/services/firebaseAdmin.service').verifyIdToken = async token => {
  if (token === 'invalid') throw new Error('Invalid token');
  return {uid:token};
};
require('../src/services/firebaseAdmin.service').legacyMemberships = async businessId => [
  {uid:'legacy-user',businessId,code:'WRONG',role:'manager'}
];
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/businesses', require('../src/routes/businesses.routes'));
app.use('/api', require('../src/routes/team.routes'));
app.use(require('../src/middleware/errorHandler'));

test('ownership, team isolation, role permissions and shared profiles', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(route, uid, method='GET', body) {
    return fetch(base+route,{method,headers:{'Content-Type':'application/json',...(uid?{Authorization:`Bearer ${uid}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  }
  try {
    assert.equal((await request('/businesses/signup',null,'POST',{businessName:'No identity'})).status,401);
    assert.equal((await request('/me/profile','invalid')).status,401);
    const response = await request('/businesses/signup','creator','POST',{businessName:'Team',businessType:'Restaurant',role:'employee',uid:'spoofed'});
    assert.equal(response.status,201);
    const business = await response.json();
    assert.equal(business.role,'manager');
    assert.equal(db.prepare('SELECT creator_uid FROM businesses WHERE id=?').get(business.businessId).creator_uid,'creator');
    const team = `/team/${business.businessId}/members`;
    assert.equal((await request(team,'outsider')).status,403);
    assert.equal((await request('/team/join','employee','POST',{code:business.code.toLowerCase()})).status,200);
    assert.equal((await (await request('/team/join','employee','POST',{code:business.code,role:'manager'})).json()).role,'employee');
    assert.equal((await request(`${team}/employee/role`,'employee','PATCH',{role:'manager'})).status,403);
    assert.equal((await request(`${team}/outsider/role`,'creator','PATCH',{role:'manager'})).status,404);
    assert.equal((await request(`${team}/employee/role`,'creator','PATCH',{role:'owner'})).status,400);
    assert.equal((await request(`${team}/employee/role`,'creator','PATCH',{role:'assistant_manager'})).status,200);
    assert.equal((await request(`${team}/creator/role`,'employee','PATCH',{role:'employee'})).status,403);
    assert.equal((await (await request('/team/join','employee','POST',{code:business.code})).json()).role,'assistant_manager');
    const me = {firstName:' Alex ',lastName:' Smith ',phone:'5551234567',bio:'Hello team'};
    assert.equal((await request('/me/profile','employee','PUT',me)).status,200);
    assert.equal((await (await request('/me/profile','employee')).json()).firstName,'Alex');
    assert.equal((await request('/me/profile','employee','PUT',{...me,firstName:''})).status,400);
    assert.equal((await request('/me/profile','employee','PUT',{...me,bio:'x'.repeat(501)})).status,400);
    const rows = await (await request(team,'employee')).json();
    assert.equal(rows.length,2);
    assert.equal(rows[0].uid,'creator');
    assert.equal(rows[1].firstName,'Alex');
    assert.equal(rows[1].phone,undefined);
    require('../src/services/firebaseAdmin.service').legacyMemberships = async businessId => businessId === business.businessId ? [
      {uid:'legacy-user',code:business.code,role:'manager'},
      {uid:'creator',code:business.code,role:'employee'}
    ] : [];
    const imported = await (await request(team,'creator')).json();
    assert.equal(imported.find(row => row.uid === 'legacy-user').role,'employee');
    assert.equal(imported.find(row => row.uid === 'creator').role,'manager');
    assert.equal((await (await request('/me/businesses','employee')).json())[0].role,'assistant_manager');
    assert.equal((await request(`${team}/employee/role`,'creator','PATCH',{role:'manager'})).status,200);
    assert.equal((await request(`${team}/creator/role`,'employee','PATCH',{role:'employee'})).status,409);
    const other = await (await request('/businesses/signup','outsider','POST',{businessName:'Other'})).json();
    assert.equal((await request(`/team/${other.businessId}/members`,'creator')).status,403);
    assert.equal((await request(`/team/${other.businessId}/members/outsider/role`,'creator','PATCH',{role:'employee'})).status,403);
    db.prepare('UPDATE businesses SET creator_uid=NULL WHERE id=?').run(other.businessId);
    assert.equal((await request(`/team/${other.businessId}/members/outsider/role`,'outsider','PATCH',{role:'employee'})).status,409);
    assert.equal((await request('/team/join','employee','POST',{code:'UNKNOWN'})).status,404);
    delete require.cache[require.resolve('../src/db/db')];
    const reopened = require('../src/db/db');
    assert.equal(reopened.prepare('SELECT role FROM business_members WHERE uid=? AND business_id=?').get('creator',business.businessId).role,'manager');
    reopened.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
