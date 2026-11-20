#!/usr/bin/env node

// lobby/src/server/createServer.ts
var import_ws = require("ws");

// lobby/src/server/roomSettings.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var maxFileSize = 1024 * 1024;
var reservedFields = /* @__PURE__ */ new Set(["mode", "version", "number", "gameStarted", "observeReady", "roomSettingsFromCloud", "a60e024487f63a67c634d782aaaf1127"]);
var listFields = ["characterPack", "cardPack", "banned", "bannedcards", "zhinang_tricks", "forbidai"];
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isSettingName(name) {
  return /^[\p{L}\p{N}_-]{1,128}$/u.test(name) && !name.startsWith("_noname_") && name !== "prototype" && !Object.prototype.hasOwnProperty.call(Object.prototype, name);
}
function isSettingText(value) {
  return typeof value === "string" && value.length <= 128 && !value.startsWith("_noname_") && !/[<>]/.test(value);
}
function isStringList(value) {
  return Array.isArray(value) && value.every(isSettingText);
}
function isRoomSettings(value) {
  if (!isRecord(value) || !Object.keys(value).length) return false;
  return Object.entries(value).every(([mode, config]) => {
    if (!isSettingName(mode) || !isRecord(config) || !listFields.every((key) => isStringList(config[key]))) {
      return false;
    }
    return Object.entries(config).every(([key, setting]) => {
      if (!isSettingName(key) || reservedFields.has(key)) return false;
      if (key === "character_online" && mode === "doudizhu") {
        if (setting === null) return true;
        if (!isRecord(setting)) return false;
        const groups = Object.entries(setting);
        return groups.every(([group, characters]) => isSettingName(group) && isStringList(characters)) && groups.filter(([, characters]) => Array.isArray(characters) && characters.length >= 3).length >= 3;
      }
      return typeof setting === "boolean" || Number.isFinite(setting) || isSettingText(setting) || isStringList(setting);
    });
  });
}
function openRoomSettings() {
  const file = (0, import_node_path.resolve)(process.env.NONAME_ROOM_SETTINGS_FILE || "room-settings.json");
  const adminToken = Buffer.from(process.env.NONAME_ROOM_SETTINGS_TOKEN || "");
  let settings;
  try {
    const saved = (0, import_node_fs.readFileSync)(file);
    if (saved.byteLength > maxFileSize) throw new Error("Room settings file is too large: " + file);
    const parsed = JSON.parse(saved.toString("utf8"));
    if (!isRoomSettings(parsed)) {
      throw new Error("Invalid room settings file: " + file);
    }
    settings = parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    canSave: adminToken.length > 0,
    get isConfigured() {
      return settings !== void 0;
    },
    get(mode) {
      return typeof mode === "string" && settings && Object.hasOwn(settings, mode) ? settings[mode] : void 0;
    },
    save(token, value) {
      if (!adminToken.length || typeof token !== "string" || Buffer.byteLength(token) !== adminToken.length || !(0, import_node_crypto.timingSafeEqual)(Buffer.from(token), adminToken)) {
        return "forbidden";
      }
      const data = JSON.stringify(value);
      if (!data || Buffer.byteLength(data) > maxFileSize || !isRoomSettings(value)) {
        return "invalid";
      }
      try {
        (0, import_node_fs.writeFileSync)(file + ".tmp", data, { mode: 384 });
        (0, import_node_fs.renameSync)(file + ".tmp", file);
        settings = value;
        return "ok";
      } catch (error) {
        console.error("Unable to save room settings:", error);
        return "storage";
      }
    }
  };
}

