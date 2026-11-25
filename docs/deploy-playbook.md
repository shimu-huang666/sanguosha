# 通用部署手册：静态站点 + 常驻 Node 服务

> 适用：一台 Linux VPS（宝塔 / nginx），网站是静态文件，另有一个常驻 Node 进程（联机大厅、API、WebSocket 服务等）。
> 目标：本地 `git push` 后，网站和 Node 服务自动更新，不用登录服务器、不用手工上传。
>
> 本文所有 `<尖括号>` 都是占位符，按项目替换。

## 0. 快速开始（TL;DR）

服务器上：

```bash
cd /opt && git clone <REPO_URL> <APP>-src
cd <APP>-src && cp scripts/deploy.env.example scripts/deploy.env   # 改 3 个路径
bash scripts/deploy.sh --install-hook
bash scripts/deploy.sh --full        # 首次全量同步（先备份！）
```

GitHub 上：

1. 生成一把部署密钥，公钥加到服务器 `authorized_keys`；
2. 仓库 Secrets 填 `SERVER_HOST` / `SERVER_PORT` / `SERVER_USER` / `SSH_PRIVATE_KEY`；
3. 加 `.github/workflows/deploy.yml`（见 §3.4）。

之后每次 `git push` 自动部署。

---

## 1. 目录与角色约定

| 角色 | 示例路径 | 说明 |
| --- | --- | --- |
| GitHub 仓库 | `https://github.com/<owner>/<repo>` | 代码源头 |
| 仓库克隆 | `/opt/<APP>-src` | **必须放在网站目录之外**，避免 `/.git` 被公开访问 |
| 网站目录 | `/www/wwwroot/<site>` | nginx 的 root，只放对外文件 |
| 服务目录 | `/opt/<APP>-server` | 常驻 Node 进程实际运行的目录 |
| 服务名 | `<APP>-server.service` | systemd 单元名 |
| 端口 | `8080` | 服务监听端口，不能与已有服务冲突 |

三条原则：

1. 仓库克隆不放进网站目录；
2. 部署脚本只同步「运行文件」，不碰媒体、用户上传、运行时数据；
3. 服务用 systemd（或 pm2）托管，换文件后重启才生效。

---

## 2. 服务器一次性配置

### 2.1 安装依赖

```bash
# CentOS / 阿里云 Linux / 腾讯云 Linux
yum install -y git curl

# Ubuntu / Debian
apt update && apt install -y git curl
```

Node 用宝塔自带的即可，记下绝对路径（例如 `/www/server/nodejs/v24.22.3/bin/node`），systemd 里要用。

### 2.2 克隆仓库

公开仓库（推荐，免密钥）：

```bash
cd /opt
git clone https://github.com/<owner>/<repo>.git <APP>-src
```

私有仓库：用 Deploy Key（只读）或 HTTPS + Personal Access Token。**不要**把私钥提交进仓库。

### 2.3 部署脚本与配置

把 `scripts/deploy.sh` 和 `scripts/deploy.env.example` 放进仓库（本项目已有，可直接复用）。

`scripts/deploy.env`（不提交，已在 `.gitignore`）：

```bash
# 网站目录
WEB_ROOT=/www/wwwroot/<site>

# 服务进程实际加载的文件所在目录（留空表示只更新网站目录里的那份）
SERVICE_DIST_TARGET=/opt/<APP>-server/dist/<entry>.cjs

# 重启服务的命令（留空则只同步文件，不重启）
SERVICE_RESTART_CMD="systemctl restart <APP>-server"
```

脚本顶部的 `RUNTIME_PATHS` 数组决定同步哪些路径：

```bash
RUNTIME_PATHS=(
  _virtual
  game
  mode
  noname
  theme
  index.html
  service-worker.js
  server/dist/
)
```

**只列运行文件**：源码、文档、测试、`node_modules`（如果线上不需要）都不要放进来。

### 2.4 安装 post-merge 钩子

```bash
cd /opt/<APP>-src
bash scripts/deploy.sh --install-hook
```

钩子内容等价于：每次 `git pull` 合并完成后执行 `bash scripts/deploy.sh --no-pull`。

### 2.5 用 systemd 托管服务

`/etc/systemd/system/<APP>-server.service`：

```ini
[Unit]
Description=<APP> server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www
WorkingDirectory=/opt/<APP>-server
ExecStart=/www/server/nodejs/v24.22.3/bin/node dist/<entry>.cjs --port 8080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now <APP>-server
systemctl status <APP>-server --no-pager
```

注意：

