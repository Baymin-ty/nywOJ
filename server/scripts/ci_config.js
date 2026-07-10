// 从 config.example.json 生成 config.json，用环境变量覆盖 DB 连接（CI 专用）。
// 不写入任何真实凭据；SMTP/LLM/S3 保留占位（CI 逻辑层用不到）。
//   DB_HOST DB_PORT DB_USER DB_PASS DB_NAME node scripts/ci_config.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.example.json'), 'utf8'));

cfg.DB.host = process.env.DB_HOST || '127.0.0.1';
cfg.DB.port = Number(process.env.DB_PORT || 3306);
cfg.DB.username = process.env.DB_USER || 'root';
cfg.DB.password = process.env.DB_PASS || '';
cfg.DB.databasename = process.env.DB_NAME || 'nywoj_ci';

// CI 里没有邮件/沙箱，关闭会拨外网的东西
cfg.EMAIL.host = '';
cfg.JUDGE.NAME = 'ci';

fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
console.log(`ci config.json 已生成 -> ${cfg.DB.username}@${cfg.DB.host}:${cfg.DB.port}/${cfg.DB.databasename}`);
