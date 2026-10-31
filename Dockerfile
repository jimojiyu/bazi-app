FROM node:24-alpine

WORKDIR /app

# 零依赖：不需要 npm install，直接拷贝代码
# 注意：config.json 含密钥、不进仓库，所以拷模板；运行时靠环境变量注入
COPY package.json server.js config.example.json ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production

# 不写死 PORT：Render 等平台会注入 PORT，server.js 读取 process.env.PORT
EXPOSE 8756

# 健康检查（不需要口令）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8756)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
