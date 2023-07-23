const express = require('express')
const session = require('express-session')
const app = express()
const cors = require('cors')
const bodyParser = require('body-parser')
const router = require('./router')
const config = require('./config.json')
const MySQLStore = require('express-mysql-session')(session);
const options = {
    host: 'localhost',
    port: 3306,
    user: config.DB.username,
    password: config.DB.password,
    database: config.DB.databasename
};

const sessionStore = new MySQLStore(options);

const getClientIp = (req) => {
    return req.headers['x-forwarded-for'];
}

app.use(session({
    store: sessionStore,
    secret: '114514-nywOJ-1919810',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: parseInt(config.SESSION.expire) },
    name: 'token'
}));
const parser = require('ua-parser-js');
const db = require('./db/index');

app.use((req, res, next) => {
    // if (!req.headers.referer || !req.headers.referer.match('^https:\/\/ty.szsyzx.cn\/')) {
    //     return res.status(403).end('403 Forbidden');
    // }
    res.setTimeout(10000, () => {
        return res.status(408).end("Request Timeout");
    });
    req.session.ip = getClientIp(req);
    req.useragent = parser(req.headers['user-agent']);
    if (req.session.uid) {
        db.query('UPDATE userSession SET lastact=? WHERE token=? AND uid=?', [new Date(), req.sessionID, req.session.uid]);
        if (req.url.match('^\/api\/admin') && req.session.gid !== 3)
            res.status(403).end('403 Forbidden');
        next();
    } else {
        if (req.url === '/api/user/login' ||
            req.url === '/api/user/reg' ||
            req.url === '/api/user/setUserEmail' ||
            req.url === '/api/user/sendEmailVerifyCode' ||
            req.url === '/api/user/getUserInfo' ||
            req.url === '/api/common/getAnnouncementList' ||
            req.url === '/api/rabbit/getRankInfo' ||
            req.url === '/api/rabbit/getClickData'
        )
            next();
        else res.status(404).end('404 Not Found');
    }
});

app.use(bodyParser.json());  //配置解析，用于解析json和urlencoded格式的数据
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors())              //配置跨域
app.use(router)              //配置路由

process.on('uncaughtException', (err) => {
    console.log(err)
});

app.listen(1234, () => {
    console.log('success!!!');
});

