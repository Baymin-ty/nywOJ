let db = require('../db/index')
const bcrypt = require('bcryptjs');
const axios = require('axios');

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
}

const getInfo = () => {
    return axios.get('https://ip.useragentinfo.com/json').then((response) => {
        let ipInfo = {};
        ipInfo.ip = response.data.ip;
        ipInfo.country = response.data.country;
        ipInfo.province = response.data.province;
        ipInfo.city = response.data.city;
        if (ipInfo.country === "中国") ipInfo.country = "";
        if (ipInfo.province === ipInfo.city) ipInfo.province = "";
        return {
            ip_loc: ipInfo.country + ipInfo.province + ipInfo.city
        };
    })
}

const dateFormat = (x) => {
    x = x.toString();
    return x.length > 1 ? x : '0' + x;
}
const getCurTime = () => {
    const now = new Date();
    return now.getFullYear() + '-' + dateFormat(now.getMonth() + 1) + '-' + dateFormat(now.getDate()) + ' ' + dateFormat(now.getHours()) + ':' + dateFormat(now.getMinutes()) + ':' + dateFormat(now.getSeconds());
}

exports.all = (req, res) => {
    let sql = 'SELECT * FROM clickList ORDER BY id desc limit 20';
    db.query(sql, (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}

exports.add = (req, res) => {
    const ip = getClientIp(req);
    let sql = 'INSERT INTO clickList(userid,time,ip,ip_loc) values (?,?,?,?)';
    db.query(sql, [1, getCurTime(), ip, getInfo(ip).ip_loc], (err, data) => {
        if (err) return res.send('Error：' + err.message);
        if (data.affectedRows > 0) {
            res.send({
                status: 200, message: 'success',
            })
        } else {
            res.send({
                status: 202, message: 'error',
            })
        }
    })
}

exports.getClickCnt = (req, res) => {
    let sql = 'SELECT COUNT(*) as cnt FROM clickList WHERE ip=?';
    db.query(sql, [req.query.ip], (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}

exports.getRankInfo = (req, res) => {
    let sql = 'SELECT ip,ip_loc,COUNT(*) as cnt FROM clickList GROUP BY ip ORDER BY cnt DESC LIMIT 20';
    db.query(sql, (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}