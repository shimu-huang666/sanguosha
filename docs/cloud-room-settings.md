# 联机房间云端设置

## 启用

1. 更新游戏网页的运行文件。此功能改动了 `mode/doudizhu.js`、`noname/game/index.js`、`noname/init/index.js`、`noname/library/index.js` 和 `noname/ui/create/menu/pages/startMenu.js`。线上有其他功能分支的改动时，先合并分支，再用合并后的文件更新网页。
2. 用本仓库的 `lobby/dist/cli.cjs` 覆盖现有大厅项目里的 `dist/cli.cjs`。覆盖后重启大厅。沿用现有的大厅启动命令和 WebSocket 地址。
3. 网页重新加载后，进入「联机大厅 → 创建房间」。在「模式」「武将」「卡牌」里设置规则，回到「模式」点「保存联机设置到云端」。看到保存成功即可建房。

保存会一次发布各联机模式的本机房间规则，包括武将包、禁用武将、「仅点将可用」、卡牌包、禁用卡牌和智斗三国自定义将池。大厅玩家都可以保存。每个新房间都会从大厅读取最近一次保存的对应模式设置。单机偏好留在本机，房内临时调整的模式规则只作用于当前房间。

默认保存到大厅工作目录的 `room-settings.json`。重启时从该文件恢复。需要指定存放位置时，将 `NONAME_ROOM_SETTINGS_FILE` 设为大厅进程有写权限的文件路径。

## 手机

手机浏览器打开更新后的游戏页面、连接同一个大厅，创建和加入房间都会自动使用房间配置。安卓 App 的房主需要使用包含上述更新的客户端。与游戏版本兼容的旧 App 可以作为玩家加入，由房主同步房间配置。

## 构建大厅运行文件

在仓库根目录运行以下命令。大厅部署沿用现有的 `ws` 依赖。

```powershell
npx esbuild@0.25.12 lobby/src/cli.ts --bundle --platform=node --format=cjs --target=node20 --external:ws --outfile=lobby/dist/cli.cjs
```
