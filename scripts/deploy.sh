#!/usr/bin/env bash
# 自动部署：git pull 之后把运行文件同步到网站目录，并在需要时重启大厅。
#
#   scripts/deploy.sh                 拉取最新提交并同步变更
#   scripts/deploy.sh --no-pull       只同步（post-merge 钩子里使用）
#   scripts/deploy.sh --full          全量同步当前提交的运行文件
#   scripts/deploy.sh --dry-run       只打印将要执行的操作
#   scripts/deploy.sh --install-hook  安装 post-merge 钩子
#
# 服务器相关的路径和重启命令写在 scripts/deploy.env，参考 scripts/deploy.env.example。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

CONFIG_FILE="${NONAME_DEPLOY_CONFIG:-$REPO_DIR/scripts/deploy.env}"
if [[ -f "$CONFIG_FILE" ]]; then
	# shellcheck disable=SC1090
	source "$CONFIG_FILE"
fi

WEB_ROOT="${WEB_ROOT:-/www/wwwroot/sanguosha}"
LOBBY_DIST_TARGET="${LOBBY_DIST_TARGET:-}"
LOBBY_RESTART_CMD="${LOBBY_RESTART_CMD:-}"

# 与 打包部署.cmd 保持一致：只同步这些运行文件。
# audio / image / font 不在 git 里，网站目录中的这些文件夹不会被改动。
RUNTIME_PATHS=(
	_virtual
	card
	character
	extension
	game
	layout
	mode
	node_modules
	noname
	theme
	index.html
	jit-test.ts
	noname.js
	service-worker.js
	lobby/dist/cli.cjs
)

NO_PULL=0
FULL=0
DRY_RUN=0
INSTALL_HOOK=0

usage() {
	cat <<'EOF'
用法: scripts/deploy.sh [选项]

  --no-pull        不再执行 git pull，只同步（post-merge 钩子用）
  --full           全量同步当前提交的运行文件（首次部署用）
  --dry-run        只打印，不写文件、不重启
  --install-hook   安装 post-merge 钩子后退出
  -h, --help       显示帮助

配置: scripts/deploy.env（参考 scripts/deploy.env.example）
EOF
}

for arg in "$@"; do
	case "$arg" in
		--no-pull) NO_PULL=1 ;;
		--full) FULL=1 ;;
		--dry-run) DRY_RUN=1 ;;
		--install-hook) INSTALL_HOOK=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "未知参数: $arg" >&2
			usage >&2
			exit 2
			;;
	esac
done

if [[ "$INSTALL_HOOK" == 1 ]]; then
	hook="$REPO_DIR/.git/hooks/post-merge"
	mkdir -p "$(dirname "$hook")"
	cat >"$hook" <<'HOOK'
#!/bin/sh
# 由 scripts/deploy.sh --install-hook 安装
repo=$(git rev-parse --show-toplevel) || exit 0
exec bash "$repo/scripts/deploy.sh" --no-pull
HOOK
	chmod +x "$hook"
	echo "已安装 post-merge 钩子: $hook"
	exit 0
fi

if [[ ! -d "$WEB_ROOT" ]]; then
	echo "网站目录不存在: $WEB_ROOT" >&2
	echo "请先在 $CONFIG_FILE 里设置 WEB_ROOT" >&2
	exit 1
fi

if [[ "$NO_PULL" == 1 ]]; then
	# post-merge 钩子里 HEAD@{1} 就是 pull 之前的提交。
	OLD="$(git rev-parse -q --verify 'HEAD@{1}' || true)"
	NEW="$(git rev-parse --verify HEAD)"
	[[ -z "$OLD" ]] && OLD="$NEW"
else
	OLD="$(git rev-parse --verify HEAD)"
	git pull --ff-only
	NEW="$(git rev-parse --verify HEAD)"
fi

if [[ "$FULL" == 0 && "$OLD" == "$NEW" ]]; then
	echo "没有新的提交，跳过同步。"
	exit 0
fi

declare -a STATUS=()
declare -a FILES=()

if [[ "$FULL" == 1 ]]; then
	while IFS= read -r path; do
		STATUS+=("A")
		FILES+=("$path")
	done < <(git ls-tree -r --name-only "$NEW" -- "${RUNTIME_PATHS[@]}")
else
	while IFS=$'\t' read -r status path; do
		[[ -z "$path" ]] && continue
		STATUS+=("${status:0:1}")
		FILES+=("$path")
	done < <(git -c core.quotepath=false diff --no-renames --name-status "$OLD" "$NEW" -- "${RUNTIME_PATHS[@]}")
fi

copied=0
removed=0
lobby_changed=0

for i in "${!FILES[@]}"; do
	status="${STATUS[$i]}"
	path="${FILES[$i]}"
	[[ "$path" == "lobby/dist/cli.cjs" ]] && lobby_changed=1

	if [[ "$status" == "D" ]]; then
		if [[ -e "$WEB_ROOT/$path" ]]; then
			if [[ "$DRY_RUN" == 1 ]]; then
				echo "  [dry] 删除 $path"
			else
				rm -f "$WEB_ROOT/$path"
				echo "  删除 $path"
			fi
			removed=$((removed + 1))
		fi
		continue
	fi

	if [[ "$DRY_RUN" == 1 ]]; then
		echo "  [dry] 更新 $path"
	else
		dest="$WEB_ROOT/$path"
		mkdir -p "$(dirname "$dest")"
		git show "$NEW:$path" >"$dest.tmp.$$"
		mv -f "$dest.tmp.$$" "$dest"
		echo "  更新 $path"
	fi
	copied=$((copied + 1))
done

echo "同步完成：更新 $copied 个文件，删除 $removed 个文件。"

if [[ "$lobby_changed" == 1 ]]; then
	if [[ -n "$LOBBY_DIST_TARGET" ]]; then
		if [[ "$DRY_RUN" == 1 ]]; then
			echo "  [dry] 复制 cli.cjs 到 $LOBBY_DIST_TARGET"
		else
			cp -f "$WEB_ROOT/lobby/dist/cli.cjs" "$LOBBY_DIST_TARGET"
			echo "  已复制 cli.cjs 到 $LOBBY_DIST_TARGET"
		fi
	fi

	if [[ -n "$LOBBY_RESTART_CMD" ]]; then
		if [[ "$DRY_RUN" == 1 ]]; then
			echo "  [dry] 重启大厅: $LOBBY_RESTART_CMD"
		else
			echo "  重启大厅: $LOBBY_RESTART_CMD"
			bash -c "$LOBBY_RESTART_CMD"
		fi
	else
		echo "  注意：大厅文件有更新，但未配置 LOBBY_RESTART_CMD，请手动重启大厅。"
	fi
fi
