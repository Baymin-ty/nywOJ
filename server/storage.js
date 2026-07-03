const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const compressing = require('compressing');

const config = require('./config.json');

const storageConfig = config.STORAGE || {};
const s3Config = storageConfig.s3 || storageConfig.S3 || {};
const provider = String(storageConfig.provider || storageConfig.type || 'local').toLowerCase();
const localRoot = path.resolve(__dirname, storageConfig.localRoot || storageConfig.root || '.');
const defaultTtl = Number(storageConfig.signedUrlTTL || storageConfig.SIGNED_URL_TTL || 15 * 60);
const archivePrefix = String(storageConfig.problemArchivePrefix || storageConfig.archivePrefix || 'problem-data')
  .replace(/^\/+|\/+$/g, '');
const signSecret = String(
  storageConfig.signSecret ||
  storageConfig.SIGN_SECRET ||
  process.env.NYWOJ_STORAGE_SIGN_SECRET ||
  'nywoj-local-storage-signing-secret'
);

const toBase64Url = (value) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const fromBase64Url = (value) => {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
};

const normalizeKey = (key) => {
  const initial = String(key || '').replace(/\\/g, '/');
  if (path.posix.isAbsolute(initial)) throw new Error('非法存储路径');
  const raw = initial.replace(/^\.\//, '');
  if (raw.split('/').includes('..')) throw new Error('非法存储路径');
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)) {
    throw new Error('非法存储路径');
  }
  return normalized;
};

const localPath = (key) => path.join(localRoot, normalizeKey(key));

const stripSlash = (value) => String(value || '').replace(/^\/+|\/+$/g, '');
const s3Endpoint = () => new URL(s3Config.endpoint || storageConfig.endpoint || 'http://127.0.0.1:9000');
const s3Region = () => String(s3Config.region || storageConfig.region || 'us-east-1');
const s3Bucket = () => String(s3Config.bucket || storageConfig.bucket || '');
const s3AccessKey = () => String(s3Config.accessKeyId || s3Config.accessKey || storageConfig.accessKeyId || storageConfig.accessKey || '');
const s3SecretKey = () => String(s3Config.secretAccessKey || s3Config.secretKey || storageConfig.secretAccessKey || storageConfig.secretKey || '');
const s3SessionToken = () => s3Config.sessionToken || storageConfig.sessionToken || '';
const s3ForcePathStyle = () => {
  const value = s3Config.forcePathStyle != null ? s3Config.forcePathStyle : storageConfig.forcePathStyle;
  return value !== false;
};
const s3Prefix = () => stripSlash(s3Config.prefix || storageConfig.prefix || '');

const encodePath = (value) => '/' + String(value || '')
  .split('/')
  .filter((part) => part.length)
  .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
  .join('/');

const s3Key = (key) => {
  const prefix = s3Prefix();
  const normalized = normalizeKey(key);
  return prefix ? `${prefix}/${normalized}` : normalized;
};

const s3UrlParts = (key) => {
  const endpoint = s3Endpoint();
  const bucket = s3Bucket();
  if (!bucket) throw new Error('STORAGE.s3.bucket 未配置');
  const objectKey = s3Key(key);
  const basePath = stripSlash(endpoint.pathname);
  let host = endpoint.host;
  let pathName;
  if (s3ForcePathStyle()) {
    pathName = `${basePath ? '/' + basePath : ''}/${bucket}/${objectKey}`;
  } else {
    host = `${bucket}.${endpoint.host}`;
    pathName = `${basePath ? '/' + basePath : ''}/${objectKey}`;
  }
  const protocol = endpoint.protocol || 'https:';
  const canonicalUri = encodePath(pathName);
  return {
    protocol,
    host,
    canonicalUri,
    url: `${protocol}//${host}${canonicalUri}`,
    objectKey,
  };
};

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);
const amzNow = () => {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
};

