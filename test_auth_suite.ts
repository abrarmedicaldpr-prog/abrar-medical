/**
 * Abrar Medical Store (AMS) - Authentication & User Management Verification Suite
 * Tests all 12 key security and authentication requirements.
 */
import { getDatabase } from './server/db/connection.js';
import { runMigrations } from './server/db/migrations.js';

const BASE_URL = 'http://127.0.0.1:3000';

async function runAuthTests() {
  console.log('================================================================');
  console.log(' [AMS AUTH TEST SUITE] Starting Complete Verification...');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(` ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${testName} - ${detail || 'Condition not met'}`);
      failed++;
    }
  }

  const db = getDatabase();

  // Test 1: Run migrations and verify schema
  console.log('\n--- 1. Database Schema & Migration Verification ---');
  const migrationRes = runMigrations();
  assert(migrationRes.success, 'Migrations execute cleanly', migrationRes.message);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const tableNames = tables.map((t) => t.name);
  assert(tableNames.includes('users'), 'Table "users" exists');
  assert(tableNames.includes('user_sessions'), 'Table "user_sessions" exists');
  assert(tableNames.includes('role_permissions'), 'Table "role_permissions" exists');
  assert(tableNames.includes('auth_audit_logs'), 'Table "auth_audit_logs" exists');

  // Verify Role Permissions were seeded
  const permCount = db.prepare('SELECT COUNT(*) as c FROM role_permissions').get() as { c: number };
  assert(permCount.c >= 60, `Role permissions seeded (found ${permCount.c} entries)`);

  // Ensure clean test state for users table
  db.prepare('DELETE FROM auth_audit_logs').run();
  db.prepare('DELETE FROM user_sessions').run();
  db.prepare('DELETE FROM users').run();

  // Test 2: Startup Status when uninitialized
  console.log('\n--- 2. Application Startup & Status Check ---');
  const statusRes1 = await fetch(`${BASE_URL}/api/auth/status`);
  const status1 = await statusRes1.json();
  assert(
    status1.initialized === false && status1.authenticated === false,
    'Uninitialized system returns initialized=false & authenticated=false',
    JSON.stringify(status1)
  );

  // Test 3: First-Time Super Admin Setup
  console.log('\n--- 3. First-Time Super Admin Account Setup ---');
  const setupPayload = {
    username: 'admin',
    password: 'MasterAdmin@2026',
    full_name: 'Abrar Aslam',
    email: 'abrar.aslam02@gmail.com',
    phone: '+92 300 1234567',
  };

  const setupRes = await fetch(`${BASE_URL}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setupPayload),
  });
  const setupData = await setupRes.json();
  assert(setupRes.status === 201 && setupData.success === true, 'Super Admin setup succeeds (201 Created)');
  assert(setupData.user && setupData.user.role === 'Super Admin', 'User role assigned as "Super Admin"');
  assert(typeof setupData.token === 'string' && setupData.token.length >= 60, 'Generates secure 64-char session token');
  const superAdminToken = setupData.token;

  // Test 4: Lock Down Setup (Reject second setup attempt)
  console.log('\n--- 4. Lock Down Super Admin Setup ---');
  const setupRes2 = await fetch(`${BASE_URL}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setupPayload),
  });
  const setupData2 = await setupRes2.json();
  assert(
    setupRes2.status === 403 && setupData2.code === 'SETUP_LOCKED',
    'Subsequent setup attempt is strictly blocked (403 Forbidden - SETUP_LOCKED)'
  );

  // Test 5: Verify Session Token Authentication
  console.log('\n--- 5. Session Token Verification ---');
  const statusRes2 = await fetch(`${BASE_URL}/api/auth/status`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const status2 = await statusRes2.json();
  assert(
    status2.initialized === true && status2.authenticated === true && status2.user.username === 'admin',
    'Active session token recognized: authenticated=true for @admin'
  );

  // Test 6: Protected API Rejection Without Token
  console.log('\n--- 6. Protected Business API Access Control ---');
  const unauthItemsRes = await fetch(`${BASE_URL}/api/items`);
  assert(unauthItemsRes.status === 401, 'Accessing /api/items without token returns 401 Unauthorized');

  const unauthSalesRes = await fetch(`${BASE_URL}/api/sales`);
  assert(unauthSalesRes.status === 401, 'Accessing /api/sales without token returns 401 Unauthorized');

  const authItemsRes = await fetch(`${BASE_URL}/api/items`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(authItemsRes.status === 200, 'Accessing /api/items with valid Super Admin token returns 200 OK');

  // Test 7: Authentication Failure & Password Verification
  console.log('\n--- 7. Login Verification & Failure Handling ---');
  const wrongLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'WrongPassword' }),
  });
  const wrongLoginData = await wrongLoginRes.json();
  assert(wrongLoginRes.status === 401 && wrongLoginData.success === false, 'Invalid password rejected with 401');
  assert(
    typeof wrongLoginData.attemptsRemaining === 'number',
    `Remaining attempts tracked (${wrongLoginData.attemptsRemaining} remaining)`
  );

  // Test 8: Brute-Force Lockout Defense
  console.log('\n--- 8. Brute-Force Lockout Protection ---');
  // Attempt 4 more failed logins to reach 5
  for (let i = 0; i < 4; i++) {
    await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'WrongPassword' }),
    });
  }

  // 5th failed attempt should trigger lockout (423 Locked)
  const lockedRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'WrongPassword' }),
  });
  const lockedData = await lockedRes.json();
  assert(
    lockedRes.status === 423 && lockedData.locked === true,
    '5 consecutive failed logins triggers temporary 15-minute account lockout (423 Locked)'
  );

  // Reset lockout for test progression
  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE username = ?').run('admin');

  // Successful login
  const validLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'MasterAdmin@2026', remember_me: true }),
  });
  const validLoginData = await validLoginRes.json();
  assert(validLoginRes.status === 200 && validLoginData.success === true, 'Correct credentials authenticate successfully (200 OK)');
  const adminActiveToken = validLoginData.token;

  // Test 9: Staff User Management (Super Admin operations)
  console.log('\n--- 9. Staff User Management & Role Creation ---');
  // Create a Salesman
  const createSalesmanRes = await fetch(`${BASE_URL}/api/auth/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminActiveToken}`,
    },
    body: JSON.stringify({
      username: 'salesman1',
      full_name: 'Muhammad Tariq',
      password: 'SalesmanPass@123',
      role: 'Salesman',
      phone: '+92 301 9876543',
      status: 'Active',
    }),
  });
  const salesmanData = await createSalesmanRes.json();
  assert(createSalesmanRes.status === 201 && salesmanData.success === true, 'Super Admin creates Salesman staff user');
  const salesmanId = salesmanData.user.id;

  // Create an Accountant
  const createAcctRes = await fetch(`${BASE_URL}/api/auth/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminActiveToken}`,
    },
    body: JSON.stringify({
      username: 'accountant1',
      full_name: 'Zahid Hussain',
      password: 'AcctPass@123',
      role: 'Accountant',
      phone: '+92 302 1122334',
      status: 'Active',
    }),
  });
  assert(createAcctRes.status === 201, 'Super Admin creates Accountant staff user');

  // Test User List
  const listUsersRes = await fetch(`${BASE_URL}/api/auth/users`, {
    headers: { Authorization: `Bearer ${adminActiveToken}` },
  });
  const listUsersData = await listUsersRes.json();
  assert(listUsersRes.status === 200 && listUsersData.users.length === 3, 'User list returns all 3 staff accounts');

  // Test 10: Role-Based Authorization Enforcement
  console.log('\n--- 10. Role-Based Access Enforcement ---');
  // Log in as Salesman
  const salesmanLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'salesman1', password: 'SalesmanPass@123' }),
  });
  const salesmanLogin = await salesmanLoginRes.json();
  const salesmanToken = salesmanLogin.token;

  // Salesman tries to access Super Admin User Management (should be 403 Forbidden)
  const salesmanAdminRes = await fetch(`${BASE_URL}/api/auth/users`, {
    headers: { Authorization: `Bearer ${salesmanToken}` },
  });
  assert(
    salesmanAdminRes.status === 403,
    'Salesman is blocked from User Management API (403 Forbidden)'
  );

  // Salesman CAN access Sales API
  const salesmanSalesRes = await fetch(`${BASE_URL}/api/sales`, {
    headers: { Authorization: `Bearer ${salesmanToken}` },
  });
  assert(
    salesmanSalesRes.status === 200,
    'Salesman has authorized access to Sales API (200 OK)'
  );

  // Test 11: User Status Change & Password Reset
  console.log('\n--- 11. Deactivation & Password Reset ---');
  // Deactivate Salesman
  const deactRes = await fetch(`${BASE_URL}/api/auth/users/${salesmanId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminActiveToken}`,
    },
    body: JSON.stringify({ status: 'Inactive' }),
  });
  assert(deactRes.status === 200, 'Super Admin successfully deactivates staff user');

  // Deactivated salesman tries to use previous session token
  const deactivatedAccessRes = await fetch(`${BASE_URL}/api/sales`, {
    headers: { Authorization: `Bearer ${salesmanToken}` },
  });
  assert(
    deactivatedAccessRes.status === 401,
    'Deactivated user sessions are immediately revoked (401 Unauthorized)'
  );

  // Deactivated salesman tries to log in
  const deactivatedLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'salesman1', password: 'SalesmanPass@123' }),
  });
  assert(
    deactivatedLoginRes.status === 403,
    'Deactivated user login rejected with 403 Forbidden'
  );

  // Reactivate & Reset Password
  await fetch(`${BASE_URL}/api/auth/users/${salesmanId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminActiveToken}`,
    },
    body: JSON.stringify({ status: 'Active' }),
  });

  const resetPassRes = await fetch(`${BASE_URL}/api/auth/users/${salesmanId}/reset-password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminActiveToken}`,
    },
    body: JSON.stringify({ new_password: 'NewSalesmanPass@2026' }),
  });
  assert(resetPassRes.status === 200, 'Super Admin successfully resets user password');

  // Login with new password
  const newPassLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'salesman1', password: 'NewSalesmanPass@2026' }),
  });
  assert(newPassLoginRes.status === 200, 'User can log in with new reset password');

  // Test 12: Voluntary Logout & Audit Trail
  console.log('\n--- 12. Voluntary Logout & Security Audit Trail ---');
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminActiveToken}` },
  });
  assert(logoutRes.status === 200, 'Logout succeeds and terminates server-side session');

  // Verify token is now invalid
  const postLogoutRes = await fetch(`${BASE_URL}/api/items`, {
    headers: { Authorization: `Bearer ${adminActiveToken}` },
  });
  assert(postLogoutRes.status === 401, 'Logged out session token is invalid (401 Unauthorized)');

  // Verify Audit Logs
  const auditLogs = db.prepare('SELECT DISTINCT action FROM auth_audit_logs').all() as Array<{ action: string }>;
  const auditActions = auditLogs.map((l) => l.action);
  assert(auditActions.includes('ADMIN_INITIALIZED'), 'Audit log records ADMIN_INITIALIZED');
  assert(auditActions.includes('LOGIN_SUCCESS'), 'Audit log records LOGIN_SUCCESS');
  assert(auditActions.includes('LOGIN_FAILURE'), 'Audit log records LOGIN_FAILURE');
  assert(auditActions.includes('ACCOUNT_LOCKED'), 'Audit log records ACCOUNT_LOCKED');
  assert(auditActions.includes('USER_CREATED'), 'Audit log records USER_CREATED');
  assert(auditActions.includes('USER_STATUS_CHANGED'), 'Audit log records USER_STATUS_CHANGED');
  assert(auditActions.includes('PASSWORD_RESET'), 'Audit log records PASSWORD_RESET');
  assert(auditActions.includes('LOGOUT'), 'Audit log records LOGOUT');

  // Test 13: Preservation of Pre-Existing Data
  console.log('\n--- 13. Pre-Existing Data Integrity Check ---');
  const itemsCount = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
  const accountsCount = db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number };
  const inventoryCount = db.prepare('SELECT COUNT(*) as c FROM inventory').get() as { c: number };

  assert(itemsCount.c >= 3, `Items records preserved (${itemsCount.c} items)`);
  assert(accountsCount.c >= 30, `Accounts records preserved (${accountsCount.c} accounts)`);
  assert(inventoryCount.c >= 3, `Inventory batches preserved (${inventoryCount.c} batches)`);

  console.log('\n================================================================');
  console.log(` [AMS AUTH TEST SUITE RESULT] Total Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthTests().catch((err) => {
  console.error('[AMS Auth Suite Fatal Error]', err);
  process.exit(1);
});
