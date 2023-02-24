const express = require('express')
const session = require('express-session')
const app = express()
const cors = require('cors')
const bodyParser = require('body-parser')
const router = require('./router')

const getClientIp = (req) => {
    return req.headers['x-forwarded-for'];
}

app.use(session({
    secret: '114514-nywOJ-1919810',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 86400 * 1000 * 7 },
    name: 'token'
}));

app.use((req, res, next) => {
    req.session.ip = getClientIp(req);
    if (req.session.uid) {
        next();
    } else {
        if (req.url === '/api/user/login' ||
            req.url === '/api/user/reg' ||
            req.url === '/api/user/getUserInfo')
            next();
        else res.status(404).end('404 Not Found');
    }
});

app.use(bodyParser.json());  //配置解析，用于解析json和urlencoded格式的数据
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors())              //配置跨域
app.use(router)              //配置路由

app.listen(1234, () => {
    console.log('success!!!');
});

