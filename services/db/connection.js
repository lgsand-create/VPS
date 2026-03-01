import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const config = {
  user: process.env.DB_USER || 'root',
  database: process.env.DB_NAME || 'minridskola',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true, // Behåll DATE/DATETIME som strängar, undvik tidszonskonvertering
};

// Unix socket (standard på Linux) eller TCP
if (process.env.DB_SOCKET) {
  config.socketPath = process.env.DB_SOCKET;
} else {
  config.host = process.env.DB_HOST || 'localhost';
  config.port = parseInt(process.env.DB_PORT || '3306');
  config.password = process.env.DB_PASSWORD || '';
}

const pool = mysql.createPool(config);

export default pool;
