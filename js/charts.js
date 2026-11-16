/*
 * Tiny dependency free SVG chart renderer used by the explorer.
 * One chart instance owns a persistent overlay so drag selection survives re-renders.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'style') Object.assign(node.style, attrs[k]);
        else if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }

  function makeTicks(min, max, count) {
    const step = niceStep(max - min, count);
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(6));
    return out;
  }

  function pathFrom(points, sx, sy, step) {
    let d = '';
    for (let i = 0; i < points.length; i++) {
      const x = sx(points[i][0]);
      const y = sy(points[i][1]);
      if (i === 0) d += 'M' + x.toFixed(1) + ' ' + y.toFixed(1);
      else if (step) d += 'H' + x.toFixed(1) + 'V' + y.toFixed(1);
      else d += 'L' + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }

  function createChart(container) {
    const id = 'chart' + ++uid;
    container.classList.add('chart');
    const svg = el('svg', { class: 'chart-svg', role: 'img', focusable: 'false' });
    const content = el('g', null, svg);
    const hoverG = el('g', { class: 'chart-hover' }, svg);
    const overlay = el('rect', { class: 'chart-overlay', fill: 'transparent' }, svg);
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');
    container.append(svg, tip);

    let cfg = null;
    let geo = null;
    let dragging = false;

    function toData(e) {
      const r = overlay.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      let x = geo.xd[0] + frac * (geo.xd[1] - geo.xd[0]);
      if (cfg.snap) x = Math.round(x / cfg.snap) * cfg.snap;
      return Math.min(geo.xd[1], Math.max(geo.xd[0], x));
    }

    function hideHover() {
      hoverG.textContent = '';
      tip.hidden = true;
    }

    function showHover(x) {
      if (!cfg || !geo || !cfg.tooltip) return;
      const info = cfg.tooltip(x);
      hoverG.textContent = '';
      if (!info) {
        tip.hidden = true;
        return;
      }
      const px = geo.sx(x);
      el('line', { x1: px, x2: px, y1: geo.m.t, y2: geo.m.t + geo.ih, class: 'hover-line' }, hoverG);
      tip.textContent = '';
      const title = document.createElement('div');
      title.className = 'tip-title';
      title.textContent = info.title;
      tip.appendChild(title);
      (info.rows || []).forEach((r) => {
        if (r.y != null && Number.isFinite(r.y)) {
          const cy = Math.min(geo.m.t + geo.ih, Math.max(geo.m.t, geo.sy(r.y)));
          el('circle', { cx: px, cy, r: 4.5, class: 'hover-dot', style: { fill: r.color || 'currentColor' } }, hoverG);
        }
        const row = document.createElement('div');
        row.className = 'tip-row';
        const sw = document.createElement('i');
        sw.style.background = r.color || 'currentColor';
        const lab = document.createElement('span');
        lab.textContent = r.label;
        const val = document.createElement('b');
        val.textContent = r.value;
        row.append(sw, lab, val);
        tip.appendChild(row);
      });
      if (info.foot) {
        const foot = document.createElement('div');
        foot.className = 'tip-foot';
        foot.textContent = info.foot;
        tip.appendChild(foot);
      }
      tip.hidden = false;
      const cw = container.clientWidth;
      const tw = tip.offsetWidth;
      let left = px + 14;
      if (left + tw > cw - 4) left = px - tw - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = geo.m.t + 6 + 'px';
    }

    overlay.addEventListener('pointermove', (e) => {
      if (!geo) return;
      const x = toData(e);
      showHover(x);
      if (dragging && cfg.onSelect) cfg.onSelect(x);
    });
    overlay.addEventListener('pointerdown', (e) => {
      if (!geo || !cfg.onSelect) return;
      dragging = true;
      try {
        overlay.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      cfg.onSelect(toData(e));
    });
    const stop = () => {
      dragging = false;
    };
    overlay.addEventListener('pointerup', stop);
    overlay.addEventListener('pointercancel', stop);
    overlay.addEventListener('pointerleave', () => {
      if (!dragging) hideHover();
    });

    function render() {
      if (!cfg) return;
      const W = Math.max(280, Math.floor(container.clientWidth));
      const H = cfg.height || (W < 560 ? 330 : 430);
      const small = W < 560;
      const m = { l: small ? 52 : 70, r: small ? 12 : 22, t: 30, b: 48 };
      const iw = W - m.l - m.r;
      const ih = H - m.t - m.b;
      const xd = cfg.x.domain;
      const yd = cfg.y.domain;
      const sx = (v) => m.l + ((v - xd[0]) / (xd[1] - xd[0])) * iw;
      const sy = (v) => m.t + (1 - (v - yd[0]) / (yd[1] - yd[0])) * ih;
      geo = { m, iw, ih, xd, yd, sx, sy };

      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);
      svg.setAttribute('aria-label', cfg.aria || '');
      content.textContent = '';
      hoverG.textContent = '';
      tip.hidden = true;
      overlay.setAttribute('x', m.l);
      overlay.setAttribute('y', m.t);
      overlay.setAttribute('width', iw);
      overlay.setAttribute('height', ih);

      const defs = el('defs', null, content);
      const clip = el('clipPath', { id: id + '-clip' }, defs);
      el('rect', { x: m.l, y: m.t - 2, width: iw, height: ih + 4 }, clip);

      const grid = el('g', { class: 'chart-grid' }, content);
      const yTicks = cfg.y.ticks || makeTicks(yd[0], yd[1], small ? 4 : 6);
      yTicks.forEach((t) => {
        const y = sy(t);
        el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, class: t === 0 ? 'zero' : '' }, grid);
        el('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'tick', text: cfg.y.format(t) }, grid);
      });
      const xTicks = cfg.x.ticks || makeTicks(xd[0], xd[1], small ? 4 : 6);
      xTicks.forEach((t) => {
        const x = sx(t);
        el('line', { x1: x, x2: x, y1: m.t + ih, y2: m.t + ih + 5, class: 'axis' }, grid);
        el('text', { x, y: m.t + ih + 20, 'text-anchor': 'middle', class: 'tick', text: cfg.x.format(t) }, grid);
      });
      if (cfg.x.label) {
        el('text', { x: m.l + iw / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-label', text: cfg.x.label }, grid);
      }
      if (cfg.y.label) {
        el('text', { x: m.l - (small ? 44 : 62), y: m.t - 12, 'text-anchor': 'start', class: 'axis-label', text: cfg.y.label }, grid);
      }

      const plot = el('g', { 'clip-path': 'url(#' + id + '-clip)' }, content);

      (cfg.bands || []).forEach((b) => {
        const x0 = Math.max(m.l, sx(b.x0));
        const x1 = Math.min(m.l + iw, sx(b.x1));
        if (x1 <= x0) return;
        el('rect', { x: x0, y: m.t, width: x1 - x0, height: ih, class: 'band ' + (b.cls || ''), style: b.fill ? { fill: b.fill } : {} }, plot);
      });

      (cfg.areas || []).forEach((a) => {
        let d = '';
        a.top.forEach((p, i) => {
          d += (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1);
        });
        for (let i = a.bottom.length - 1; i >= 0; i--) {
          d += 'L' + sx(a.bottom[i][0]).toFixed(1) + ' ' + sy(a.bottom[i][1]).toFixed(1);
        }
        el('path', { d: d + 'Z', class: 'area ' + (a.cls || ''), style: a.fill ? { fill: a.fill } : {} }, plot);
      });

      (cfg.bars || []).forEach((b) => {
        const x0 = sx(b.x0);
        const w = Math.max(1, sx(b.x1) - x0 - 0.5);
        const y0 = sy(0);
        const y1 = sy(Math.min(b.y, yd[1]));
        el('rect', { x: x0, y: Math.min(y0, y1), width: w, height: Math.abs(y0 - y1), style: { fill: b.fill } }, plot);
      });

      (cfg.hlines || []).forEach((h) => {
        const y = sy(h.y);
        el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, class: 'ref-line', style: { stroke: h.color || '', strokeDasharray: h.dash || '4 4' } }, plot);
        if (h.label) {
          el('text', { x: m.l + iw - 6, y: y - 6, 'text-anchor': 'end', class: 'ref-label halo', style: { fill: h.color || '' }, text: h.label }, content);
        }
      });

      (cfg.lines || []).forEach((l) => {
        el(
          'path',
          {
            d: pathFrom(l.points, sx, sy, l.step),
            class: 'series',
            style: { stroke: l.color, strokeWidth: l.width || 2.5, strokeDasharray: l.dash || 'none' },
          },
          plot
        );
      });

      (cfg.vlines || []).forEach((v, i) => {
        if (v.x < xd[0] || v.x > xd[1]) return;
        const x = sx(v.x);
        el('line', { x1: x, x2: x, y1: m.t, y2: m.t + ih, class: 'ref-line', style: { stroke: v.color || '', strokeDasharray: v.dash || '5 4', strokeWidth: v.width || 1.5 } }, content);
        if (v.label) {
          const flip = x > m.l + iw - 110;
          const row = v.row != null ? v.row : i % 2;
          el(
            'text',
            {
              x: x + (flip ? -6 : 6),
              y: m.t + 14 + row * 15,
              'text-anchor': flip ? 'end' : 'start',
              class: 'ref-label halo',
              style: { fill: v.color || '' },
              text: v.label,
            },
            content
          );
        }
      });

      if (cfg.selected != null && cfg.selected >= xd[0] && cfg.selected <= xd[1]) {
        const x = sx(cfg.selected);
        el('line', { x1: x, x2: x, y1: m.t, y2: m.t + ih, class: 'selected-line' }, content);
        el('path', { d: 'M' + (x - 6) + ' ' + (m.t + ih + 1) + 'L' + (x + 6) + ' ' + (m.t + ih + 1) + 'L' + x + ' ' + (m.t + ih - 7) + 'Z', class: 'selected-handle' }, content);
      }

      (cfg.dots || []).forEach((d) => {
        if (d.x < xd[0] || d.x > xd[1]) return;
        el('circle', { cx: sx(d.x), cy: sy(Math.min(yd[1], Math.max(yd[0], d.y))), r: d.r || 5.5, class: 'dot', style: { fill: d.color } }, content);
      });

      (cfg.notes || []).forEach((n) => {
        if (n.x < xd[0] || n.x > xd[1]) return;
        const lines = String(n.text).split('\n');
        lines.forEach((ln, i) => {
          el(
            'text',
            {
              x: sx(n.x) + (n.dx || 0),
              y: sy(n.y) + (n.dy || 0) + i * 14,
              'text-anchor': n.anchor || 'start',
              class: 'note halo' + (n.strong ? ' strong' : ''),
              style: { fill: n.color || '' },
              text: ln,
            },
            content
          );
        });
      });
    }

    return {
      update(next) {
        cfg = next;
        overlay.style.cursor = cfg.onSelect ? 'ew-resize' : 'crosshair';
        render();
      },
      resize: render,
      el: container,
    };
  }

  const api = { createChart, makeTicks };
  root.TaxCharts = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
