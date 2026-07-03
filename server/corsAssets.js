const fs = require('fs');
const config = require('./config.json');

const YEAR_SECONDS = 31536000;
const xdomainScript = fs.readFileSync(require.resolve('xdomain/dist/xdomain.min'), 'utf8');
const streamSaverMitm = fs.readFileSync(require.resolve('streamsaver/mitm.html'), 'utf8');
const streamSaverSw = fs.readFileSync(require.resolve('streamsaver/sw.js'), 'utf8');

const corsConfig = () => {
  const security = config.security || config.SECURITY || {};
  return security.crossOrigin || security.CROSS_ORIGIN || config.CORS || config.CROSS_ORIGIN || {};
};

const cache = (res, type) => {
  res.setHeader('Cache-Control', `public, max-age=${YEAR_SECONDS}`);
  res.setHeader('Content-Type', type);
};

const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

exports.xdomainHtml = (req, res) => {
  const cfg = corsConfig();
  cache(res, 'text/html; charset=utf-8');
  if (!cfg.enabled) {
    res.end('Requested cors proxy page, but cross origin is NOT enabled');
    return;
  }
  const origins = Array.isArray(cfg.whiteList) ? cfg.whiteList : [];
  const masters = {};
  for (const origin of origins) masters[origin] = '*';
  res.end(`<script src="xdomain.min.js"></script><script>xdomain.masters(${safeJson(masters)});</script>`);
};

exports.xdomainScript = (req, res) => {
  const cfg = corsConfig();
  cache(res, 'application/javascript; charset=utf-8');
  if (!cfg.enabled) {
    res.end("console.error('Requested cors/xdomain.min.js, but cross origin is NOT enabled');");
    return;
  }
  res.end(xdomainScript);
};

exports.streamSaverMitm = (req, res) => {
  cache(res, 'text/html; charset=utf-8');
  res.end(streamSaverMitm);
};

exports.streamSaverSw = (req, res) => {
  cache(res, 'application/javascript; charset=utf-8');
  res.end(streamSaverSw);
};
