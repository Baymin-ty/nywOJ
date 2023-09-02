const mysql = require('mysql');
const config = require('../config.json');
const db = mysql.createPool({
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.username,
  password: config.DB.password,
  database: config.DB.databasename
});

module.exports = db;
