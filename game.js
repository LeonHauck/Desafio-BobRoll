// ============================================================
// HiperRoll - O Desafio do Rolo
// Jogo estilo Pac-Man com a marca HiperRoll
// ============================================================

(function () {
  "use strict";

  // ---------------- Maze data ----------------
  // Static fallback / initial layout - wall blocks spell "HIPERROLL" across
  // the top rows. Each level regenerates a fresh random layout below the
  // banner (see generateMaze()); this is also the safety-net if that ever
  // fails to produce a fully-connected maze.
  const DEFAULT_MAZE = [
    "######### ################### #########",
    "#o....... ................... .......o#",
    "# # # ### ### ### ### ### ### #   #   #",
    "# # #  #  # # #   # # # # # # #   #   #",
    "# ###  #  ### ### ### ### # # #   #   #",
    "# # #  #  #   #   ##  ##  # # #   #   #",
    "# # # ### #   ### # # # # ### ### ### #",
    "#.....................................#",
    "#.####..####..####...####..####..####.#",
    "#.....................................#",
    "#.##..##..###.............###..##..##.#",
    "#.##..##.......................##..##.#",
    "#.####..##..####.......####..##..####.#",
    "#.......##...................##.......#",
    "#.##..###..###..##...##..###..###..##.#",
    "#.##..###..###..##...##..###..###..##.#",
    "#.###..###..###..## ##..###..###..###.#",
    "#................#   #................#",
    "  ...............#   #...............  ",
    "#................#   #................#",
    "#.###..###..###..#####..###..###..###.#",
    "#.....................................#",
    "#.##..###..###..##...##..###..###..##.#",
    "#.##..###..###..##...##..###..###..##.#",
    "#.......##...................##.......#",
    "#.####..##..####.......####..##..####.#",
    "#.....................................#",
    "#.##..##..###.............###..##..##.#",
    "#.##..##.......................##..##.#",
    "#.####..####..####...####..####..####.#",
    "#o....... ................... .......o#",
    "######### ################### #########",
  ];
  let MAZE = DEFAULT_MAZE;

  const COLS = 39;
  const ROWS = 32;
  const TILE = 20;
  const TUNNEL_ROW = 18;
  // Vertical tunnels: gap columns between banner letters (col 9 is between
  // "H" and "I", col 29 is right next to the "O" of "ROLL") that stay clear
  // all the way through the banner and the pillar zones below it.
  const TUNNEL_COLS = [9, 29];
  function isTunnelCol(col) { return TUNNEL_COLS.indexOf(col) !== -1; }

  const HOUSE_COL_MIN = 17, HOUSE_COL_MAX = 21;
  const HOUSE_ROW_MIN = 17, HOUSE_ROW_MAX = 19;
  const HOUSE_CENTER = { col: 19, row: 18 };
  const HOUSE_EXIT = { col: 19, row: 15 };

  const PLAYER_START = { col: 19, row: 28 };

  const UP = { dx: 0, dy: -1 };
  const DOWN = { dx: 0, dy: 1 };
  const LEFT = { dx: -1, dy: 0 };
  const RIGHT = { dx: 1, dy: 0 };
  const STOP = { dx: 0, dy: 0 };
  const DIRS = [UP, LEFT, DOWN, RIGHT];
  function oppositeDir(d) {
    if (d === UP) return DOWN;
    if (d === DOWN) return UP;
    if (d === LEFT) return RIGHT;
    if (d === RIGHT) return LEFT;
    return STOP;
  }

  // Flips an entity's direction in place while preserving its exact pixel
  // position (no teleport): the tile it was heading into becomes the tile
  // it now departs from, and progress mirrors around that point.
  function reverseEntityDir(e) {
    const nd = oppositeDir(e.dir);
    if (nd === STOP) return;
    const newCol = wrapCol(e.col + e.dir.dx, e.row);
    const newRow = wrapRow(e.row + e.dir.dy, e.col);
    e.t = 1 - e.t;
    e.col = newCol;
    e.row = newRow;
    e.dir = nd;
  }

  const COLORS = {
    bg: "#05070f",
    wall: "#2b48c9",
    wallGlow: "#5c7dff",
    wallFlash: "#f5d98b",
    wallFlashGlow: "#fff3c4",
    dot: "#f4f6fb",
    pellet: "#ff5a5f",
  };

  // ---------------- Canvas setup ----------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;

  // ---------------- Player sprite (Bob Roll walk-cycle sheet) ----------------
  // Sheet is 8 columns x 2 rows; row 0 is the walking + mouth-chomp cycle.
  const BOB_SHEET_COLS = 8;
  const BOB_SHEET_ROWS = 2;
  const BOB_WALK_ROW = 0;
  const bobSprite = new Image();
  let bobSpriteReady = false;
  let bobFrameW = 0, bobFrameH = 0;
  bobSprite.onload = () => {
    bobFrameW = bobSprite.naturalWidth / BOB_SHEET_COLS;
    bobFrameH = bobSprite.naturalHeight / BOB_SHEET_ROWS;
    bobSpriteReady = true;
  };
  bobSprite.src = "bobroll-sheet.png";

  // ---------------- Audio ----------------
  let audioCtx = null;
  let muted = localStorage.getItem("hiperroll_muted") === "1";
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function beep(freq, dur, type, vol, delay) {
    if (muted) return;
    try {
      const ac = getAudioCtx();
      const t0 = ac.currentTime + (delay || 0);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol || 0.12, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    } catch (e) { /* audio unavailable */ }
  }
  let chompToggle = false;
  function playChomp() {
    chompToggle = !chompToggle;
    beep(chompToggle ? 260 : 200, 0.06, "square", 0.08);
  }
  function playPower() { beep(500, 0.08, "sawtooth", 0.12); beep(300, 0.15, "sawtooth", 0.1, 0.08); }
  function playEatGhost() { beep(700, 0.05, "square", 0.15); beep(1000, 0.08, "square", 0.15, 0.05); }
  function playDeath() {
    for (let i = 0; i < 6; i++) beep(400 - i * 55, 0.09, "sawtooth", 0.13, i * 0.09);
  }
  function playStart() {
    [392, 440, 494, 587, 659].forEach((f, i) => beep(f, 0.12, "square", 0.1, i * 0.11));
  }
  function playLevelUp() {
    [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.1, "square", 0.12, i * 0.09));
  }
  function playExtraLife() { beep(660, 0.1, "triangle", 0.15); beep(880, 0.15, "triangle", 0.15, 0.1); }

  // ---------------- Background electronic music ----------------
  const BPM = 138;
  const STEP_DUR = 60 / BPM / 4; // 16th note
  // 16-step patterns per bar, cycling through 2 bars (32 steps) for a driving synthwave loop
  const MUSIC_BASS = [
    110, 0, 110, 0, 110, 0, 146.83, 0, 98, 0, 98, 0, 130.81, 0, 123.47, 0,
    110, 0, 110, 0, 110, 0, 164.81, 0, 87.31, 0, 87.31, 0, 130.81, 0, 116.54, 0,
  ];
  const MUSIC_ARP = [
    0, 440, 0, 554.37, 0, 440, 0, 659.25, 0, 392, 0, 493.88, 0, 392, 0, 587.33,
    0, 440, 0, 554.37, 0, 440, 0, 659.25, 0, 349.23, 0, 440, 0, 523.25, 0, 466.16,
  ];
  const MUSIC_HAT = [
    1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1,
    1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1,
  ];
  // Denser, higher-pitched "power mode" patterns while the Rolo Turbo is active.
  const MUSIC_BASS_FRIGHT = [
    196, 196, 220, 220, 196, 196, 174.61, 174.61, 196, 196, 220, 220, 196, 196, 174.61, 174.61,
    196, 196, 220, 220, 196, 196, 174.61, 174.61, 196, 196, 220, 220, 196, 196, 174.61, 174.61,
  ];
  const MUSIC_ARP_FRIGHT = [
    880, 932.33, 880, 830.61, 880, 932.33, 880, 830.61, 880, 932.33, 880, 830.61, 880, 932.33, 880, 830.61,
    880, 932.33, 880, 830.61, 880, 932.33, 880, 830.61, 880, 932.33, 880, 830.61, 880, 932.33, 880, 830.61,
  ];
  const MUSIC_HAT_FRIGHT = [
    1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0,
    1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0,
  ];
  let musicTimerId = null;
  let nextNoteTime = 0;
  let musicStep = 0;

  function scheduleTone(freq, time, dur, type, vol) {
    if (!freq) return;
    const ac = getAudioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function scheduleHat(time) {
    const ac = getAudioCtx();
    const bufferSize = Math.floor(ac.sampleRate * 0.03);
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.05, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    noise.connect(hp).connect(gain).connect(ac.destination);
    noise.start(time);
    noise.stop(time + 0.03);
  }

  function musicScheduler() {
    const ac = getAudioCtx();
    while (nextNoteTime < ac.currentTime + 0.12) {
      const frightened = frightTimer > 0;
      const bassPat = frightened ? MUSIC_BASS_FRIGHT : MUSIC_BASS;
      const arpPat = frightened ? MUSIC_ARP_FRIGHT : MUSIC_ARP;
      const hatPat = frightened ? MUSIC_HAT_FRIGHT : MUSIC_HAT;
      const step = musicStep % bassPat.length;
      if (bassPat[step]) {
        scheduleTone(bassPat[step], nextNoteTime, STEP_DUR * (frightened ? 0.9 : 1.9), frightened ? "sawtooth" : "square", frightened ? 0.06 : 0.07);
      }
      if (arpPat[step]) {
        scheduleTone(arpPat[step], nextNoteTime, STEP_DUR * 0.85, frightened ? "triangle" : "square", frightened ? 0.05 : 0.035);
      }
      if (hatPat[step]) scheduleHat(nextNoteTime);
      nextNoteTime += STEP_DUR;
      musicStep++;
    }
  }

  function startMusic() {
    if (musicTimerId || muted) return;
    const ac = getAudioCtx();
    if (ac.state === "suspended") ac.resume();
    nextNoteTime = ac.currentTime + 0.05;
    musicStep = 0;
    musicScheduler();
    musicTimerId = setInterval(musicScheduler, 25);
  }

  function stopMusic() {
    if (musicTimerId) {
      clearInterval(musicTimerId);
      musicTimerId = null;
    }
  }

  // ---------------- Maze helpers ----------------
  function cellChar(col, row) {
    let r = row;
    if (isTunnelCol(col)) r = ((row % ROWS) + ROWS) % ROWS;
    if (r < 0 || r >= ROWS) return "#";
    let c = col;
    if (r === TUNNEL_ROW) c = ((col % COLS) + COLS) % COLS;
    if (c < 0 || c >= COLS) return "#";
    return MAZE[r][c];
  }

  function isWalkable(col, row, isGhostLike) {
    const ch = cellChar(col, row);
    if (ch === "#") return false;
    let c = col;
    if (row === TUNNEL_ROW) c = ((col % COLS) + COLS) % COLS;
    if (!isGhostLike && c >= HOUSE_COL_MIN && c <= HOUSE_COL_MAX && row >= HOUSE_ROW_MIN && row <= HOUSE_ROW_MAX) {
      return false;
    }
    return true;
  }

  function wrapCol(col, row) {
    if (row === TUNNEL_ROW) {
      if (col < 0) return COLS - 1;
      if (col >= COLS) return 0;
    }
    return col;
  }

  function wrapRow(row, col) {
    if (isTunnelCol(col)) {
      if (row < 0) return ROWS - 1;
      if (row >= ROWS) return 0;
    }
    return row;
  }

  // ---------------- Random maze generation ----------------
  // The banner, ghost house, tunnel and border are always the same; only
  // the pillar layout in the open play area (above/below the house) is
  // randomized each level. Pillars are placed in fixed, non-touching
  // "slots" so the maze is always fully connected by construction - a
  // flood-fill check still guards against any edge case, falling back to
  // the static DEFAULT_MAZE if it ever fails.
  const BANNER_WORD = "HIPERROLL";
  const BANNER_ROW = 2;
  const BANNER_GLYPHS = {
    H: ["101", "101", "111", "101", "101"],
    I: ["111", "010", "010", "010", "111"],
    P: ["111", "101", "111", "100", "100"],
    E: ["111", "100", "111", "100", "111"],
    R: ["111", "101", "111", "110", "101"],
    O: ["111", "101", "101", "101", "111"],
    L: ["100", "100", "100", "100", "111"],
  };

  function stampBanner(g) {
    for (let r = BANNER_ROW; r <= BANNER_ROW + 4; r++) {
      for (let c = 1; c <= COLS - 2; c++) g[r][c] = " ";
    }
    const letterW = 3, gap = 1;
    const totalW = BANNER_WORD.length * letterW + (BANNER_WORD.length - 1) * gap;
    let c0 = 1 + Math.floor((COLS - 2 - totalW) / 2);
    for (const ch of BANNER_WORD) {
      const glyph = BANNER_GLYPHS[ch];
      for (let rr = 0; rr < 5; rr++) {
        for (let cc = 0; cc < 3; cc++) {
          if (glyph[rr][cc] === "1") g[BANNER_ROW + rr][c0 + cc] = "#";
        }
      }
      c0 += letterW + gap;
    }
  }

  function stampHouse(g) {
    for (let r = HOUSE_ROW_MIN; r <= HOUSE_ROW_MAX; r++) {
      for (let c = HOUSE_COL_MIN; c <= HOUSE_COL_MAX; c++) g[r][c] = " ";
    }
    for (let c = HOUSE_COL_MIN; c <= HOUSE_COL_MAX; c++) g[HOUSE_ROW_MIN - 1][c] = "#";
    g[HOUSE_ROW_MIN - 1][HOUSE_CENTER.col] = " "; // door
    for (let c = HOUSE_COL_MIN; c <= HOUSE_COL_MAX; c++) g[HOUSE_ROW_MAX + 1][c] = "#";
    for (let r = HOUSE_ROW_MIN; r <= HOUSE_ROW_MAX; r++) {
      g[r][HOUSE_COL_MIN] = "#";
      g[r][HOUSE_COL_MAX] = "#";
    }
  }

  // 2-row-tall x 3-col-wide slots, left half only (mirrored for the right
  // half), each separated from its neighbors by at least one clear column
  // or row so a pillar can never touch another and trap an open pocket.
  const PILLAR_ROW_BANDS = [[8, 9], [11, 12], [14, 15], [21, 22], [24, 25], [27, 28]];
  const PILLAR_COL_SLOTS = [[2, 4], [6, 8], [10, 12], [14, 16]];

  function placeRandomPillars(g) {
    for (const [r0] of PILLAR_ROW_BANDS) {
      for (const [c0, c1] of PILLAR_COL_SLOTS) {
        if (Math.random() > 0.55) continue; // leave this slot open
        // always fill the whole slot width - a partial-width pillar leaves
        // a single stray dot wedged against it that's only reachable from
        // one exact direction, which is the "hard to grab" spot players hit
        const h = Math.random() < 0.5 ? 1 : 2;
        for (let r = r0; r < r0 + h; r++) {
          for (let c = c0; c <= c1; c++) {
            g[r][c] = "#";
            g[r][COLS - 1 - c] = "#";
          }
        }
      }
    }
  }

  function buildMazeGrid() {
    const g = [];
    for (let r = 0; r < ROWS; r++) g.push(new Array(COLS).fill("."));
    for (let c = 0; c < COLS; c++) { g[0][c] = "#"; g[ROWS - 1][c] = "#"; }
    for (let r = 0; r < ROWS; r++) { g[r][0] = "#"; g[r][COLS - 1] = "#"; }
    stampBanner(g);
    stampHouse(g);
    g[TUNNEL_ROW][0] = " "; g[TUNNEL_ROW][1] = " ";
    g[TUNNEL_ROW][COLS - 1] = " "; g[TUNNEL_ROW][COLS - 2] = " ";
    for (const tc of TUNNEL_COLS) {
      g[0][tc] = " "; g[1][tc] = " ";
      g[ROWS - 1][tc] = " "; g[ROWS - 2][tc] = " ";
    }
    placeRandomPillars(g);
    // power pellets: the 4 corners plus 4 more along the guaranteed-clear
    // gap rows/columns between pillar slots, so they're always reachable
    // no matter which random pillars got placed this level
    g[1][1] = "o"; g[1][COLS - 2] = "o";
    g[ROWS - 2][1] = "o"; g[ROWS - 2][COLS - 2] = "o";
    g[10][9] = "o"; g[10][COLS - 1 - 9] = "o";
    g[23][9] = "o"; g[23][COLS - 1 - 9] = "o";
    return g;
  }

  function isMazeFullyConnected(g) {
    const visited = [];
    for (let r = 0; r < ROWS; r++) visited.push(new Array(COLS).fill(false));
    const start = [PLAYER_START.row, PLAYER_START.col];
    const queue = [start];
    visited[start[0]][start[1]] = true;
    let qi = 0;
    while (qi < queue.length) {
      const [r, c] = queue[qi++];
      const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      for (const [nrRaw, ncRaw] of neighbors) {
        let nr = nrRaw;
        if (isTunnelCol(c)) nr = ((nr % ROWS) + ROWS) % ROWS;
        if (nr < 0 || nr >= ROWS) continue;
        let nc = ncRaw;
        if (nr === TUNNEL_ROW) nc = ((nc % COLS) + COLS) % COLS;
        if (nc < 0 || nc >= COLS) continue;
        if (g[nr][nc] !== "#" && !visited[nr][nc]) {
          visited[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((g[r][c] === "." || g[r][c] === "o") && !visited[r][c]) return false;
      }
    }
    return true;
  }

  function generateMaze() {
    for (let attempt = 0; attempt < 25; attempt++) {
      const g = buildMazeGrid();
      if (isMazeFullyConnected(g)) return g.map((row) => row.join(""));
    }
    return DEFAULT_MAZE.slice();
  }

  let dotState = []; // 0 none, 1 dot, 2 pellet
  let dotsRemaining = 0;

  function resetDots() {
    dotState = [];
    dotsRemaining = 0;
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const ch = MAZE[r][c];
        let v = 0;
        if (ch === ".") v = 1;
        else if (ch === "o") v = 2;
        if (v) dotsRemaining++;
        row.push(v);
      }
      dotState.push(row);
    }
  }

  // ---------------- Entities ----------------
  function makeEntity(col, row) {
    return { col, row, dir: STOP, nextDir: STOP, t: 0 };
  }

  const player = Object.assign(makeEntity(PLAYER_START.col, PLAYER_START.row), {
    walkPhase: 0,
    facing: RIGHT,
    hFace: RIGHT, // last left/right facing - the sprite is side-profile only, so
    // up/down moves keep whichever horizontal mirror was last used
    speed: 8.3, // tiles/sec
  });

  const rivalDefs = [
    { name: "Nó", color: "#3355e0", personality: "chase", start: { col: 18, row: 18 }, scatter: { col: 1, row: 1 }, release: 0 },
    { name: "Emperro", color: "#e8e8e8", personality: "ambush", start: { col: 19, row: 18 }, scatter: { col: 37, row: 1 }, release: 3 },
    { name: "Poeira", color: "#f5a623", personality: "distance", start: { col: 20, row: 18 }, scatter: { col: 1, row: 30 }, release: 7 },
    { name: "Atraso", color: "#ff6b81", personality: "flank", start: { col: 19, row: 17 }, scatter: { col: 37, row: 30 }, release: 11 },
  ];

  let rivals = [];
  function makeRivals() {
    rivals = rivalDefs.map((def) => Object.assign(makeEntity(def.start.col, def.start.row), {
      name: def.name,
      color: def.color,
      personality: def.personality,
      scatterTile: def.scatter,
      releaseTimer: def.release,
      status: def.release === 0 ? "leaving" : "house",
      mode: "scatter",
      path: null,
      speed: 5.0,
    }));
  }
  makeRivals();
  resetDots();

  // ---------------- Game state ----------------
  let score = 0;
  let highscore = parseInt(localStorage.getItem("hiperroll_highscore") || "0", 10);
  let lives = 3;
  let level = 1;
  let comboCount = 0;
  let frightTimer = 0;
  let frightDuration = 7;
  let globalMode = "scatter";
  let modeClock = 0;
  let modeIdx = 0;
  const MODE_SCHEDULE = [7, 20, 7, 20, 5, 20, 5, 1e9];
  let houseClock = 0;
  let extraLifeGiven = false;
  let playerName = "Jogador";
  let floatTexts = [];

  let state = "menu"; // menu, ready, playing, dying, levelcomplete, paused, gameover
  let stateTimer = 0;

  // ---------------- DOM ----------------
  const scoreEl = document.getElementById("score");
  const highscoreEl = document.getElementById("highscore");
  const levelEl = document.getElementById("level");
  const livesEl = document.getElementById("lives");
  const toastEl = document.getElementById("toast");
  const menuOverlay = document.getElementById("menuOverlay");
  const pauseOverlay = document.getElementById("pauseOverlay");
  const gameOverOverlay = document.getElementById("gameOverOverlay");
  const finalScoreEl = document.getElementById("finalScore");
  const newRecordEl = document.getElementById("newRecord");
  const gameOverTitle = document.getElementById("gameOverTitle");
  const muteBtn = document.getElementById("muteBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const playerNameInput = document.getElementById("playerName");
  const rankingOverlay = document.getElementById("rankingOverlay");
  const rankingList = document.getElementById("rankingList");
  const rankingStatus = document.getElementById("rankingStatus");

  document.getElementById("year").textContent = new Date().getFullYear();
  highscoreEl.textContent = highscore;
  muteBtn.textContent = muted ? "🔇" : "🔊";
  const nameErrorEl = document.getElementById("nameError");
  playerNameInput.value = (localStorage.getItem("hiperroll_playername") || "").slice(0, 10);
  playerNameInput.addEventListener("input", () => {
    if (playerNameInput.value.trim()) {
      playerNameInput.classList.remove("invalid");
      nameErrorEl.classList.add("hidden");
    }
  });

  function showToast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(showToast._t);
    if (ms) showToast._t = setTimeout(() => toastEl.classList.add("hidden"), ms);
  }
  function hideToast() { toastEl.classList.add("hidden"); }

  function updateLives() {
    livesEl.innerHTML = "";
    for (let i = 0; i < lives; i++) {
      const img = document.createElement("img");
      img.className = "life-icon";
      img.src = "bobroll-icon.png";
      img.alt = "";
      livesEl.appendChild(img);
    }
  }
  updateLives();

  function addScore(v) {
    score += v;
    scoreEl.textContent = score;
    if (score > highscore) {
      highscore = score;
      highscoreEl.textContent = highscore;
    }
    if (!extraLifeGiven && score >= 10000) {
      extraLifeGiven = true;
      lives++;
      updateLives();
      playExtraLife();
      showToast("Vida extra!", 1400);
    }
  }

  // ---------------- Reset helpers ----------------
  function resetPositions() {
    player.col = PLAYER_START.col;
    player.row = PLAYER_START.row;
    player.dir = STOP;
    player.nextDir = STOP;
    player.t = 0;
    player.facing = RIGHT;
    makeRivals();
    houseClock = 0;
    modeClock = 0;
    modeIdx = 0;
    globalMode = "scatter";
    frightTimer = 0;
    comboCount = 0;
    floatTexts = [];
  }

  function startLevel(newLevel) {
    level = newLevel;
    levelEl.textContent = level;
    MAZE = generateMaze();
    resetDots();
    resetPositions();
    frightDuration = Math.max(3, 7 - (level - 1) * 0.4);
    player.speed = Math.min(10.5, 8.3 + (level - 1) * 0.15);
    rivals.forEach((r) => (r.speed = Math.min(6.8, 5.0 + (level - 1) * 0.1)));
    enterReady();
  }

  function enterReady() {
    state = "ready";
    stateTimer = 1.3;
    showToast("PREPARAR!");
  }

  function loseLife() {
    state = "dying";
    stateTimer = 1.1;
    player.dir = STOP;
    player.nextDir = STOP;
    stopMusic();
    playDeath();
  }

  function gotoGameOver() {
    state = "gameover";
    stopMusic();
    finalScoreEl.textContent = score;
    if (score >= highscore && score > 0) {
      localStorage.setItem("hiperroll_highscore", String(highscore));
      newRecordEl.classList.remove("hidden");
      gameOverTitle.textContent = "Novo recorde!";
    } else {
      newRecordEl.classList.add("hidden");
      gameOverTitle.textContent = "Fim de Jogo";
    }
    gameOverOverlay.classList.remove("hidden");
    if (score > 0) submitScore(playerName, score);
  }

  // ---------------- Leaderboard ----------------
  // Tries the shared server-side ranking (leaderboard.php, works once this
  // is hosted somewhere with PHP - e.g. HostGator). If that's unreachable
  // (still testing locally, or not deployed yet) it falls back to a ranking
  // kept in this browser's localStorage, so the feature is fully testable
  // today and upgrades automatically once the PHP endpoint is live.
  const LEADERBOARD_URL = "leaderboard.php";
  const LOCAL_LEADERBOARD_KEY = "hiperroll_leaderboard_local";

  function getLocalLeaderboard() {
    try {
      const list = JSON.parse(localStorage.getItem(LOCAL_LEADERBOARD_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function addLocalScore(name, scoreValue) {
    const list = getLocalLeaderboard();
    list.push({ name, score: scoreValue, date: new Date().toISOString().slice(0, 10) });
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 10);
    localStorage.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(top));
    return top;
  }

  async function submitScore(name, scoreValue) {
    try {
      const res = await fetch(LEADERBOARD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, score: scoreValue }),
      });
      if (!res.ok) throw new Error("bad response");
    } catch (e) {
      addLocalScore(name, scoreValue);
    }
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch(LEADERBOARD_URL, { method: "GET" });
      if (!res.ok) throw new Error("bad response");
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error("bad payload");
      return { list, online: true };
    } catch (e) {
      return { list: getLocalLeaderboard(), online: false };
    }
  }

  function renderLeaderboard(list, online) {
    rankingList.innerHTML = "";
    if (list.length === 0) {
      rankingStatus.textContent = "Ninguém pontuou ainda - seja o primeiro!";
    } else {
      const medals = ["🥇", "🥈", "🥉"];
      list.forEach((entry, i) => {
        const li = document.createElement("li");
        if (i < 3) li.classList.add("rank-medal", "rank-top" + (i + 1));
        const pos = document.createElement("span");
        pos.className = "rank-pos";
        pos.textContent = i < 3 ? medals[i] : i + 1 + "º";
        const name = document.createElement("span");
        name.className = "rank-name";
        name.textContent = entry.name || "Jogador";
        const scoreSpan = document.createElement("span");
        scoreSpan.className = "rank-score";
        scoreSpan.textContent = entry.score;
        li.appendChild(pos);
        li.appendChild(name);
        li.appendChild(scoreSpan);
        rankingList.appendChild(li);
      });
      rankingStatus.textContent = online
        ? "Ranking compartilhado (online)"
        : "Ranking local deste navegador - hospede o jogo com o leaderboard.php para compartilhar entre computadores";
    }
  }

  async function openRanking() {
    rankingOverlay.classList.remove("hidden");
    rankingStatus.textContent = "Carregando...";
    rankingList.innerHTML = "";
    const { list, online } = await fetchLeaderboard();
    renderLeaderboard(list, online);
  }

  document.getElementById("rankingBtn").addEventListener("click", openRanking);
  document.getElementById("rankingBtn2").addEventListener("click", openRanking);
  document.getElementById("rankingBtn3").addEventListener("click", openRanking);
  document.getElementById("closeRankingBtn").addEventListener("click", () => {
    rankingOverlay.classList.add("hidden");
  });




  // ---------------- Input ----------------
  function setDir(d) {
    player.nextDir = d;
    if (state !== "playing") return;
    if (player.dir === STOP) {
      // try to move immediately if possible
      if (isWalkable(player.col + d.dx, player.row + d.dy, false)) {
        player.dir = d;
        player.facing = d;
      }
    } else if (d === oppositeDir(player.dir)) {
      // reversing never needs to wait for an intersection - do it instantly
      reverseEntityDir(player);
      player.facing = player.dir;
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.target === playerNameInput) {
      // let the player type their name normally, but Enter still starts the game
      if (e.code === "Enter" && state === "menu") beginGame();
      return;
    }
    const k = e.code;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyW", "KeyA", "KeyS", "KeyD"].includes(k)) {
      e.preventDefault();
    }
    if (k === "ArrowUp" || k === "KeyW") setDir(UP);
    else if (k === "ArrowDown" || k === "KeyS") setDir(DOWN);
    else if (k === "ArrowLeft" || k === "KeyA") setDir(LEFT);
    else if (k === "ArrowRight" || k === "KeyD") setDir(RIGHT);
    else if (k === "KeyP" || k === "Escape" || k === "Space") togglePause();
    else if (k === "Enter") {
      if (state === "menu") beginGame();
      else if (state === "gameover") restartGame();
    }
  });

  document.querySelectorAll(".tc-btn").forEach((btn) => {
    const map = { up: UP, down: DOWN, left: LEFT, right: RIGHT };
    btn.addEventListener("click", () => setDir(map[btn.dataset.dir]));
  });

  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > 18) setDir(dx > 0 ? RIGHT : LEFT);
    } else {
      if (Math.abs(dy) > 18) setDir(dy > 0 ? DOWN : UP);
    }
    touchStart = null;
  }, { passive: true });

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      pauseOverlay.classList.remove("hidden");
      stopMusic();
    } else if (state === "paused") {
      state = "playing";
      pauseOverlay.classList.add("hidden");
      startMusic();
    }
  }
  pauseBtn.addEventListener("click", togglePause);
  document.getElementById("resumeBtn").addEventListener("click", togglePause);

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    localStorage.setItem("hiperroll_muted", muted ? "1" : "0");
    muteBtn.textContent = muted ? "🔇" : "🔊";
    if (muted) stopMusic();
    else if (state === "playing") startMusic();
  });

  function beginGame() {
    const typed = playerNameInput.value.trim().slice(0, 10);
    if (!typed) {
      playerNameInput.classList.add("invalid");
      nameErrorEl.classList.remove("hidden");
      playerNameInput.focus();
      return;
    }
    playerNameInput.classList.remove("invalid");
    nameErrorEl.classList.add("hidden");
    playerName = typed;
    localStorage.setItem("hiperroll_playername", playerName);
    menuOverlay.classList.add("hidden");
    score = 0;
    scoreEl.textContent = "0";
    lives = 3;
    extraLifeGiven = false;
    updateLives();
    playStart();
    startLevel(1);
  }
  document.getElementById("startBtn").addEventListener("click", beginGame);

  function restartGame() {
    gameOverOverlay.classList.add("hidden");
    beginGame();
  }
  document.getElementById("restartBtn").addEventListener("click", restartGame);

  // ---------------- AI targeting ----------------
  function computeChaseTarget(r) {
    switch (r.personality) {
      case "chase":
        return { col: player.col, row: player.row };
      case "ambush": {
        const f = player.facing || RIGHT;
        return { col: player.col + f.dx * 3, row: player.row + f.dy * 3 };
      }
      case "flank": {
        const anchor = rivals.find((x) => x.personality === "chase") || r;
        return { col: player.col + (player.col - anchor.col), row: player.row + (player.row - anchor.row) };
      }
      case "distance": {
        const d = Math.hypot(r.col - player.col, r.row - player.row);
        return d > 8 ? { col: player.col, row: player.row } : r.scatterTile;
      }
      default:
        return { col: player.col, row: player.row };
    }
  }

  // Exact shortest path (BFS, wrap-aware) between two tiles. Used to send
  // eaten/leaving ghosts back to the house: the regular greedy "step toward
  // whichever neighbor reduces distance" AI that chases/scatters with can
  // get stuck looping around pillars forever in some maze layouts, since it
  // never revisits a decision - a real path guarantees they always arrive.
  function findPathBFS(fromCol, fromRow, toCol, toRow) {
    const startKey = fromRow * COLS + fromCol;
    const goalKey = toRow * COLS + toCol;
    if (startKey === goalKey) return [];
    const visited = new Set([startKey]);
    const prev = new Map();
    const queue = [[fromCol, fromRow]];
    let qi = 0;
    while (qi < queue.length) {
      const [c, r] = queue[qi++];
      for (const d of DIRS) {
        const nc = wrapCol(c + d.dx, r);
        const nr = wrapRow(r + d.dy, c);
        if (!isWalkable(nc, nr, true)) continue;
        const k = nr * COLS + nc;
        if (visited.has(k)) continue;
        visited.add(k);
        prev.set(k, [c, r]);
        if (k === goalKey) { qi = queue.length; break; }
        queue.push([nc, nr]);
      }
    }
    if (!visited.has(goalKey)) return [];
    const path = [];
    let cur = [toCol, toRow];
    let curKey = goalKey;
    while (curKey !== startKey) {
      path.push({ col: cur[0], row: cur[1] });
      cur = prev.get(curKey);
      if (!cur) return [];
      curKey = cur[1] * COLS + cur[0];
    }
    path.reverse();
    return path;
  }

  function dirBetween(c0, r0, c1, r1) {
    for (const d of DIRS) {
      if (wrapCol(c0 + d.dx, r0) === c1 && wrapRow(r0 + d.dy, c0) === r1) return d;
    }
    return STOP;
  }

  function decideGhostDir(r) {
    // Self-healing: arriving at the target flips status here (not only in
    // stepRival's tile-arrival block) so a ghost can never get stranded
    // "at" its destination with status still eaten/leaving and nothing left
    // to path toward.
    if (r.status === "eaten" && r.col === HOUSE_CENTER.col && r.row === HOUSE_CENTER.row) {
      r.status = "leaving";
      r.path = null;
    }
    if (r.status === "leaving" && r.col === HOUSE_EXIT.col && r.row === HOUSE_EXIT.row) {
      r.status = "normal";
      r.mode = globalMode;
      r.path = null;
    }
    if (r.status === "eaten" || r.status === "leaving") {
      const target = r.status === "eaten" ? HOUSE_CENTER : HOUSE_EXIT;
      if (!r.path || r.path.length === 0) {
        r.path = findPathBFS(r.col, r.row, target.col, target.row);
      }
      const next = r.path.shift();
      r.dir = next ? dirBetween(r.col, r.row, next.col, next.row) : STOP;
      return;
    }
    const forbidden = { dx: -r.dir.dx, dy: -r.dir.dy };
    if (r.status === "frightened") {
      const options = DIRS.filter((d) => isWalkable(r.col + d.dx, r.row + d.dy, true) &&
        !(d.dx === forbidden.dx && d.dy === forbidden.dy));
      const pool = options.length ? options : DIRS.filter((d) => isWalkable(r.col + d.dx, r.row + d.dy, true));
      r.dir = pool.length ? pool[Math.floor(Math.random() * pool.length)] : STOP;
      return;
    }
    const target = r.mode === "scatter" ? r.scatterTile : computeChaseTarget(r);

    let best = null, bestDist = Infinity;
    for (const d of DIRS) {
      const nc = r.col + d.dx, nr = r.row + d.dy;
      if (!isWalkable(nc, nr, true)) continue;
      if (d.dx === forbidden.dx && d.dy === forbidden.dy) continue;
      const dist = (nc - target.col) ** 2 + (nr - target.row) ** 2;
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    if (!best) {
      for (const d of DIRS) {
        const nc = r.col + d.dx, nr = r.row + d.dy;
        if (!isWalkable(nc, nr, true)) continue;
        const dist = (nc - target.col) ** 2 + (nr - target.row) ** 2;
        if (dist < bestDist) { bestDist = dist; best = d; }
      }
    }
    r.dir = best || STOP;
  }

  function reverseNormalGhosts() {
    rivals.forEach((r) => {
      if (r.status === "normal" || r.status === "frightened") {
        reverseEntityDir(r);
      }
    });
  }

  function activateFrightened() {
    frightTimer = frightDuration;
    comboCount = 0;
    rivals.forEach((r) => {
      if (r.status === "normal" || r.status === "leaving") {
        reverseEntityDir(r);
        r.status = "frightened";
      }
    });
  }

  // ---------------- Movement stepping ----------------
  function stepPlayer(dt) {
    if (player.dir === STOP) {
      if (player.nextDir !== STOP && isWalkable(player.col + player.nextDir.dx, player.row + player.nextDir.dy, false)) {
        player.dir = player.nextDir;
        player.facing = player.dir;
      }
      return;
    }
    player.t += player.speed * dt;
    if (player.t >= 1) {
      player.t -= 1;
      const newCol = wrapCol(player.col + player.dir.dx, player.row);
      const newRow = wrapRow(player.row + player.dir.dy, player.col);
      player.col = newCol;
      player.row = newRow;
      eatAt(player.col, player.row);
      if (player.nextDir !== STOP && isWalkable(player.col + player.nextDir.dx, player.row + player.nextDir.dy, false)) {
        player.dir = player.nextDir;
        player.facing = player.dir;
      } else if (!isWalkable(player.col + player.dir.dx, player.row + player.dir.dy, false)) {
        player.dir = STOP;
        player.t = 0;
      } else {
        player.facing = player.dir;
      }
    }
  }

  function stepRival(r, dt) {
    if (r.status === "house") return;
    if (r.dir === STOP) {
      decideGhostDir(r);
      if (r.dir === STOP) return;
    }
    const spd = r.status === "eaten" ? r.speed * 1.7 : r.status === "frightened" ? r.speed * 0.55 : r.speed;
    r.t += spd * dt;
    if (r.t >= 1) {
      r.t -= 1;
      const newCol = wrapCol(r.col + r.dir.dx, r.row);
      const newRow = wrapRow(r.row + r.dir.dy, r.col);
      r.col = newCol;
      r.row = newRow;
      decideGhostDir(r);
      if (r.dir === STOP) r.t = 0;
    }
  }

  function eatAt(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    const v = dotState[row][col];
    if (v === 1) {
      dotState[row][col] = 0;
      dotsRemaining--;
      addScore(10);
      playChomp();
    } else if (v === 2) {
      dotState[row][col] = 0;
      dotsRemaining--;
      addScore(50);
      activateFrightened();
      playPower();
    }
  }

  function entityPixel(e) {
    let col = e.col + e.dir.dx * e.t;
    let row = e.row + e.dir.dy * e.t;
    col = ((col % COLS) + COLS) % COLS;
    row = ((row % ROWS) + ROWS) % ROWS;
    return { x: (col + 0.5) * TILE, y: (row + 0.5) * TILE };
  }

  function eatGhost(r) {
    r.status = "eaten";
    r.path = null;
    reverseEntityDir(r);
    const pts = 200 * Math.pow(2, comboCount);
    comboCount++;
    addScore(pts);
    playEatGhost();
    const p = entityPixel(r);
    floatTexts.push({ x: p.x, y: p.y, text: "+" + pts, life: 0.8 });
  }

  function checkCollisions() {
    const p = entityPixel(player);
    for (const r of rivals) {
      // "leaving" ghosts are still dangerous - only fully idle (still inside
      // the house, unreachable by the player anyway) or already-eaten ghosts
      // are safe to touch
      if (r.status !== "normal" && r.status !== "frightened" && r.status !== "leaving") continue;
      const gp = entityPixel(r);
      const dist = Math.hypot(p.x - gp.x, p.y - gp.y);
      if (dist < TILE * 0.6) {
        if (r.status === "frightened") eatGhost(r);
        else loseLife();
      }
    }
  }

  // ---------------- Update ----------------
  function update(dt) {
    if (state === "ready") {
      stateTimer -= dt;
      if (stateTimer <= 0) { state = "playing"; hideToast(); startMusic(); }
      return;
    }
    if (state === "dying") {
      stateTimer -= dt;
      if (stateTimer <= 0) {
        lives--;
        updateLives();
        if (lives <= 0) { gotoGameOver(); }
        else { resetPositions(); enterReady(); }
      }
      return;
    }
    if (state === "levelcomplete") {
      stateTimer -= dt;
      if (stateTimer <= 0) startLevel(level + 1);
      return;
    }
    if (state !== "playing") return;

    houseClock += dt;
    rivals.forEach((r) => {
      if (r.status === "house" && houseClock >= r.releaseTimer) {
        r.status = "leaving";
        r.path = null;
      }
    });

    if (frightTimer > 0) {
      frightTimer -= dt;
      if (frightTimer <= 0) {
        rivals.forEach((r) => { if (r.status === "frightened") { r.status = "normal"; r.mode = globalMode; } });
      }
    } else {
      modeClock += dt;
      if (modeClock >= MODE_SCHEDULE[modeIdx]) {
        modeClock = 0;
        modeIdx = Math.min(modeIdx + 1, MODE_SCHEDULE.length - 1);
        globalMode = globalMode === "scatter" ? "chase" : "scatter";
        rivals.forEach((r) => { if (r.status === "normal") r.mode = globalMode; });
        reverseNormalGhosts();
      }
    }

    stepPlayer(dt);
    rivals.forEach((r) => stepRival(r, dt));
    checkCollisions();

    floatTexts.forEach((f) => { f.life -= dt; f.y -= dt * 20; });
    floatTexts = floatTexts.filter((f) => f.life > 0);

    if (dotsRemaining <= 0) {
      state = "levelcomplete";
      stateTimer = 1.6;
      playLevelUp();
      showToast("Fase concluída!", 1500);
    }

    // walk-cycle animation - advances with distance traveled so legs/mouth
    // step in sync with movement speed, freezes when stopped
    if (player.dir !== STOP) {
      player.walkPhase += player.speed * dt;
    }
  }

  // ---------------- Rendering ----------------
  function drawMaze(time) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let wallFill = COLORS.wall;
    let wallStroke = COLORS.wallGlow;
    if (frightTimer > 0) {
      const blinkMs = frightTimer < 2 ? 130 : 260;
      if (Math.floor(time / blinkMs) % 2 === 0) {
        wallFill = COLORS.wallFlash;
        wallStroke = COLORS.wallFlashGlow;
      }
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (MAZE[r][c] === "#") {
          ctx.fillStyle = wallFill;
          ctx.strokeStyle = wallStroke;
          ctx.lineWidth = 1;
          const x = c * TILE, y = r * TILE;
          const pad = 1.5;
          ctx.beginPath();
          ctx.roundRect(x + pad, y + pad, TILE - pad * 2, TILE - pad * 2, 4);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = dotState[r][c];
        if (v === 1) {
          ctx.fillStyle = COLORS.dot;
          ctx.beginPath();
          ctx.arc(c * TILE + TILE / 2, r * TILE + TILE / 2, 3.4, 0, Math.PI * 2);
          ctx.fill();
        } else if (v === 2) {
          const pulse = 5 + Math.sin(time / 130) * 1.8;
          ctx.fillStyle = COLORS.pellet;
          ctx.shadowColor = COLORS.pellet;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(c * TILE + TILE / 2, r * TILE + TILE / 2, pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  const BOB_CYCLES_PER_TILE = 1.15; // how many full 8-frame walk cycles play per tile crossed
  const BOB_DRAW_HEIGHT = TILE * 2.05;
  const BOB_VERTICAL_TILT = 0.26; // radians - the art is side-profile only, so
  // up/down movement is hinted at by leaning the sprite instead of a real turn

  function drawPlayer(time) {
    const p = entityPixel(player);
    if (player.facing === LEFT) player.hFace = LEFT;
    else if (player.facing === RIGHT) player.hFace = RIGHT;
    const faceLeft = player.hFace === LEFT;
    const shrink = state === "dying" ? Math.max(0, stateTimer / 1.1) : 1;

    if (!bobSpriteReady) {
      // sprite still loading - draw a simple placeholder so the player is never invisible
      ctx.fillStyle = "#e31e24";
      ctx.beginPath();
      ctx.arc(p.x, p.y, TILE * 0.42 * shrink, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const frame = state === "playing" && player.dir !== STOP
      ? Math.floor(player.walkPhase * BOB_CYCLES_PER_TILE * BOB_SHEET_COLS) % BOB_SHEET_COLS
      : 0;
    const sx = frame * bobFrameW;
    const sy = BOB_WALK_ROW * bobFrameH;
    const drawH = BOB_DRAW_HEIGHT * shrink;
    const drawW = drawH * (bobFrameW / bobFrameH);

    let tilt = 0;
    if (state === "playing") {
      if (player.dir === UP) tilt = -BOB_VERTICAL_TILT;
      else if (player.dir === DOWN) tilt = BOB_VERTICAL_TILT;
    }
    // mirroring (scale -1,1) flips the apparent direction of a rotation, so
    // the tilt sign must be flipped too, and the mirror must be applied
    // BEFORE the rotation (closer to translate) - otherwise the lean reads
    // backwards whenever the character is facing left instead of right
    const effectiveTilt = faceLeft ? -tilt : tilt;

    ctx.save();
    ctx.translate(p.x, p.y);
    if (faceLeft) ctx.scale(-1, 1);
    ctx.rotate(state === "dying" ? (1 - shrink) * Math.PI * 2 : effectiveTilt);
    // the art's feet sit near the bottom of the frame - anchor it a little
    // above the tile center so the character reads as standing on the path
    ctx.drawImage(bobSprite, sx, sy, bobFrameW, bobFrameH, -drawW / 2, -drawH * 0.6, drawW, drawH);
    ctx.restore();
  }

  function drawGhostBody(x, y, color) {
    const r = TILE * 0.42;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.1, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r * 0.7);
    const bumps = 4;
    const w = (r * 2) / bumps;
    for (let i = 0; i < bumps; i++) {
      const bx = x + r - w * i;
      const midx = bx - w / 2;
      const endx = bx - w;
      ctx.quadraticCurveTo(midx, i % 2 === 0 ? y + r * 1.05 : y + r * 0.55, endx, y + r * 0.7);
    }
    ctx.lineTo(x - r, y - r * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  function drawRival(r, time) {
    const p = entityPixel(r);
    if (r.status === "eaten") {
      drawEyes(p.x, p.y, r.dir, "#ffffff");
      return;
    }
    let color = r.color;
    if (r.status === "frightened") {
      const flashing = frightTimer < 2;
      const on = flashing ? Math.floor(time / 150) % 2 === 0 : true;
      color = on ? "#4d6fe0" : "#e8e8ff";
    }
    drawGhostBody(p.x, p.y, color);
    if (r.status === "frightened") {
      // scared face
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const yy = p.y + 2;
      ctx.moveTo(p.x - 7, yy);
      for (let i = 0; i < 4; i++) {
        ctx.lineTo(p.x - 7 + (i + 0.5) * 3.5, yy + (i % 2 === 0 ? 3 : -3));
      }
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(p.x - 5, p.y - 3, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x + 5, p.y - 3, 1.6, 0, Math.PI * 2); ctx.fill();
    } else {
      drawEyes(p.x, p.y, r.dir, "#ffffff");
    }
  }

  function drawEyes(x, y, dir, scleraColor) {
    const ox = dir ? dir.dx * 2.4 : 0;
    const oy = dir ? dir.dy * 2.4 : 0;
    for (const s of [-4.2, 4.2]) {
      ctx.fillStyle = scleraColor;
      ctx.beginPath();
      ctx.arc(x + s, y - 3, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1b3b8c";
      ctx.beginPath();
      ctx.arc(x + s + ox, y - 3 + oy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFloatTexts() {
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    floatTexts.forEach((f) => {
      ctx.fillStyle = `rgba(245,166,35,${Math.max(0, f.life / 0.8)})`;
      ctx.fillText(f.text, f.x, f.y);
    });
  }

  function render(time) {
    drawMaze(time);
    rivals.forEach((r) => drawRival(r, time));
    if (state !== "menu") {
      drawPlayer(time);
      drawFloatTexts();
    }
  }

  // ---------------- Main loop ----------------
  let lastTime = 0;
  function loop(ts) {
    const dt = Math.min((ts - lastTime) / 1000, 0.05) || 0;
    lastTime = ts;
    if (state === "playing" || state === "ready" || state === "dying" || state === "levelcomplete") {
      update(dt);
    }
    render(ts);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
