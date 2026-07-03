const http = require('http');

const LATENCY_BUCKETS = [0.03, 0.1, 0.3, 1, 3, 5, 10];

const state = {
  requestTotal: new Map(),
  latencyBuckets: new Map(),
  latencySum: new Map(),
  latencyCount: new Map(),
};

const normalizeIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

const metricName = (name) => `nywoj_${name}`;

const escapeLabel = (value) => String(value == null ? '' : value)
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/"/g, '\\"');

const labelKey = (labels) => Object.keys(labels)
  .sort()
  .map((key) => `${key}=${labels[key]}`)
  .join('\u0000');

const labelText = (labels) => {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return '';
  return `{${keys.map((key) => `${key}="${escapeLabel(labels[key])}"`).join(',')}}`;
};

const incMap = (map, labels, amount = 1) => {
  const key = labelKey(labels);
  const item = map.get(key);
  if (item) item.value += amount;
  else map.set(key, { labels, value: amount });
};

const normalizePath = (path) => String(path || '/')
  .replace(/\/\d+(?=\/|$)/g, '/:id')
  .replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, '/:hash');

const observeLatency = (labels, seconds) => {
  const baseKey = labelKey(labels);
  if (!state.latencyBuckets.has(baseKey)) {
    state.latencyBuckets.set(baseKey, {
      labels,
      buckets: new Map(LATENCY_BUCKETS.map((bucket) => [bucket, 0])),
      inf: 0,
    });
  }
  const item = state.latencyBuckets.get(baseKey);
  for (const bucket of LATENCY_BUCKETS) {
    if (seconds <= bucket) item.buckets.set(bucket, item.buckets.get(bucket) + 1);
  }
  item.inf += 1;
  incMap(state.latencySum, labels, seconds);
  incMap(state.latencyCount, labels, 1);
};

const middleware = () => (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      path: normalizePath(req.path || req.url),
      status: String(res.statusCode),
    };
    incMap(state.requestTotal, labels);
    observeLatency(labels, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
};

const writeMap = (lines, name, help, type, map) => {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
  for (const item of map.values()) lines.push(`${name}${labelText(item.labels)} ${item.value}`);
};

const render = () => {
  const lines = [];
  const requestTotalName = metricName('http_requests_total');
  const latencyName = metricName('http_request_duration_seconds');

  writeMap(lines, requestTotalName, 'Total HTTP requests handled by nywOJ.', 'counter', state.requestTotal);

  lines.push(`# HELP ${latencyName} HTTP request latency in seconds.`);
  lines.push(`# TYPE ${latencyName} histogram`);
  for (const item of state.latencyBuckets.values()) {
    for (const [bucket, value] of item.buckets.entries()) {
      lines.push(`${latencyName}_bucket${labelText({ ...item.labels, le: bucket })} ${value}`);
    }
    lines.push(`${latencyName}_bucket${labelText({ ...item.labels, le: '+Inf' })} ${item.inf}`);
  }
  for (const item of state.latencySum.values()) lines.push(`${latencyName}_sum${labelText(item.labels)} ${item.value}`);
  for (const item of state.latencyCount.values()) lines.push(`${latencyName}_count${labelText(item.labels)} ${item.value}`);

  const memory = process.memoryUsage();
  lines.push(`# HELP ${metricName('process_uptime_seconds')} Process uptime in seconds.`);
  lines.push(`# TYPE ${metricName('process_uptime_seconds')} gauge`);
  lines.push(`${metricName('process_uptime_seconds')} ${process.uptime()}`);
  lines.push(`# HELP ${metricName('process_memory_bytes')} Process memory usage in bytes.`);
  lines.push(`# TYPE ${metricName('process_memory_bytes')} gauge`);
  for (const [type, value] of Object.entries(memory)) {
    lines.push(`${metricName('process_memory_bytes')}${labelText({ type })} ${value}`);
  }
  lines.push('');
  return lines.join('\n');
};

const isAllowedIp = (cfg, ip) => {
  const allow = Array.isArray(cfg.allowedIps) ? cfg.allowedIps : [];
  if (!allow.length) return true;
  return allow.includes(normalizeIp(ip));
};

const startServer = (cfg = {}) => {
  if (!cfg.enabled) return null;
  const hostname = cfg.hostname || cfg.host || '127.0.0.1';
  const port = Number(cfg.port || cfg.basePort || 9100);
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] !== '/metrics') {
      res.writeHead(404).end('Not Found');
      return;
    }
    if (!isAllowedIp(cfg, req.socket.remoteAddress)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(render());
  });
  server.on('error', (err) => {
    console.error('metrics server failed:', err && err.stack ? err.stack : err);
  });
  server.listen(port, hostname, () => {
    console.log(`metrics server listening on ${hostname}:${port}`);
  });
  return server;
};

module.exports = {
  middleware,
  render,
  startServer,
};
