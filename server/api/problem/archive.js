const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const loadYaml = yaml.load || yaml.safeLoad;
const dumpYaml = yaml.dump || yaml.safeDump;

const DATA_CONFIG_FILE = 'config.json';
const PROFILE_YAML_FILE = 'nywoj.yaml';
const PROFILE_CONFIG_FILE = 'nywoj.config.json';
const ARCHIVE_FORMAT = 'nywoj.problem-data.v1';

const PROFILE_YAML_IMPORT_FILES = [
  PROFILE_YAML_FILE,
  'nywoj.yml',
  'judgeProfile.yaml',
  'judgeProfile.yml',
  'judge-profile.yaml',
  'judge-profile.yml',
];

const PROFILE_JSON_IMPORT_FILES = [
  PROFILE_CONFIG_FILE,
  'nywoj.json',
  'judgeProfile.json',
  'judge-profile.json',
];

const CONTROL_FILES = new Set([
  ...PROFILE_YAML_IMPORT_FILES,
  ...PROFILE_JSON_IMPORT_FILES,
]);

const normalizeRelPath = (value) => {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
};

const isUnsafeRelPath = (value) => {
  const raw = String(value || '').replace(/\\/g, '/');
  const normalized = normalizeRelPath(raw);
  return !normalized
    || path.posix.isAbsolute(raw)
    || normalized === '..'
    || normalized.startsWith('../');
};

const safeResolve = (root, rel) => {
  if (isUnsafeRelPath(rel)) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, normalizeRelPath(rel));
  return full === base || full.startsWith(base + path.sep) ? full : null;
};

const listFilesRecursive = (root, prefix = '') => {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
};

const extractProfilePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.judgeProfile && typeof payload.judgeProfile === 'object') return payload.judgeProfile;
  if (payload.profile && typeof payload.profile === 'object') return payload.profile;
  return payload;
};

const readImportedProfile = (root) => {
  for (const name of PROFILE_YAML_IMPORT_FILES) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    const payload = loadYaml(fs.readFileSync(full, 'utf-8'));
    const profile = extractProfilePayload(payload);
    if (!profile || typeof profile !== 'object') throw new Error(`${name} 中没有可识别的评测流程配置`);
    return { profile, source: name };
  }

  for (const name of PROFILE_JSON_IMPORT_FILES) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    const payload = JSON.parse(fs.readFileSync(full, 'utf-8'));
    const profile = extractProfilePayload(payload);
    if (!profile || typeof profile !== 'object') throw new Error(`${name} 中没有可识别的评测流程配置`);
    return { profile, source: name };
  }

  return null;
};

const dumpProfileYaml = (profile) =>
  dumpYaml(profile, { indent: 2, lineWidth: 100, noRefs: true });

const buildProfileConfigJson = (profile) => JSON.stringify({
  format: ARCHIVE_FORMAT,
  version: 1,
  judgeProfile: profile,
}, null, 2) + '\n';

const isArchiveControlFile = (rel) => CONTROL_FILES.has(normalizeRelPath(rel));

module.exports = {
  ARCHIVE_FORMAT,
  DATA_CONFIG_FILE,
  PROFILE_CONFIG_FILE,
  PROFILE_YAML_FILE,
  PROFILE_JSON_IMPORT_FILES,
  PROFILE_YAML_IMPORT_FILES,
  buildProfileConfigJson,
  dumpProfileYaml,
  isArchiveControlFile,
  isUnsafeRelPath,
  listFilesRecursive,
  normalizeRelPath,
  readImportedProfile,
  safeResolve,
};
