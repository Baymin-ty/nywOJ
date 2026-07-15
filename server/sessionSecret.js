const config = require('./config.json');

// Keep the legacy value as a compatibility fallback for existing installations.
// New deployments should configure SESSION.secret or NYWOJ_SESSION_SECRET.
const LEGACY_SESSION_SECRET = '114514-nywOJ-1919810';
const configuredSecret = process.env.NYWOJ_SESSION_SECRET ||
  (config.SESSION && config.SESSION.secret);

module.exports = {
  sessionSecret: String(configuredSecret || LEGACY_SESSION_SECRET),
  usingLegacySessionSecret: !configuredSecret,
};
