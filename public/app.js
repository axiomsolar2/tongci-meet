const socket = io();
const $ = (id) => document.getElementById(id);

const state = {
  playerId: getPlayerId(),
  name: "",
  roomCode: null,
  room: null,
  mySocketId: null,
  submitted: false,
  resultTimer: null
};

function getPlayerId() {
  let id = localStorage.getItem("tongci-player-id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem("tongci-player-id", id);
  }
  return id;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function setView(view) {
  $("homeView").classList.toggle("hidden", view !== "home");
  $("roomView").classList.toggle("hidden", view !== "room");
}

function playerName() {
  const value = $("nickname").value.trim();
  return (value || "玩家").slice(0, 12);
}

function ackEmit(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response || { ok: false, message: "连接异常，请重试。" }));
  });
}

$("createBtn").addEventListener("click", async () => {
  state.name = playerName();
  const response = await ackEmit("room:create", { name: state.name, playerId: state.playerId });
  if (!response.ok) return showToast(response.message);
  state.roomCode = response.code;
  setView("room");
});

$("joinToggleBtn").addEventListener("click", () => {
  $("joinPanel").classList.toggle("hidden");
  if (!$("joinPanel").classList.contains("hidden")) $("roomCodeInput").focus();
});

$("joinBtn").addEventListener("click", joinRoom);
$("roomCodeInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRoom();
});
$("roomCodeInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});

async function joinRoom() {
  const code = $("roomCodeInput").value.trim().toUpperCase();
  if (code.length !== 6) return showToast("请输入完整的 6 位房间号。");
  state.name = playerName();
  const response = await ackEmit("room:join", { code, name: state.name, playerId: state.playerId });
  if (!response.ok) return showToast(response.message);
  state.roomCode = response.code;
  setView("room");
}

$("copyCodeBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.roomCode);
    showToast("房间号已复制，发给朋友吧。");
  } catch {
    showToast(`房间号：${state.roomCode}`);
  }
});

$("startBtn").addEventListener("click", async () => {
  const response = await ackEmit("game:start", {});
  if (!response.ok) showToast(response.message);
});

$("leaveBtn").addEventListener("click", () => {
  location.reload();
});

$("wordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.submitted) return;
  const word = $("wordInput").value.trim();
  if (!word) return showToast("先写下你想到的词。");
  $("submitWordBtn").disabled = true;
  const response = await ackEmit("word:submit", { word });
  if (!response.ok) {
    $("submitWordBtn").disabled = false;
    return showToast(response.message);
  }
  state.submitted = true;
  $("wordInput").disabled = true;
  $("submitWordBtn").classList.add("hidden");
  $("submittedNotice").classList.remove("hidden");
  $("submitStatus").textContent = "答案已锁定";
});

function renderRoom(room) {
  state.room = room;
  state.roomCode = room.code;
  $("roomCode").textContent = room.code;
  const meIndex = room.players.findIndex((p) => p.id === socket.id);
  const mine = meIndex >= 0 ? room.players[meIndex] : room.players[0];
  const other = room.players.find((p) => p.id !== socket.id);

  $("playerOneName").textContent = mine ? mine.name : "玩家 1";
  $("avatarOne").textContent = mine ? mine.name.slice(0, 1) : "你";
  $("playerOneStatus").textContent = mine ? (mine.submitted ? "已提交答案" : "已加入") : "等待中";
  $("playerTwoName").textContent = other ? other.name : "等待好友加入";
  $("avatarTwo").textContent = other ? other.name.slice(0, 1) : "友";
  $("playerTwoStatus").textContent = other ? (other.submitted ? "已提交答案" : "已加入") : "尚未加入";
  $("playerTwoIndicator").classList.toggle("online", Boolean(other));

  const full = room.players.length === 2;
  $("startBtn").disabled = !full || socket.id !== room.hostId;
  $("startBtn").textContent = !full ? "等待好友加入" : socket.id === room.hostId ? "开始游戏" : "等待房主开始";
  $("startBtn").classList.toggle("hidden", room.status !== "waiting");
  $("waitingPanel").classList.toggle("hidden", room.status !== "waiting");
  if (room.status === "playing") {
    $("gamePanel").classList.remove("hidden");
    $("waitingPanel").classList.add("hidden");
    $("resultPanel").classList.add("hidden");
    $("roundNumber").textContent = room.round;
    const submittedCount = room.players.filter((p) => p.submitted).length;
    $("submitStatus").textContent = submittedCount === 0 ? "等待双方提交" : submittedCount === 1 ? "一位玩家已提交" : "正在揭晓";
  }
  if (room.status === "finished" && room.result) {
    $("gamePanel").classList.add("hidden");
    $("waitingPanel").classList.add("hidden");
    showResult(room.result);
  }
}

