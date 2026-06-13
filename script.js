document.addEventListener('DOMContentLoaded', () => {

  const PAGE_SIZE = 100;
  let currentPage     = 1;
  let currentProducts = [];
  let allProducts     = [];
  let searchMode      = 'semantic';

  // SCROLL REVEAL
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const delay = Number(entry.target.dataset.revealDelay || 0);
        setTimeout(() => entry.target.classList.add('visible'), delay);
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

  // RIPPLE
  const rippleStyle = document.createElement('style');
  rippleStyle.textContent =
    '@keyframes ripple-expand { to { transform: scale(4.5); opacity: 0; } }';
  document.head.appendChild(rippleStyle);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn, .pagination-btn');
    if (!btn || btn.disabled) return;
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

  // GLOW DELAYS
  function refreshGlowDelays() {
    document.querySelectorAll('.glass-card').forEach((el, i) => {
      el.style.setProperty('--glow-delay', `${(i * 1.3) % 7}s`);
      el.style.setProperty('--glow-dur',   `${7 + (i % 3) * 1.5}s`);
    });
  }

  // PROGRESS BAR
  let progressInterval = null;

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

  function setProgress(pct, label) {
    const fill = document.getElementById('progress-fill');
    const lbl  = document.getElementById('progress-label');
    fill.style.transition = 'width 0.4s cubic-bezier(0.22,1,0.36,1)';
    fill.style.width = pct + '%';
    if (label) lbl.textContent = label;
  }

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

  // COLOR UTILITIES
  // t=0 → #015FA9 (blue, 0% similar)   t=1 → #F8C904 (yellow, 100% similar)
  function getGradientColor(t) {
    t = Math.max(0, Math.min(1, t));
    const r = Math.round(1   + t * 247);
    const g = Math.round(95  + t * 106);
    const b = Math.round(169 - t * 165);
    return `rgb(${r},${g},${b})`;
  }

  function getChipTextColor(t) {
    t = Math.max(0, Math.min(1, t));
    const r = Math.round(1   + t * 247);
    const g = Math.round(95  + t * 106);
    const b = Math.round(169 - t * 165);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 128 ? 'var(--on-surface)' : '#fff';
  }

  // COLORIZE BOX
  // similarity is cosine distance (0=identical, 1=different); null means no search
  // We convert to actual similarity t = 1 - distance, then tint the wrap background.
  // The box image uses mix-blend-mode:multiply in CSS, so its grayscale shading mixes
  // with the background to produce a naturally shaded colored box.
  function colorize(imgEl, similarity) {
    const wrap = imgEl.closest('.product-img-wrap');
    const t = similarity == null ? 0 : Math.max(0, Math.min(1, 1 - similarity));
    wrap.style.background = getGradientColor(t);
  }

  // URL SAFETY
  function safeUrl(url) {
    try {
      const u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? url : '';
    } catch { return ''; }
  }

  // HTML ESCAPE
  function esc(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // RENDER PAGE
  function renderPage(page) {
    currentPage = page;
    const start        = (page - 1) * PAGE_SIZE;
    const pageProducts = currentProducts.slice(start, start + PAGE_SIZE);

    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';

    pageProducts.forEach((p, i) => {
      const card = document.createElement('article');
      card.className = 'product-card glass-card reveal';
      card.setAttribute('role', 'listitem');
      card.dataset.revealDelay = i < 30 ? i * 40 : 0;

      const price   = p.price > 0 ? `$${Number(p.price).toFixed(2)}` : 'N/A';
      const href    = safeUrl(p.link);
      const viewBtn = href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">View</a>`
        : '';

      // Convert cosine distance → similarity percentage
      const simPct = p.similarity != null ? Math.round((1 - p.similarity) * 100) : null;
      const t      = p.similarity != null ? Math.max(0, Math.min(1, 1 - p.similarity)) : null;
      const chipStyle = t != null ? `style="background:${getGradientColor(t)};color: white"` : '';
      const chip = simPct != null ? `<span class="similarity-chip" ${chipStyle}>${simPct}%</span>` : '';

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
    renderPagination(page, currentProducts.length);
  }

  // RENDER PAGINATION
  function renderPagination(page, total) {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const container  = document.getElementById('pagination');

    if (totalPages <= 1) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    container.innerHTML = `
      <button class="pagination-btn"${page === 1 ? ' disabled' : ''} aria-label="Previous page">&#8249;</button>
      <span class="pagination-page">${page}</span>
      <button class="pagination-btn"${page === totalPages ? ' disabled' : ''} aria-label="Next page">&#8250;</button>
    `;

    const [prevBtn, nextBtn] = container.querySelectorAll('.pagination-btn');
    prevBtn.addEventListener('click', () => {
      if (page > 1) {
        renderPage(page - 1);
        document.getElementById('results-header').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    nextBtn.addEventListener('click', () => {
      if (page < totalPages) {
        renderPage(page + 1);
        document.getElementById('results-header').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // RENDER RESULTS
  function renderResults(products, labelText) {
    const grid   = document.getElementById('products-grid');
    const header = document.getElementById('results-header');
    const label  = document.getElementById('results-label');
    const empty  = document.getElementById('empty-state');

    if (!products || products.length === 0) {
      grid.innerHTML = '';
      header.hidden  = true;
      empty.hidden   = false;
      document.getElementById('pagination').hidden = true;
      return;
    }

    empty.hidden = true;
    header.hidden = false;
    label.textContent = labelText || `${products.length} products`;

    currentProducts = products;
    renderPage(1);
  }

  // SHOW ERROR IN EMPTY STATE
  function showEmptyMessage(msg) {
    const empty = document.getElementById('empty-state');
    empty.hidden = false;
    empty.textContent = msg;
  }

  // FETCH AND RENDER PRODUCTS
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

  // STATUS STREAM (SSE)
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

  // APP INIT
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

  // MODE TOGGLE
  document.querySelectorAll('.mode-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      searchMode = pill.dataset.mode;
      const q = document.getElementById('search-input').value.trim();
      if (q) doSearch(q);
    });
  });

  // SEARCH
  async function doSearch(query) {
    const modeLabel = searchMode === 'name' ? 'name' : 'semantic';
    startFakeProgress(`Searching for "${query}"…`);
    document.getElementById('products-grid').innerHTML = '';
    document.getElementById('empty-state').hidden = true;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&n=100&mode=${modeLabel}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const hits = await res.json();
      if (hits.error) throw new Error(hits.error);

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

  // FORM HANDLER
  const form  = document.getElementById('search-form');
  const input = document.getElementById('search-input');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) {
      doSearch(q);
    } else {
      renderResults(allProducts, `All products — ${allProducts.length} items`);
    }
  });

  // INIT
  startApp();

});
