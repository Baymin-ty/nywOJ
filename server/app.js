const express = require('express')
const session = require('express-session')
const app = express()
const cors = require('cors')
const router = require('./router')
const config = require('./config.json')
const { sessionSecret, usingLegacySessionSecret } = require('./sessionSecret')
const requestBodyLimit = process.env.NYWOJ_BODY_LIMIT ||
  (config.HTTP && config.HTTP.bodyLimit) ||
  (config.http && config.http.bodyLimit) ||
  '64mb';
const MySQLStore = require('express-mysql-session')(session);
const options = {
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.username,
  password: config.DB.password,
  database: config.DB.databasename
};

const refererCheck = require('./refererCheck');
const whiteList = ['localhost', '127.0.0.1', '::1', 'https://ty.szsyzx.cn/', 'https://www.niyiwei.com', 'https://niyiwei.com'];
app.use(refererCheck(whiteList, { allowEmpty: true }));

const sessionStore = new MySQLStore(options);

app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: true,
  saveUninitialized: true,
  cookie: { maxAge: parseInt(config.SESSION.expire) },
  name: 'token'
}));

if (usingLegacySessionSecret) {
  console.warn('SESSION.secret is not configured; using the legacy compatibility secret.');
}
const parser = require('ua-parser-js');
const db = require('./db');
const { syncPermissionCatalog } = require('./auth/sync');
const { attachPermissions } = require('./auth/middleware');
const metrics = require('./metrics');
const eventReporter = require('./eventReporter');

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    null;
  if (ip === null)
    res.status(403).end('403 Forbidden');
  else {
    req.session.ip = ip;
    next();
  }
});

app.use(attachPermissions);
app.use(metrics.middleware(config.METRICS || {}));

app.use((req, res, next) => {
  req.useragent = parser(req.headers['user-agent']);
  if (req.session.uid) {
    db.query('UPDATE userSession SET lastact=? WHERE token=? AND uid=?', [new Date(), req.sessionID, req.session.uid]).catch((err) => console.log(err));
    // Each /api/admin/* handler enforces its own fine-grained permission via requirePermission.
    next();
  } else {
    if (req.url === '/api/user/login' ||
      req.url.startsWith('/api/auth/getSessionInfo') ||
      req.url === '/api/migration/migrateUser' ||
      req.url === '/api/migration/queryUserMigrationInfo' ||
      req.url === '/api/user/sendLoginEmailCode' ||
      req.url === '/api/user/loginByEmailCode' ||
      req.url === '/api/user/reg' ||
      req.url.startsWith('/api/user/checkAvailability') ||
      req.url === '/api/user/setUserEmail' ||
      req.url === '/api/user/sendEmailVerifyCode' ||
      req.url === '/api/user/sendPasswordResetCode' ||
      req.url === '/api/user/resetPasswordByEmail' ||
      req.url === '/api/user/getUserInfo' ||
      req.url === '/api/user/getUserPublicInfo' ||
      req.url === '/api/user/getUserMeta' ||
      req.url === '/api/user/getUserDetail' ||
      req.url.startsWith('/api/user/searchUser') ||
      req.url === '/api/user/getUserList' ||
      req.url === '/api/common/getAnnouncementList' ||
      req.url === '/api/common/getHomeConfig' ||
      req.url === '/api/common/getHitokoto' ||
      req.url.startsWith('/api/homepage/getHomepage') ||
      req.url === '/api/rabbit/getRankInfo' ||
      req.url === '/api/rabbit/getClickData' ||
      // grant new access
      req.url === '/api/problem/getProblemList' ||
      req.url === '/api/problem/getProblemInfo' ||
      req.url === '/api/problem/queryProblemSet' ||
      req.url === '/api/problem/getProblem' ||
      req.url === '/api/problem/getProblemAuth' ||
      req.url === '/api/rabbit/all' ||
      req.url === '/api/contest/getContestList' ||
      req.url === '/api/judge/getSubmissionList' ||
      req.url === '/api/common/getAnnouncementInfo' ||
      req.url === '/api/discussion/getDiscussionList' ||
      req.url === '/api/discussion/getDiscussion' ||
      req.url === '/api/discussion/getReplies' ||
      req.url.startsWith('/api/problem/signedDownloadCase') ||
      req.url.startsWith('/api/problem/signedDownloadAnswerInputs') ||
      req.url.startsWith('/api/problem/signedDownloadAsset') ||
      req.url.startsWith('/api/problem/signedDownloadProblemFile') ||
      req.url.startsWith('/api/problem/signedUploadData') ||
      req.url.startsWith('/api/problem/signedUploadProblemFile') ||
      req.url === '/api/problem/getProblemTags' ||
      req.url === '/api/problem/getProblemPublishers' ||
      req.url === '/api/judge/getLangs' ||
      req.url === '/api/ide/problemContext' ||
      req.url === '/api/ide/profileRun' ||
      req.url === '/api/judge/receiveTask'
    )
      next();
    else return res.status(404).end('404 Not Found');
  }
});

app.use(express.json({ extended: true, limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
app.use(cors())              //配置跨域
app.use(router)              //配置路由
app.use((err, req, res, next) => {
  console.error('express error:', err && err.stack ? err.stack : err);
  eventReporter.reportError(err, req, 'Express middleware caught an exception.').catch(() => {});
  if (res.headersSent) return next(err);
  const status = Number(err && (err.status || err.statusCode)) || 500;
  const tooLarge = status === 413 || (err && err.type === 'entity.too.large');
  const message = tooLarge
    ? `请求内容过大，请减少静态数据或调大 HTTP.bodyLimit（当前 ${requestBodyLimit}）。`
    : err && err.message ? err.message : String(err);
  return res.status(status).send({ message });
});

const logFilePath = './app.log';
const fs = require('fs');

const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

const originalLog = console.log;
const { Format } = require('./static')

const logToFileAndConsole = (level, ...args) => {
  const message = `[${Format(new Date())}] ${level}: ${args.join(' ')}\n`;
  logStream.write(message);
  originalLog(message);
};

console.log = (...args) => logToFileAndConsole('LOG', ...args);
console.error = (...args) => logToFileAndConsole('ERROR', ...args);

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  eventReporter.reportError(reason, null, 'Unhandled Rejection', {
    promise: String(promise),
  }).catch(() => {});
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', `Error: ${err.message}\nStack: ${err.stack}`);
  eventReporter.reportError(err, null, 'Uncaught Exception').catch(() => {});
});

const { attach: attachIdeWs } = require('./api/judge/ideSocket');

syncPermissionCatalog()
  .then(() => {
    const server = app.listen(1234, () => {
      console.log('success!!!');
    });
    metrics.startServer(config.METRICS || {});
    // Online IDE interactive terminal — WebSocket at /api/ide/stream.
    attachIdeWs(server);
    // 站内通知：开赛提醒 / 作业截止提醒的定时扫描（每 60s，幂等）。
    require('./api/content/notificationScanner').start();
  })
  .catch((err) => {
    console.error('permission catalog sync failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
