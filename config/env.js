// Centralized environment configuration.
// Loads and validates required environment variables in one place so the
// rest of the app never touches process.env directly.

require('dotenv').config();

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0 && process.env.NODE_ENV !== 'test') {
  // We don't throw here so the app can still boot for local scripting
  // (e.g. generating a password hash) without a full .env file, but we
  // loudly warn since the API will fail without these.
  console.warn(
    `[config] Warning: missing environment variables: ${missing.join(', ')}. ` +
    'Copy .env.example to .env and fill these in.'
  );
}

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
  },

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  payment: {
    keyId: process.env.PAYMENT_KEY_ID || '',
    keySecret: process.env.PAYMENT_KEY_SECRET || '',
  },
};
