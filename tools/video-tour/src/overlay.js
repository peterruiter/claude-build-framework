// Injected into every page and frame the recorder opens (Playwright addInitScript). Draws what a
// viewer needs to follow along and the browser does not show: a cursor, a ripple on each click,
// a highlight ring around what the narration talks about, and a smooth zoom. Also hides scrollbars.
// It listens to real mouse events, so whatever Playwright does with the mouse is what is drawn.
(() => {
  if (window.__vs) return;
  const state = {
    x: -100, y: -100, touch: false, root: null, cursor: null, ring: null, zoomed: false, ready: false
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem('__vs.pos') || 'null');
    if (saved) { state.x = saved.x; state.y = saved.y; }
  } catch { /* a sandboxed frame */ }
  const params = (() => { try { return JSON.parse(sessionStorage.getItem('__vs.mode') || '{}'); } catch { return {}; } })();
  let frameTouch = false;
  try { frameTouch = window.top !== window && window.frameElement?.dataset?.touch === '1'; } catch { /* cross-origin frame */ }
  state.touch = Boolean(window.__vsTouch || params.touch || frameTouch);
  // A frame inside the page (a preview, an embedded player) draws nothing of its own: the cursor is
  // the page's. Only the phone's screen, a frame marked for touch, draws its fingertip there.
  const quiet = window.top !== window && !state.touch;

  const css = `
    html, body, * { scrollbar-width: none !important; }
    *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
    #__vs-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; contain: layout style; }
    #__vs-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; transform: translate(-100px, -100px);
      will-change: transform; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); transition: opacity .2s; }
    #__vs-cursor svg { display: block; transform-origin: 3px 2px; transition: transform .12s ease-out; }
    #__vs-cursor.down svg { transform: scale(.82); }
    #__vs-cursor.touch { width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,.55) 0%, rgba(255,255,255,.28) 55%, rgba(255,255,255,0) 72%);
      box-shadow: 0 0 0 2px rgba(11,31,56,.28) inset; filter: none; opacity: 0; transition: opacity .25s, transform 0s; }
    #__vs-cursor.touch.on { opacity: .95; }
    #__vs-cursor.touch.down { background: radial-gradient(circle, rgba(__VS_HL__,.85) 0%, rgba(__VS_HL__,.45) 55%, rgba(__VS_HL__,0) 72%); }
    .__vs-ripple { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
      border: 3px solid rgba(__VS_HL__,.95); box-shadow: 0 0 12px rgba(__VS_HL__,.6); animation: __vs-ripple .6s ease-out forwards; }
    @keyframes __vs-ripple { from { transform: scale(.4); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }
    #__vs-ring { position: absolute; border-radius: 12px; border: 3px solid rgb(__VS_HL__); opacity: 0;
      box-shadow: 0 0 0 4px rgba(__VS_HL__,.25), 0 0 26px rgba(__VS_HL__,.55);
      transition: opacity .3s ease, left .45s cubic-bezier(.2,.8,.2,1), top .45s cubic-bezier(.2,.8,.2,1), width .45s cubic-bezier(.2,.8,.2,1), height .45s cubic-bezier(.2,.8,.2,1); }
    #__vs-ring.on { opacity: 1; animation: __vs-pulse 1.6s ease-in-out infinite; }
    #__vs-ring.spot { box-shadow: 0 0 0 4px rgba(__VS_HL__,.25), 0 0 26px rgba(__VS_HL__,.55), 0 0 0 200vmax rgba(6,17,31,.38); }
    @keyframes __vs-pulse { 0%, 100% { box-shadow: 0 0 0 4px rgba(__VS_HL__,.25), 0 0 22px rgba(__VS_HL__,.45); } 50% { box-shadow: 0 0 0 7px rgba(__VS_HL__,.18), 0 0 34px rgba(__VS_HL__,.7); } }
    #__vs-ring.spot.on { animation: none; }
  `;

  function mount() {
    if (quiet) { if (!document.getElementById('__vs-style')) { const st = document.createElement('style'); st.id = '__vs-style'; st.textContent = css; (document.head || document.documentElement).appendChild(st); } return; }
    if (state.root && state.root.isConnected) return;
    const style = document.createElement('style');
    style.id = '__vs-style';
    style.textContent = css;
    const root = document.createElement('div');
    root.id = '__vs-root';
    const cursor = document.createElement('div');
    cursor.id = '__vs-cursor';
    if (state.touch) cursor.className = 'touch';
    else cursor.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M4 2.5 L4 24 L9.6 18.6 L13.4 27.4 L17.4 25.7 L13.7 17 L21.6 17 Z" fill="#ffffff" stroke="#0b1f38" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div');
    ring.id = '__vs-ring';
    root.append(ring, cursor);
    // Beside <body>, not in it: a zoom transforms the page's own root and must not move these.
    (document.head || document.documentElement).appendChild(style);
    document.documentElement.appendChild(root);
    state.root = root; state.cursor = cursor; state.ring = ring;
    place();
  }

  function place() {
    if (state.cursor) state.cursor.style.transform = `translate(${state.x}px, ${state.y}px)`;
  }

  function ensure() { if (!quiet && document.documentElement && (!state.root || !state.root.isConnected)) mount(); }

  addEventListener('mousemove', (event) => {
    state.x = event.clientX; state.y = event.clientY;
    ensure(); place();
    try { sessionStorage.setItem('__vs.pos', JSON.stringify({ x: state.x, y: state.y })); } catch { /* ignore */ }
  }, { capture: true, passive: true });

  addEventListener('mousedown', (event) => {
    ensure();
    state.cursor?.classList.add('down');
    if (state.touch) { clearTimeout(state.fade); state.cursor?.classList.add('on'); }
    const ripple = document.createElement('div');
    ripple.className = '__vs-ripple';
    ripple.style.left = `${event.clientX}px`;
    ripple.style.top = `${event.clientY}px`;
    state.root?.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  }, { capture: true, passive: true });

  addEventListener('mouseup', () => {
    state.cursor?.classList.remove('down');
    if (state.touch) state.fade = setTimeout(() => state.cursor?.classList.remove('on'), 350);
  }, { capture: true, passive: true });

  /** The element a zoom transforms: the app's own root, never <html> or the overlay. */
  function zoomRoot() {
    return document.querySelector(__VS_ZOOM_ROOT__) || document.querySelector("[data-vs-zoom-root]") || document.getElementById('root') || document.getElementById('app')
      || document.body?.firstElementChild || document.body;
  }

  window.__vs = {
    ensure,
    setTouch(on) { state.touch = on; if (state.root) { state.root.remove(); state.root = null; } mount(); },
    hideCursor(hidden) { ensure(); if (state.cursor) state.cursor.style.opacity = hidden ? '0' : ''; },
    /** A ring in the highlight colour around a rectangle (viewport coordinates), optionally dimming the rest. */
    highlight(rect, { pad = 8, spot = false, radius = 12 } = {}) {
      ensure();
      const ring = state.ring;
      ring.style.left = `${rect.x - pad}px`; ring.style.top = `${rect.y - pad}px`;
      ring.style.width = `${rect.width + pad * 2}px`; ring.style.height = `${rect.height + pad * 2}px`;
      ring.style.borderRadius = `${radius}px`;
      ring.classList.toggle('spot', spot);
      requestAnimationFrame(() => ring.classList.add('on'));
    },
    /** A finger swiping from one point to another (touch mode), drawn only. */
    swipe(x, y1, y2, ms) {
      ensure();
      const c = state.cursor;
      clearTimeout(state.fade);
      c.style.transition = 'opacity .2s';
      state.x = x; state.y = y1; place();
      c.classList.add('on');
      const start = performance.now();
      return new Promise((done) => {
        function frame(now) {
          const k = Math.min(1, (now - start) / ms);
          const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          state.y = y1 + (y2 - y1) * e; place();
          if (k < 1) requestAnimationFrame(frame);
          else { state.fade = setTimeout(() => c.classList.remove('on'), 200); done(); }
        }
        requestAnimationFrame(frame);
      });
    },
    unhighlight() { state.ring?.classList.remove('on'); },
    /** Zooms the page so a rectangle fills the screen at `scale`, centred, never past an edge. */
    zoom(rect, scale, ms) {
      const target = zoomRoot();
      const w = innerWidth, h = innerHeight;
      const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
      let tx = w / 2 - scale * cx, ty = h / 2 - scale * cy;
      tx = Math.min(0, Math.max(w - scale * w, tx));
      ty = Math.min(0, Math.max(h - scale * h, ty));
      // The transform's origin is the root's own corner, which is above the screen when the window
      // itself has scrolled (some apps scroll the page, others a box inside it):
      // a scale about that corner moves everything by its offset times (scale - 1) as well.
      const origin = target.getBoundingClientRect();
      tx += origin.left * (scale - 1);
      ty += origin.top * (scale - 1);
      // Inside a zoomed body (the recorder's CSS zoom) a translation is in the body's own pixels.
      const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
      target.style.transformOrigin = '0 0';
      target.style.transition = `transform ${ms}ms cubic-bezier(.45,.05,.25,1)`;
      target.style.transform = `translate(${tx / z}px, ${ty / z}px) scale(${scale})`;
      state.zoomed = true;
    },
    unzoom(ms) {
      const target = zoomRoot();
      target.style.transition = `transform ${ms}ms cubic-bezier(.45,.05,.25,1)`;
      target.style.transform = 'none';
      state.zoomed = false;
    },
    /** Scrolls the nearest scrolling box of an element (or the page) by an easing, over ms. */
    scrollTo(el, top, ms) {
      const box = el || document.scrollingElement;
      const from = box.scrollTop;
      const start = performance.now();
      return new Promise((done) => {
        function frame(now) {
          const k = Math.min(1, (now - start) / ms);
          const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          box.scrollTop = from + (top - from) * e;
          if (k < 1) requestAnimationFrame(frame); else done();
        }
        requestAnimationFrame(frame);
      });
    }
  };

  // Addresses a viewer should not see: a development host shown in the page (a preview's address
  // bar, a link) reads as the real one. Pairs come from the recorder in window.__vsReplace.
  const pairs = window.__vsReplace || [];
  function rewrite(node) {
    if (!pairs.length || !node) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.currentNode.nodeType === 3 ? walker.currentNode : walker.nextNode(); t; t = walker.nextNode()) {
      let v = t.nodeValue, changed = false;
      for (const [from, to] of pairs) if (v.includes(from)) { v = v.split(from).join(to); changed = true; }
      if (changed) t.nodeValue = v;
    }
    if (node.querySelectorAll) for (const input of node.querySelectorAll('input')) {
      for (const [from, to] of pairs) if (input.value && input.value.includes(from)) input.value = input.value.split(from).join(to);
    }
  }
  if (pairs.length) {
    const observer = new MutationObserver((list) => { for (const m of list) { if (m.type === 'characterData') rewrite(m.target.parentNode); else m.addedNodes.forEach((n) => rewrite(n.nodeType === 1 ? n : n.parentNode)); } });
    const start = () => { rewrite(document.body); observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
