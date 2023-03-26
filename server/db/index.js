let mysql = require('mysql2');

let db = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '114514',
    database: 'test'
});

module.exports = db;
