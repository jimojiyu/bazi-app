FROM node:24-alpine

WORKDIR /app

# 零依赖：不需要 npm install，直接拷贝代码
COPY package.json server.js config.json ./
COPY lib ./lib
COPY public ./public

# 云端必须用环境变量注入密钥；config.json 仅作为字段骨架
ENV PORT=8756
ENV NODE_ENV=production

EXPOSE 8756

# 健康检查（不需要口令）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8756)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
