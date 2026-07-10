const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const multer = require('multer');
const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const config = require('../../config.json');
const { getFile, setFile } = require('../../file');
const storage = require('../../storage');
const { recordEvent } = require('../../static');
const { problemAuth } = require('./core');
const { dumpProfileYaml, PROFILE_YAML_FILE } = require('./archive');
const aiPrompt = require('./aiPrompt');
const { buildSandboxGeneratedCases, runDraftChecks } = require('./aiValidate');

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MAX_PROMPT_BYTES = 24 * 1024;
const MAX_CASES = 50;
const MAX_CASE_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_CHUNKED_CASE_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKED_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_SOLUTION_BYTES = 512 * 1024;
const MAX_STATEMENT_BYTES = 512 * 1024;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_DRAFT_CONTEXT_BYTES = 512 * 1024;
const MAX_PROMPT_HISTORY_ITEMS = 8;
const MAX_PROMPT_HISTORY_BYTES = 16 * 1024;
const MAX_JUDGE_ASSETS = 12;
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const DATA_SAVE_TTL_MS = 30 * 60 * 1000;
const LOST_JOB_GRACE_MS = 10 * 60 * 1000;
const PREVIEW_REASONING_BYTES = 128 * 1024;
const MAX_REPAIR_ROUNDS = 2;
const MAX_SUMMARY_BYTES = 8 * 1024;
const LOST_JOB_MESSAGE = '后台生成任务已中断（服务可能已重启），请重新生成。';
const CANCELLED_JOB_MESSAGE = '已停止本次生成。';
const PROCESS_STARTED_AT = Date.now();
const loadYaml = yaml.load || yaml.safeLoad;

const dataCaseUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 2,
    fields: 8,
    parts: 12,
    fileSize: MAX_CHUNKED_CASE_BYTES,
  },
}).fields([
  { name: 'input', maxCount: 1 },
  { name: 'output', maxCount: 1 },
]);

const JUDGE_PRESETS = new Set(['traditional', 'spj', 'answer', 'answer-spj', 'function', 'interactive', 'communication', 'custom']);
const DRAFT_SECTIONS = ['statement', 'std', 'solution', 'data', 'judge'];

const aiJobs = new Map();
const latestJobByUserProblem = new Map();
const dataSaveSessions = new Map();

const dataDirOf = (pid) => path.join(__dirname, '..', '..', 'data', String(pid));
const judgeAssetRel = (pid, name) => name === 'checker.cpp' ? `./data/${pid}/checker.cpp` : `./data/${pid}/assets/${name}`;
const jobKey = (uid, pid) => `${Number(uid || 0)}:${Number(pid || 0)}`;

const bool = (value) => value === true || value === 1 || value === '1';

const byteLen = (value) => Buffer.byteLength(String(value || ''), 'utf-8');

const readStreamText = (stream) => new Promise((resolve, reject) => {
  let text = '';
  stream.on('data', (chunk) => { text += chunk.toString('utf-8'); });
  stream.on('end', () => resolve(text));
  stream.on('error', reject);
});

const writeSse = (res, event, data = {}) => {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

let userLlmSchemaReady = null;
const ensureUserLlmSchema = () => {
  if (!userLlmSchemaReady) {
    userLlmSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS userLlmConfig (
        uid INT NOT NULL,
        baseUrl VARCHAR(300) NOT NULL,
        apiKey TEXT NOT NULL,
        model VARCHAR(120) NOT NULL,
        updateTime DATETIME NOT NULL,
        PRIMARY KEY (uid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
  return userLlmSchemaReady;
};

let aiPreviewSchemaReady = null;
const ensureAiPreviewSchema = () => {
  if (!aiPreviewSchemaReady) {
    aiPreviewSchemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS problemAiPreview (
          uid INT NOT NULL,
          pid INT NOT NULL,
          jobId VARCHAR(80) NOT NULL,
          status VARCHAR(24) NOT NULL,
          model VARCHAR(120) NOT NULL,
          sections TEXT NULL,
          prompt MEDIUMTEXT NULL,
          draft LONGTEXT NULL,
          reasoning MEDIUMTEXT NULL,
          summary TEXT NULL,
          checks MEDIUMTEXT NULL,
          error TEXT NULL,
          createTime DATETIME NOT NULL,
          updateTime DATETIME NOT NULL,
          PRIMARY KEY (uid, pid),
          KEY idx_jobId (jobId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      const addColumn = (sql) => db.query(sql).catch((err) => {
        if (!err || err.code !== 'ER_DUP_FIELDNAME') throw err;
      });
      await addColumn('ALTER TABLE problemAiPreview ADD COLUMN prompt MEDIUMTEXT NULL AFTER sections');
      await addColumn('ALTER TABLE problemAiPreview ADD COLUMN summary TEXT NULL AFTER reasoning');
      await addColumn('ALTER TABLE problemAiPreview ADD COLUMN checks MEDIUMTEXT NULL AFTER summary');
    })();
  }
  return aiPreviewSchemaReady;
};

const cleanText = (value, maxBytes = 64 * 1024) => {
  const text = String(value == null ? '' : value).replace(/\r\n/g, '\n');
  if (byteLen(text) <= maxBytes) return text;
  return Buffer.from(text, 'utf-8').subarray(0, maxBytes).toString('utf-8');
};

const cleanString = (value, maxChars = 100) => String(value == null ? '' : value).trim().slice(0, maxChars);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const globalLlmOptions = () => {
  const conf = config.LLM || config.llm || config.AI || config.ai || config.OPENAI || {};
  return {
    defaultBaseUrl: cleanString(conf.baseUrl || conf.baseURL || conf.BASE_URL || DEFAULT_BASE_URL, 300),
    defaultModel: cleanString(conf.model || DEFAULT_MODEL, 120) || DEFAULT_MODEL,
    timeout: Math.max(3000, Math.min(Number(process.env.LLM_TIMEOUT || conf.timeout || 120000), 240000)),
    maxTokens: Math.max(1024, Math.min(Number(process.env.LLM_MAX_TOKENS || conf.maxTokens || 8192), 32000)),
  };
};

const normalizeBaseUrl = (value) => {
  const raw = cleanString(value || DEFAULT_BASE_URL, 300).replace(/\/+$/, '');
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return raw;
};

const maskKey = (apiKey) => {
  const key = String(apiKey || '');
  if (!key) return '';
  if (key.length <= 10) return '*'.repeat(key.length);
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
};

const formatLlmRequestError = (err) => {
  const message = err && err.message ? String(err.message) : String(err);
  const code = err && (err.code || err.cause && err.cause.code);
  if (code === 'ENOTFOUND') return 'LLM Base URL 域名无法解析，请检查 Base URL。';
  if (code === 'ECONNREFUSED') return 'LLM 服务拒绝连接，请检查 Base URL 或代理服务是否启动。';
  if (code === 'ECONNABORTED' || /timeout/i.test(message)) return 'LLM 请求超时，请稍后重试或调大 LLM timeout。';
  if (code === 'ECONNRESET' || /socket hang up|network socket disconnected|TLS connection/i.test(message)) {
    return 'LLM 连接中断，请检查网络、代理或 Base URL。';
  }
  return message;
};

const withLlmRequestError = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    throw new Error(formatLlmRequestError(err));
  }
};

const loadUserLlmConfig = async (uid) => {
  await ensureUserLlmSchema();
  const defaults = globalLlmOptions();
  const row = uid ? await db.one('SELECT baseUrl,apiKey,model FROM userLlmConfig WHERE uid=?', [uid]) : null;
  const baseUrl = normalizeBaseUrl(row && row.baseUrl) || normalizeBaseUrl(defaults.defaultBaseUrl) || DEFAULT_BASE_URL;
  const model = cleanString(row && row.model, 120) || defaults.defaultModel || DEFAULT_MODEL;
  const apiKey = row ? String(row.apiKey || '') : '';
  return {
    enabled: !!apiKey,
    hasKey: !!apiKey,
    keyPreview: maskKey(apiKey),
    apiKey,
    baseUrl,
    model,
    timeout: defaults.timeout,
    maxTokens: defaults.maxTokens,
  };
};

const llmFromRequestOrSaved = async (req) => {
  const saved = await loadUserLlmConfig(req.session.uid);
  const baseUrl = normalizeBaseUrl(req.body.baseUrl || saved.baseUrl);
  if (!baseUrl) throw new Error('Base URL 格式错误');
  const apiKey = String(req.body.apiKey || saved.apiKey || '').trim();
  const model = cleanString(req.body.model || saved.model, 120) || DEFAULT_MODEL;
  return { ...saved, baseUrl, apiKey, model, enabled: !!apiKey, hasKey: !!apiKey };
};

const parseSections = (sections) => {
  const allowed = new Set(['statement', 'std', 'solution', 'data', 'judge']);
  const raw = Array.isArray(sections) ? sections : [];
  const out = raw.map((item) => String(item || '').trim()).filter((item) => allowed.has(item));
  return out.length ? [...new Set(out)] : ['statement', 'std', 'solution', 'data'];
};

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};

const normalizeTags = (tags) => {
  const raw = Array.isArray(tags) ? tags : String(tags || '').split(/[,\n，、]/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const tag = cleanString(item, 30);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
};

const normalizeSamples = (samples) => {
  const raw = Array.isArray(samples) ? samples : [];
  const out = [];
  for (const sample of raw) {
    const inputData = cleanText(sample && (sample.inputData != null ? sample.inputData : sample.input), 256 * 1024);
    const outputData = cleanText(sample && (sample.outputData != null ? sample.outputData : sample.output), 256 * 1024);
    if (!inputData.trim() && !outputData.trim()) continue;
    out.push({ inputData, outputData });
    if (out.length >= 10) break;
  }
  return out;
};

const sanitizeAssetName = (value, fallback) => {
  const raw = cleanString(value || fallback, 80).replace(/[\\/]/g, '-');
  const name = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || fallback;
  return name.slice(0, 64);
};

const extensionForLanguage = (language) => {
  const key = String(language || '').trim().toLowerCase();
  if (key.includes('python') || key === 'py') return 'py';
  if (key.includes('java')) return 'java';
  if (key.includes('javascript') || key === 'js' || key === 'node') return 'js';
  if (key.includes('c++') || key.includes('cpp') || key === 'c') return 'cpp';
  return 'cpp';
};

const normalizeCodeBlock = (block, fallbackName) => {
  const language = cleanString(block && block.language, 40) || 'cpp';
  const fileName = sanitizeAssetName(
    block && block.fileName,
    `${fallbackName}.${extensionForLanguage(language)}`
  );
  return {
    language,
    fileName,
    source: cleanText(block && block.source, MAX_SOURCE_BYTES),
    explanation: cleanText(block && block.explanation, 32 * 1024),
  };
};

const sanitizeCaseBase = (value, index, used) => {
  const raw = cleanString(value || index, 64)
    .replace(/\.(in|out)$/i, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '') || String(index);
  let base = raw.slice(0, 48);
  let suffix = 1;
  while (used.has(base)) {
    suffix++;
    base = `${raw.slice(0, 44)}-${suffix}`;
  }
  used.add(base);
  return base;
};

const normalizeSubtasks = (subtasks, cases) => {
  const raw = Array.isArray(subtasks) ? subtasks : [];
  const normalized = [];
  let expected = 1;
  let totalScore = 0;
  for (const item of raw) {
    const index = clampInt(item && item.index, 1, 100, expected);
    if (index !== expected) break;
    const score = clampInt(item && item.score, 1, 100, 100);
    const option = clampInt(item && item.option, 0, 1, 0);
    const dependencies = Array.isArray(item && item.dependencies)
      ? item.dependencies.map((dep) => clampInt(dep, 1, 100, 0)).filter((dep) => dep > 0 && dep < index)
      : [];
    normalized.push({ index, score, option, skip: option ? bool(item && item.skip) : false, dependencies });
    totalScore += score;
    expected++;
  }
  if (!normalized.length || totalScore !== 100) {
    return [{ index: 1, score: 100, option: 0, skip: false, dependencies: [] }];
  }
  const valid = new Set(normalized.map((item) => item.index));
  for (const c of cases) {
    if (!valid.has(Number(c.subtaskId))) c.subtaskId = 1;
  }
  return normalized;
};

const normalizeGenerationArg = (value) => cleanString(value, 200);

const normalizeGenerationPlan = (data) => {
  const raw = (data && (data.generation || data.generationPlan || data.generate)) || {};
  const rawCases = Array.isArray(raw.cases) ? raw.cases
    : Array.isArray(raw.commands) ? raw.commands
      : Array.isArray(raw.plan) ? raw.plan
        : [];
  const cases = [];
  const used = new Set();
  for (let i = 0; i < rawCases.length && cases.length < MAX_CASES; i++) {
    const item = rawCases[i] || {};
    const index = cases.length + 1;
    const rawArgs = item.args != null ? item.args : item.command;
    const args = Array.isArray(rawArgs)
      ? rawArgs.map(normalizeGenerationArg).filter((arg) => arg !== '').slice(0, 24)
      : String(rawArgs || '').split(/\s+/).map(normalizeGenerationArg).filter((arg) => arg !== '').slice(0, 24);
    cases.push({
      index,
      name: sanitizeCaseBase(item.name, index, used),
      subtaskId: clampInt(item.subtaskId, 1, 100, 1),
      args,
      stdin: cleanText(item.stdin, 64 * 1024),
      note: cleanText(item.note || item.description, 4 * 1024),
    });
  }
  return {
    mode: cleanString(raw.mode || 'per-case-stdout', 40) || 'per-case-stdout',
    cases,
    compile: cleanText(raw.compile, 4 * 1024),
    run: cleanText(raw.run, 16 * 1024),
    output: cleanText(raw.output, 16 * 1024),
    notes: cleanText(raw.notes || raw.description, 32 * 1024),
  };
};

const normalizeDataDraft = (data) => {
  const rawCases = Array.isArray(data && data.cases) ? data.cases : [];
  const cases = [];
  const used = new Set();
  let totalBytes = 0;
  for (let i = 0; i < rawCases.length && cases.length < MAX_CASES; i++) {
    const item = rawCases[i] || {};
    const input = cleanText(item.input, MAX_CASE_TOTAL_BYTES);
    const output = cleanText(item.output, MAX_CASE_TOTAL_BYTES);
    if (!input.trim() && !output.trim()) continue;
    totalBytes += byteLen(input) + byteLen(output);
    if (totalBytes > MAX_CASE_TOTAL_BYTES) break;
    const index = cases.length + 1;
    cases.push({
      index,
      name: sanitizeCaseBase(item.name, index, used),
      input,
      output,
      subtaskId: clampInt(item.subtaskId, 1, 100, 1),
    });
  }
  const generation = normalizeGenerationPlan(data);
  const subtasks = normalizeSubtasks(data && data.subtasks, [...cases, ...generation.cases]);
  return {
    cases,
    subtasks,
    generator: normalizeCodeBlock(data && data.generator, 'ai-generator'),
    generation,
    notes: cleanText(data && data.notes, 64 * 1024),
  };
};

const normalizeDataSaveMeta = (data) => {
  const rawCases = Array.isArray(data && data.cases) ? data.cases : [];
  const cases = [];
  const used = new Set();
  for (let i = 0; i < rawCases.length && cases.length < MAX_CASES; i++) {
    const item = rawCases[i] || {};
    const index = cases.length + 1;
    cases.push({
      index,
      name: sanitizeCaseBase(item.name, index, used),
      subtaskId: clampInt(item.subtaskId, 1, 100, 1),
    });
  }
  const subtasks = normalizeSubtasks(data && data.subtasks, cases);
  return {
    cases,
    subtasks,
    generator: normalizeCodeBlock(data && data.generator, 'ai-generator'),
    notes: cleanText(data && data.notes, 64 * 1024),
  };
};

const cloneProfile = (profile, preset) => {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const serialized = JSON.stringify(profile);
  if (byteLen(serialized) > MAX_PROFILE_BYTES) return null;
  const cloned = JSON.parse(serialized);
  if (!cloned.version) cloned.version = 1;
  if (!cloned.preset) cloned.preset = preset || 'custom';
  return cloned;
};

const normalizeJudgeAsset = (asset, index) => {
  const language = cleanString(asset && (asset.language || asset.lang), 40) || 'cpp';
  const fallback = `${cleanString(asset && asset.role, 20) || 'asset'}-${index + 1}.${extensionForLanguage(language)}`;
  return {
    name: sanitizeAssetName(asset && (asset.name || asset.fileName), fallback),
    role: cleanString(asset && asset.role, 30) || 'asset',
    language,
    content: cleanText(asset && (asset.content != null ? asset.content : asset && asset.source), MAX_SOURCE_BYTES),
  };
};

const profileToYaml = (profile) => {
  if (!profile || typeof profile !== 'object') return '';
  try {
    return cleanText(dumpProfileYaml(profile), MAX_PROFILE_BYTES);
  } catch (_) {
    return '';
  }
};

const extractProfilePayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.judgeProfile && typeof payload.judgeProfile === 'object' && !Array.isArray(payload.judgeProfile)) {
    return payload.judgeProfile;
  }
  if (payload.profile && typeof payload.profile === 'object' && !Array.isArray(payload.profile)) {
    return payload.profile;
  }
  return payload;
};

