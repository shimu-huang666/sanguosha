import { game, get, lib, ui, _status } from "noname";

export const type = "extension";

export default {
	name: "云端建房",
	editable: false,
	connect: true,
	package: {
		nopack: true,
		intro: "让旧版客户端在支持云端设置的联机大厅开房，并自动使用大厅保存的配置。",
		version: "1.0.0",
	},

	precontent() {
		// 新版客户端已有云端建房逻辑。
		if (typeof game.getRoomConfig === "function") return;

		const messages = lib.message.client;
		const roomlist = messages.roomlist;
		messages.roomlist = function (list, events, clients, wsid, canSaveRoomSettings) {
			if (game.ws) game.ws.canSaveRoomSettings = canSaveRoomSettings === true;
			return roomlist.apply(this, arguments);
		};

		const send = game.send;
		game.send = function (channel, action, key, nickname, avatar, config, mode) {
			if (channel !== "server" || action !== "create" || !game.ws?.canSaveRoomSettings) {
				return send.apply(this, arguments);
			}
			const roomMode = mode || lib.configOL?.mode || lib.config.connect_mode;
			return send.call(this, channel, action, key, nickname, avatar, config ?? null, roomMode, 1);
		};

		const createroom = messages.createroom;
		messages.createroom = function (index, config, mode, fromCloud) {
			if (fromCloud !== true || !game.ws?.canSaveRoomSettings) {
				return createroom.apply(this, arguments);
			}
			game.online = false;
			game.onlineroom = true;
			game.roomId = index;
			lib.node = {};
			lib.configOL = { roomSettingsFromCloud: true };
			game.switchMode(mode, config);
			ui.create.connecting(true);
		};

		const characterDisabled = lib.filter.characterDisabled;
		lib.filter.characterDisabled = function (name, characters, ...options) {
			const room = lib.configOL;
			if (!_status.connectMode || !room?.roomSettingsFromCloud || !Array.isArray(room.forbidai) || options.includes("ignoreForibidden")) {
				return characterDisabled.apply(this, arguments);
			}
			const character = lib.character[name];
			if (room.forbidai.includes(name) || character?.isAiForbidden || character?.isBoss || character?.isHiddenBoss) {
				return true;
			}
			return characterDisabled.call(this, name, characters, ...options, "ignoreForibidden");
		};

		const getConfig = get.config;
		get.config = function (key, mode) {
			const room = lib.configOL;
			if (key === "character_online" && (!mode || mode === "doudizhu") &&
				_status.connectMode && room?.roomSettingsFromCloud && room.mode === "doudizhu" &&
				Object.prototype.hasOwnProperty.call(room, key)) {
				return room[key] == null ? undefined : get.copy(room[key]);
			}
			return getConfig.apply(this, arguments);
		};
	},
};