// lobby/src/server/createServer.ts
function createServer(options = {}) {
  const port2 = options.port ?? 8082;
  const roomSettings = openRoomSettings();
  const clients = /* @__PURE__ */ new Map();
  const rooms = /* @__PURE__ */ new Map();
  const events = [];
  const bannedKeys = /* @__PURE__ */ new Set();
  const bannedIps = /* @__PURE__ */ new Set();
  const bannedKeyWords = [];
  let wss;
  const clearClientTimers = (client) => {
    clearTimeout(client.keyCheck);
    clearInterval(client.heartbeat);
  };
  const util = {
    nickname(str) {
      return typeof str === "string" ? str.slice(0, 12) : "\u65E0\u540D\u73A9\u5BB6";
    },
    isBanned(str) {
      return bannedKeyWords.some((k) => str.includes(k));
    },
    sendl(client, ...args) {
      try {
        client.send(JSON.stringify(args));
      } catch {
        client.close();
      }
    },
    newId() {
      return Math.floor(1e9 + Math.random() * 9e9).toString();
    },
    buildRoomList() {
      const roomList = [];
      const clientCount = /* @__PURE__ */ new Map();
      rooms.forEach((room, key) => clientCount.set(key, 0));
      clients.forEach((c) => {
        if (c.room && !c.servermode) {
          const key = c.room.key;
          clientCount.set(key, (clientCount.get(key) || 0) + 1);
        }
      });
      rooms.forEach((room, key) => {
        const count = clientCount.get(key) || 0;
        if (room.servermode) {
          roomList.push("server");
        } else if (room.owner && room.config) {
          if (count === 0) {
            util.sendl(room.owner, "reloadroom");
          }
          roomList.push([room.owner.nickname, room.owner.avatar, room.config, count, room.key]);
        }
      });
      return roomList;
    },
    buildClientList() {
      const out = [];
      clients.forEach((c) => {
        out.push([c.nickname, c.avatar, !c.room, c.status, c.wsid, c.onlineKey]);
      });
      return out;
    },
    updateRooms() {
      const roomList = util.buildRoomList();
      const clientList = util.buildClientList();
      clients.forEach((c) => {
        if (!c.room) util.sendl(c, "updaterooms", roomList, clientList);
      });
    },
    updateClients() {
      const list = util.buildClientList();
      clients.forEach((c) => {
        if (!c.room) util.sendl(c, "updateclients", list);
      });
    },
    checkEvents() {
      const now = Date.now();
      for (let i = 0; i < events.length; i++) {
        if (events[i].utc <= now) {
          events.splice(i--, 1);
        }
      }
      return events;
    },
    updateEvents() {
      util.checkEvents();
      clients.forEach((c) => {
        if (!c.room) util.sendl(c, "updateevents", events);
      });
    }
  };
  const handlers = {
    create(client, key, nickname, avatar, _config, mode, cloudSettingsVersion) {
      if (typeof key !== "string" || client.onlineKey !== key) return;
      const settings = roomSettings.get(mode);
      if (roomSettings.isConfigured) {
        if (cloudSettingsVersion !== 1) return util.sendl(client, "enterroomfailed", "cloud-client-outdated");
        if (!settings) return util.sendl(client, "enterroomfailed", "cloud-mode-missing");
      }
      client.nickname = util.nickname(nickname);
      client.avatar = avatar;
      const room = { key, owner: client };
      rooms.set(key, room);
      client.room = room;
      delete client.status;
      if (settings) {
        util.sendl(client, "createroom", key, settings, mode, true);
      } else {
        util.sendl(client, "createroom", key);
      }
      util.updateRooms();
    },
    saveRoomSettings(client, token, settings) {
      if (typeof client.onlineKey !== "string" || client.room) {
        return util.sendl(client, "roomsettingssaved", "forbidden");
      }
      util.sendl(client, "roomsettingssaved", roomSettings.save(token, settings));
    },
    enter(client, key, nickname, avatar) {
      const room = rooms.get(key);
      if (!room?.owner || !room.config || room.config.gameStarted && (!room.config.observe || !room.config.observeReady)) {
        return util.sendl(client, "enterroomfailed");
      }
      client.nickname = util.nickname(nickname);
      client.avatar = avatar;
      client.room = room;
      delete client.status;
      client.owner = room.owner;
      util.sendl(room.owner, "onconnection", client.wsid);
      util.updateRooms();
    },
    changeAvatar(client, nickname, avatar) {
      client.nickname = util.nickname(nickname);
      client.avatar = avatar;
      util.updateClients();
    },
    key(client, id) {
      if (!id || typeof id !== "object") {
        util.sendl(client, "denied", "key");
        return client.close();
      }
      if (bannedKeys.has(id[0])) {
        bannedIps.add(client.clientIp);
        return client.close();
      }
      client.onlineKey = id[0];
      clearTimeout(client.keyCheck);
    },
    events(client, cfg, id, type) {
      if (bannedKeys.has(id) || typeof id !== "string" || client.onlineKey !== id) {
        bannedIps.add(client.clientIp);
        client.close();
        return;
      }
      let changed = false;
      const now = Date.now();
      if (typeof cfg === "string") {
        for (let ev of events) {
          if (ev.id === cfg) {
            if (type === "join" && !ev.members.includes(id)) {
              ev.members.push(id);
              changed = true;
            }
            if (type === "leave") {
              const idx = ev.members.indexOf(id);
              if (idx !== -1) {
                ev.members.splice(idx, 1);
                if (ev.members.length === 0) {
                  const index = events.indexOf(ev);
                  events.splice(index, 1);
                }
                changed = true;
              }
            }
          }
        }
      } else if (cfg && typeof cfg === "object" && "utc" in cfg && "day" in cfg && "hour" in cfg && "content" in cfg) {
        if (events.length >= 20) util.sendl(client, "eventsdenied", "total");
        else if (cfg.utc <= now) util.sendl(client, "eventsdenied", "time");
        else if (util.isBanned(cfg.content)) util.sendl(client, "eventsdenied", "ban");
        else {
          const item = {
            ...cfg,
            nickname: util.nickname(cfg.nickname),
            avatar: cfg.avatar || "caocao",
            creator: id,
            id: util.newId(),
            members: [id]
          };
          events.unshift(item);
          changed = true;
        }
      }
      if (changed) util.updateEvents();
    },
    config(client, config) {
      const room = client.room;
      if (!room || room.owner !== client) return;
      if (room.servermode) {
        room.servermode = false;
      }
      room.config = config;
      util.updateRooms();
    },
    status(client, str) {
      if (typeof str === "string") client.status = str;
      else delete client.status;
      util.updateClients();
    },
    send(client, id, message) {
      const target = clients.get(id);
      if (target && target.owner === client) {
        try {
          target.send(message);
        } catch {
          target.close();
        }
      }
    },
    close(client, id) {
      const target = clients.get(id);
      if (target && target.owner === client) target.close();
    }
  };
  const handleConnection = (ws, req) => {
    const client = ws;
    const ip = req.socket.remoteAddress ?? "";
    if (bannedIps.has(ip)) {
      util.sendl(client, "denied", "banned");
      return setTimeout(() => ws.close(), 500);
    }
    client.wsid = util.newId();
    client.clientIp = ip;
    clients.set(client.wsid, client);
    client.keyCheck = setTimeout(() => {
      util.sendl(client, "denied", "key");
      setTimeout(() => client.close(), 500);
    }, 2e3);
    util.sendl(client, "roomlist", util.buildRoomList(), util.checkEvents(), util.buildClientList(), client.wsid, roomSettings.canSave);
    client.heartbeat = setInterval(() => {
      if (client.beat) {
        client.close();
        clearInterval(client.heartbeat);
        return;
      }
      client.beat = true;
      try {
        client.send("heartbeat");
      } catch {
        client.close();
      }
    }, 6e4);
    client.on("message", (msg) => {
      const raw = msg.toString();
      if (raw === "heartbeat") {
        client.beat = false;
        return;
      }
      if (client.owner) {
        util.sendl(client.owner, "onmessage", client.wsid, raw);
        return;
      }
      let arr;
      try {
        arr = JSON.parse(raw);
        if (!Array.isArray(arr)) throw new Error();
      } catch {
        util.sendl(client, "denied", "banned");
        return;
      }
      if (arr.shift() !== "server") return;
      const type = arr.shift();
      if (typeof type !== "string" || !Object.hasOwn(handlers, type)) return;
      handlers[type](client, ...arr);
    });
    client.on("close", () => {
      clearClientTimers(client);
      rooms.forEach((room, key) => {
        if (room.owner === client) {
          clients.forEach((c) => {
            if (c.room === room && c !== client) {
              util.sendl(c, "selfclose");
            }
          });
          rooms.delete(key);
        }
      });
      if (client.owner) util.sendl(client.owner, "onclose", client.wsid);
      clients.delete(client.wsid);
      if (client.room) util.updateRooms();
      else util.updateClients();
    });
  };
  return {
    start() {
      if (wss) return Promise.resolve();
      return new Promise((resolve2, reject) => {
        const server2 = new import_ws.WebSocketServer({ port: port2 });
        const handleError = (error) => {
          server2.off("listening", handleListening);
          server2.off("connection", handleConnection);
          wss = void 0;
          reject(error);
        };
        const handleListening = () => {
          server2.off("error", handleError);
          resolve2();
        };
        server2.once("error", handleError);
        server2.once("listening", handleListening);
        server2.on("connection", handleConnection);
        wss = server2;
      });
    },
    stop() {
      if (!wss) return Promise.resolve();
      const server2 = wss;
      wss = void 0;
      const curClients = [...clients];
      for (const [_, client] of curClients) {
        clearClientTimers(client);
        client.close();
      }
      return new Promise((resolve2, reject) => {
        server2.close((error) => {
          if (error) reject(error);
          else resolve2();
        });
      });
    }
  };
}

// lobby/src/cli.ts
function readPort() {
  const portArgIndex = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
  const rawPort = portArgIndex === -1 ? process.env.PORT : process.argv[portArgIndex + 1];
  const port2 = Number(rawPort ?? 8082);
  if (!Number.isInteger(port2) || port2 < 0 || port2 > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  return port2;
}
var port = readPort();
var server = createServer({ port });
var stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
async function main() {
  await server.start();
  console.log(`Server listening on port ${port}`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
