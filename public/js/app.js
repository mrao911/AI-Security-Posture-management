/* Client controller: wires the lobby + game UI to the Socket.IO server. */

(function () {
  const socket = io();
  const L = window.LUDO;

  const state = {
    you: null, // socket id
    code: null,
    room: null, // latest publicRoom snapshot
    name: localStorage.getItem('ludo:name') || '',
  };

  // ---- element helpers ----
  const $ = (sel) => document.querySelector(sel);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  const screens = {
    lobby: $('#screen-lobby'),
    room: $('#screen-room'),
    game: $('#screen-game'),
  };
  function goto(name) {
    Object.values(screens).forEach(hide);
    show(screens[name]);
  }

  const board = new window.Board($('#board'));
  board.onTokenClick = (color, token) => {
    if (!state.room || !state.room.game) return;
    const g = state.room.game;
    const me = mySeat();
    if (!me || me.color !== g.currentColor) return;
    if (!g.dicePending) return;
    if (color !== me.color) return;
    if (!g.movableTokens.includes(token)) return;
    socket.emit('game:move', { token }, (res) => {
      if (!res.ok) flash(res.error || 'Illegal move');
    });
  };

  function mySeat() {
    if (!state.room) return null;
    return state.room.seats.find((s) => s.id === state.you) || null;
  }

  // --------------------------------------------------------------- lobby UI
  $('#name-input').value = state.name;
  $('#name-input').addEventListener('input', (e) => {
    state.name = e.target.value;
    localStorage.setItem('ludo:name', state.name);
  });

  $('#btn-create').addEventListener('click', () => {
    socket.emit('room:create', { name: state.name }, (res) => {
      if (res.ok) {
        state.you = res.you;
        state.code = res.code;
        goto('room');
      }
    });
  });

  $('#btn-join').addEventListener('click', () => {
    const code = $('#join-code').value.trim().toUpperCase();
    if (!code) return flash('Enter a room code');
    socket.emit('room:join', { code, name: state.name }, (res) => {
      if (!res.ok) return flash(res.error || 'Could not join');
      state.you = res.you;
      state.code = res.code;
      goto('room');
    });
  });

  // --------------------------------------------------------------- room UI
  $('#btn-add-bot').addEventListener('click', () => {
    socket.emit('room:addBot', {}, (res) => {
      if (!res.ok) flash(res.error || 'Could not add bot');
    });
  });

  $('#btn-start').addEventListener('click', () => {
    socket.emit('game:start', {}, (res) => {
      if (!res.ok) flash(res.error || 'Could not start');
    });
  });

  $('#btn-copy-code').addEventListener('click', () => {
    navigator.clipboard?.writeText(state.code).then(() => flash('Code copied!'));
  });

  // --------------------------------------------------------------- game UI
  $('#btn-roll').addEventListener('click', () => {
    socket.emit('game:roll', {}, (res) => {
      if (!res.ok) flash(res.error || 'Cannot roll');
    });
  });

  // chat
  function sendChat() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat:send', { text });
    input.value = '';
  }
  $('#chat-send').addEventListener('click', sendChat);
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  $('#btn-leave').addEventListener('click', () => location.reload());
  $('#btn-play-again').addEventListener('click', () => location.reload());

  // --------------------------------------------------------- socket events
  socket.on('connect', () => {
    state.you = socket.id;
  });

  socket.on('room:update', (room) => {
    state.room = room;
    if (room.game) {
      goto('game');
      renderGame();
    } else {
      goto('room');
      renderRoom();
    }
  });

  socket.on('chat:message', (msg) => addChat(msg));

  // ------------------------------------------------------------- rendering
  function renderRoom() {
    const room = state.room;
    $('#room-code').textContent = room.code;
    const isHost = room.hostId === state.you;
    $('#host-controls').style.display = isHost ? 'flex' : 'none';
    $('#start-hint').textContent = room.seats.length < 2
      ? 'Waiting for at least 2 players…'
      : 'Ready when you are.';

    const list = $('#seat-list');
    list.innerHTML = '';
    room.seats.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'seat';
      li.innerHTML = `
        <span class="dot" style="background:${L.COLOR_HEX[s.color]}"></span>
        <span class="seat-name">${escapeHtml(s.name)}</span>
        ${s.isBot ? '<span class="tag">BOT</span>' : ''}
        ${s.id === room.hostId ? '<span class="tag host">HOST</span>' : ''}
        ${s.id === state.you ? '<span class="tag you">YOU</span>' : ''}
      `;
      if (isHost && s.id !== state.you) {
        const btn = document.createElement('button');
        btn.className = 'mini danger';
        btn.textContent = '✕';
        btn.title = 'Remove';
        btn.onclick = () => socket.emit('room:removeSeat', { seatId: s.id }, () => {});
        li.appendChild(btn);
      }
      list.appendChild(li);
    });

    $('#btn-add-bot').disabled = room.seats.length >= 4;
    $('#btn-start').disabled = room.seats.length < 2;
  }

  function renderGame() {
    const room = state.room;
    const g = room.game;
    const me = mySeat();
    const isYourTurn = me && me.color === g.currentColor;

    board.render(g, {
      movableTokens: g.movableTokens,
      youColor: me ? me.color : null,
      isYourTurn,
    });

    // Players panel.
    const panel = $('#players-panel');
    panel.innerHTML = '';
    g.players.forEach((p) => {
      const div = document.createElement('div');
      const homeCount = p.tokens.filter((t) => t.state === 'home').length;
      div.className = 'player-card' +
        (p.color === g.currentColor ? ' active' : '') +
        (p.finished ? ' finished' : '');
      div.innerHTML = `
        <span class="dot" style="background:${L.COLOR_HEX[p.color]}"></span>
        <span class="pc-name">${escapeHtml(p.name)}</span>
        ${p.isBot ? '<span class="tag">BOT</span>' : ''}
        ${!p.connected ? '<span class="tag off">OFF</span>' : ''}
        <span class="pc-home">🏠 ${homeCount}/4</span>
      `;
      panel.appendChild(div);
    });

    // Turn + dice.
    const turnName = g.players.find((p) => p.color === g.currentColor)?.name || '';
    $('#turn-banner').textContent = isYourTurn ? 'Your turn!' : `${turnName}'s turn`;
    $('#turn-banner').style.color = L.COLOR_HEX[g.currentColor];

    const die = $('#die');
    die.className = 'die ' + g.currentColor;
    die.textContent = g.dice ? pip(g.dice) : '–';

    const rollBtn = $('#btn-roll');
    const canRoll = isYourTurn && !g.dicePending && !g.winner;
    rollBtn.disabled = !canRoll;
    rollBtn.classList.toggle('pulse', canRoll);

    $('#move-hint').textContent =
      g.winner ? '' :
      !isYourTurn ? 'Waiting for other players…' :
      g.dicePending ? 'Tap a highlighted token to move.' :
      'Roll the dice!';

    // Last event note.
    const ev = g.lastEvent;
    if (ev) {
      let note = '';
      if (ev.type === 'no-move') note = `${capitalize(ev.color)} rolled ${ev.value} — no moves.`;
      else if (ev.type === 'three-sixes') note = `${capitalize(ev.color)} rolled three 6s — turn skipped!`;
      else if (ev.type === 'move' && ev.captured.length) {
        note = `${capitalize(ev.color)} captured ${ev.captured.map((c) => capitalize(c.color)).join(', ')}!`;
      } else if (ev.type === 'move' && ev.reachedHome) note = `${capitalize(ev.color)} got a token home! 🎉`;
      $('#event-note').textContent = note;
    }

    if (g.winner) showWinner(g);
  }

  function showWinner(g) {
    const modal = $('#winner-modal');
    const order = g.ranking.length ? g.ranking : [g.winner];
    $('#winner-title').textContent = `${capitalize(g.winner)} wins! 🏆`;
    const ol = $('#winner-list');
    ol.innerHTML = '';
    order.forEach((color, i) => {
      const p = g.players.find((pp) => pp.color === color);
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${L.COLOR_HEX[color]}"></span> ${escapeHtml(p ? p.name : color)} ${['🥇','🥈','🥉'][i] || ''}`;
      ol.appendChild(li);
    });
    show(modal);
  }

  // ------------------------------------------------------------- chat utils
  function addChat(msg) {
    const box = $('#chat-log');
    const div = document.createElement('div');
    div.className = 'chat-line' + (msg.color === 'system' ? ' system' : '');
    if (msg.color === 'system') {
      div.textContent = msg.text;
    } else {
      div.innerHTML = `<b style="color:${L.COLOR_HEX[msg.color] || '#333'}">${escapeHtml(msg.name)}:</b> ${escapeHtml(msg.text)}`;
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------- misc utils
  let flashTimer;
  function flash(text) {
    const el = $('#toast');
    el.textContent = text;
    show(el);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => hide(el), 2200);
  }

  function pip(n) {
    return ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][n] || n;
  }
  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  // Responsive board sizing.
  function fitBoard() {
    const wrap = $('#board-wrap');
    const size = Math.min(wrap.clientWidth, 560);
    if (size > 0) {
      board.resize(Math.floor(size / L.GRID) * L.GRID);
      if (state.room && state.room.game) renderGame();
    }
  }
  window.addEventListener('resize', fitBoard);
  setTimeout(fitBoard, 50);
})();