const parseJudgeYamlProfile = (source) => {
  const text = cleanText(source, MAX_PROFILE_BYTES);
  if (!text.trim()) return null;
  const payload = loadYaml(text);
  const profile = extractProfilePayload(payload);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('nywoj.yaml 中没有可识别的评测流程配置');
  }
  return profile;
};

const normalizeJudgeDraft = (judge) => {
  const rawPreset = cleanString(judge && judge.preset, 40) || 'traditional';
  const preset = JUDGE_PRESETS.has(rawPreset) ? rawPreset : 'custom';
  const profile = cloneProfile(judge && judge.profile, preset);
  const rawAssets = Array.isArray(judge && judge.assets) ? judge.assets : [];
  const assets = [];
  const seen = new Set();
  for (let i = 0; i < rawAssets.length && assets.length < MAX_JUDGE_ASSETS; i++) {
    const asset = normalizeJudgeAsset(rawAssets[i], i);
    if (!asset.name || seen.has(asset.name)) continue;
    seen.add(asset.name);
    assets.push(asset);
  }
  return {
    preset: profile && profile.preset ? cleanString(profile.preset, 40) : preset,
    profile,
    assets,
    yaml: cleanText(judge && (judge.yaml || judge.profileYaml || judge.problemYaml), MAX_PROFILE_BYTES) || profileToYaml(profile),
    notes: cleanText(judge && judge.notes, 64 * 1024),
  };
};

const normalizeDraft = (payload, currentProblem = {}) => {
  const statement = payload && payload.statement && typeof payload.statement === 'object' ? payload.statement : {};
  const title = cleanString(statement.title, 100) || currentProblem.title || '';
  const description = cleanText(statement.description || statement.markdown, MAX_STATEMENT_BYTES);
  const data = normalizeDataDraft(payload && payload.data);
  return {
    statement: {
      title,
      description,
      tags: normalizeTags(statement.tags),
      timeLimit: clampInt(statement.timeLimit, 1, 60000, Number(currentProblem.timeLimit) || 1000),
      memoryLimit: clampInt(statement.memoryLimit, 1, 4096, Number(currentProblem.memoryLimit) || 256),
      level: clampInt(statement.level, 0, 5, Number(currentProblem.level) || 0),
      samples: normalizeSamples(statement.samples),
    },
    std: normalizeCodeBlock(payload && payload.std, 'std'),
    solution: {
      title: cleanString(payload && payload.solution && payload.solution.title, 80) || `${title || currentProblem.title || '题目'} 题解`,
      markdown: cleanText(payload && payload.solution && (payload.solution.markdown || payload.solution.content), MAX_SOLUTION_BYTES),
    },
    data,
    judge: normalizeJudgeDraft(payload && payload.judge),
  };
};

const scanJsonStringEnd = (text, start) => {
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') return i;
  }
  return -1;
};

const scanJsonMatching = (text, start, open, close) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const completeJsonValueSlice = (text, valueStart) => {
  let i = valueStart;
  while (i < text.length && /\s/.test(text[i])) i++;
  const ch = text[i];
  if (ch === '{') {
    const end = scanJsonMatching(text, i, '{', '}');
    return end >= 0 ? text.slice(i, end + 1) : null;
  }
  if (ch === '[') {
    const end = scanJsonMatching(text, i, '[', ']');
    return end >= 0 ? text.slice(i, end + 1) : null;
  }
  if (ch === '"') {
    const end = scanJsonStringEnd(text, i);
    return end >= 0 ? text.slice(i, end + 1) : null;
  }
  let end = i;
  while (end < text.length && !/[,\}\]\r\n]/.test(text[end])) end++;
  return end > i ? text.slice(i, end).trim() : null;
};

const extractCompleteTopLevelValue = (text, wantedKey) => {
  const root = text.indexOf('{');
  if (root < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = root; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      if (depth === 1) {
        const end = scanJsonStringEnd(text, i);
        if (end < 0) return undefined;
        let j = end + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] !== ':') {
          i = end;
          continue;
        }
        let key = null;
        try {
          key = JSON.parse(text.slice(i, end + 1));
        } catch (_) {
          i = end;
          continue;
        }
        if (key === wantedKey) {
          const slice = completeJsonValueSlice(text, j + 1);
          if (!slice) return undefined;
          return JSON.parse(slice);
        }
        i = end;
        continue;
      }
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return undefined;
};

