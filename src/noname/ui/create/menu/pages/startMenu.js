import { menuContainer, popupContainer, updateActive, setUpdateActive, updateActiveCard, setUpdateActiveCard, menux, menuxpages, menuUpdates, openMenu, clickToggle, clickSwitcher, clickContainer, clickMenuItem, createMenu, createConfig } from "../index.js";
import { ui, game, get, ai, lib, _status } from "noname";

export const startMenu = function (connectMenu) {
	/**
	 * 由于联机模式会创建第二个菜单，所以需要缓存一下可变的变量
	 */
	const cacheMenuContainer = menuContainer;
	// const cachePopupContainer = popupContainer;
	// const cacheMenux = menux;
	const cacheMenuxpages = menuxpages;
	/** @type { HTMLDivElement } */
	// @ts-expect-error ignore
	var start = cacheMenuxpages.shift();
	var rightPane = start.lastChild;
	let roomConfigChanges = null;
	if (connectMenu) {
		const roomOptions = {
			connect_choose_timeout: {
				name: "出牌时限",
				init: "30",
				item: {
					10: "10秒",
					15: "15秒",
					30: "30秒",
					60: "60秒",
					90: "90秒",
				},
				connect: true,
				frequent: true,
			},
			connect_observe: {
				name: "允许旁观",
				init: true,
				connect: true,
			},
			connect_observe_handcard: {
				name: "允许观看手牌",
				init: false,
				connect: true,
			},
			connect_mount_combine: {
				name: "合并坐骑栏",
				init: false,
				connect: true,
			},
		};
		for (const info of Object.values(lib.mode)) {
			if (info.connect) Object.assign(info.connect, roomOptions);
		}

		menuUpdates.push(() => {
			roomConfigChanges = null;
			if (!_status.waitingForPlayer || !lib.configOL.roomSettingsFromCloud) return;

			const activeMode = start.firstChild.querySelector(".active");
			if (!activeMode) return;
			if (!activeMode.link) {
				activeMode._initLink();
				rightPane.appendChild(activeMode.link);
			}
			roomConfigChanges = {};
			activeMode.loadRoomConfig();
		});
	}


	/** 启动按钮 */
	let startButton = ui.create.div(".menubutton.round.highlight", "启", start, function () {
		if (this.animating || this.classList.contains("dim")) {
			return;
		}
		var active = this.parentNode.querySelector(".active");
		if (active) {
			if (connectMenu) {
				if (_status.waitingForPlayer) {
					let config = roomConfigChanges;
					if (!config) {
						config = {};
						for (var i in lib.mode[lib.configOL.mode].connect) {
							if (i == "update") {
								continue;
							}
							config[i.slice(8)] = get.config(i, lib.configOL.mode);
						}
						config.zhinang_tricks = lib.config.connect_zhinang_tricks;
					}
					if (!Object.keys(config).length) {
						clickContainer.call(cacheMenuContainer, connectMenu);
						return;
					}
					if (game.online) {
						if (game.onlinezhu) {
							game.send("changeRoomConfig", config);
						}
					} else {
						game.broadcastAll(function (config) {
							for (var i in config) {
								lib.configOL[i] = config[i];
							}
						}, config);
						if (lib.configOL.mode == "identity" && lib.configOL.identity_mode == "zhong" && game.connectPlayers) {
							for (var i = 0; i < game.connectPlayers.length; i++) {
								game.connectPlayers[i].classList.remove("unselectable2");
							}
							lib.configOL.number = 8;
							game.updateWaiting();
						}
						if (game.onlineroom) {
							game.send("server", "config", lib.configOL);
						}
						game.connectPlayers[0].chat("房间设置已更改");
					}
				} else if (_status.enteringroom || _status.creatingroom) {
					lib.configOL.mode = active.mode;
					const mode = lib.configOL.mode;
					const legacyConfig = _status.enteringroomserver ? game.getRoomConfig(mode) : null;
					if (_status.enteringroomserver) {
						game.saveConfig("connect_mode", mode);
					}
					game.send("server", "create", game.onlineKey, get.connectNickname(), lib.config.connect_avatar, legacyConfig, mode, 1);
				} else {
					localStorage.setItem(lib.configprefix + "directstart", true);
					game.saveConfig("directstartmode", active.mode);
					game.saveConfig("mode", "connect");
					ui.exitroom = ui.create.system(
						"退出房间",
						function () {
							game.saveConfig("directstartmode");
							game.reload();
						},
						true
					);
					game.switchMode(active.mode);
					game.requireSandboxOn();
				}
				clickContainer.call(cacheMenuContainer, connectMenu);
			} else {
				game.saveConfig("mode", active.mode);
				localStorage.setItem(lib.configprefix + "directstart", true);
				game.reload();
			}
		}
	});

	var clickMode = function () {
		if (this.classList.contains("unselectable")) {
			return;
		}
		var active = this.parentNode.querySelector(".active");
		if (active === this) {
			return;
		}
		active.classList.remove("active");
		active.link.remove();
		active = this;
		this.classList.add("active");
		if (this.link) {
			rightPane.appendChild(this.link);
		} else {
			this._initLink();
			rightPane.appendChild(this.link);
		}
		if (connectMenu) {
			if (updateActive) {
				updateActive();
			}
			if (updateActiveCard) {
				updateActiveCard();
			}
		}
	};

	var createModeConfig = function (mode, position) {
		var info = lib.mode[mode];
		var page = ui.create.div("");
		var node = ui.create.div(".menubutton.large", info.name, position, clickMode);
		node.mode = mode;
		var connectDisplayMap = {
			connect_player_number: null,
			connect_versus_mode: null,
		};
		var updateConnectDisplayMap = function () {
			if (_status.waitingForPlayer) {
				if (connectDisplayMap.connect_player_number) {
					connectDisplayMap.connect_player_number.style.display = "none";
				}
				if (connectDisplayMap.connect_versus_mode) {
					connectDisplayMap.connect_versus_mode.style.display = "none";
				}
			}
		};
		if (connectMenu) {
			menuUpdates.push(updateConnectDisplayMap);
			if (mode == lib.config.connect_mode) {
				node.classList.add("active");
			}
		} else {
			if (mode == lib.config.mode) {
				node.classList.add("active");
			}
		}
		node._initLink = function () {
			node.link = page;
			if (connectMenu) {
				const saveSettings = ui.create.div(".config.pointerspan", "<span>保存联机设置到云端</span>", page, function () {
					if (game.ws?.readyState !== WebSocket.OPEN || !_status.creatingroom) return;

					const forbidai = new Set([...lib.baseForbidai, ...lib.config.forbidai_user]);
					for (const pack of lib.connectCharacterPack) {
						if (lib.config["forbidai_user_" + pack]) {
							for (const name of Object.keys(lib.characterPack[pack])) forbidai.add(name);
						}
					}

					const aiBans = [...forbidai];
					const settings = Object.fromEntries(
						Object.keys(lib.mode).filter(mode => lib.mode[mode].connect).map(mode => [mode, { ...game.getRoomConfig(mode), forbidai: aiBans }])
					);
					if (settings.doudizhu) {
						settings.doudizhu.character_online = get.config("character_online", "doudizhu") ?? null;
					}
					game.send("server", "saveRoomSettings", settings);
				});
				const updateSaveSettings = () => {
					saveSettings.style.display = _status.creatingroom && game.ws?.canSaveRoomSettings ? "" : "none";
				};
				menuUpdates.push(updateSaveSettings);
				updateSaveSettings();
			}
			//“更多”下的内容
			var map = {};
			var infoconfig = connectMenu ? info.connect : info.config;
			let config = lib.config.mode_config[mode] || {};
			if (infoconfig) {
				var hiddenNodes = [];
				for (var j in infoconfig) {
					if (j === "update") {
						continue;
					}
					const cfg = get.copy(infoconfig[j]);
					cfg._name = j;
					cfg.mode = mode;
					cfg.saveValue = value => {
						if (!roomConfigChanges) {
							game.saveConfig(cfg._name, value, mode);
							return;
						}
						const key = cfg._name.slice(8);
						config[cfg._name] = value;
						if (value === lib.configOL[key]) {
							delete roomConfigChanges[key];
						} else {
							roomConfigChanges[key] = value;
						}
					};
					if (j in config) {
						cfg.init = config[j];
					} else {
						game.saveConfig(j, cfg.init, mode);
					}
					if (!cfg.onclick) {
						cfg.onclick = function (result) {
							var cfg = this._link.config;
							cfg.saveValue(result);
						if (roomConfigChanges) return;
							if (cfg.onsave) {
								cfg.onsave.call(this, result);
							}
							if (!_status.connectMode || game.online) {
								if (typeof cfg.restart == "function") {
									if (cfg.restart()) {
										startButton.classList.add("glowing");
									}
								} else if (cfg.restart) {
									startButton.classList.add("glowing");
								}
							}
						};
					}
					if (infoconfig.update) {
						cfg.update = function () {
							infoconfig.update(config, map);
						};
					}
					var cfgnode = createConfig(cfg);
					map[j] = cfgnode;
					if (cfg.frequent) {
						page.appendChild(cfgnode);
					} else {
						cfgnode.classList.add("auto-hide");
						hiddenNodes.push(cfgnode);
					}
				}
				if (!connectMenu) {
					var move = ui.create.div(".auto-hide.config", '<div style="margin-right:10px" class="pointerdiv">上移↑</div><div class="pointerdiv">下移↓</div>');
					move.firstChild.listen(function () {
						if (node.previousSibling) {
							node.parentNode.insertBefore(node, node.previousSibling);
							var order = [];
							for (var i = 0; i < node.parentNode.childNodes.length; i++) {
								order.push(node.parentNode.childNodes[i].mode);
							}
							game.saveConfig("modeorder", order);
						}
					});
					move.lastChild.listen(function () {
						if (node.nextSibling) {
							if (node.nextSibling.nextSibling) {
								node.parentNode.insertBefore(node, node.nextSibling.nextSibling);
							} else {
								node.parentNode.insertBefore(node.nextSibling, node);
							}
							var order = [];
							for (var i = 0; i < node.parentNode.childNodes.length; i++) {
								order.push(node.parentNode.childNodes[i].mode);
							}
							game.saveConfig("modeorder", order);
						}
					});
					hiddenNodes.push(move);
				}
				var expanded = false;
				var hasexpand = true;
				if (hiddenNodes.length) {
					if (lib.config.fold_mode) {
						var clickmore = function (type) {
							if (type === "expand" && expanded) {
								return;
							}
							if (type === "unexpand" && !expanded) {
								return;
							}
							if (expanded) {
								this.classList.remove("on");
								this.parentNode.classList.remove("expanded");
							} else {
								this.classList.add("on");
								this.parentNode.classList.add("expanded");
							}
							expanded = !expanded;
						};
						var morenodes = ui.create.div(".config.more", "更多 <div>&gt;</div>", page);
						morenodes.listen(clickmore);
						morenodes._onclick = clickmore;
						page.morenodes = morenodes;
					} else {
						page.classList.add("expanded");
						if (!connectMenu) {
							page.classList.add("expanded2");
						}
					}
					for (var k = 0; k < hiddenNodes.length; k++) {
						page.appendChild(hiddenNodes[k]);
					}
				} else {
					hasexpand = false;
				}
				if (!connectMenu) {
					var hidemode = ui.create.div(".config.pointerspan", "<span>隐藏此模式</span>", page, function () {
						if (this.firstChild.innerHTML == "隐藏此模式") {
							this.firstChild.innerHTML = "此模式将在重启后隐藏";
							lib.config.hiddenModePack.add(mode);
							if (!lib.config.prompt_hidepack) {
								alert("隐藏的扩展包可通过选项-其它-重置隐藏内容恢复");
								game.saveConfig("prompt_hidepack", true);
							}
						} else {
							this.firstChild.innerHTML = "隐藏此模式";
							lib.config.hiddenModePack.remove(mode);
						}
						game.saveConfig("hiddenModePack", lib.config.hiddenModePack);
					});
					if (hasexpand) {
						hidemode.classList.add("auto-hide");
					}
				}
				if (infoconfig.update) {
					infoconfig.update(config, map);
					node.update = function () {
						infoconfig.update(config, map);
					};
				}
			}
			if (connectMenu) {
				node.loadRoomConfig = () => {
					config = {};
					for (const [key, field] of Object.entries(map)) {
						const value = lib.configOL[key.slice(8)] ?? infoconfig[key].init;
						config[key] = value;
						const { choosing, config: definition } = field._link;
						if (choosing) {
							field._link.current = value;
							choosing.innerHTML = definition.item[value] ?? value;
						} else if (definition.input) {
							field.lastChild.textContent = value;
						} else if (field.classList.contains("toggle")) {
							field.classList.toggle("on", value === true);
						}
					}
					node.update?.();
					updateConnectDisplayMap();
				};
				connectDisplayMap.connect_player_number = map.connect_player_number;
				connectDisplayMap.connect_versus_mode = map.connect_versus_mode;
				updateConnectDisplayMap();
			}
		};
		if (!get.config("menu_loadondemand")) {
			node._initLink();
		}
		return node;
	};
	var modeorder = lib.config.modeorder || [];
	for (var i in lib.mode) {
		modeorder.add(i);
	}
	for (var i = 0; i < modeorder.length; i++) {
		if (connectMenu) {
			if (!lib.mode[modeorder[i]].connect) {
				continue;
			}
			if (!lib.config["connect_" + modeorder[i] + "_banned"]) {
				lib.config["connect_" + modeorder[i] + "_banned"] = [];
			}
			if (!lib.config["connect_" + modeorder[i] + "_bannedcards"]) {
				lib.config["connect_" + modeorder[i] + "_bannedcards"] = [];
			}
		}
		if (lib.config.all.mode.includes(modeorder[i])) {
			createModeConfig(modeorder[i], start.firstChild);
		}
	}
	var active = start.firstChild.querySelector(".active");
	if (!active) {
		active = start.firstChild.firstChild;
		active.classList.add("active");
	}
	if (!active.link) {
		active._initLink();
	}
	rightPane.appendChild(active.link);
	if (lib.config.fold_mode) {
		rightPane.addEventListener(
			"mousewheel",
			function (e) {
				var morenodes = this.firstChild.morenodes;
				if (morenodes) {
					if (e.wheelDelta < 0) {
						morenodes._onclick.call(morenodes, "expand");
					} else if (this.scrollTop == 0) {
						morenodes._onclick.call(morenodes, "unexpand");
					}
				}
			},
			{ passive: true }
		);
	}

	return startButton;
};
