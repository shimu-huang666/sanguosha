import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type RoomSettings = Record<string, Record<string, unknown>>;

const maxFileSize = 1024 * 1024;
// Exclude live room fields and the client's special object marker.
const reservedFields = new Set(["mode", "version", "number", "gameStarted", "observeReady", "roomSettingsFromCloud", "a60e024487f63a67c634d782aaaf1127"]);
const listFields = ["characterPack", "cardPack", "banned", "bannedcards", "zhinang_tricks", "forbidai"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSettingName(name: string): boolean {
	return /^[\p{L}\p{N}_-]{1,128}$/u.test(name) && !name.startsWith("_noname_") &&
		name !== "prototype" && !Object.prototype.hasOwnProperty.call(Object.prototype, name);
}

function isSettingText(value: unknown): value is string {
	return typeof value === "string" && value.length <= 128 && !value.startsWith("_noname_") &&
		!/[<>]/.test(value);
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isSettingText);
}

function isRoomSettings(value: unknown): value is RoomSettings {
	if (!isRecord(value) || !Object.keys(value).length) return false;

	return Object.entries(value).every(([mode, config]) => {
		if (!isSettingName(mode) || !isRecord(config) || !listFields.every(key => isStringList(config[key]))) {
			return false;
		}

		return Object.entries(config).every(([key, setting]) => {
			if (!isSettingName(key) || reservedFields.has(key)) return false;
			if (key === "character_online" && mode === "doudizhu") {
				if (setting === null) return true;
				if (!isRecord(setting)) return false;

				const groups = Object.entries(setting);
				return groups.every(([group, characters]) => isSettingName(group) && isStringList(characters)) &&
					groups.filter(([, characters]) => Array.isArray(characters) && characters.length >= 3).length >= 3;
			}
			return typeof setting === "boolean" || Number.isFinite(setting) || isSettingText(setting) || isStringList(setting);
		});
	});
}

export function openRoomSettings() {
	const file = resolve(process.env.NONAME_ROOM_SETTINGS_FILE || "room-settings.json");
	let settings: RoomSettings | undefined;

	try {
		const saved = readFileSync(file);
		if (saved.byteLength > maxFileSize) throw new Error("Room settings file is too large: " + file);
		const parsed: unknown = JSON.parse(saved.toString("utf8"));
		if (!isRoomSettings(parsed)) {
			throw new Error("Invalid room settings file: " + file);
		}
		settings = parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	return {
		get isConfigured() {
			return settings !== undefined;
		},
		get(mode: unknown) {
			return typeof mode === "string" && settings && Object.hasOwn(settings, mode) ? settings[mode] : undefined;
		},
		save(value: unknown) {
			const data = JSON.stringify(value);
			if (!data || Buffer.byteLength(data) > maxFileSize || !isRoomSettings(value)) {
				return "invalid";
			}

			try {
				writeFileSync(file + ".tmp", data, { mode: 0o600 });
				renameSync(file + ".tmp", file);
				settings = value;
				return "ok";
			} catch (error) {
				console.error("Unable to save room settings:", error);
				return "storage";
			}
		},
	};
}
