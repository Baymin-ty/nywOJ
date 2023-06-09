const mysql = require('mysql');
const config = require('../config.json');
const db = mysql.createPool({
    host: '127.0.0.1',
    user: config.DB.username,
    password: config.DB.password,
    database: config.DB.databasename
});

module.exports = db;
