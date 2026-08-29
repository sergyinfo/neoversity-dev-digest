const REQUIRED = ['JWT_SECRET', 'MONGODB_URI'];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`${key} must be set`);
  }
}

if (Buffer.byteLength(process.env.JWT_SECRET) < 32) {
  throw new Error('JWT_SECRET must be at least 32 bytes');
}

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  MONGODB_URI: process.env.MONGODB_URI,
  TOKEN_TTL: process.env.TOKEN_TTL || '15m',
};
