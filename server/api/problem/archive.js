const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const loadYaml = yaml.load || yaml.safeLoad;
const dumpYaml = yaml.dump || yaml.safeDump;

const DATA_CONFIG_FILE = 'config.json';
const PROFILE_YAML_FILE = 'nywoj.yaml';
const PROFILE_CONFIG_FILE = 'nywoj.config.json';
const ARCHIVE_FORMAT = 'nywoj.problem-data.v1';
const FULL_ARCHIVE_FORMAT = 'nywoj.problem.v2';
const PROBLEM_JSON_FILE = 'problem.json';
const MAX_STATEMENT_BYTES = 64 * 1024 - 1;
const MAX_SAMPLES = 20;
const MAX_SAMPLES_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_BYTES = 256 * 1024;

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
  PROBLEM_JSON_FILE,
]);

const integerInRange = (value, fallback, min, max, label) => {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} 应为 ${min} 到 ${max} 之间的整数`);
  }
  return number;
};

const normalizeFullProblemManifest = (payload) => {
  if (!payload || typeof payload !== 'object' || payload.format !== FULL_ARCHIVE_FORMAT) {
    throw new Error(`不是受支持的完整题目包（需要 ${FULL_ARCHIVE_FORMAT}）`);
  }
  const input = payload.statement;
  if (!input || typeof input !== 'object') throw new Error('problem.json 缺少 statement');

  const title = String(input.title == null ? '' : input.title).trim();
  const description = String(input.description == null ? '' : input.description);
  if (!title) throw new Error('题目标题不能为空');
  if ([...title].length > 127) throw new Error('题目标题不能超过 127 个字符');
  if (!description.trim()) throw new Error('题目描述不能为空');
  if (Buffer.byteLength(description, 'utf-8') > MAX_STATEMENT_BYTES) {
    throw new Error('题目描述不能超过 64KB');
  }

  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  if (rawTags.length > 50) throw new Error('题目标签不能超过 50 个');
  const tags = [];
  const seenTags = new Set();
  for (const item of rawTags) {
    const tag = String(item == null ? '' : item).trim();
    if (!tag || seenTags.has(tag)) continue;
    if ([...tag].length > 30) throw new Error('单个题目标签不能超过 30 个字符');
    seenTags.add(tag);
    tags.push(tag);
  }

  const rawSamples = Array.isArray(input.samples) ? input.samples : [];
  if (rawSamples.length > MAX_SAMPLES) throw new Error(`样例不能超过 ${MAX_SAMPLES} 组`);
  let sampleBytes = 0;
  const samples = rawSamples.map((sample) => {
    const inputData = String(sample && (sample.inputData != null ? sample.inputData : sample.input) || '')
      .replace(/\r\n/g, '\n');
    const outputData = String(sample && (sample.outputData != null ? sample.outputData : sample.output) || '')
      .replace(/\r\n/g, '\n');
    sampleBytes += Buffer.byteLength(inputData) + Buffer.byteLength(outputData);
    return { inputData, outputData };
  });
  if (sampleBytes > MAX_SAMPLES_BYTES) throw new Error('样例总大小不能超过 2MB');

  return {
    format: FULL_ARCHIVE_FORMAT,
    statement: {
      title,
      description,
      samples,
      tags,
      difficulty: integerInRange(input.difficulty, 0, 0, 5, '难度'),
      timeLimit: integerInRange(input.timeLimit, 1000, 1, 600000, '时间限制'),
      memoryLimit: integerInRange(input.memoryLimit, 128, 1, 65536, '空间限制'),
      langMask: integerInRange(input.langMask, 6, 0, 0x7fffffff, '语言掩码'),
    },
  };
};

const buildFullProblemManifest = (statement, extra = {}) => {
  const normalized = normalizeFullProblemManifest({
    format: FULL_ARCHIVE_FORMAT,
    statement,
  });
  return {
    ...extra,
    format: FULL_ARCHIVE_FORMAT,
    statement: {
      ...normalized.statement,
      samples: normalized.statement.samples.map((sample) => ({
        input: sample.inputData,
        output: sample.outputData,
      })),
    },
  };
};

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
    if (fs.statSync(full).size > MAX_PROFILE_BYTES) throw new Error(`${name} 不能超过 256KB`);
    const payload = loadYaml(fs.readFileSync(full, 'utf-8'));
    const profile = extractProfilePayload(payload);
    if (!profile || typeof profile !== 'object') throw new Error(`${name} 中没有可识别的评测流程配置`);
    return { profile, source: name };
  }

  for (const name of PROFILE_JSON_IMPORT_FILES) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).size > MAX_PROFILE_BYTES) throw new Error(`${name} 不能超过 256KB`);
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
  FULL_ARCHIVE_FORMAT,
  PROBLEM_JSON_FILE,
  PROFILE_CONFIG_FILE,
  PROFILE_YAML_FILE,
  PROFILE_JSON_IMPORT_FILES,
  PROFILE_YAML_IMPORT_FILES,
  buildProfileConfigJson,
  buildFullProblemManifest,
  dumpProfileYaml,
  isArchiveControlFile,
  isUnsafeRelPath,
  listFilesRecursive,
  normalizeRelPath,
  normalizeFullProblemManifest,
  readImportedProfile,
  safeResolve,
};
