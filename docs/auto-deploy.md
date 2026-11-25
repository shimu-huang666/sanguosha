# 自动部署：`git pull` 后自动更新网站

## 效果

在服务器上执行：

```bash
cd /www/noname-src
git pull
```

就会自动：

1. 把这次提交里变动的运行文件同步到网站目录（默认 `/www/wwwroot/sanguosha`）；
2. 删除仓库里已删除的文件；
3. 如果 `lobby/dist/cli.cjs` 有变化，把它复制到大厅真实运行目录，并执行重启命令。

同步的路径和 `打包部署.cmd` 一致：`_virtual`、`card`、`character`、`extension`、`game`、`layout`、`mode`、`node_modules`、`noname`、`theme`、`index.html`、`jit-test.ts`、`noname.js`、`service-worker.js`、`lobby/dist/cli.cjs`。

`audio/`、`image/`、`font/` 不在 git 里，网站目录里的这些文件夹不会被改动。

## 原理

```
GitHub ──git pull──▶ /www/noname-src（仓库 clone）
                              │ post-merge 钩子
                              ▼
                     scripts/deploy.sh --no-pull
                              │ 只同步变动的运行文件
                              ▼
                 /www/wwwroot/sanguosha（nginx 网站目录）
                              │ lobby/dist/cli.cjs 有变化时
                              ▼
                     复制到大厅目录 + 重启大厅
```

仓库不要放在网站目录里，否则 `https://站点/.git/config` 可能被直接下载。

## 一次性安装

在服务器上执行（root 或有写权限的账号）：

```bash
# 1. 克隆仓库（放网站目录之外）
cd /www
git clone git@github.com:shimu-huang666/sanguosha.git noname-src
cd noname-src

# 2. 写配置
cp scripts/deploy.env.example scripts/deploy.env
vi scripts/deploy.env

# 3. 安装 post-merge 钩子
bash scripts/deploy.sh --install-hook

# 4. 首次同步（见下方说明，可先不执行）
bash scripts/deploy.sh --full
```

### 配置 `scripts/deploy.env`

| 配置项 | 说明 |
| --- | --- |
| `WEB_ROOT` | 网站目录，默认 `/www/wwwroot/sanguosha` |
| `LOBBY_DIST_TARGET` | 大厅进程实际加载的 `dist/cli.cjs` 路径；留空表示只更新网站目录里的那份 |
| `LOBBY_RESTART_CMD` | 重启大厅的命令；留空表示不自动重启 |

找大厅真实路径：

```bash
ps -ef | grep cli.cjs | grep -v grep
readlink /proc/<PID>/cwd
```

例如进程在 `/www/noname-services`，则：

```bash
LOBBY_DIST_TARGET=/www/noname-services/dist/cli.cjs
LOBBY_RESTART_CMD="pm2 restart noname-lobby"      # pm2
# LOBBY_RESTART_CMD="systemctl restart noname-lobby"   # systemd
# 宝塔 Node 项目也可以在面板里重启，此时留空 LOBBY_RESTART_CMD
```

### 首次同步跑不跑 `--full`

- 跑：网站运行文件与 GitHub `main` 完全对齐，最干净。
- 不跑：只从下一次 `git pull` 开始增量同步，网站保持现状直到对应文件在 `main` 里发生变化。

注意：目前线上还带着两个未合进 `main` 的分支功能（讨论延时、房主改昵称）。`--full` 会用 `main` 覆盖这些文件，导致这两个功能从线上消失。还需要的话，先把 `codex/discussion-timer`、`codex/host-rename-player` 合并进 `main` 再切换。

切换前建议先备份（不含大媒体）：

```bash
tar -czf /www/sanguosha-backup-$(date +%F).tgz \
  -C /www/wwwroot/sanguosha --exclude=audio --exclude=image --exclude=font .
```

## 日常更新

```bash
cd /www/noname-src
git pull
```

`git pull` 的输出里会列出「更新 / 删除」了哪些文件。

如果连登录服务器都省掉，可以加个定时任务，每 5 分钟自动拉取：

```bash
crontab -e
```

```cron
*/5 * * * * cd /www/noname-src && git pull --quiet >>/var/log/noname-src-pull.log 2>&1
```

## 可选：push 后立即部署（GitHub Actions）

仓库里的 `.github/workflows/deploy.yml` 会在 `push` 到 `main` 后，通过 SSH 到服务器执行 `cd /www/noname-src && git pull --ff-only`，把上面「日常更新」那一步提前到 push 时触发。

需要：

- 服务器上给部署用户配置好公钥（`~/.ssh/authorized_keys`）；
- 仓库 Secrets 里配置 `SERVER_HOST`、`SERVER_PORT`、`SERVER_USER`、`SSH_PRIVATE_KEY`、`SSH_KNOWN_HOSTS`。

启用后可以把服务器上的 cron 删掉，避免同一件事做两遍。

## 访问 GitHub

仓库是私有的话，服务器需要有读权限：

- 用 Deploy Key（只读）：把 `github_deploy` 私钥放到服务器的 `~/.ssh/`，在 `~/.ssh/config` 里给 `github.com` 指定 `IdentityFile`；或
- 用 HTTPS + Personal Access Token。

## 注意事项

1. **大厅重启会断开在线连接**。不想每次自动重启就把 `LOBBY_RESTART_CMD` 留空，改成手动。
2. 脚本是幂等的：没有新提交直接退出；`git pull` 冲突时会中止，不会写坏网站。
3. 网站目录里的那一份 `lobby/dist/cli.cjs` 只是静态文件，真正生效与否取决于大厅进程加载的是哪个文件、有没有重启。
4. 删除只针对仓库里跟踪的文件，不会动 `audio/`、`image/`、`font/` 和 `room-settings.json` 等运行时文件。

## 验证

- 推一个改动 → 服务器 `git pull` → 输出里有「更新 xxx」；
- 浏览器强刷（`Ctrl+Shift+R`）后能看到变化；
- 大厅更新后，连上大厅在控制台执行 `game.ws.canSaveRoomSettings` 应为 `true`。
