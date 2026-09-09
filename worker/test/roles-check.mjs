// Guards the operator-role auth (roles.js): access-key → role, token mint/verify, tamper/expiry
// rejection, and the owner>admin>member rank gate. This protects privileged console access, so
// it must stay green.  node test/roles-check.mjs
import { issueRoleToken, readRoleToken, roleForKey, requireRole } from '../src/roles.js';

const S = 'test-secret-123';
const env = { OWNER_KEY: 'owner-pass', ADMIN_KEY: 'admin-pass', ROLE_SECRET: S };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗', m); } };
const req = (tok) => ({ headers: { get: (h) => (h === 'X-Role-Token' ? tok : null) }, url: 'https://x/console/overview' });

ok(roleForKey('owner-pass', env) === 'owner', 'owner key → owner');
ok(roleForKey('admin-pass', env) === 'admin', 'admin key → admin');
ok(roleForKey('wrong', env) === null, 'wrong key → null');
ok(roleForKey('', env) === null, 'empty key → null');
ok(roleForKey('owner-pass', {}) === null, 'no keys configured → null');

const ot = await issueRoleToken('owner', 12, S);
ok((await readRoleToken(ot, S))?.role === 'owner', 'owner token round-trips');
ok(await readRoleToken(ot, 'other') === null, 'wrong signing secret rejected');
ok(await readRoleToken(ot + 'x', S) === null, 'tampered token rejected');
ok(await readRoleToken(await issueRoleToken('owner', -1, S), S) === null, 'expired token rejected');

ok((await requireRole(req(ot), env, 'admin')).ok === true, 'owner passes admin gate');
ok((await requireRole(req(await issueRoleToken('admin', 12, S)), env, 'owner')).ok === false, 'admin fails owner gate');
ok((await requireRole(req(''), env, 'admin')).ok === false, 'no token fails gate');
ok((await requireRole(req(ot), {}, 'admin')).status === 404, 'no signing secret → 404 (closed by default)');

console.log(`\nroles-check.mjs — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