const extractCompletePayloadSections = (content) => {
  const payload = {};
  const found = [];
  for (const key of DRAFT_SECTIONS) {
    try {
      const value = extractCompleteTopLevelValue(String(content || ''), key);
      if (value !== undefined) {
        payload[key] = value;
        found.push(key);
      }
    } catch (_) {
      // Ignore incomplete or malformed sections while the model is still writing.
    }
  }
  return { payload, found };
};

const mergeNormalizedSections = (draft, payload, currentProblem) => {
  const normalized = normalizeDraft(payload, currentProblem);
  const next = draft || normalizeDraft({}, currentProblem);
  for (const key of DRAFT_SECTIONS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) next[key] = normalized[key];
  }
  return next;
};

const parsedSectionsCover = (parsedSections, wantedSections) => {
  const have = parsedSections instanceof Set ? parsedSections : new Set(Array.isArray(parsedSections) ? parsedSections : []);
  const wanted = Array.isArray(wantedSections) && wantedSections.length ? wantedSections : DRAFT_SECTIONS;
  return wanted.every((key) => have.has(key));
};

// 模型写代码字符串时的常见 JSON 笔误：非法转义（\d、残缺 \u）和字符串里的
// 裸换行/制表符。把它们修成合法 JSON，尽量保留原意（非法转义视为字面反斜杠）。
const repairLlmJson = (text) => {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1] || '';
      if ('"\\/bfnrt'.includes(next)) {
        out += ch + next;
        i++;
        continue;
      }
      if (next === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += text.slice(i, i + 6);
          i += 5;
          continue;
        }
      }
      out += `\\\\${next}`;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') { out += '\\r'; continue; }
    if (ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
};

const extractJson = (content) => {
  const text = String(content || '').trim();
  if (!text) throw new Error('模型返回为空');
  try {
    return JSON.parse(text);
  } catch (_) {
    // Continue with wrapper cleanup below.
  }
  // Only strip a Markdown fence when the whole response is fenced JSON. Problem
  // statements legitimately contain fenced sample blocks inside JSON strings.
  const fenced = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    // Fall through to brace slicing / escape repair.
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const sliced = start >= 0 && end > start ? candidate.slice(start, end + 1) : '';
  if (sliced) {
    try {
      return JSON.parse(sliced);
    } catch (_) {
      // Last resort: repair common LLM escape mistakes and retry.
    }
    return JSON.parse(repairLlmJson(sliced));
  }
  throw new Error('模型没有返回合法 JSON');
};

const normalizePromptHistory = (history, currentPrompt = '') => {
  const raw = Array.isArray(history) ? history : [];
  const current = cleanText(currentPrompt, MAX_PROMPT_BYTES).trim();
  const out = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const item of raw.slice(-MAX_PROMPT_HISTORY_ITEMS * 2).reverse()) {
    const text = cleanText(
      typeof item === 'string' ? item : item && (item.prompt || item.content || item.text),
      4096
    ).trim();
    if (!text || text === current || seen.has(text)) continue;
    const nextBytes = byteLen(text);
    if (totalBytes + nextBytes > MAX_PROMPT_HISTORY_BYTES) break;
    seen.add(text);
    out.unshift(text);
    totalBytes += nextBytes;
  }
  return out.slice(-MAX_PROMPT_HISTORY_ITEMS);
};

const compactCasesForPrompt = (cases, limit = 8) => {
  const raw = Array.isArray(cases) ? cases : [];
  return raw.slice(0, limit).map((item, index) => ({
    index: item.index || index + 1,
    name: item.name || String(index + 1),
    subtaskId: item.subtaskId || 1,
    input: cleanText(item.input, 2048),
    output: cleanText(item.output, 2048),
  }));
};

const compactGenerationCasesForPrompt = (cases) => {
  const raw = Array.isArray(cases) ? cases : [];
  return raw.slice(0, MAX_CASES).map((item, index) => ({
    index: item.index || index + 1,
    name: item.name || String(index + 1),
    subtaskId: item.subtaskId || 1,
    args: Array.isArray(item.args) ? item.args.map((arg) => cleanString(arg, 160)) : [],
    stdin: cleanText(item.stdin, 1024),
    note: cleanText(item.note || item.description, 1024),
  }));
};

const compactDraftForPrompt = (draft, compact = false) => {
  if (!draft || typeof draft !== 'object') return null;
  const sourceBytes = compact ? 12000 : 32000;
  const markdownBytes = compact ? 12000 : 32000;
  const statementBytes = MAX_STATEMENT_BYTES;
  const assetBytes = compact ? 12000 : 24000;
  const data = draft.data || {};
  const generation = data.generation || data.generationPlan || {};
  const judge = draft.judge || {};
  return {
    statement: {
      ...(draft.statement || {}),
      description: cleanText(draft.statement && draft.statement.description, statementBytes),
      samples: normalizeSamples(draft.statement && draft.statement.samples).slice(0, compact ? 5 : 10),
    },
    std: {
      ...(draft.std || {}),
      source: cleanText(draft.std && draft.std.source, sourceBytes),
    },
    solution: {
      ...(draft.solution || {}),
      markdown: cleanText(draft.solution && draft.solution.markdown, markdownBytes),
    },
    data: {
      cases: compactCasesForPrompt(data.cases, compact ? 5 : 10),
      omittedStaticCases: Math.max(0, (Array.isArray(data.cases) ? data.cases.length : 0) - (compact ? 5 : 10)),
      subtasks: Array.isArray(data.subtasks) ? data.subtasks : [],
      generator: {
        ...(data.generator || {}),
        source: cleanText(data.generator && data.generator.source, sourceBytes),
      },
      generation: {
        ...generation,
        cases: compactGenerationCasesForPrompt(generation.cases),
        notes: cleanText(generation.notes, 4096),
      },
      notes: cleanText(data.notes, compact ? 4096 : 12000),
    },
    judge: {
      preset: judge.preset,
      profile: judge.profile || null,
      yaml: cleanText(judge.yaml, compact ? 12000 : 24000),
      assets: (Array.isArray(judge.assets) ? judge.assets : []).slice(0, MAX_JUDGE_ASSETS).map((asset, index) => ({
        name: cleanString(asset && (asset.name || asset.fileName), 80) || `asset-${index + 1}.cpp`,
        role: cleanString(asset && asset.role, 30) || 'asset',
        language: cleanString(asset && (asset.language || asset.lang), 40) || 'cpp',
        content: cleanText(asset && (asset.content != null ? asset.content : asset && asset.source), assetBytes),
      })),
      notes: cleanText(judge.notes, compact ? 4096 : 12000),
    },
  };
};

const stringifyDraftContext = (draft) => {
  if (!draft) return '';
  let text = JSON.stringify(compactDraftForPrompt(draft, false), null, 2);
  if (byteLen(text) <= MAX_DRAFT_CONTEXT_BYTES) return text;
  text = JSON.stringify(compactDraftForPrompt(draft, true), null, 2);
  if (byteLen(text) <= MAX_DRAFT_CONTEXT_BYTES) return text;
  return `${cleanText(text, MAX_DRAFT_CONTEXT_BYTES)}\n/* 当前草稿过长，以上内容已截断。未展示的大型静态数据不要删除，除非用户明确要求。 */`;
};

const mergeDraftSections = (baseDraft, generatedDraft, sections) => {
  if (!baseDraft) return generatedDraft;
  const next = cloneJson(baseDraft);
  const allowed = new Set(DRAFT_SECTIONS);
  const keys = Array.isArray(sections) ? sections.filter((key) => allowed.has(key)) : [];
  for (const key of keys) {
    if (generatedDraft && Object.prototype.hasOwnProperty.call(generatedDraft, key)) next[key] = generatedDraft[key];
  }
  return next;
};

// 提示词构建委托给 aiPrompt（评测模板与 validateProfile 同步）。这里只负责
// 组装题目上下文和草稿文本。
const buildMessages = (prompt, sections, problem, options = {}) => {
  const context = {
    pid: problem.pid,
    title: problem.title,
    tags: problem.tags,
    level: problem.level,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
    description: cleanText(problem.description, MAX_STATEMENT_BYTES),
    samples: problem.samples || [],
  };
  return aiPrompt.buildMessages(prompt, sections, context, {
    currentDraftText: stringifyDraftContext(options.currentDraft),
    promptHistory: normalizePromptHistory(options.promptHistory, prompt),
    mode: options.mode,
  });
};

const chatCompletion = async (llm, payload) => {
  const url = `${llm.baseUrl}/chat/completions`;
  const body = {
    model: payload.model || llm.model,
    messages: payload.messages,
    temperature: payload.temperature,
    max_tokens: llm.maxTokens,
    response_format: { type: 'json_object' },
  };
  const headers = {
    Authorization: `Bearer ${llm.apiKey}`,
    'Content-Type': 'application/json',
  };
  const options = {
    timeout: llm.timeout,
    validateStatus: (status) => status >= 200 && status < 500,
  };
  let res = await withLlmRequestError(() => axios.post(url, body, { ...options, headers }));
  if (res.status >= 400 && res.status < 500) {
    const fallbackBody = { ...body };
    delete fallbackBody.response_format;
    res = await withLlmRequestError(() => axios.post(url, fallbackBody, { ...options, headers }));
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message);
    throw new Error(detail || `LLM 请求失败 (${res.status})`);
  }
  const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
  return content;
};

