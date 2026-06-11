/* Canvas renderer for the Ludo board. Pure drawing + hit-testing; it knows
 * nothing about networking. */

(function () {
  const L = window.LUDO;

  class Board {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cell = canvas.width / L.GRID;
      this.tokenHits = []; // { color, token, x, y, r } for click detection
      this.onTokenClick = null;

      canvas.addEventListener('click', (e) => this._handleClick(e));
    }

    resize(size) {
      this.canvas.width = size;
      this.canvas.height = size;
      this.cell = size / L.GRID;
    }

    _handleClick(e) {
      if (!this.onTokenClick) return;
      const rect = this.canvas.getBoundingClientRect();
      const scale = this.canvas.width / rect.width;
      const x = (e.clientX - rect.left) * scale;
      const y = (e.clientY - rect.top) * scale;
      // Topmost (last drawn) first.
      for (let i = this.tokenHits.length - 1; i >= 0; i--) {
        const h = this.tokenHits[i];
        if (Math.hypot(x - h.x, y - h.y) <= h.r + 2) {
          this.onTokenClick(h.color, h.token);
          return;
        }
      }
    }

    // ------------------------------------------------------------------ paint
    render(state, opts = {}) {
      const ctx = this.ctx;
      const c = this.cell;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // Background.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      this._drawYards();
      this._drawTrack();
      this._drawHomeLanes();
      this._drawCenter();

      this.tokenHits = [];
      if (state) this._drawTokens(state, opts);

      // Outer frame.
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, this.canvas.width - 3, this.canvas.height - 3);
    }

    _rect(col, row, w, h) {
      const c = this.cell;
      this.ctx.fillRect(col * c, row * c, w * c, h * c);
    }

    _cellSquare(col, row, fill, stroke) {
      const c = this.cell;
      const ctx = this.ctx;
      ctx.fillStyle = fill;
      ctx.fillRect(col * c, row * c, c, c);
      ctx.strokeStyle = stroke || '#bbb';
      ctx.lineWidth = 1;
      ctx.strokeRect(col * c, row * c, c, c);
    }

    _drawYards() {
      const ctx = this.ctx;
      const c = this.cell;
      for (const color of ['red', 'green', 'yellow', 'blue']) {
        const [col, row, w, h] = L.YARDS[color];
        ctx.fillStyle = L.COLOR_HEX[color];
        this._rect(col, row, w, h);
        // Inner white panel.
        ctx.fillStyle = '#fff';
        this._rect(col + 1, row + 1, w - 2, h - 2);
        // Rounded coloured pad.
        ctx.fillStyle = L.COLOR_HEX[color];
        const pad = 0.5;
        ctx.fillRect((col + 1 + pad) * c, (row + 1 + pad) * c, (w - 2 - pad * 2) * c, (h - 2 - pad * 2) * c);
        // Parking circles.
        for (const [sc, sr] of L.YARD_SPOTS[color]) {
          ctx.beginPath();
          ctx.arc(sc * c, sr * c, c * 0.42, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = L.COLOR_DARK[color];
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    _drawTrack() {
      const ctx = this.ctx;
      const safe = new Set(L.SAFE_INDICES);
      const startCells = {};
      for (const color of Object.keys(L.START_INDEX)) {
        startCells[L.START_INDEX[color]] = color;
      }
      L.PATH.forEach(([col, row], idx) => {
        let fill = '#ffffff';
        if (startCells[idx]) fill = L.COLOR_HEX[startCells[idx]];
        this._cellSquare(col, row, fill, '#9aa');
        if (safe.has(idx) && !startCells[idx]) this._drawStar(col, row);
      });
    }

    _drawStar(col, row) {
      const ctx = this.ctx;
      const c = this.cell;
      const cx = col * c + c / 2;
      const cy = row * c + c / 2;
      const spikes = 5;
      const outer = c * 0.32;
      const inner = c * 0.14;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / spikes) * i - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,120,120,0.55)';
      ctx.fill();
    }

    _drawHomeLanes() {
      for (const color of Object.keys(L.HOME_LANES)) {
        for (const [col, row] of L.HOME_LANES[color]) {
          this._cellSquare(col, row, L.COLOR_HEX[color], L.COLOR_DARK[color]);
        }
      }
    }

    _drawCenter() {
      const ctx = this.ctx;
      const c = this.cell;
      // Central 3x3 home triangles meeting at the middle.
      const cx = 7.5 * c;
      const cy = 7.5 * c;
      const left = 6 * c;
      const right = 9 * c;
      const top = 6 * c;
      const bottom = 9 * c;
      const tris = [
        { color: 'green', pts: [[left, top], [right, top], [cx, cy]] },
        { color: 'yellow', pts: [[right, top], [right, bottom], [cx, cy]] },
        { color: 'blue', pts: [[right, bottom], [left, bottom], [cx, cy]] },
        { color: 'red', pts: [[left, bottom], [left, top], [cx, cy]] },
      ];
      for (const t of tris) {
        ctx.beginPath();
        ctx.moveTo(t.pts[0][0], t.pts[0][1]);
        ctx.lineTo(t.pts[1][0], t.pts[1][1]);
        ctx.lineTo(t.pts[2][0], t.pts[2][1]);
        ctx.closePath();
        ctx.fillStyle = L.COLOR_HEX[t.color];
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    _drawTokens(state, opts) {
      const ctx = this.ctx;
      const c = this.cell;
      const movable = new Set(opts.movableTokens || []);
      const youColor = opts.youColor;
      const isYourTurn = opts.isYourTurn;

      // Group tokens by the board cell they occupy so we can fan out stacks.
      const occupancy = new Map(); // "col,row" -> array of {color, token, t}
      const yardDraws = [];

      for (const p of state.players) {
        for (const t of p.tokens) {
          if (t.state === 'yard') {
            const spot = L.YARD_SPOTS[p.color][t.index];
            yardDraws.push({ color: p.color, token: t.index, col: spot[0], row: spot[1], yard: true });
          } else {
            const cell = L.tokenCell(p.color, t);
            const key = cell.join(',');
            if (!occupancy.has(key)) occupancy.set(key, []);
            occupancy.get(key).push({ color: p.color, token: t.index, col: cell[0], row: cell[1] });
          }
        }
      }

      const drawToken = (d, highlight) => {
        const center = d.yard
          ? { x: d.col * c, y: d.row * c }
          : { x: d.col * c + c / 2, y: d.row * c + c / 2 };
        const r = c * 0.34;
        // Shadow.
        ctx.beginPath();
        ctx.arc(center.x, center.y + 2, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fill();
        // Body.
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.fillStyle = L.COLOR_HEX[d.color];
        ctx.fill();
        ctx.lineWidth = highlight ? 3.5 : 2;
        ctx.strokeStyle = highlight ? '#fff' : L.COLOR_DARK[d.color];
        ctx.stroke();
        // Inner dot.
        ctx.beginPath();
        ctx.arc(center.x, center.y, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        if (highlight) {
          ctx.beginPath();
          ctx.arc(center.x, center.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const canClick = isYourTurn && d.color === youColor && movable.has(d.token);
        this.tokenHits.push({ color: d.color, token: d.token, x: center.x, y: center.y, r, clickable: canClick });
      };

      // Yard tokens.
      for (const d of yardDraws) {
        const canClick = isYourTurn && d.color === youColor && movable.has(d.token);
        drawToken(d, canClick);
      }

      // Board tokens, fanned out when stacked.
      for (const [, group] of occupancy) {
        group.forEach((d, i) => {
          if (group.length > 1) {
            const angle = (Math.PI * 2 * i) / group.length;
            const off = c * 0.18;
            d = { ...d };
            d.col = d.col + 0.5 + (Math.cos(angle) * off) / c - 0.5;
            d.row = d.row + 0.5 + (Math.sin(angle) * off) / c - 0.5;
          }
          const canClick = isYourTurn && d.color === youColor && movable.has(d.token);
          drawToken(d, canClick);
          if (group.length > 1) {
            const center = { x: d.col * c + c / 2, y: d.row * c + c / 2 };
            ctx.fillStyle = '#111';
            ctx.font = `bold ${c * 0.3}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(group.length), center.x, center.y);
          }
        });
      }
    }
  }

  window.Board = Board;
})();
