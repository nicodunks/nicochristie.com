const PRESETS = {
  beginner: { label: 'Beginner', rows: 9, cols: 9, mines: 10 },
  intermediate: { label: 'Intermediate', rows: 16, cols: 16, mines: 40 },
  expert: { label: 'Expert', rows: 16, cols: 30, mines: 99 },
};

const NUMBER_COLORS = ['', '#0000ff', '#007b00', '#ff0000', '#00007b', '#7b0000', '#007b7b', '#000', '#808080'];

function randomIndex(max) {
  if (globalThis.crypto?.getRandomValues) {
    const ceiling = Math.floor(0x100000000 / max) * max;
    const value = new Uint32Array(1);
    do crypto.getRandomValues(value); while (value[0] >= ceiling);
    return value[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function upgradeMinesweeper(root) {
  if (root.dataset.upgraded === 'true') return;
  root.dataset.upgraded = 'true';

  let presetName = 'intermediate';
  let preset;
  let mines = [];
  let revealed = [];
  let flagged = [];
  let adjacent = [];
  let cells = [];
  let started = false;
  let finished = false;
  let won = false;
  let explodedIndex = null;
  let seconds = 0;
  let timer = null;
  let flagMode = false;
  let focusedIndex = 0;

  root.innerHTML = `
    <div class="ms-toolbar" role="toolbar" aria-label="Game difficulty">
      ${Object.entries(PRESETS).map(([key, item]) => `<button type="button" class="ms-difficulty" data-preset="${key}" aria-pressed="false">${item.label}</button>`).join('')}
      <button type="button" class="ms-mode" aria-pressed="false" title="Useful on touch screens">🚩 Flag mode</button>
    </div>
    <div class="ms-header">
      <div class="ms-lcd ms-mines" aria-label="Mines remaining">040</div>
      <button type="button" class="ms-face" aria-label="New game" title="New game">🙂</button>
      <div class="ms-lcd ms-time" aria-label="Elapsed time">000</div>
    </div>
    <div class="ms-grid-wrap"><div class="ms-grid" role="grid" aria-label="Minesweeper board"></div></div>
    <div class="ms-status" aria-live="polite"><span class="ms-progress"></span><span class="ms-best"></span></div>
    <div class="ms-hint">Click to reveal · Right-click or F to flag · Click a number to clear around it</div>
  `;

  const grid = root.querySelector('.ms-grid');
  const mineDisplay = root.querySelector('.ms-mines');
  const timeDisplay = root.querySelector('.ms-time');
  const face = root.querySelector('.ms-face');
  const progress = root.querySelector('.ms-progress');
  const best = root.querySelector('.ms-best');
  const modeButton = root.querySelector('.ms-mode');

  const indexOf = (row, col) => row * preset.cols + col;
  const isInside = (row, col) => row >= 0 && row < preset.rows && col >= 0 && col < preset.cols;
  const neighbors = (index) => {
    const row = Math.floor(index / preset.cols);
    const col = index % preset.cols;
    const result = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
        if ((rowOffset || colOffset) && isInside(row + rowOffset, col + colOffset)) {
          result.push(indexOf(row + rowOffset, col + colOffset));
        }
      }
    }
    return result;
  };

  const formatCounter = (value) => Math.max(-99, Math.min(999, value)).toString().padStart(3, '0');
  const bestKey = () => `nico-minesweeper-best-${presetName}`;
  const getBest = () => {
    try { return Number(localStorage.getItem(bestKey())) || null; } catch { return null; }
  };
  const setBest = (value) => {
    try { localStorage.setItem(bestKey(), String(value)); } catch { /* Storage can be unavailable. */ }
  };

  function stopTimer() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  }

  function startTimer() {
    stopTimer();
    timer = window.setInterval(() => {
      if (!root.isConnected) return stopTimer();
      seconds = Math.min(999, seconds + 1);
      updateStatus();
      if (seconds === 999) stopTimer();
    }, 1000);
  }

  function updateStatus(message = '') {
    const flagCount = flagged.filter(Boolean).length;
    const safeCount = preset.rows * preset.cols - preset.mines;
    const revealedCount = revealed.reduce((sum, value, index) => sum + Number(value && !mines[index]), 0);
    mineDisplay.textContent = formatCounter(preset.mines - flagCount);
    timeDisplay.textContent = formatCounter(seconds);
    progress.innerHTML = message || `<strong>${revealedCount}</strong> of ${safeCount} safe squares cleared`;
    const record = getBest();
    best.textContent = record ? `Best: ${record}s` : 'Best: —';
  }

  function resizeWindow() {
    const shell = root.closest('.window');
    if (!shell) return;
    const cellSize = presetName === 'expert' ? 20 : presetName === 'beginner' ? 26 : 24;
    const desiredWidth = Math.max(310, preset.cols * cellSize + 34);
    const desiredHeight = Math.max(420, preset.rows * cellSize + 178);
    const maxWidth = Math.max(300, window.innerWidth - 12);
    const maxHeight = Math.max(360, window.innerHeight - 46);
    const width = Math.min(desiredWidth, maxWidth);
    const height = Math.min(desiredHeight, maxHeight);
    const oldLeft = Number.parseFloat(shell.style.left) || 6;
    const oldTop = Number.parseFloat(shell.style.top) || 6;
    shell.style.width = `${width}px`;
    shell.style.height = `${height}px`;
    shell.style.left = `${Math.max(4, Math.min(oldLeft, window.innerWidth - width - 4))}px`;
    shell.style.top = `${Math.max(4, Math.min(oldTop, window.innerHeight - height - 36))}px`;
  }

  function placeMines(safeIndex) {
    const excluded = new Set([safeIndex, ...neighbors(safeIndex)]);
    const choices = Array.from({ length: preset.rows * preset.cols }, (_, index) => index).filter((index) => !excluded.has(index));
    for (let count = 0; count < preset.mines; count += 1) {
      const pick = randomIndex(choices.length);
      mines[choices.splice(pick, 1)[0]] = true;
    }
    adjacent = mines.map((_, index) => neighbors(index).filter((neighbor) => mines[neighbor]).length);
  }

  function revealArea(index) {
    const queue = [index];
    while (queue.length) {
      const current = queue.pop();
      if (revealed[current] || flagged[current]) continue;
      revealed[current] = true;
      if (!mines[current] && adjacent[current] === 0) {
        neighbors(current).forEach((neighbor) => {
          if (!revealed[neighbor] && !flagged[neighbor]) queue.push(neighbor);
        });
      }
    }
  }

  function lose(index) {
    finished = true;
    won = false;
    explodedIndex = index;
    revealed[index] = true;
    mines.forEach((isMine, cellIndex) => { if (isMine) revealed[cellIndex] = true; });
    stopTimer();
    face.textContent = '😵';
    render();
    updateStatus('Boom — click the face to try again.');
  }

  function checkWin() {
    const safeCount = preset.rows * preset.cols - preset.mines;
    const revealedSafe = revealed.reduce((sum, value, index) => sum + Number(value && !mines[index]), 0);
    if (revealedSafe !== safeCount) return false;
    finished = true;
    won = true;
    mines.forEach((isMine, index) => { if (isMine) flagged[index] = true; });
    stopTimer();
    face.textContent = '😎';
    const record = getBest();
    if (!record || seconds < record) setBest(seconds);
    render();
    updateStatus(record && seconds >= record ? `Cleared in ${seconds}s.` : `New best: ${seconds}s!`);
    return true;
  }

  function reveal(index) {
    if (finished || flagged[index]) return;
    if (!started) {
      placeMines(index);
      started = true;
      startTimer();
    }
    if (revealed[index]) return chord(index);
    if (mines[index]) return lose(index);
    revealArea(index);
    render();
    if (!checkWin()) updateStatus();
  }

  function chord(index) {
    if (!revealed[index] || adjacent[index] === 0 || finished) return;
    const around = neighbors(index);
    if (around.filter((neighbor) => flagged[neighbor]).length !== adjacent[index]) return;
    for (const neighbor of around) {
      if (!flagged[neighbor] && mines[neighbor]) return lose(neighbor);
    }
    around.forEach((neighbor) => { if (!flagged[neighbor]) revealArea(neighbor); });
    render();
    if (!checkWin()) updateStatus();
  }

  function toggleFlag(index) {
    if (finished || revealed[index]) return;
    const flagCount = flagged.filter(Boolean).length;
    if (!flagged[index] && flagCount >= preset.mines) return;
    flagged[index] = !flagged[index];
    render();
    updateStatus();
  }

  function cellLabel(index) {
    const row = Math.floor(index / preset.cols) + 1;
    const col = (index % preset.cols) + 1;
    if (flagged[index]) return `Row ${row}, column ${col}, flagged`;
    if (!revealed[index]) return `Row ${row}, column ${col}, covered`;
    if (mines[index]) return `Row ${row}, column ${col}, mine`;
    return `Row ${row}, column ${col}, ${adjacent[index] || 'no'} adjacent mines`;
  }

  function render() {
    cells.forEach((cell, index) => {
      cell.className = 'ms-cell';
      cell.textContent = '';
      cell.style.color = '';
      cell.tabIndex = index === focusedIndex ? 0 : -1;
      cell.setAttribute('aria-label', cellLabel(index));
      cell.setAttribute('aria-pressed', revealed[index] ? 'true' : 'false');
      if (revealed[index]) {
        cell.classList.add('open');
        if (mines[index]) {
          cell.classList.add('mine');
          cell.textContent = '✸';
          if (index === explodedIndex) cell.classList.add('mine-hit');
        } else if (adjacent[index]) {
          cell.textContent = String(adjacent[index]);
          cell.style.color = NUMBER_COLORS[adjacent[index]];
        }
      } else if (flagged[index]) {
        cell.textContent = '⚑';
        cell.classList.add('flag');
        if (finished && !won && !mines[index]) cell.classList.add('wrong-flag');
      }
    });
  }

  function buildBoard() {
    stopTimer();
    preset = PRESETS[presetName];
    root.dataset.size = presetName;
    const total = preset.rows * preset.cols;
    mines = Array(total).fill(false);
    revealed = Array(total).fill(false);
    flagged = Array(total).fill(false);
    adjacent = Array(total).fill(0);
    started = false;
    finished = false;
    won = false;
    explodedIndex = null;
    seconds = 0;
    focusedIndex = 0;
    face.textContent = '🙂';
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${preset.cols}, var(--ms-cell-size))`;
    grid.setAttribute('aria-rowcount', String(preset.rows));
    grid.setAttribute('aria-colcount', String(preset.cols));
    cells = Array.from({ length: total }, (_, index) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'ms-cell';
      cell.dataset.i = String(index);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-rowindex', String(Math.floor(index / preset.cols) + 1));
      cell.setAttribute('aria-colindex', String((index % preset.cols) + 1));
      grid.append(cell);
      return cell;
    });
    root.querySelectorAll('.ms-difficulty').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.preset === presetName));
    });
    render();
    updateStatus();
    requestAnimationFrame(resizeWindow);
  }

  root.querySelector('.ms-toolbar').addEventListener('click', (event) => {
    const button = event.target.closest('.ms-difficulty');
    if (!button || button.dataset.preset === presetName) return;
    presetName = button.dataset.preset;
    buildBoard();
  });

  modeButton.addEventListener('click', () => {
    flagMode = !flagMode;
    modeButton.setAttribute('aria-pressed', String(flagMode));
    modeButton.textContent = flagMode ? '🚩 Flagging' : '🚩 Flag mode';
  });

  grid.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && !finished) face.textContent = '😮';
  });
  window.addEventListener('pointerup', () => {
    if (!finished) face.textContent = '🙂';
  });
  grid.addEventListener('click', (event) => {
    const cell = event.target.closest('.ms-cell');
    if (!cell) return;
    const index = Number(cell.dataset.i);
    focusedIndex = index;
    if (flagMode) toggleFlag(index); else reveal(index);
  });
  grid.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const cell = event.target.closest('.ms-cell');
    if (cell) toggleFlag(Number(cell.dataset.i));
  });
  grid.addEventListener('keydown', (event) => {
    const cell = event.target.closest('.ms-cell');
    if (!cell) return;
    const index = Number(cell.dataset.i);
    const row = Math.floor(index / preset.cols);
    const col = index % preset.cols;
    const moves = {
      ArrowUp: [Math.max(0, row - 1), col],
      ArrowDown: [Math.min(preset.rows - 1, row + 1), col],
      ArrowLeft: [row, Math.max(0, col - 1)],
      ArrowRight: [row, Math.min(preset.cols - 1, col + 1)],
    };
    if (moves[event.key]) {
      event.preventDefault();
      focusedIndex = indexOf(...moves[event.key]);
      render();
      cells[focusedIndex].focus();
    } else if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      toggleFlag(index);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      reveal(index);
    }
  });
  face.addEventListener('click', buildBoard);
  window.addEventListener('resize', resizeWindow);

  buildBoard();
}

function scanForGames(node = document) {
  if (node.matches?.('.minesweeper')) upgradeMinesweeper(node);
  node.querySelectorAll?.('.minesweeper').forEach(upgradeMinesweeper);
}

scanForGames();
new MutationObserver((records) => {
  records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) scanForGames(node);
  }));
}).observe(document.body, { childList: true, subtree: true });