const signingKey = (dateStamp) => {
  const kDate = hmac('AWS4' + s3SecretKey(), dateStamp);
  const kRegion = hmac(kDate, s3Region());
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
};

const canonicalQuery = (params) => Object.keys(params)
  .sort()
  .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key]).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`)
  .join('&');

const ensureS3 = () => {
  if (provider !== 's3' && provider !== 'minio' && provider !== 'r2') {
    throw new Error(`当前存储 provider=${provider} 不是 S3-compatible provider`);
  }
  if (!s3AccessKey() || !s3SecretKey() || !s3Bucket()) {
    throw new Error('STORAGE.s3 accessKeyId / secretAccessKey / bucket 未配置');
  }
};

const s3Request = async (method, key, options = {}) => {
  ensureS3();
  const body = options.body || Buffer.alloc(0);
  const payloadHash = options.payloadHash || sha256Hex(body);
  const { amzDate, dateStamp } = amzNow();
  const parts = s3UrlParts(key);
  const headers = {
    host: parts.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(options.headers || {}),
  };
  if (s3SessionToken()) headers['x-amz-security-token'] = s3SessionToken();
  const signedHeaderKeys = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map((h) => `${h}:${String(headers[h] || headers[Object.keys(headers).find((k) => k.toLowerCase() === h)]).trim()}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [
    method,
    parts.canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${s3Region()}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign, 'hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${s3AccessKey()}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const axiosHeaders = { ...headers };
  delete axiosHeaders.host;
  return axios({
    method,
    url: parts.url,
    data: method === 'GET' || method === 'HEAD' ? undefined : body,
    headers: axiosHeaders,
    responseType: options.responseType || 'arraybuffer',
    validateStatus: (status) => status >= 200 && status < 300,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
};

const presignS3Url = (method, key, ttlSeconds = defaultTtl) => {
  ensureS3();
  const ttl = Math.max(1, Math.min(Number(ttlSeconds) || defaultTtl, 7 * 24 * 60 * 60));
  const { amzDate, dateStamp } = amzNow();
  const parts = s3UrlParts(key);
  const scope = `${dateStamp}/${s3Region()}/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${s3AccessKey()}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(ttl),
    'X-Amz-SignedHeaders': 'host',
  };
  if (s3SessionToken()) params['X-Amz-Security-Token'] = s3SessionToken();
  const query = canonicalQuery(params);
  const canonicalRequest = [
    method,
    parts.canonicalUri,
    query,
    `host:${parts.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign, 'hex');
  return `${parts.url}?${query}&X-Amz-Signature=${signature}`;
};

const signString = (value) => crypto.createHmac('sha256', signSecret).update(value).digest();

const signToken = (payload, ttlSeconds = defaultTtl) => {
  const ttl = Math.max(1, Math.min(Number(ttlSeconds) || defaultTtl, 24 * 60 * 60));
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttl,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const encoded = toBase64Url(JSON.stringify(body));
  return `${encoded}.${toBase64Url(signString(encoded))}`;
};

const verifyToken = (token, expectedAction) => {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = toBase64Url(signString(encoded));
  const gotBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (gotBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(gotBuf, expectedBuf)) return null;

  let body;
  try {
    body = JSON.parse(fromBase64Url(encoded).toString('utf-8'));
  } catch (_) {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  if (expectedAction && body.action !== expectedAction) return null;
  if (!body.exp || Number(body.exp) < Math.floor(Date.now() / 1000)) return null;
  return body;
};

const ensureLocal = () => {
  if (provider !== 'local') {
    throw new Error(`当前存储 provider=${provider} 不支持服务端直读写`);
  }
};

const isRemote = () => provider === 's3' || provider === 'minio' || provider === 'r2';

const getText = async (key, encoding = 'utf-8') => {
  const target = localPath(key);
  if (fs.existsSync(target)) return fs.promises.readFile(target, encoding);
  if (isRemote()) {
    try {
      const res = await s3Request('GET', key);
      return Buffer.from(res.data).toString(encoding);
    } catch (err) {
      if (err.response && err.response.status === 404) return null;
      throw err;
    }
  }
  ensureLocal();
  return null;
};

const putText = async (key, data) => {
  const target = localPath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, data);
  if (isRemote()) {
    await s3Request('PUT', key, { body: Buffer.from(String(data)), headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};

const deleteObject = async (key) => {
  await fs.promises.rm(localPath(key), { force: true });
  if (isRemote()) {
    await s3Request('DELETE', key);
  }
};

const putFile = async (key, filePath, contentType = 'application/octet-stream') => {
  const target = localPath(key);
  if (path.resolve(filePath) !== path.resolve(target)) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(filePath, target);
  }
  if (isRemote()) {
    const body = await fs.promises.readFile(filePath);
    await s3Request('PUT', key, { body, headers: { 'content-type': contentType } });
  }
};

const getFileTo = async (key, filePath) => {
  if (isRemote()) {
    const res = await s3Request('GET', key, { responseType: 'stream' });
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(filePath);
      res.data.pipe(out);
      res.data.on('error', reject);
      out.on('finish', resolve);
      out.on('error', reject);
    });
  } else {
    ensureLocal();
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.copyFile(localPath(key), filePath);
  }
};

const problemArchiveKey = (pid) => `${archivePrefix}/${Number(pid)}.zip`;
const tmpRoot = path.join(__dirname, 'tmp', 'storage');

const mirrorProblemData = async (pid, sourceDir) => {
  if (!isRemote()) return false;
  if (!sourceDir || !fs.existsSync(sourceDir)) return false;
  await fs.promises.mkdir(tmpRoot, { recursive: true });
  const zipPath = path.join(tmpRoot, `problem-${pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  try {
    await compressing.zip.compressDir(sourceDir, zipPath);
    await putFile(problemArchiveKey(pid), zipPath, 'application/zip');
    return true;
  } finally {
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});
  }
};

const restoreProblemData = async (pid, destination) => {
  if (!isRemote()) return false;
  await fs.promises.mkdir(tmpRoot, { recursive: true });
  const zipPath = path.join(tmpRoot, `restore-${pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  const workDir = path.join(tmpRoot, `restore-${pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const backup = fs.existsSync(destination)
    ? path.join(path.dirname(destination), `.${path.basename(destination)}.backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    : null;
  let installed = false;
  try {
    await getFileTo(problemArchiveKey(pid), zipPath);
    await fs.promises.mkdir(workDir, { recursive: true });
    await compressing.zip.uncompress(zipPath, workDir);
    if (backup) await fs.promises.rename(destination, backup);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.rename(workDir, destination);
    installed = true;
    if (backup) await fs.promises.rm(backup, { recursive: true, force: true });
    return true;
  } catch (err) {
    if (installed) await fs.promises.rm(destination, { recursive: true, force: true }).catch(() => {});
    if (backup && fs.existsSync(backup)) await fs.promises.rename(backup, destination).catch(() => {});
    throw err;
  } finally {
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

const deleteProblemDataArchive = async (pid) => {
  if (!isRemote()) return false;
  await deleteObject(problemArchiveKey(pid));
  return true;
};

const info = () => ({
  provider,
  localRoot: provider === 'local' ? localRoot : undefined,
  bucket: isRemote() ? s3Bucket() : undefined,
  endpoint: isRemote() ? String(s3Config.endpoint || storageConfig.endpoint || '') : undefined,
  prefix: isRemote() ? s3Prefix() : undefined,
  problemArchivePrefix: archivePrefix,
  signedUrlTTL: defaultTtl,
});

module.exports = {
  info,
  normalizeKey,
  localPath,
  isRemote,
  getText,
  putText,
  deleteObject,
  putFile,
  getFileTo,
  presignS3Url,
  problemArchiveKey,
  mirrorProblemData,
  restoreProblemData,
  deleteProblemDataArchive,
  signToken,
  verifyToken,
};