function resetInput(round) {
  state.submitted = false;
  $("roundNumber").textContent = round;
  $("wordInput").value = "";
  $("wordInput").disabled = false;
  $("submitWordBtn").disabled = false;
  $("submitWordBtn").classList.remove("hidden");
  $("submittedNotice").classList.add("hidden");
  $("submitStatus").textContent = "等待双方提交";
}

function showResult(result) {
  clearTimeout(state.resultTimer);
  $("resultPanel").classList.remove("hidden");
  $("resultPanel").classList.toggle("miss", !result.matched);
  $("resultSymbol").textContent = result.matched ? "✦" : "↗";
  $("resultEyebrow").textContent = result.matched ? "A PERFECT MATCH" : "NOT THIS TIME";
  $("resultTitle").textContent = result.matched ? "你们想到一起了。" : "差一点，就差一点。";
  $("resultDescription").textContent = result.matched
    ? `第 ${result.round} 轮，两个想法恰好重合。`
    : `第 ${result.round} 轮答案不同，再试一次，默契还在路上。`;
  $("answerCards").innerHTML = result.answers.map((answer) => `
    <div class="answer-card"><span>${escapeHtml(answer.name)}</span><strong>${escapeHtml(answer.word)}</strong></div>
  `).join("");

  const actions = $("resultActions");
  if (result.matched) {
    const isHost = state.room && socket.id === state.room.hostId;
    actions.innerHTML = isHost
      ? '<button id="rematchBtn" class="button button-dark">再来一局 <span>↗</span></button><button id="backRoomBtn" class="button button-light">留在房间</button>'
      : '<button id="backRoomBtn" class="button button-light">等待房主开启下一局</button>';
    const rematch = $("rematchBtn");
    if (rematch) rematch.addEventListener("click", async () => {
      const response = await ackEmit("game:rematch", {});
      if (!response.ok) showToast(response.message);
    });
    $("backRoomBtn").addEventListener("click", () => showToast("你可以留在这里，等待房主开启下一局。"));
  } else {
    actions.innerHTML = '<span class="next-round-note">下一轮即将开始…</span>';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function renderLeaderboard(rows) {
  const container = $("leaderboardRows");
  if (!rows.length) {
    container.innerHTML = '<div class="empty-ranking">还没有上榜玩家，来成为第一个吧。</div>';
    return;
  }
  container.innerHTML = rows.map((row, index) => `
    <div class="rank-row">
      <div class="rank-player"><span class="rank-number ${index < 3 ? "top" : ""}">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(row.name)}</div>
      <span class="rank-count">${row.wins}</span>
      <span class="rank-average">${row.averageRounds ? row.averageRounds.toFixed(1) : "—"}</span>
    </div>
  `).join("");
}

socket.on("connect", () => {
  state.mySocketId = socket.id;
  socket.emit("leaderboard:get");
});
socket.on("room:update", renderRoom);
socket.on("leaderboard:update", renderLeaderboard);
socket.on("word:progress", (progress) => {
  $("submitStatus").textContent = progress.submitted === 1 ? "一位玩家已提交" : "双方已提交";
});
socket.on("game:started", ({ round }) => {
  $("waitingPanel").classList.add("hidden");
  $("resultPanel").classList.add("hidden");
  $("gamePanel").classList.remove("hidden");
  resetInput(round);
});
socket.on("round:result", (result) => {
  showResult(result);
  if (!result.matched) {
    state.resultTimer = setTimeout(() => {
      $("resultPanel").classList.add("hidden");
      $("gamePanel").classList.remove("hidden");
      resetInput(result.round + 1);
    }, 2400);
  }
});
socket.on("round:next", ({ round }) => {
  $("resultPanel").classList.add("hidden");
  $("gamePanel").classList.remove("hidden");
  resetInput(round);
});
socket.on("room:opponent-left", ({ message }) => {
  showToast(message);
  $("gamePanel").classList.add("hidden");
  $("resultPanel").classList.add("hidden");
  $("waitingPanel").classList.remove("hidden");
});

socket.on("connect_error", () => showToast("连接服务器失败，请刷新页面重试。"));