- `WorkingDirectory` 决定运行时文件（配置、房间设置、上传）写在哪里；
- 用户用 `www`，别用 root；
- 目录和运行时文件要对该用户可写。

### 2.6 Web 服务器（nginx / 宝塔）

1. 新建站点，根目录指向 `WEB_ROOT`；
2. 如果服务提供 WebSocket，加反向代理：

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

3. 静态站点记得禁止访问 `.git`（如果仓库曾放在网站目录里）。

### 2.7 首次全量同步

```bash
cd /opt/<APP>-src
bash scripts/deploy.sh --full --dry-run   # 先看会同步哪些，不写文件
bash scripts/deploy.sh --full             # 真正执行
```

⚠️ `--full` 会用仓库当前分支覆盖网站的运行文件。网站上有手工改过的文件时，先备份：

```bash
tar -czf /opt/<APP>-backup-$(date +%F).tgz \
  -C <WEB_ROOT> --exclude=uploads --exclude=media .
```

---

## 3. GitHub Actions

### 3.1 生成部署密钥（每台服务器一把）

```bash
ssh-keygen -t ed25519 -C "<APP>-deploy" -f ~/.ssh/<APP>_deploy -N ""
```

| 文件 | 用途 |
| --- | --- |
| `<APP>_deploy`（私钥） | 放进 GitHub Secrets |
| `<APP>_deploy.pub`（公钥） | 加到服务器 `authorized_keys` |

每台服务器单独一把，方便吊销；不要多站共用一把。

### 3.2 服务器授权

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh
cat >> /root/.ssh/authorized_keys <<'EOF'
<粘贴 .pub 的内容>
EOF
chmod 600 /root/.ssh/authorized_keys
```

更安全的写法（只允许执行部署命令）：

```
command="cd /opt/<APP>-src && git pull --ff-only",no-pty,no-port-forwarding ssh-ed25519 AAAA...
```

### 3.3 仓库 Secrets

`Settings → Secrets and variables → Actions`：

| Name | Value |
| --- | --- |
| `SERVER_HOST` | 服务器公网 IP 或域名（用 `dig +short 域名` 核对，别填成控制台/另一台机器） |
| `SERVER_PORT` | `22` |
| `SERVER_USER` | `root` 或部署用户 |
| `SSH_PRIVATE_KEY` | 私钥**完整内容**（含 `BEGIN/END` 行，不是 `.pub`） |

多个站点时用后缀区分：`SERVER_HOST_2`、`SSH_PRIVATE_KEY_2`……

### 3.4 Workflow 模板

`.github/workflows/deploy.yml`：

```yaml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: production-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: 同步服务器并部署
        env:
          SSH_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          HOST_RAW: ${{ secrets.SERVER_HOST }}
          PORT_RAW: ${{ secrets.SERVER_PORT }}
          USER_RAW: ${{ secrets.SERVER_USER }}
        run: |
          HOST=$(printf '%s' "$HOST_RAW" | tr -d '\r\n ')
          PORT=$(printf '%s' "$PORT_RAW" | tr -d '\r\n ')
          USER=$(printf '%s' "$USER_RAW" | tr -d '\r\n ')

          mkdir -p ~/.ssh
          printf '%s\n' "$SSH_KEY" | tr -d '\r' > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519

          # 固定服务器主机公钥做严格校验（ssh-keyscan -t ed25519 <HOST> 的输出）
          cat > ~/.ssh/known_hosts <<'EOF'
<HOST> ssh-ed25519 AAAA...
EOF
          chmod 600 ~/.ssh/known_hosts

          set +e
          out=$(ssh -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
            -p "$PORT" "$USER@$HOST" 'cd /opt/<APP>-src && git pull --ff-only' 2>&1)
          code=$?
          printf '%s\n' "$out"

          if [ "$code" -ne 0 ]; then
            msg=$(printf '%s' "$out" | tr '\n' ' ' | tr -d '\r' | cut -c1-800)
            echo "::error::ssh 退出码 $code：$msg"
            exit "$code"
          fi
```

要点：

- 主机公钥是**公开信息**，直接写进 workflow 比放进 secret 更不容易填错；
- `tr -d '\r\n '` 去掉粘贴 secret 时带进来的换行/空格；
- 失败时用 `::error::` 输出原因，Annotations 里可见，不用登录也能排查。

---

## 4. 日常使用

```bash
git push
```

- GitHub 在 30–60 秒内触发 workflow；
- 服务器 `git pull` → 钩子同步变动的文件；
- 服务文件有变化时执行 `SERVICE_RESTART_CMD` 重启。

手动触发：Actions 页面 → 对应 workflow → `Run workflow`。

---

## 5. 验证清单

```bash
# 1. 密钥能连
ssh -i ~/.ssh/<APP>_deploy root@<HOST> 'echo OK'

