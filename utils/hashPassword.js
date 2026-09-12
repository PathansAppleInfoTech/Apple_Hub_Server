// Standalone helper: generate a bcrypt hash for a given password.
// Usage: node utils/hashPassword.js "YourNewPassword123!"
// Paste the resulting hash into the admins table (or seed.sql) manually.

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage: node utils/hashPassword.js "YourPassword"');
  process.exit(1);
}

bcrypt.hash(password, 10).then((hash) => {
  console.log('\nPassword hash:\n');
  console.log(hash);
  console.log('\nUse this in an INSERT/UPDATE statement for the admins table.\n');
});
