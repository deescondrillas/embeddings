document.addEventListener('DOMContentLoaded', () => {

  // All products cached on load — search floats relevant ones to the top
  let allProducts = [];

  // ===== SCROLL REVEAL =====
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const delay = Number(entry.target.dataset.revealDelay || 0);
        setTimeout(() => entry.target.classList.add('visible'), delay);
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

  // ===== RIPPLE =====
  const rippleStyle = document.createElement('style');
  rippleStyle.textContent =
    '@keyframes ripple-expand { to { transform: scale(4.5); opacity: 0; } }';
  document.head.appendChild(rippleStyle);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const rect   = btn.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.style.cssText = `
      position: absolute;
      width: ${size}px; height: ${size}px;
      left: ${e.clientX - rect.left - size / 2}px;
      top:  ${e.clientY - rect.top  - size / 2}px;
      background: rgba(255,255,255,0.20);
      border-radius: 50%;
      transform: scale(0);
      animation: ripple-expand 0.55s cubic-bezier(0.22,1,0.36,1) forwards;
      pointer-events: none;
    `;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });

  // ===== GLOW DELAYS =====
  function refreshGlowDelays() {
    document.querySelectorAll('.glass-card').forEach((el, i) => {
      el.style.setProperty('--glow-delay', `${(i * 1.3) % 7}s`);
      el.style.setProperty('--glow-dur',   `${7 + (i % 3) * 1.5}s`);
    });
  }

  // ===== PROGRESS BAR =====
  let progressInterval = null;

  // Show the bar with a label, no automatic advancement (for real server progress)
  function showProgress(label) {
    const wrap   = document.getElementById('progress-wrap');
    const fill   = document.getElementById('progress-fill');
    const lbl    = document.getElementById('progress-label');
    const header = document.getElementById('results-header');
    header.hidden = true;
    wrap.hidden   = false;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    lbl.textContent = label;
  }

  // Set an exact percentage and optional label (for real server progress)
  function setProgress(pct, label) {
    const fill = document.getElementById('progress-fill');
    const lbl  = document.getElementById('progress-label');
    fill.style.transition = 'width 0.4s cubic-bezier(0.22,1,0.36,1)';
    fill.style.width = pct + '%';
    if (label) lbl.textContent = label;
  }

  // Show bar and advance randomly — used for search where we have no real progress signal
  function startFakeProgress(label) {
    showProgress(label);
    const fill = document.getElementById('progress-fill');
    let pct = 0;
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      const step = Math.random() * 7 + 2;
      pct = Math.min(pct + step, 88);
      fill.style.transition = 'width 0.35s cubic-bezier(0.22,1,0.36,1)';
      fill.style.width = pct + '%';
      if (pct >= 88) clearInterval(progressInterval);
    }, 220);
  }

  function completeProgress() {
    clearInterval(progressInterval);
    const wrap = document.getElementById('progress-wrap');
    const fill = document.getElementById('progress-fill');
    fill.style.transition = 'width 0.3s cubic-bezier(0.22,1,0.36,1)';
    fill.style.width = '100%';
    setTimeout(() => {
      wrap.hidden = true;
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }, 450);
  }

  // ===== COLORIZE BOX =====
  // null similarity → IKEA blue (hue ≈ 210°)
  // otherwise: map arccos(similarity) × 4 onto the color wheel
  function colorize(imgEl, similarity) {
    let hue;
    if (similarity == null) {
      hue = 210;
    } else {
      const s = Math.min(Math.max(similarity, 0), 1);
      hue = Math.acos(s) * (180 / Math.PI) * 4;
    }
    imgEl.style.filter =
      `brightness(0) saturate(100%) invert(1) sepia(1) saturate(3) hue-rotate(${hue.toFixed(1)}deg)`;
  }

  // ===== URL SAFETY =====
  function safeUrl(url) {
    try {
      const u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? url : '';
    } catch { return ''; }
  }

  // ===== HTML ESCAPE =====
  function esc(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ===== RENDER =====
  function renderResults(products, labelText) {
    const grid   = document.getElementById('products-grid');
    const header = document.getElementById('results-header');
    const label  = document.getElementById('results-label');
    const empty  = document.getElementById('empty-state');

    if (!products || products.length === 0) {
      grid.innerHTML = '';
      header.hidden  = true;
      empty.hidden   = false;
      return;
    }

    empty.hidden = true;
    header.hidden = false;
    label.textContent = labelText || `${products.length} products`;

    grid.innerHTML = '';

    products.forEach((p, i) => {
      const card = document.createElement('article');
      card.className = 'product-card glass-card reveal';
      card.setAttribute('role', 'listitem');
      // Stagger reveal: first 30 cards animate in, rest appear instantly
      card.dataset.revealDelay = i < 30 ? i * 40 : 0;

      const price   = p.price > 0 ? `$${Number(p.price).toFixed(2)}` : 'N/A';
      const href    = safeUrl(p.link);
      const viewBtn = href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">View</a>`
        : '';
      const chip = p.similarity != null
        ? `<span class="similarity-chip">${Math.round(p.similarity * 100)}%</span>`
        : '';

      card.innerHTML = `
        <div class="product-img-wrap">
          <img src="assets/box.png" class="product-box" alt="${esc(p.name)}">
          ${chip}
        </div>
        <div class="product-body">
          <p class="product-categories">${esc(p.category)}</p>
          <h3 class="product-name">${esc(p.name)}</h3>
          <p class="product-desc">${esc(p.description)}</p>
          <div class="product-footer">
            <span class="product-price">${price}</span>
            ${viewBtn}
          </div>
        </div>
      `;

      grid.appendChild(card);
      colorize(card.querySelector('.product-box'), p.similarity);
    });

    grid.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
    refreshGlowDelays();
  }

  // ===== SHOW ERROR IN EMPTY STATE =====
  function showEmptyMessage(msg) {
    const empty = document.getElementById('empty-state');
    empty.hidden = false;
    empty.textContent = msg;
  }

  // ===== FETCH AND RENDER PRODUCTS (no progress bar side-effects) =====
  async function fetchAndRenderProducts() {
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      allProducts = data;
      renderResults(allProducts, `All products — ${allProducts.length} items`);
    } catch {
      showEmptyMessage('Could not load catalog.');
    }
  }

  // ===== STATUS STREAM (SSE) =====
  // Opens an EventSource to /api/status and drives the progress bar
  // with real server-side stage labels and percentages.
  function openStatusStream() {
    const es = new EventSource('/api/status');

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setProgress(data.pct, data.label);

      if (data.error) {
        es.close();
        completeProgress();
        showEmptyMessage(`Server error: ${data.error}`);
        return;
      }

      if (data.ready) {
        es.close();
        // Hold at 100% briefly, then hide and render
        setTimeout(() => {
          completeProgress();
          fetchAndRenderProducts();
        }, 600);
      }
    };

    es.onerror = () => {
      es.close();
      completeProgress();
      showEmptyMessage('Lost connection to the server.');
    };
  }

  // ===== APP INIT =====
  // Ping the server first so we can show a clear offline message,
  // then open the SSE stream for real progress.
  async function startApp() {
    showProgress('Connecting to server…');

    try {
      await fetch('/api/ping', { signal: AbortSignal.timeout(2500) });
    } catch {
      completeProgress();
      showEmptyMessage('Server is offline — run python app.py to start the catalog.');
      return;
    }

    openStatusStream();
  }

  // ===== SEARCH =====
  // Returns the top-N matches from the API, then appends the remaining
  // cached products (not in results) sorted alphabetically below them.
  async function doSearch(query) {
    startFakeProgress(`Searching for "${query}"…`);
    document.getElementById('products-grid').innerHTML = '';
    document.getElementById('empty-state').hidden = true;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&n=24`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const hits = await res.json();
      if (hits.error) throw new Error(hits.error);

      // Float search results to the top; append the rest of the catalog below
      const hitIds = new Set(hits.map(h => h.id));
      const rest   = allProducts.filter(p => !hitIds.has(p.id));
      const merged = [...hits, ...rest];

      completeProgress();
      renderResults(
        merged,
        `${hits.length} match${hits.length !== 1 ? 'es' : ''} for "${query}"`
      );
    } catch {
      completeProgress();
      showEmptyMessage('Something went wrong — is the server running?');
    }
  }

  // ===== FORM HANDLER =====
  const form  = document.getElementById('search-form');
  const input = document.getElementById('search-input');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) {
      doSearch(q);
    } else {
      // Empty query → restore full catalog
      renderResults(allProducts, `All products — ${allProducts.length} items`);
    }
  });

  // ===== INIT =====
  startApp();

});
