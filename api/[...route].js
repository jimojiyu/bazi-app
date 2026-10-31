// Vercel Serverless 入口：把所有 /api/* 请求交给 app 的 handleRequest 处理
const handler = require('../server.js');

module.exports = async (req, res) => {
  return handler(req, res);
};