# 2. 服务器拉到了
ssh -i ~/.ssh/<APP>_deploy root@<HOST> 'cd /opt/<APP>-src && git log -1 --oneline'

# 3. 服务在跑
ssh -i ~/.ssh/<APP>_deploy root@<HOST> 'systemctl is-active <APP>-server'

# 4. 站点正常
curl -I https://<域名>/
```

再 push 一个只改文档的提交，确认 Actions 变绿。

---

## 6. 第二个站点（多环境）

### 同一台服务器

| 项目 | 必须不同 |
| --- | --- |
| 仓库克隆 | `/opt/<APP>-src-2` |
| 网站目录 | `/www/wwwroot/<site2>` |
| 服务端口 | 8081 |
| systemd 服务名 | `<APP>-server-2` |
| 运行时数据 | 各服务工作目录不同，天然隔离 |
| 站点 | 新域名 + `/ws` 反代到新端口 |

### 另一台服务器

完全重复 §2，GitHub 侧使用 `_2` 后缀的 secrets 和第二个 workflow 文件。

### 同一仓库、多个站点

`Settings → Environments` 或每个站点一组 secret 名，workflow 里用 `if` 或拆成 `deploy-site1.yml` / `deploy-site2.yml`。

---

## 7. 排错表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Permission denied (publickey)` | 公钥没加到服务器 | 把 `.pub` 追加到 `authorized_keys` |
| `Host key verification failed` / `REMOTE HOST IDENTIFICATION HAS CHANGED` | `SERVER_HOST` 指错机器，或主机公钥没固定 | `dig +short 域名` 核对；`ssh-keyscan -t ed25519 <HOST>` 重新取 |
| `Load key ... error in libcrypto` | `SSH_PRIVATE_KEY` 填成了公钥/不完整 | 贴完整私钥（含 `BEGIN/END`） |
| workflow 绿但网站没变 | 文件不在 `RUNTIME_PATHS` 里，或路径写错 | 检查脚本数组和 `WEB_ROOT` |
| 网站变了但服务没变 | 服务加载的是另一个目录，或没重启 | `ps -ef` + `readlink /proc/<PID>/cwd` 找真实目录；确认 `SERVICE_RESTART_CMD` |
| `git pull` 报冲突 | 服务器上有本地修改 | 先备份/还原，再 `git pull --ff-only` |
| 服务起不来 | 端口占用、权限不足、Node 路径错 | `journalctl -u <APP>-server -n 50` |
| 配置保存失败 | 工作目录不可写 | 改 `WorkingDirectory` 或调整属主 |

---

## 8. 有构建步骤的项目

上面的方案假设「仓库里的文件就是上线文件」。如果必须先 `npm run build`：

**方案 A（推荐）**：Actions 构建 + `rsync` 上传：

```yaml
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run build
      - run: |
          rsync -az --delete dist/ "$USER@$HOST:/www/wwwroot/<site>/"
```

注意：

- `--delete` 会删掉目标目录里不在 `dist/` 的文件，**不要**对媒体/上传目录做镜像；
- 上传后如果还有常驻服务，另加一步 `ssh ... 'systemctl restart <APP>-server'`。

**方案 B**：仍然 `git pull`，让服务器在钩子里执行构建（占用服务器 CPU，慢，不推荐）。

---

## 9. 安全与注意事项

1. 私钥只放 GitHub Secrets，绝不提交；泄露后立刻删除密钥并重新授权。
2. `authorized_keys` 用 `command=` 限制只能执行部署命令。
3. `scripts/deploy.env` 不要提交（`.gitignore`）。
4. 仓库克隆不放进网站目录。
5. 首次全量同步、切换分支前先备份。
6. 自动部署会重启服务，在线连接会短暂中断——挑低峰期发版。
7. 只允许 `main` 触发；其他分支走 PR 合并。

---

## 10. 模板文件清单

复制到新项目后改名字即可：

| 文件 | 作用 | 需要改的 |
| --- | --- | --- |
| `scripts/deploy.sh` | 同步 + 重启 | `RUNTIME_PATHS`、配置项名 |
| `scripts/deploy.env.example` | 配置模板 | 三个路径 |
| `.github/workflows/deploy.yml` | push 触发部署 | secrets 名、`known_hosts`、仓库路径 |
| 本文档 | 操作手册 | 占位符 |
