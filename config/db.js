const mysql = require('mysql2');
require('dotenv').config();

const createPool = (database) => mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: false
}).promise();

module.exports = {
  pmsDb: createPool('pms_db'),
  posDb: createPool('pos_db'),
  mdmDb: createPool('mdm_db')
};