const postChatStream = async (llm, body, signal) => {
  const url = `${llm.baseUrl}/chat/completions`;
  const headers = {
    Authorization: `Bearer ${llm.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  return withLlmRequestError(() => axios.post(url, body, {
    headers,
    responseType: 'stream',
    timeout: llm.timeout,
    signal,
    validateStatus: (status) => status >= 200 && status < 500,
  }));
};

const chatCompletionStream = async (llm, payload, hooks) => {
  const baseBody = {
    model: payload.model || llm.model,
    messages: payload.messages,
    temperature: payload.temperature,
    max_tokens: llm.maxTokens,
    stream: true,
    response_format: { type: 'json_object' },
  };
  const controller = payload.controller;
  let res = await postChatStream(llm, baseBody, controller && controller.signal);

  if (res.status >= 400 && res.status < 500) {
    const detail = await readStreamText(res.data).catch(() => '');
    const fallbackBody = { ...baseBody };
    delete fallbackBody.response_format;
    hooks.onStatus && hooks.onStatus('模型接口不接受 response_format，已自动切换为普通 JSON 流。');
    res = await postChatStream(llm, fallbackBody, controller && controller.signal);
    if (res.status >= 400 && res.status < 500) {
      const fallbackDetail = await readStreamText(res.data).catch(() => '');
      throw new Error(fallbackDetail || detail || `LLM 请求失败 (${res.status})`);
    }
  }

  if (res.status < 200 || res.status >= 300) {
    const detail = await readStreamText(res.data).catch(() => '');
    throw new Error(detail || `LLM 请求失败 (${res.status})`);
  }

  let content = '';
  let buffer = '';
  const handleJson = (parsed) => {
    const choices = Array.isArray(parsed && parsed.choices) ? parsed.choices : [];
    for (const choice of choices) {
      const delta = choice && (choice.delta || choice.message || {});
      const reasoning = delta.reasoning_content || delta.reasoningContent || delta.reasoning_text ||
        delta.reasoning || delta.thinking || '';
      const token = delta.content || delta.text || '';
      if (reasoning) hooks.onReasoning && hooks.onReasoning(String(reasoning));
      if (token) {
        const text = String(token);
        content += text;
        hooks.onToken && hooks.onToken(text);
      }
    }
    if (parsed && parsed.message && parsed.message.content) {
      const text = String(parsed.message.content);
      content += text;
      hooks.onToken && hooks.onToken(text);
    }
  };

  const handleStreamPayload = (data) => {
    const text = String(data || '').trim();
    if (!text) return false;
    if (text === '[DONE]') return true;
    try {
      handleJson(JSON.parse(text));
    } catch (_) {
      if (!text.startsWith('{')) {
        content += text;
        hooks.onToken && hooks.onToken(text);
      }
    }
    return false;
  };

  const handleBufferedText = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('{')) {
      try {
        handleJson(JSON.parse(trimmed));
        return false;
      } catch (_) {
        // Fall through to SSE/NDJSON parsing.
      }
    }
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('data:')) {
        if (handleStreamPayload(line.slice(5))) return true;
      } else if (line.startsWith('{')) {
        if (handleStreamPayload(line)) return true;
      }
    }
    return false;
  };

  await new Promise((resolve, reject) => {
    res.data.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const frames = buffer.split(/\n\n|\r\n\r\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        if (handleBufferedText(frame)) {
          resolve();
          return;
        }
      }
    });
    res.data.on('end', () => {
      handleBufferedText(buffer);
      resolve();
    });
    res.data.on('error', reject);
  });

  return content;
};

const listRemoteModels = async (llm) => {
  const res = await withLlmRequestError(() => axios.get(`${llm.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${llm.apiKey}` },
    timeout: llm.timeout,
    validateStatus: (status) => status >= 200 && status < 500,
  }));
  if (res.status < 200 || res.status >= 300) {
    const detail = res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message);
    throw new Error(detail || `模型列表请求失败 (${res.status})`);
  }
  const raw = Array.isArray(res.data && res.data.data) ? res.data.data : [];
  return raw
    .map((item) => String(item && item.id || '').trim())
    .filter(Boolean)
    .slice(0, 200);
};

const loadProblemContext = async (pid) => {
  const row = await db.one(
    'SELECT pid,title,description,timeLimit,memoryLimit,tags,level FROM problem WHERE pid=?',
    [pid]
  );
  if (!row) return null;
  try {
    row.tags = JSON.parse(row.tags || '[]');
  } catch (_) {
    row.tags = [];
  }
  const sampleRow = await db.one('SELECT samples FROM problemSample WHERE pid=?', [pid]).catch(() => null);
  try {
    row.samples = sampleRow ? JSON.parse(sampleRow.samples || '[]') : [];
  } catch (_) {
    row.samples = [];
  }
  return row;
};

const assertManage = async (req, res, pid) => {
  const auth = await problemAuth(req, pid);
  if (!auth.manage) {
    res.status(403).end('403 Forbidden');
    return null;
  }
  return auth;
};

const draftSectionKeys = (draft) => {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return [];
  return DRAFT_SECTIONS.filter((key) => Object.prototype.hasOwnProperty.call(draft, key));
};

const parsedSectionKeys = (sections) => {
  const raw = sections instanceof Set ? [...sections] : Array.isArray(sections) ? sections : [];
  const allowed = new Set(DRAFT_SECTIONS);
  return raw.map((key) => String(key || '').trim()).filter((key) => allowed.has(key));
};

const pickDraftSections = (draft, sections) => {
  const keys = parsedSectionKeys(sections);
  if (!draft || !keys.length) return null;
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(draft, key)) out[key] = draft[key];
  }
  return Object.keys(out).length ? out : null;
};

const snapshotDraftForJob = (job) => {
  const keys = parsedSectionKeys(job && job.parsedSections);
  return pickDraftSections(job && job.draft, keys);
};

const isTerminalJobStatus = (status) => status === 'done' || status === 'done_with_warning' || status === 'error' || status === 'cancelled';

const persistedDraftForJob = (job) => {
  if (job && job.baseDraft && isTerminalJobStatus(job.status) && job.draft && draftHasPreviewContent(job.draft)) {
    return job.draft;
  }
  return snapshotDraftForJob(job);
};

const publicJobSnapshot = (job) => {
  const draft = snapshotDraftForJob(job);
  const sections = draftSectionKeys(draft);
  return {
    jobId: job.id,
    pid: job.pid,
    status: job.status,
    statusText: job.statusText || '',
    model: job.model,
    sections: job.sections,
    prompt: cleanText(job.prompt || '', MAX_PROMPT_BYTES),
    draft,
    parsedSections: sections,
    startedSections: Array.isArray(job.startedSections) ? job.startedSections : [],
    plan: Array.isArray(job.plan) ? job.plan : [],
    reasoning: cleanText(job.reasoning || '', PREVIEW_REASONING_BYTES),
    summary: cleanText(job.summary || '', MAX_SUMMARY_BYTES),
    checks: Array.isArray(job.checks) ? job.checks : [],
    repairRound: job.repairRound || 0,
    error: job.error || '',
    warning: job.warning || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    seq: job.seq || 0,
  };
};

const persistPreview = async (job) => {
  await ensureAiPreviewSchema();
  const draft = persistedDraftForJob(job);
  await db.query(
    'INSERT INTO problemAiPreview(uid,pid,jobId,status,model,sections,prompt,draft,reasoning,summary,checks,error,createTime,updateTime) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
      'ON DUPLICATE KEY UPDATE jobId=VALUES(jobId),status=VALUES(status),model=VALUES(model),sections=VALUES(sections),' +
      'prompt=VALUES(prompt),draft=VALUES(draft),reasoning=VALUES(reasoning),summary=VALUES(summary),checks=VALUES(checks),' +
      'error=VALUES(error),updateTime=VALUES(updateTime)',
    [
      job.uid,
      job.pid,
      job.id,
      job.status,
      job.model || '',
      JSON.stringify(job.sections || []),
      cleanText(job.prompt || '', MAX_PROMPT_BYTES),
      draft ? JSON.stringify(draft) : null,
      cleanText(job.reasoning || '', PREVIEW_REASONING_BYTES),
      cleanText(job.summary || '', MAX_SUMMARY_BYTES) || null,
      Array.isArray(job.checks) && job.checks.length ? JSON.stringify(job.checks) : null,
      job.error || job.warning || null,
      new Date(job.createdAt),
      new Date(job.updatedAt),
    ]
  );
};

const publishJob = (job, event = 'update') => {
  job.updatedAt = Date.now();
  job.seq = (job.seq || 0) + 1;
  const snapshot = publicJobSnapshot(job);
  for (const client of [...job.clients]) {
    if (client.writableEnded || client.destroyed) {
      job.clients.delete(client);
      continue;
    }
    writeSse(client, event, snapshot);
  }
};

const updateJob = (job, patch = {}, event = 'update') => {
  Object.assign(job, patch);
  publishJob(job, event);
};

const cleanupOldJobs = () => {
  const now = Date.now();
  for (const [id, job] of aiJobs.entries()) {
    if (job.status === 'running' || job.status === 'queued') continue;
    if (now - job.updatedAt < JOB_TTL_MS) continue;
    aiJobs.delete(id);
  }
};

const cleanupOldDataSaveSessions = () => {
  const now = Date.now();
  for (const [id, session] of dataSaveSessions.entries()) {
    if (now - session.updatedAt < DATA_SAVE_TTL_MS) continue;
    dataSaveSessions.delete(id);
  }
};

const getDataSaveSession = (req, res, pid) => {
  const body = req.body || {};
  const sessionId = cleanString(body.sessionId || body.saveId, 100);
  const session = dataSaveSessions.get(sessionId);
  if (!session || session.pid !== pid || session.uid !== req.session.uid) {
    fail(res, '保存会话不存在或已过期，请重新保存');
    return null;
  }
  session.updatedAt = Date.now();
  return session;
};

const uploadedCaseText = (req, field, fallback) => {
  const files = req.files && req.files[field];
  const file = Array.isArray(files) ? files[0] : null;
  if (file && file.buffer) return file.buffer.toString('utf-8');
  return String(fallback == null ? '' : fallback);
};

exports.saveDataCaseUpload = (req, res, next) => {
  dataCaseUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return fail(res, `测试点单个输入或输出超过 ${Math.round(MAX_CHUNKED_CASE_BYTES / 1024 / 1024)}MB`);
    }
    if (err.code && String(err.code).startsWith('LIMIT_')) {
      return fail(res, '测试点上传内容过大或字段数量过多');
    }
    return next(err);
  });
};

const isActiveJobStatus = (status) => status === 'queued' || status === 'running';

const draftHasPreviewContent = (draft) => {
  if (!draft || typeof draft !== 'object') return false;
  const statement = draft.statement || {};
  const std = draft.std || {};
  const solution = draft.solution || {};
  const data = draft.data || {};
  const generation = data.generation || data.generationPlan || {};
  const judge = draft.judge || {};
  return !!(
    statement.description ||
    Array.isArray(statement.samples) && statement.samples.length ||
    std.source ||
    solution.markdown ||
    data.generator && data.generator.source ||
    Array.isArray(data.cases) && data.cases.length ||
    Array.isArray(generation.cases) && generation.cases.length ||
    judge.yaml ||
    judge.notes ||
    Array.isArray(judge.assets) && judge.assets.some((asset) => asset && asset.content)
  );
};

const problemStatementPayload = (problem = {}) => ({
  statement: {
    title: problem.title || '',
    description: problem.description || '',
    tags: Array.isArray(problem.tags) ? problem.tags : [],
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
    level: problem.level,
    samples: Array.isArray(problem.samples) ? problem.samples : [],
  },
});

const currentDraftFromRequest = (body, problem) => {
  const base = normalizeDraft(problemStatementPayload(problem), problem);
  const raw = body && (body.currentDraft || body.draftContext || body.draft);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return draftHasPreviewContent(base) ? base : null;
  const draft = normalizeDraft(raw, problem);
  const rawStatement = raw.statement && typeof raw.statement === 'object' && !Array.isArray(raw.statement)
    ? raw.statement
    : null;
  if (!rawStatement) {
    draft.statement = base.statement;
  } else {
    const hasRawDescription = Object.prototype.hasOwnProperty.call(rawStatement, 'description') ||
      Object.prototype.hasOwnProperty.call(rawStatement, 'markdown');
    if (!hasRawDescription) draft.statement.description = base.statement.description;
    if (!Array.isArray(rawStatement.samples)) draft.statement.samples = base.statement.samples;
  }
  return draftHasPreviewContent(draft) ? draft : (draftHasPreviewContent(base) ? base : null);
};

const markLostPreviewJob = async (uid, pid, jobId) => {
  await db.query(
    'UPDATE problemAiPreview SET status=?, draft=NULL, error=?, updateTime=? WHERE uid=? AND pid=? AND jobId=? AND status IN (?,?)',
    ['error', LOST_JOB_MESSAGE, new Date(), uid, pid, jobId, 'queued', 'running']
  );
};

const latestPreviewFromDb = async (uid, pid, missingJobId = '') => {
  await ensureAiPreviewSchema();
  const row = await db.one(
    'SELECT jobId,status,model,sections,prompt,draft,reasoning,summary,checks,error,createTime,updateTime FROM problemAiPreview WHERE uid=? AND pid=?',
    [uid, pid]
  );
  if (!row) return null;
  let draft = null;
  let sections = [];
  let checks = [];
  try { draft = row.draft ? JSON.parse(row.draft) : null; } catch (_) { draft = null; }
  try { sections = row.sections ? JSON.parse(row.sections) : []; } catch (_) { sections = []; }
  try { checks = row.checks ? JSON.parse(row.checks) : []; } catch (_) { checks = []; }
  let status = row.status;
  let storedMessage = row.error || '';
  let updatedAt = row.updateTime ? new Date(row.updateTime).getTime() : 0;
  const missingRequestedJob = missingJobId && row.jobId === missingJobId;
  const missingFromCurrentProcess = isActiveJobStatus(status) && (
    missingRequestedJob ||
    !updatedAt ||
    updatedAt < PROCESS_STARTED_AT ||
    Date.now() - updatedAt > LOST_JOB_GRACE_MS
  );
  const lostActiveJob = missingFromCurrentProcess;
  if (lostActiveJob) {
    status = 'error';
    storedMessage = LOST_JOB_MESSAGE;
    draft = null;
    updatedAt = Date.now();
    await markLostPreviewJob(uid, pid, row.jobId).catch((err) => {
      console.error('mark lost LLM job failed:', err && err.stack ? err.stack : err);
    });
  }
  const recoveredMatch = storedMessage.match(/^模型完整 JSON 校验失败，已保留可解析的预览字段：(.+)$/);
  const recoveredSections = recoveredMatch
    ? recoveredMatch[1].split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean)
    : [];
  const recoveredComplete = recoveredSections.length && parsedSectionsCover(recoveredSections, sections);
  if (recoveredComplete) status = 'done';
  const storedSections = draftSectionKeys(draft);
  const exposeDraft = draft && storedMessage !== LOST_JOB_MESSAGE && (status !== 'error' || draftHasPreviewContent(draft));
  const statusText = status === 'cancelled'
    ? CANCELLED_JOB_MESSAGE
    : ((status === 'done' || status === 'done_with_warning') ? '已载入最近一次后台生成预览。' : '');
  return {
    jobId: row.jobId,
    pid,
    status,
    statusText,
    model: row.model,
    sections,
    prompt: row.prompt || '',
    draft: exposeDraft ? draft : null,
    parsedSections: exposeDraft ? storedSections : [],
    reasoning: row.reasoning || '',
    summary: row.summary || '',
    checks: Array.isArray(checks) ? checks : [],
    error: status === 'error' ? storedMessage : '',
    warning: status === 'done_with_warning' ? storedMessage : '',
    createdAt: row.createTime ? new Date(row.createTime).getTime() : 0,
    updatedAt,
    seq: 0,
  };
};

exports.getConfig = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (pid && !(await assertManage(req, res, pid))) return;
  const llm = await loadUserLlmConfig(req.session.uid);
  return ok(res, {
    data: {
      enabled: llm.enabled,
      hasKey: llm.hasKey,
      keyPreview: llm.keyPreview,
      model: llm.model,
      baseUrl: llm.baseUrl,
      maxPromptBytes: MAX_PROMPT_BYTES,
      maxCases: MAX_CASES,
    },
  });
});

exports.saveConfig = handler(async (req, res) => {
  const uid = req.session.uid;
  if (!uid) return res.status(403).end('403 Forbidden');
  await ensureUserLlmSchema();
  const current = await loadUserLlmConfig(uid);
  const baseUrl = normalizeBaseUrl(req.body.baseUrl || current.baseUrl);
  if (!baseUrl) return fail(res, 'Base URL 格式错误');

  const incomingKey = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : null;
  const apiKey = bool(req.body.clearApiKey) ? '' : (incomingKey !== null && incomingKey !== '' ? incomingKey : current.apiKey);
  const model = cleanString(req.body.model || current.model || DEFAULT_MODEL, 120) || DEFAULT_MODEL;
  await db.query(
    'INSERT INTO userLlmConfig(uid,baseUrl,apiKey,model,updateTime) VALUES (?,?,?,?,?) ' +
      'ON DUPLICATE KEY UPDATE baseUrl=VALUES(baseUrl),apiKey=VALUES(apiKey),model=VALUES(model),updateTime=VALUES(updateTime)',
    [uid, baseUrl, apiKey, model, new Date()]
  );
  return ok(res, {
    data: {
      enabled: !!apiKey,
      hasKey: !!apiKey,
      keyPreview: maskKey(apiKey),
      baseUrl,
      model,
      maxPromptBytes: MAX_PROMPT_BYTES,
      maxCases: MAX_CASES,
    },
  });
});

exports.listModels = handler(async (req, res) => {
  const uid = req.session.uid;
  if (!uid) return res.status(403).end('403 Forbidden');
  const llm = await llmFromRequestOrSaved(req);
  if (!llm.apiKey) return fail(res, '请先填写 LLM Key');
  const models = await listRemoteModels(llm);
  return ok(res, { data: { models, model: models.includes(llm.model) ? llm.model : (models[0] || llm.model) } });
});

exports.generate = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;

  const prompt = cleanText(req.body.prompt, MAX_PROMPT_BYTES);
  if (!prompt.trim()) return fail(res, '请输入提示词');

  const llm = await loadUserLlmConfig(req.session.uid);
  if (!llm.enabled) return fail(res, '请先配置自己的 LLM Key 和 Base URL');
  const problem = await loadProblemContext(pid);
  if (!problem) return fail(res, '题目不存在');

  const sections = parseSections(req.body.sections);
  const currentDraft = currentDraftFromRequest(req.body, problem);
  const promptHistory = normalizePromptHistory(req.body.promptHistory, prompt);
  const messages = buildMessages(prompt, sections, problem, { currentDraft, promptHistory });
  const temperature = Math.max(0, Math.min(Number(req.body.temperature || 0.35), 1.5));
  const model = cleanString(req.body.model, 120) || llm.model;

  const content = await chatCompletion(llm, { messages, temperature, model });
  const parsed = extractJson(content);
  const generatedDraft = normalizeDraft(parsed, problem);
  const outputSections = draftSectionKeys(parsed);
  const draft = currentDraft ? mergeDraftSections(currentDraft, generatedDraft, outputSections) : generatedDraft;
  recordEvent(req, 'problem.aiGenerate', { pid, sections, model });
  return ok(res, {
    data: draft,
    model,
    summary: typeof parsed.summary === 'string' ? cleanText(parsed.summary, MAX_SUMMARY_BYTES) : '',
    outputSections,
  });
});

const SECTION_LABEL = {
  statement: '题面', std: 'STD', solution: '题解', data: '数据', judge: '评测',
};

// The model's own to-do list ("plan" is the first key of the response). Shown
// live so the user watches the assistant "work through" its checklist.
const extractPlanFromRaw = (job) => {
  if (job.plan && job.plan.length) return;
  try {
    const value = extractCompleteTopLevelValue(String(job.raw || ''), 'plan');
    if (Array.isArray(value)) {
      job.plan = value.map((item) => cleanString(item, 120)).filter(Boolean).slice(0, 12);
    }
  } catch (_) {
    // plan not complete yet
  }
};

// A section counts as "writing" from the moment its top-level key shows up in
// the raw stream until it parses as complete. Inside JSON string values quotes
// are escaped (\"), so a bare "key": match is always structural.
const detectStartedSections = (job) => {
  const started = [];
  for (const key of DRAFT_SECTIONS) {
    if (job.parsedSections.has(key)) continue;
    if (new RegExp(`"${key}"\\s*:`).test(job.raw)) started.push(key);
  }
  job.startedSections = started;
};

const applyPartialDraftFromRaw = (job, problem, force = false) => {
  const now = Date.now();
  if (!force && now - (job.lastPartialAt || 0) < 350) return false;
  job.lastPartialAt = now;
  const prevPlanLen = (job.plan || []).length;
  const prevStarted = (job.startedSections || []).join(',');
  const prevSummary = job.summary || '';
  extractPlanFromRaw(job);
  if (job.parsedSections.size && !job.summary) extractSummaryFromRaw(job);
  const { payload, found } = extractCompletePayloadSections(job.raw);
  const fresh = found.filter((key) => !job.parsedSections.has(key));
  if (fresh.length) {
    job.draft = mergeNormalizedSections(job.draft, payload, problem);
    fresh.forEach((key) => job.parsedSections.add(key));
  }
  detectStartedSections(job);
  const changed = fresh.length > 0 ||
    (job.plan || []).length !== prevPlanLen ||
    (job.startedSections || []).join(',') !== prevStarted ||
    (job.summary || '') !== prevSummary;
  if (!changed) return false;
  const writing = (job.startedSections || []).map((key) => SECTION_LABEL[key] || key);
  const doneList = [...job.parsedSections].map((key) => SECTION_LABEL[key] || key);
  job.statusText = [
    doneList.length ? `已完成：${doneList.join('、')}` : '',
    writing.length ? `正在撰写：${writing[writing.length - 1]}` : '',
  ].filter(Boolean).join(' · ') || '模型正在写草稿。';
  publishJob(job);
  return true;
};

const extractSummaryFromRaw = (job) => {
  try {
    const value = extractCompleteTopLevelValue(String(job.raw || ''), 'summary');
    if (typeof value === 'string' && value.trim()) job.summary = cleanText(value, MAX_SUMMARY_BYTES);
  } catch (_) {
    // summary not complete yet
  }
};

// 解析模型完整输出并合并进 job.draft。只设置状态，不发布/不落库 ——
// 发布由 runAiJob 在自检流程结束后统一做。
const parseJobContent = (job, problem) => {
  extractPlanFromRaw(job);
  extractSummaryFromRaw(job);
  try {
    const parsed = extractJson(job.raw);
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      job.summary = cleanText(parsed.summary, MAX_SUMMARY_BYTES);
    }
    const sections = draftSectionKeys(parsed);
    if (!sections.length) {
      // 模型判断不需要改动（纯回答）：合法的对话轮次，保留原草稿。
      if (job.summary) {
        job.startedSections = [];
        job.status = 'done';
        job.statusText = '本轮没有修改草稿。';
        return;
      }
      throw new Error('模型没有返回请求的草稿字段');
    }
    const generatedDraft = normalizeDraft(parsed, problem);
    job.draft = job.baseDraft ? mergeDraftSections(job.baseDraft, generatedDraft, sections) : generatedDraft;
    job.parsedSections = new Set(sections);
    job.startedSections = [];
    job.status = 'done';
    job.statusText = '草稿已生成，可继续预览和修改。';
  } catch (err) {
    applyPartialDraftFromRaw(job, problem, true);
    if (!job.draft || !job.parsedSections.size) throw err;
    if (parsedSectionsCover(job.parsedSections, job.sections)) {
      job.status = 'done';
      job.warning = '';
      job.statusText = '草稿已生成，可继续预览和修改。';
    } else {
      job.status = 'done_with_warning';
      job.warning = `模型完整 JSON 校验失败，已保留可解析的预览字段：${[...job.parsedSections].join(', ')}`;
      job.statusText = '已从模型输出中恢复出可用预览，请检查后再保存。';
    }
  }
};

// 自检是否有可查的内容：有生成器/生成计划/评测资产/非传统评测配置才值得跑 sandbox。
const draftNeedsSelfCheck = (draft, parsedSections) => {
  if (!draft || !parsedSections || !parsedSections.size) return false;
  const data = draft.data || {};
  const judge = draft.judge || {};
  const generation = data.generation || {};
  const touchedData = parsedSections.has('data') || parsedSections.has('std');
  const touchedJudge = parsedSections.has('judge');
  const hasDataWork = !!(data.generator && data.generator.source && data.generator.source.trim()) ||
    (Array.isArray(generation.cases) && generation.cases.length > 0);
  const hasJudgeWork = (Array.isArray(judge.assets) && judge.assets.some((a) => a && a.content && a.content.trim())) ||
    (judge.profile && judge.preset && judge.preset !== 'traditional');
  return (touchedData && hasDataWork) || (touchedJudge && hasJudgeWork);
};

// 一轮修复调用：把自检报告喂回模型，只重写有问题的 section。
// 与首轮不同，修复轮不做逐 token 局部渲染（避免与已解析 section 的状态机打架），
// 只更新 statusText，拿到完整 JSON 后一次性合并。
const runRepairRound = async (job, args, checks) => {
  const { llm, temperature, problem } = args;
  const repairPrompt = aiPrompt.buildRepairPrompt(checks);
  const messages = buildMessages(repairPrompt, job.sections, problem, {
    currentDraft: job.draft,
    promptHistory: [...(job.promptHistory || []), job.prompt],
    mode: 'repair',
  });
  const controller = new AbortController();
  job.controller = controller;
  let received = 0;
  const content = await chatCompletionStream(llm, {
    messages,
    temperature,
    model: job.model,
    controller,
  }, {
    onToken: (text) => {
      received += text.length;
      if (received % 2000 < text.length) {
        updateJob(job, { statusText: `模型正在修复自检问题（已输出 ${Math.round(received / 1000)}k 字符）…` });
      }
    },
    onReasoning: () => {},
    onStatus: () => {},
  });
  if (job.status === 'cancelled' || controller.signal.aborted) throw new Error(CANCELLED_JOB_MESSAGE);
  let parsed;
  try {
    parsed = extractJson(content);
  } catch (err) {
    // 修复轮的输出偶尔会提前闭合根对象；逐 section 恢复能拿回可用的部分。
    const { payload, found } = extractCompletePayloadSections(content);
    if (!found.length) throw err;
    parsed = payload;
  }
  if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
    job.summary = cleanText(parsed.summary, MAX_SUMMARY_BYTES);
  }
  const sections = draftSectionKeys(parsed);
  if (sections.length) {
    const payload = {};
    for (const key of sections) payload[key] = parsed[key];
    job.draft = mergeNormalizedSections(job.draft, payload, problem);
    sections.forEach((key) => job.parsedSections.add(key));
  }
  return sections;
};

// 生成完成后的自动体检：编译 STD/生成器/评测资产、试造数据、校验评测配置。
// 失败最多回喂模型修复 MAX_REPAIR_ROUNDS 轮；仍失败则降级为 done_with_warning，
// 让用户带着自检报告手动处理。sandbox 不可用时静默跳过（不影响出稿）。
const selfCheckAndRepair = async (job, args) => {
  const { problem } = args;
  if (!draftNeedsSelfCheck(job.draft, job.parsedSections)) return;
  const finalStatus = { status: job.status, warning: job.warning, statusText: job.statusText };
  job.status = 'running';
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    if (job.cancelRequested) return;
    job.repairRound = round;
    updateJob(job, { statusText: round ? `修复后复检（第 ${round}/${MAX_REPAIR_ROUNDS} 轮）…` : '正在自检：真实编译并试造数据…' });
    let result;
    try {
      result = await runDraftChecks(job.draft, [...job.parsedSections], (text) => updateJob(job, { statusText: text }));
    } catch (err) {
      // sandbox 挂了不拦路：跳过体检，如实告知。
      job.checks = [{ id: 'selfcheck', label: '自动自检', status: 'skip', detail: `自检服务不可用：${err.message}` }];
      publishJob(job);
      break;
    }
    job.checks = result.checks;
    publishJob(job);
    if (result.ok) {
      if (round > 0) {
        finalStatus.statusText = '自检问题已修复，草稿可继续预览和修改。';
      }
      break;
    }
    if (round === MAX_REPAIR_ROUNDS) {
      const failed = result.checks.filter((c) => c.status === 'fail').map((c) => c.label);
      finalStatus.status = 'done_with_warning';
      finalStatus.warning = `自检未全部通过（${failed.join('、')}），已尝试自动修复 ${MAX_REPAIR_ROUNDS} 轮。详情见自检报告，可让 AI 继续修或手动调整。`;
      finalStatus.statusText = '草稿已生成，但自检发现遗留问题。';
      break;
    }
    if (job.cancelRequested) return;
    updateJob(job, { statusText: `自检发现问题，正在让模型修复（第 ${round + 1}/${MAX_REPAIR_ROUNDS} 轮）…` });
    try {
      await runRepairRound(job, args, result.checks);
    } catch (err) {
      if (job.cancelRequested || (err && err.message === CANCELLED_JOB_MESSAGE)) return;
      const failed = result.checks.filter((c) => c.status === 'fail').map((c) => c.label);
      finalStatus.status = 'done_with_warning';
      finalStatus.warning = `自检未通过（${failed.join('、')}），自动修复时出错：${err.message}`;
      finalStatus.statusText = '草稿已生成，但自检发现遗留问题。';
      break;
    }
  }
  job.status = finalStatus.status;
  job.warning = finalStatus.warning;
  job.statusText = finalStatus.statusText;
};

const runAiJob = async (job, args) => {
  const { llm, messages, temperature, problem } = args;
  if (job.status === 'cancelled') return;
  const controller = new AbortController();
  job.controller = controller;
  try {
    updateJob(job, { status: 'running', statusText: '后台任务已启动，正在连接模型。' });
    let sawReasoning = false;
    let rawStarted = false;
    await chatCompletionStream(llm, {
      messages,
      temperature,
      model: job.model,
      controller,
    }, {
      onStatus: (text) => updateJob(job, { statusText: text }),
      onReasoning: (text) => {
        if (job.status === 'cancelled' || controller.signal.aborted) return;
        sawReasoning = true;
        job.reasoning = cleanText(`${job.reasoning || ''}${text}`, PREVIEW_REASONING_BYTES);
        updateJob(job, { statusText: '模型正在生成可见推理/计划。' });
      },
      onToken: (text) => {
        if (job.status === 'cancelled' || controller.signal.aborted) return;
        job.raw += text;
        if (!rawStarted) {
          rawStarted = true;
          job.statusText = sawReasoning ? '模型正在写草稿。' : '模型未返回独立思考流，正在写草稿。';
          publishJob(job);
        }
        applyPartialDraftFromRaw(job, problem);
      },
    });
    if (job.status === 'cancelled' || controller.signal.aborted) throw new Error(CANCELLED_JOB_MESSAGE);
    updateJob(job, { statusText: '模型输出完成，正在整理预览草稿。' });
    parseJobContent(job, problem);
    publishJob(job);
    await selfCheckAndRepair(job, args);
    if (job.cancelRequested || job.status === 'cancelled') throw new Error(CANCELLED_JOB_MESSAGE);
    publishJob(job, 'done');
    await persistPreview(job);
    recordEvent(job.req, 'problem.aiGenerate', { pid: job.pid, sections: job.sections, model: job.model, background: true });
  } catch (err) {
    if (job.cancelRequested || job.status === 'cancelled' || controller.signal.aborted) {
      applyPartialDraftFromRaw(job, problem, true);
      job.status = 'cancelled';
      job.error = '';
      job.warning = '';
      job.startedSections = [];
      job.statusText = CANCELLED_JOB_MESSAGE;
      publishJob(job, 'done');
      await persistPreview(job).catch(() => {});
      return;
    }
    const message = err && err.message ? err.message : String(err);
    job.status = 'error';
    job.error = message;
    job.statusText = '生成失败';
    publishJob(job, 'error');
    await persistPreview(job).catch(() => {});
    console.error('LLM background job error:', err && err.stack ? err.stack : err);
  } finally {
    delete job.controller;
  }
};

exports.startGenerate = handler(async (req, res) => {
  cleanupOldJobs();
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;

  const prompt = cleanText(req.body.prompt, MAX_PROMPT_BYTES);
  if (!prompt.trim()) return fail(res, '请输入提示词');

  const llm = await loadUserLlmConfig(req.session.uid);
  if (!llm.enabled) return fail(res, '请先配置自己的 LLM Key 和 Base URL');
  const problem = await loadProblemContext(pid);
  if (!problem) return fail(res, '题目不存在');

  const sections = parseSections(req.body.sections);
  const currentDraft = currentDraftFromRequest(req.body, problem);
  const promptHistory = normalizePromptHistory(req.body.promptHistory, prompt);
  const messages = buildMessages(prompt, sections, problem, { currentDraft, promptHistory });
  const temperature = Math.max(0, Math.min(Number(req.body.temperature || 0.35), 1.5));
  const model = cleanString(req.body.model, 120) || llm.model;
  const now = Date.now();
  const id = crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
  const job = {
    id,
    uid: req.session.uid,
    pid,
    status: 'queued',
    statusText: '任务已进入后台队列。',
    model,
    sections,
    prompt,
    draft: currentDraft ? cloneJson(currentDraft) : null,
    baseDraft: currentDraft ? cloneJson(currentDraft) : null,
    parsedSections: new Set(),
    startedSections: [],
    plan: [],
    reasoning: '',
    summary: '',
    checks: [],
    repairRound: 0,
    cancelRequested: false,
    promptHistory,
    raw: '',
    error: '',
    warning: '',
    clients: new Set(),
    createdAt: now,
    updatedAt: now,
    seq: 0,
    req,
  };
  aiJobs.set(id, job);
  latestJobByUserProblem.set(jobKey(job.uid, pid), id);
  await persistPreview(job);
  setImmediate(() => runAiJob(job, { llm, messages, temperature, problem }));
  return ok(res, { data: publicJobSnapshot(job) });
});

exports.getGeneration = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (pid && !(await assertManage(req, res, pid))) return;
  const id = cleanString(req.body.jobId || (pid ? latestJobByUserProblem.get(jobKey(req.session.uid, pid)) : ''), 80);
  if (id && aiJobs.has(id)) {
    const job = aiJobs.get(id);
    if (job.uid !== req.session.uid) return res.status(403).end('403 Forbidden');
    if (!pid && !(await assertManage(req, res, job.pid))) return;
    return ok(res, { data: publicJobSnapshot(job) });
  }
  if (pid) return ok(res, { data: await latestPreviewFromDb(req.session.uid, pid, id) });
  return ok(res, { data: null });
});

exports.cancelGeneration = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (pid && !(await assertManage(req, res, pid))) return;
  const id = cleanString(req.body.jobId || (pid ? latestJobByUserProblem.get(jobKey(req.session.uid, pid)) : ''), 80);
  if (!id) return fail(res, 'expect jobId');
  const job = aiJobs.get(id);
  if (!job) {
    if (pid) return ok(res, { data: await latestPreviewFromDb(req.session.uid, pid, id) });
    return fail(res, '任务不存在或已过期', 404);
  }
  if (job.uid !== req.session.uid) return res.status(403).end('403 Forbidden');
  if (!pid && !(await assertManage(req, res, job.pid))) return;
  if (!isActiveJobStatus(job.status)) return ok(res, { data: publicJobSnapshot(job) });
  const problem = await loadProblemContext(job.pid).catch(() => null);
  if (problem) applyPartialDraftFromRaw(job, problem, true);
  job.cancelRequested = true;
  job.status = 'cancelled';
  job.statusText = CANCELLED_JOB_MESSAGE;
  job.error = '';
  job.warning = '';
  job.startedSections = [];
  if (job.controller) {
    try { job.controller.abort(); } catch (_) { /* best effort */ }
  }
  publishJob(job, 'done');
  await persistPreview(job).catch(() => {});
  return ok(res, { data: publicJobSnapshot(job) });
});

exports.streamGeneration = async (req, res) => {
  try {
    const id = cleanString(req.query.jobId, 80);
    const job = aiJobs.get(id);
    if (!job) return fail(res, '任务不存在或已过期', 404);
    if (job.uid !== req.session.uid) return res.status(403).end('403 Forbidden');
    if (!(await assertManage(req, res, job.pid))) return;
    req.setTimeout(0);
    res.setTimeout(0);
    if (res.socket) res.socket.setKeepAlive(true, 15000);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    job.clients.add(res);
    writeSse(res, 'snapshot', publicJobSnapshot(job));
    const heartbeat = setInterval(() => writeSse(res, 'ping', { time: Date.now() }), 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      job.clients.delete(res);
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (res.headersSent) {
      writeSse(res, 'error', { message });
      if (!res.writableEnded && !res.destroyed) res.end();
    } else {
      fail(res, message);
    }
  }
};

const generateStreamImpl = async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;

  const prompt = cleanText(req.body.prompt, MAX_PROMPT_BYTES);
  if (!prompt.trim()) return fail(res, '请输入提示词');

  const llm = await loadUserLlmConfig(req.session.uid);
  if (!llm.enabled) return fail(res, '请先配置自己的 LLM Key 和 Base URL');
  const problem = await loadProblemContext(pid);
  if (!problem) return fail(res, '题目不存在');

  const sections = parseSections(req.body.sections);
  const currentDraft = currentDraftFromRequest(req.body, problem);
  const promptHistory = normalizePromptHistory(req.body.promptHistory, prompt);
  const messages = buildMessages(prompt, sections, problem, { currentDraft, promptHistory });
  const temperature = Math.max(0, Math.min(Number(req.body.temperature || 0.35), 1.5));
  const model = cleanString(req.body.model, 120) || llm.model;

  req.setTimeout(0);
  res.setTimeout(0);
  if (res.socket) res.socket.setKeepAlive(true, 15000);
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const controller = new AbortController();
  const heartbeat = setInterval(() => writeSse(res, 'ping', { time: Date.now() }), 15000);
  req.on('close', () => controller.abort());

  const finish = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded && !res.destroyed) res.end();
  };

  try {
    writeSse(res, 'meta', { model, sections, maxTokens: llm.maxTokens });
    writeSse(res, 'status', { text: '已连接模型，开始流式生成。' });
    let sawReasoning = false;
    let tokenBytes = 0;
    const content = await chatCompletionStream(llm, {
      messages,
      temperature,
      model,
      controller,
    }, {
      onStatus: (text) => writeSse(res, 'status', { text }),
      onReasoning: (text) => {
        sawReasoning = true;
        writeSse(res, 'reasoning', { text });
      },
      onToken: (text) => {
        tokenBytes += byteLen(text);
        if (!sawReasoning && tokenBytes === byteLen(text)) {
          writeSse(res, 'status', { text: '模型未返回独立思考流，正在实时输出正文。' });
        }
        writeSse(res, 'token', { text });
      },
    });

    writeSse(res, 'status', { text: '模型输出完成，正在解析 JSON 草稿。' });
    const parsed = extractJson(content);
    const generatedDraft = normalizeDraft(parsed, problem);
    const outputSections = draftSectionKeys(parsed);
    const draft = currentDraft ? mergeDraftSections(currentDraft, generatedDraft, outputSections) : generatedDraft;
    recordEvent(req, 'problem.aiGenerate', { pid, sections, model, stream: true });
    writeSse(res, 'draft', { data: draft, model });
    writeSse(res, 'done', { ok: true });
  } catch (err) {
    if (controller.signal.aborted && (res.writableEnded || res.destroyed)) return finish();
    const message = err && err.message ? err.message : String(err);
    console.error('LLM stream error:', err && err.stack ? err.stack : err);
    writeSse(res, 'error', { message });
  } finally {
    finish();
  }
};

exports.generateStream = (req, res) => {
  generateStreamImpl(req, res).catch((err) => {
    const message = err && err.sqlMessage ? err.sqlMessage : err && err.message ? err.message : String(err);
    console.error('LLM stream handler error:', err && err.stack ? err.stack : err);
    if (res.headersSent) {
      writeSse(res, 'error', { message });
      if (!res.writableEnded && !res.destroyed) res.end();
      return;
    }
    fail(res, message);
  });
};

exports.saveStd = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;
  const std = normalizeCodeBlock(req.body.std || {}, 'std');
  if (!std.source.trim()) return fail(res, 'STD 内容为空');
  if (byteLen(std.source) > MAX_SOURCE_BYTES) return fail(res, 'STD 内容过大');
  const name = sanitizeAssetName(std.fileName, 'std.cpp');
  await setFile(`./data/${pid}/assets/${name}`, std.source);
  await storage.mirrorProblemData(pid, dataDirOf(pid));
  recordEvent(req, 'problem.aiSaveStd', { pid, name });
  return ok(res, { name });
});

exports.saveSolution = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  const auth = await problemAuth(req, pid);
  if (!auth.solutionManage) return res.status(403).end('403 Forbidden');
  const solution = req.body.solution || {};
  const markdown = cleanText(solution.markdown || solution.content, MAX_SOLUTION_BYTES);
  if (!markdown.trim()) return fail(res, '题解内容为空');
  const problem = await db.one('SELECT title FROM problem WHERE pid=?', [pid]);
  if (!problem) return fail(res, '题目不存在');
  const mark = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const title = (cleanString(solution.title, 20) || `P${pid} 题解`).slice(0, 20);
  await db.tx(async (t) => {
    await t.query(
      'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,?,0)',
      [mark, title, markdown, req.session.uid, new Date()]
    );
    await t.query('INSERT INTO problemSolution(pid,mark) VALUES (?,?)', [pid, mark]);
  });
  recordEvent(req, 'problem.aiSaveSolution', { pid, mark, title });
  return ok(res, { mark, title });
});

const previewCaseText = (value, maxBytes = 4096) => {
  const text = String(value || '');
  const bytes = byteLen(text);
  if (bytes <= maxBytes) return { content: text, bytes, truncated: false };
  return {
    content: `${Buffer.from(text, 'utf-8').subarray(0, maxBytes).toString('utf-8')}\n...(truncated)`,
    bytes,
    truncated: true,
  };
};

const summarizeGeneratedCases = (cases) => {
  let totalBytes = 0;
  const rows = cases.map((item, index) => {
    const input = previewCaseText(item.input);
    const output = previewCaseText(item.output);
    totalBytes += input.bytes + output.bytes;
    return {
      index: index + 1,
      name: item.name || String(index + 1),
      subtaskId: item.subtaskId || 1,
      input,
      output,
    };
  });
  return { rows, totalBytes };
};

const dataConfigForCases = (data, caseMeta) => {
  const cases = caseMeta.map((item, index) => {
    const input = `ai/${item.name}.in`;
    const output = `ai/${item.name}.out`;
    return { index: index + 1, input, output, subtaskId: item.subtaskId || 1 };
  });
  const usedSubtasks = new Set(cases.map((item) => Number(item.subtaskId)));
  const subtasks = data.subtasks.filter((item) => usedSubtasks.has(Number(item.index)));
  if (!subtasks.length) subtasks.push({ index: 1, score: 100, option: 0, skip: false, dependencies: [] });
  const score = subtasks.reduce((sum, item) => sum + Number(item.score || 0), 0);
  if (score !== 100) {
    subtasks.splice(0, subtasks.length, { index: 1, score: 100, option: 0, skip: false, dependencies: [] });
    cases.forEach((item) => { item.subtaskId = 1; });
  }
  return { cases, subtasks };
};

const finishDataFiles = async (pid, data, caseMeta) => {
  const dir = dataDirOf(pid);
  const { cases, subtasks } = dataConfigForCases(data, caseMeta);
  await setFile(`./data/${pid}/config.json`, JSON.stringify({ cases, subtask: subtasks }, null, 2));
  const previewPath = path.join(dir, 'preview.json');
  if (fs.existsSync(previewPath)) fs.rmSync(previewPath, { force: true });

  let generatorSaved = null;
  if (data.generator && data.generator.source && data.generator.source.trim()) {
    generatorSaved = sanitizeAssetName(data.generator.fileName, 'ai-generator.cpp');
    await setFile(`./data/${pid}/assets/${generatorSaved}`, data.generator.source);
  }
  await storage.mirrorProblemData(pid, dir);
  return { cases, subtasks, generatorSaved };
};

exports.previewData = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;
  const data = normalizeDataDraft(req.body.data || req.body.dataDraft || {});
  const std = normalizeCodeBlock(req.body.std || req.body.stdDraft || {}, 'std');
  const generatedCases = data.generation && data.generation.cases && data.generation.cases.length
    ? await buildSandboxGeneratedCases(data, std)
    : null;
  const dataCases = generatedCases || data.cases;
  if (!dataCases.length) return fail(res, '测试数据为空，请提供静态 Case 或在线生成计划');
  const summary = summarizeGeneratedCases(dataCases);
  recordEvent(req, 'problem.aiPreviewData', { pid, cases: dataCases.length, sandboxGenerated: !!generatedCases });
  return ok(res, {
    data: {
      cases: summary.rows,
      totalBytes: summary.totalBytes,
      sandboxGenerated: !!generatedCases,
      generatorSaved: false,
    },
  });
});

exports.saveData = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;
  const data = normalizeDataDraft(req.body.data || req.body.dataDraft || {});
  const std = normalizeCodeBlock(req.body.std || req.body.stdDraft || {}, 'std');
  const generatedCases = data.generation && data.generation.cases && data.generation.cases.length
    ? await buildSandboxGeneratedCases(data, std)
    : null;
  const dataCases = generatedCases || data.cases;
  if (!dataCases.length) return fail(res, '测试数据为空，请提供静态 Case 或在线生成计划');
  const dir = dataDirOf(pid);
  const aiDir = path.join(dir, 'ai');
  fs.mkdirSync(aiDir, { recursive: true });
  const hasConfig = fs.existsSync(path.join(dir, 'config.json'));
  if (hasConfig && !bool(req.body.confirmReplace)) return fail(res, '测试数据已存在，请确认覆盖');

  fs.rmSync(aiDir, { recursive: true, force: true });
  fs.mkdirSync(aiDir, { recursive: true });

  const caseMeta = dataCases.map((item, index) => ({
    index: index + 1,
    name: item.name,
    subtaskId: item.subtaskId || 1,
  }));
  const { cases } = dataConfigForCases(data, caseMeta);
  for (let i = 0; i < dataCases.length; i++) {
    await setFile(`./data/${pid}/${cases[i].input}`, dataCases[i].input);
    await setFile(`./data/${pid}/${cases[i].output}`, dataCases[i].output);
  }
  const result = await finishDataFiles(pid, data, caseMeta);
  recordEvent(req, 'problem.aiSaveData', {
    pid,
    cases: result.cases.length,
    generatorSaved: result.generatorSaved,
    sandboxGenerated: !!generatedCases,
  });
  return ok(res, {
    cases: result.cases,
    subtask: result.subtasks,
    generatorSaved: result.generatorSaved,
    sandboxGenerated: !!generatedCases,
  });
});

exports.startDataSave = handler(async (req, res) => {
  cleanupOldDataSaveSessions();
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;

  const data = normalizeDataSaveMeta(req.body.data || req.body.dataDraft || {});
  if (!data.cases.length) return fail(res, '测试数据为空，请提供静态 Case');

  const dir = dataDirOf(pid);
  const aiDir = path.join(dir, 'ai');
  fs.mkdirSync(dir, { recursive: true });
  const hasConfig = fs.existsSync(path.join(dir, 'config.json'));
  if (hasConfig && !bool(req.body.confirmReplace)) return fail(res, '测试数据已存在，请确认覆盖');

  fs.rmSync(aiDir, { recursive: true, force: true });
  fs.mkdirSync(aiDir, { recursive: true });

  const now = Date.now();
  const id = crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
  dataSaveSessions.set(id, {
    id,
    uid: req.session.uid,
    pid,
    data,
    written: new Array(data.cases.length).fill(false),
    caseBytes: new Array(data.cases.length).fill(0),
    totalBytes: 0,
    createdAt: now,
    updatedAt: now,
  });
  recordEvent(req, 'problem.aiStartDataSave', { pid, cases: data.cases.length });
  return ok(res, {
    sessionId: id,
    cases: data.cases.map((item) => ({ index: item.index, name: item.name, subtaskId: item.subtaskId })),
    total: data.cases.length,
  });
});

exports.saveDataCase = handler(async (req, res) => {
  cleanupOldDataSaveSessions();
  const body = req.body || {};
  const pid = Number(body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;

  const session = getDataSaveSession(req, res, pid);
  if (!session) return;
  const index = Number(body.index || 0);
  if (!Number.isInteger(index) || index < 1 || index > session.data.cases.length) {
    return fail(res, '测试点编号非法');
  }
  const item = session.data.cases[index - 1];
  const input = uploadedCaseText(req, 'input', body.input).replace(/\r\n/g, '\n');
  const output = uploadedCaseText(req, 'output', body.output).replace(/\r\n/g, '\n');
  if (!input.trim() && !output.trim()) return fail(res, `测试点 ${item.name} 为空`);

  const inputBytes = byteLen(input);
  const outputBytes = byteLen(output);
  if (inputBytes > MAX_CHUNKED_CASE_BYTES || outputBytes > MAX_CHUNKED_CASE_BYTES) {
    return fail(res, `测试点 ${item.name} 单个输入或输出超过 ${Math.round(MAX_CHUNKED_CASE_BYTES / 1024 / 1024)}MB`);
  }
  const bytes = inputBytes + outputBytes;
  const nextTotal = session.totalBytes - Number(session.caseBytes[index - 1] || 0) + bytes;
  if (nextTotal > MAX_CHUNKED_TOTAL_BYTES) {
    return fail(res, `静态测试数据总量超过 ${Math.round(MAX_CHUNKED_TOTAL_BYTES / 1024 / 1024)}MB`);
  }

  await setFile(`./data/${pid}/ai/${item.name}.in`, input);
  await setFile(`./data/${pid}/ai/${item.name}.out`, output);
  session.caseBytes[index - 1] = bytes;
  session.totalBytes = nextTotal;
  session.written[index - 1] = true;
  const written = session.written.filter(Boolean).length;
  return ok(res, { index, name: item.name, written, total: session.data.cases.length, totalBytes: session.totalBytes });
});

exports.finishDataSave = handler(async (req, res) => {
  cleanupOldDataSaveSessions();
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;

  const session = getDataSaveSession(req, res, pid);
  if (!session) return;
  const missing = session.written
    .map((written, index) => written ? null : session.data.cases[index].name)
    .filter(Boolean);
  if (missing.length) return fail(res, `仍有测试点未写入：${missing.slice(0, 8).join('、')}`);

  const result = await finishDataFiles(pid, session.data, session.data.cases);
  dataSaveSessions.delete(session.id);
  recordEvent(req, 'problem.aiFinishDataSave', {
    pid,
    cases: result.cases.length,
    totalBytes: session.totalBytes,
    generatorSaved: result.generatorSaved,
  });
  return ok(res, {
    cases: result.cases,
    subtask: result.subtasks,
    generatorSaved: result.generatorSaved,
    sandboxGenerated: false,
    totalBytes: session.totalBytes,
  });
});

exports.saveJudge = handler(async (req, res) => {
  const pid = Number(req.body.pid || 0);
  if (!pid) return fail(res, 'expect pid');
  if (!(await assertManage(req, res, pid))) return;

  const raw = req.body.judge || {
    preset: req.body.preset,
    profile: req.body.profile,
    assets: req.body.assets,
    notes: req.body.notes,
  };
  const judge = normalizeJudgeDraft(raw);
  let profile = judge.profile;
  if (judge.yaml && judge.yaml.trim()) {
    try {
      profile = cloneProfile(parseJudgeYamlProfile(judge.yaml), judge.preset);
    } catch (err) {
      return fail(res, `YAML 解析失败: ${err.message}`);
    }
  }
  if (!profile) return fail(res, '评测配置为空或过大');

  const { validateProfile, presetToType } = require('./judgeProfile');
  const { ok: valid, errors } = validateProfile(profile);
  if (!valid) return fail(res, '配置校验失败: ' + errors.slice(0, 5).join('；'));

  const serialized = JSON.stringify(profile);
  if (byteLen(serialized) > MAX_PROFILE_BYTES) return fail(res, '配置过大');
  const yamlText = profileToYaml(profile);
  if (!yamlText.trim()) return fail(res, 'YAML 生成失败');

  const assetContentByName = new Map();
  for (const asset of judge.assets) {
    assetContentByName.set(asset.name, asset.content || '');
  }
  const missingDeclaredAssets = [];
  const declaredAssets = Array.isArray(profile.assets) ? profile.assets : [];
  for (const asset of declaredAssets) {
    const name = sanitizeAssetName(asset && (asset.name || asset.fileName), '');
    if (!name) continue;
    const incoming = assetContentByName.get(name);
    if (incoming && incoming.trim()) continue;
    const existing = await getFile(judgeAssetRel(pid, name)).catch(() => '');
    if (!existing || !String(existing).trim()) missingDeclaredAssets.push(name);
  }
  if (missingDeclaredAssets.length) {
    return fail(res, `评测资产缺少内容：${missingDeclaredAssets.join('、')}。请让 AI 补全或手动填写后再保存。`);
  }

  const savedAssets = [];
  for (const asset of judge.assets) {
    if (!asset.content || !asset.content.trim()) continue;
    await setFile(judgeAssetRel(pid, asset.name), asset.content);
    savedAssets.push(asset.name);
  }
  await setFile(`./data/${pid}/${PROFILE_YAML_FILE}`, yamlText);

  const type = presetToType(profile);
  const result = await db.query('UPDATE problem SET judgeProfile=?, type=? WHERE pid=?', [serialized, type, pid]);
  if (!result.affectedRows) return fail(res, '题目不存在或更新失败');

  await storage.mirrorProblemData(pid, dataDirOf(pid));
  recordEvent(req, 'problem.aiSaveJudge', { pid, preset: profile.preset, assets: savedAssets, yaml: PROFILE_YAML_FILE });
  return ok(res, { data: { typeId: type, savedAssets, savedYaml: PROFILE_YAML_FILE, yaml: yamlText } });
});

// 供测试脚本复用线上同款逻辑（scripts/aiAssistantE2E.js），不属于 HTTP API。
exports._internals = {
  buildMessages,
  extractJson,
  extractCompletePayloadSections,
  normalizeDraft,
  mergeDraftSections,
  draftSectionKeys,
  chatCompletionStream,
  loadUserLlmConfig,
};
