# 云端部署（电脑关机也能用）

本工具是零依赖 Node 服务（除 Node 本身不需要装任何包），可直接跑在任何支持 Node 18+ 的服务器上。

## 一、必须知道的一件事

「电脑关机手机还能用」= 程序必须跑在一台 24 小时开机的机器上。可选：

| 方案 | 费用 | 稳定性 | 长请求（2-4 分钟） | 适合 |
|---|---|---|---|---|
| **便宜云服务器 / VPS** | 约 ¥60-150/年（新用户活动） | 高，IP 固定 | 无超时限制 | **最推荐** |
| Render / Zeabur 等免费 | 免费 | 会休眠、冷启动慢 | 免费层常有 100s 超时，需异步改造 | 想零成本试 |
| 家里常开设备（NAS / 软路由 / 小主机） | 0 | 取决于设备 | 无超时 | 已有设备 |
| cloudflared 穿透（当前方案） | 免费 | 电脑必须开机 | 无超时 | 临时用 |

> 本次分析要 2-4 分钟（推理模型），免费 PaaS 的请求超时可能打断。**VPS 或家里设备最省心。**

## 二、Docker 部署（VPS / NAS / 任何有 Docker 的机器）

```bash
# 1. 把整个 八字小程序 目录拷到服务器（ssh / scp / 面板上传均可）
# 2. 进入目录，构建并启动
docker build -t bazi-app .
docker run -d --name bazi \
  -p 8756:8756 \
  -e VISION_API_KEY='oc_sk_xxx' \
  -e ANALYSIS_API_KEY='sk-xxx' \
  -e ACCESS_TOKEN='换成你自己的口令' \
  --restart unless-stopped \
  bazi-app
```

然后手机访问 `http://服务器IP:8756/?t=你的口令`。

- `--restart unless-stopped` 保证重启机器后自动起来；
- **别用 `config.json` 里的本地 key**，用 `-e` 注入；
- 云厂商安全组要放行 8756 端口（或你映射的端口）。

## 三、不用 Docker（纯 Node）

```bash
# 服务器装 Node 18+ 后
cd 八字小程序
PORT=8756 \
VISION_API_KEY='oc_sk_xxx' \
ANALYSIS_API_KEY='sk-xxx' \
ACCESS_TOKEN='你的口令' \
node server.js
```

配 systemd 常驻（Linux）：

```ini
# /etc/systemd/system/bazi.service
[Unit]
Description=Bazi App
After=network.target

[Service]
WorkingDirectory=/opt/bazi
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=8756
Environment=ACCESS_TOKEN=你的口令
Environment=VISION_API_KEY=oc_sk_xxx
Environment=ANALYSIS_API_KEY=sk-xxx

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bazi
```

## 四、环境变量清单

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 默认 8756；云平台通常自动注入，必须读它 |
| `ACCESS_TOKEN` | **是（公网部署）** | 访问口令，手机/浏览器要用 `?t=` 带上 |
| `VISION_API_KEY` | 是 | 中转站 key（识别截图，官方 key 不支持视觉） |
| `VISION_BASE_URL` | 否 | 默认 `https://opencode.ai/zen/go/v1/chat/completions` |
| `VISION_MODEL` | 否 | 默认 `deepseek-v4.1-flash` |
| `ANALYSIS_API_KEY` | 是 | DeepSeek 官方 key（文字分析） |
| `ANALYSIS_BASE_URL` | 否 | 默认 `https://api.deepseek.com/chat/completions` |
| `ANALYSIS_MODEL` | 否 | 默认 `deepseek-v4-pro` |
| `ANALYSIS_MAX_TOKENS` | 否 | 默认 16000，太小会因思维链截断导致空结果 |

## 七、Render 免费部署（逐步，无需信用卡）

已为你准备好干净的上传包：**`上传包_Render/`**（129KB，15 个文件，**不含密钥、不含 55MB 工具**）。

### 第 1 步：传到 GitHub

本机没装 git，用网页上传即可：

1. 注册/登录 https://github.com → 右上 `+` → **New repository** → 名字随便（如 `bazi-app`）→ **Create**；
2. 打开仓库 → **Add file → Upload files**；
3. 在资源管理器里打开 `上传包_Render` 文件夹，**全选里面的所有文件/文件夹**（包括 `lib`、`public` 两个目录），拖进网页 → **Commit changes**。

> ⚠️ 千万不要把 `config.json`（含密钥）和 `tools/` 传上去。上传包里已经剔除了。

### 第 2 步：在 Render 创建服务

1. 打开 https://render.com → 用邮箱注册（免费，不要信用卡）；
2. 控制台 → **New +** → **Blueprint**；
3. 授权并选择你刚建的 GitHub 仓库 → **Apply**；
4. Render 会自动按 `render.yaml` 建服务（免费套餐、新加坡区域）。首次会让你填两个变量：
   - `VISION_API_KEY` → 中转站 key（`oc_sk_...`）
   - `ANALYSIS_API_KEY` → DeepSeek 官方 key（`sk-...`）
5. 等首次部署完成（约 2-3 分钟）。

### 第 3 步：拿到访问地址与口令

1. 进服务页面 → **Environment** → 找到自动生成的 `ACCESS_TOKEN`，复制；
2. 服务右上角能看到域名，形如 `https://bazi-app-xxxx.onrender.com`；
3. 手机访问：

```
https://bazi-app-xxxx.onrender.com/?t=你复制的ACCESS_TOKEN
```

浏览器菜单选「添加到主屏幕」，之后就像 App 一样用。

### 免费层注意

| 事项 | 说明 |
|---|---|
| 休眠 | 15 分钟无请求会休眠，下次访问**冷启动 30-60 秒**，等页面出来即可 |
| 额度 | 免费 750 小时/月（单服务足够个人用） |
| 超时 | 免费层请求可能 ~100 秒断开，**本项目已改成异步任务**（提交即返回、前端轮询），不会被切断 |
| 区域 | 已设为新加坡，国内访问相对快；若仍慢可换 Zeabur / Railway（同样吃这个仓库） |

### 常见问题

- **页面能开但一直"分析中"**：正常，深度分析 2-4 分钟；进度条会显示已等待秒数。
- **提示"任务不存在或已过期"**：服务中途重启（免费层休眠/重新部署）会清空内存任务，重新点一次分析即可。
- **401**：网址没带 `?t=口令`，或口令和 Render 里的 `ACCESS_TOKEN` 不一致。
- **改了代码怎么更新**：在 GitHub 网页重新上传改动文件，Render 会自动重新部署（`autoDeploy: true`）。

## 八、安全提醒

- 公网部署**必须设 `ACCESS_TOKEN`**，否则任何人都能调用、烧你的额度；
- key 只放服务器/环境变量，不要提交到公开仓库；
- 建议把端口藏在非默认值，或前面加一层 Nginx + HTTPS；
- 想用域名，国内服务器需备案；直接用 `IP:端口` 则不需要。

## 九、手机端

访问 `http://你的IP:端口/?t=口令`，浏览器菜单里"添加到主屏幕"，即可像 App 一样使用。
