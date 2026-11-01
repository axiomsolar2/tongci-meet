const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "leaderboard.json");

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readLeaderboard() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("读取排行榜失败：", error);
    return {};
  }
}
let leaderboard = readLeaderboard();

function saveLeaderboard() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(leaderboard, null, 2), "utf8");
  } catch (error) {
    console.error("保存排行榜失败：", error);
  }
}

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 12);
  return name || "玩家";
}

function normalizeWord(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\u3000，。！？、；：‘’“”"'`~!@#$%^&*()_\-+=\[\]{}<>《》〈〉·….,!?;:：]/g, "");
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    round: room.round,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      submitted: Boolean(room.submissions[p.id])
    })),
    result: room.result
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function getRoomFor(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

function getOrCreateStats(playerId, name) {
  const id = String(playerId || "").slice(0, 80);
  if (!id) return null;
  if (!leaderboard[id]) {
    leaderboard[id] = {
      playerId: id,
      name: cleanName(name),
      gamesPlayed: 0,
      wins: 0,
      roundsPlayed: 0,
      lastPlayed: Date.now()
    };
  }
  leaderboard[id].name = cleanName(name);
  leaderboard[id].lastPlayed = Date.now();
  return leaderboard[id];
}

function sendLeaderboard(target) {
  const rows = Object.values(leaderboard)
    .sort((a, b) => b.wins - a.wins ||
      ((a.gamesPlayed ? a.roundsPlayed / a.gamesPlayed : Infinity) -
       (b.gamesPlayed ? b.roundsPlayed / b.gamesPlayed : Infinity)) ||
      b.gamesPlayed - a.gamesPlayed)
    .slice(0, 20)
    .map((p) => ({
      name: p.name,
      gamesPlayed: p.gamesPlayed,
      wins: p.wins,
      averageRounds: p.gamesPlayed ? Number((p.roundsPlayed / p.gamesPlayed).toFixed(1)) : 0
    }));
  target.emit("leaderboard:update", rows);
}

io.on("connection", (socket) => {
  socket.on("leaderboard:get", () => sendLeaderboard(socket));

  socket.on("room:create", (payload = {}, ack = () => {}) => {
    const playerId = String(payload.playerId || "").slice(0, 80);
    if (!playerId) return ack({ ok: false, message: "玩家标识无效，请刷新页面重试。" });
    const code = makeCode();
    const player = {
      id: socket.id,
      playerId,
      name: cleanName(payload.name),
      ready: true
    };
    const room = {
      code,
      hostId: socket.id,
      players: [player],
      status: "waiting",
      round: 0,
      submissions: {},
      result: null
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, code });
    emitRoom(room);
  });

  socket.on("room:join", (payload = {}, ack = () => {}) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, message: "没有找到这个房间，请检查房间号。" });
    if (room.status !== "waiting") return ack({ ok: false, message: "这局游戏已经开始，暂时不能加入。" });
    if (room.players.length >= 2) return ack({ ok: false, message: "房间已满，最多只能有两名玩家。" });
    const playerId = String(payload.playerId || "").slice(0, 80);
    if (!playerId) return ack({ ok: false, message: "玩家标识无效，请刷新页面重试。" });
    if (room.players.some((p) => p.playerId === playerId)) {
      return ack({ ok: false, message: "你已经在这个房间里了。" });
    }
    room.players.push({
      id: socket.id,
      playerId,
      name: cleanName(payload.name),
      ready: true
    });
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, code });
    emitRoom(room);
  });

  socket.on("game:start", (_payload, ack = () => {}) => {
    const room = getRoomFor(socket);
    if (!room) return ack({ ok: false, message: "你当前不在房间中。" });
    if (socket.id !== room.hostId) return ack({ ok: false, message: "只有房主可以开始游戏。" });
    if (room.players.length !== 2) return ack({ ok: false, message: "需要两名玩家都加入后才能开始。" });
    if (room.status === "playing") return ack({ ok: false, message: "游戏已经开始。" });

    room.status = "playing";
    room.round = 1;
    room.submissions = {};
    room.result = null;
    room.players.forEach((p) => {
      const stats = getOrCreateStats(p.playerId, p.name);
      if (stats) stats.gamesPlayed += 1;
    });
    saveLeaderboard();
    ack({ ok: true });
    io.to(room.code).emit("game:started", { round: room.round });
    emitRoom(room);
    sendLeaderboard(io.to(room.code));
  });

  socket.on("word:submit", (payload = {}, ack = () => {}) => {
    const room = getRoomFor(socket);
    if (!room || room.status !== "playing") return ack({ ok: false, message: "当前没有进行中的游戏。" });
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return ack({ ok: false, message: "你不在这个房间中。" });
    if (room.submissions[socket.id]) return ack({ ok: false, message: "本轮已经提交，等待对方即可。" });

    const word = String(payload.word || "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!word) return ack({ ok: false, message: "先输入一个词再提交。" });
    if (!normalizeWord(word)) return ack({ ok: false, message: "请输入有效的文字或词语。" });

    room.submissions[socket.id] = { word, normalized: normalizeWord(word) };
    ack({ ok: true });
    io.to(room.code).emit("word:progress", {
      submitted: Object.keys(room.submissions).length,
      total: 2
    });

    if (Object.keys(room.submissions).length === 2) {
      const [a, b] = room.players;
      const answerA = room.submissions[a.id];
      const answerB = room.submissions[b.id];
      const matched = answerA.normalized === answerB.normalized;

      room.players.forEach((p) => {
        const stats = getOrCreateStats(p.playerId, p.name);
        if (stats) {
          stats.roundsPlayed += 1;
          if (matched) stats.wins += 1;
        }
      });
      saveLeaderboard();

      room.status = matched ? "finished" : "playing";
      room.result = {
        matched,
        round: room.round,
        answers: [
          { playerId: a.playerId, name: a.name, word: answerA.word },
          { playerId: b.playerId, name: b.name, word: answerB.word }
        ]
      };
      io.to(room.code).emit("round:result", room.result);
      sendLeaderboard(io.to(room.code));
      if (!matched) {
        room.round += 1;
        room.submissions = {};
        setTimeout(() => {
          const current = rooms.get(room.code);
          if (current && current.status === "playing" && current.round === room.round) {
            io.to(room.code).emit("round:next", { round: room.round });
            emitRoom(current);
          }
        }, 2600);
      } else {
        emitRoom(room);
      }
    } else {
      emitRoom(room);
    }
  });

  socket.on("game:rematch", (_payload, ack = () => {}) => {
    const room = getRoomFor(socket);
    if (!room) return ack({ ok: false, message: "你当前不在房间中。" });
    if (socket.id !== room.hostId) return ack({ ok: false, message: "只有房主可以开启再来一局。" });
    if (room.status !== "finished") return ack({ ok: false, message: "本局尚未结束。" });
    room.status = "playing";
    room.round = 1;
    room.submissions = {};
    room.result = null;
    room.players.forEach((p) => {
      const stats = getOrCreateStats(p.playerId, p.name);
      if (stats) stats.gamesPlayed += 1;
    });
    saveLeaderboard();
    ack({ ok: true });
    io.to(room.code).emit("game:started", { round: 1 });
    emitRoom(room);
    sendLeaderboard(io.to(room.code));
  });

  socket.on("disconnect", () => {
    const room = getRoomFor(socket);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(room.code);
    } else {
      room.hostId = room.players[0].id;
      room.status = "waiting";
      room.round = 0;
      room.submissions = {};
      room.result = null;
      io.to(room.code).emit("room:opponent-left", { message: "对方已离开房间，房间已重置。" });
      emitRoom(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`同词相遇已启动：http://localhost:${PORT}`);
});
