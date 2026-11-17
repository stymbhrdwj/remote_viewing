(function () {
  const vscode = acquireVsCodeApi();

  // State
  let pageCount = 0;
  let dimensions = []; // Array of { width, height }
  let currentScale = 1.0;
  let zoomMode = 'fit-width';
  let rotation = 0;
  let viewMode = 'continuous';
  let currentPage = 1;
  let searchMatches = [];
  let currentSearchIndex = -1;
  let isSidebarOpen = false;
  let activeSidebarTab = 'thumbnails';
  let isSearchOpen = false;
  let tileRequestDebounce = null;
  let lastTileRequestKeys = new Set();

  // DOM Elements
  const toolbar = document.getElementById('toolbar');
  const mainContainer = document.getElementById('mainContainer');
  const viewerContainer = document.getElementById('viewerContainer');
  const documentFlow = document.getElementById('documentFlow');
  const sidebar = document.getElementById('sidebar');
  const thumbnailsContent = document.getElementById('thumbnailsContent');
  const outlineContent = document.getElementById('outlineContent');
  const searchContainer = document.getElementById('searchContainer');
  const searchInput = document.getElementById('searchInput');
  const searchCount = document.getElementById('searchCount');
  const liveBadge = document.getElementById('liveBadge');

  // Toolbar Controls
  const sidebarToggle = document.getElementById('sidebarToggle');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageInput = document.getElementById('pageInput');
  const pageCountLabel = document.getElementById('pageCountLabel');
  const zoomSelect = document.getElementById('zoomSelect');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const rotateBtn = document.getElementById('rotateBtn');
  const viewModeBtn = document.getElementById('viewModeBtn');
  const searchToggleBtn = document.getElementById('searchToggleBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  // Search Controls
  const searchPrevBtn = document.getElementById('searchPrevBtn');
  const searchNextBtn = document.getElementById('searchNextBtn');
  const searchCloseBtn = document.getElementById('searchCloseBtn');

  // Initialize
  window.addEventListener('message', handleExtensionMessage);
  window.addEventListener('resize', handleResize);
  setupEventListeners();

  // Signal ready to extension host
  vscode.postMessage({ type: 'ready' });

  function setupEventListeners() {
    // Navigation
    prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
    nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));
    pageInput.addEventListener('change', () => {
      const p = parseInt(pageInput.value, 10);
      if (!isNaN(p)) goToPage(p);
    });

    // Zoom
    zoomSelect.addEventListener('change', () => {
      setZoom(zoomSelect.value);
    });
    zoomInBtn.addEventListener('click', () => zoomStep(1));
    zoomOutBtn.addEventListener('click', () => zoomStep(-1));

    // Mouse wheel zoom with Ctrl/Cmd
    viewerContainer.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const delta = -e.deltaY;
          const factor = delta > 0 ? 1.15 : 0.87;
          let newScale = currentScale * factor;
          newScale = Math.max(0.25, Math.min(16.0, newScale));
          applyCustomScale(newScale, e.clientX, e.clientY);
        }
      },
      { passive: false }
    );

    // Rotate
    rotateBtn.addEventListener('click', () => {
      rotation = (rotation + 90) % 360;
      updateRotation();
    });

    // View mode
    viewModeBtn.addEventListener('click', () => {
      viewMode = viewMode === 'continuous' ? 'single' : 'continuous';
      updateViewMode();
    });

    // Sidebar
    sidebarToggle.addEventListener('click', () => toggleSidebar());
    document.querySelectorAll('.sidebar-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-tab');
        switchSidebarTab(target);
      });
    });

    // Search
    searchToggleBtn.addEventListener('click', () => toggleSearchBar());
    searchCloseBtn.addEventListener('click', () => closeSearchBar());
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) prevSearchMatch();
        else nextSearchMatch();
      } else if (e.key === 'Escape') {
        closeSearchBar();
      }
    });
    searchInput.addEventListener('input', debounceSearch);
    searchPrevBtn.addEventListener('click', prevSearchMatch);
    searchNextBtn.addEventListener('click', nextSearchMatch);

    // Refresh
    refreshBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    // Continuous scroll listener to update current page and trigger high-res tiles
    viewerContainer.addEventListener('scroll', handleScroll);

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Don't intercept if user is typing in an input
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearchBar();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomStep(1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomStep(-1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setZoom('fit-width');
      } else if (e.key === 'r') {
        rotation = (rotation + 90) % 360;
        updateRotation();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        viewerContainer.scrollTop += 60;
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        viewerContainer.scrollTop -= 60;
      } else if (e.key === 'PageDown') {
        goToPage(currentPage + 1);
      } else if (e.key === 'PageUp') {
        goToPage(currentPage - 1);
      }
    });
  }

  function handleExtensionMessage(event) {
    const message = event.data;
    switch (message.type) {
      case 'init':
        handleDocInit(message);
        break;
      case 'pageReady':
        handlePageReady(message);
        break;
      case 'tileReady':
        handleTileReady(message);
        break;
      case 'textReady':
        handleTextReady(message);
        break;
      case 'linksReady':
        handleLinksReady(message);
        break;
      case 'outlineReady':
        handleOutlineReady(message);
        break;
      case 'searchResults':
        handleSearchResults(message);
        break;
      case 'synctexForward':
        handleSyncTeXForward(message);
        break;
      case 'docUpdated':
        handleDocUpdated(message);
        break;
    }
  }

  function handleDocInit(data) {
    pageCount = data.pageCount;
    dimensions = data.dimensions || [];
    pageCountLabel.textContent = `/ ${pageCount}`;
    pageInput.max = pageCount;
    pageInput.value = currentPage;

    buildPagePlaceholders();
    updateZoom();
    requestVisiblePages();
    loadThumbnails();

    if (data.outline) {
      buildOutlineTree(data.outline);
    } else {
      vscode.postMessage({ type: 'getOutline' });
    }
  }

  function handleDocUpdated(data) {
    liveBadge.classList.add('updated');
    setTimeout(() => liveBadge.classList.remove('updated'), 1000);

    const prevPageCount = pageCount;
    pageCount = data.pageCount;
    dimensions = data.dimensions || [];
    pageCountLabel.textContent = `/ ${pageCount}`;
    pageInput.max = pageCount;

    if (prevPageCount !== pageCount) {
      buildPagePlaceholders();
      loadThumbnails();
    }

    // Refresh visible pages and tiles while preserving exact scroll position
    updateZoom();
    requestVisiblePages(true);
  }

  function buildPagePlaceholders() {
    documentFlow.innerHTML = '';
    for (let i = 1; i <= pageCount; i++) {
      const dim = dimensions[i - 1] || { width: 595, height: 842 };
      const pageContainer = document.createElement('div');
      pageContainer.className = 'page-container';
      pageContainer.id = `page-${i}`;
      pageContainer.setAttribute('data-page', i);
      pageContainer.style.width = `${dim.width * currentScale}px`;
      pageContainer.style.height = `${dim.height * currentScale}px`;

      const viewport = document.createElement('div');
      viewport.className = 'page-viewport';

      // Skeleton loader
      const skeleton = document.createElement('div');
      skeleton.className = 'page-loading-skeleton';
      skeleton.id = `skeleton-${i}`;
      skeleton.textContent = `Page ${i}`;
      viewport.appendChild(skeleton);

      // Base page image
      const img = document.createElement('img');
      img.className = 'page-image';
      img.id = `img-${i}`;
      img.alt = `Page ${i}`;
      img.style.display = 'none';
      viewport.appendChild(img);

      // High-res tile layer for 1600% zoom
      const tileLayer = document.createElement('div');
      tileLayer.className = 'tile-layer';
      tileLayer.id = `tile-layer-${i}`;
      viewport.appendChild(tileLayer);

      // Selectable text layer
      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      textLayer.id = `text-layer-${i}`;
      viewport.appendChild(textLayer);

      // Search layer
      const searchLayer = document.createElement('div');
      searchLayer.className = 'search-layer';
      searchLayer.id = `search-layer-${i}`;
      viewport.appendChild(searchLayer);

      // SyncTeX layer
      const synctexLayer = document.createElement('div');
      synctexLayer.className = 'synctex-layer';
      synctexLayer.id = `synctex-layer-${i}`;
      viewport.appendChild(synctexLayer);

      // Links layer
      const linksLayer = document.createElement('div');
      linksLayer.className = 'links-layer';
      linksLayer.id = `links-layer-${i}`;
      viewport.appendChild(linksLayer);

      // Double-click for SyncTeX inverse search
      viewport.addEventListener('dblclick', (e) => {
        handleSyncTeXReverseClick(i, e);
      });

      pageContainer.appendChild(viewport);
      documentFlow.appendChild(pageContainer);
    }
  }

  function handleSyncTeXReverseClick(pageNum, e) {
    const dim = dimensions[pageNum - 1];
    if (!dim) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert client coords back to unscaled PDF points
    const ptX = clickX / currentScale;
    const ptY = clickY / currentScale;

    vscode.postMessage({
      type: 'reverseSyncTeX',
      page: pageNum,
      x: ptX,
      y: ptY
    });
  }

  function handleSyncTeXForward(data) {
    goToPage(data.page);
    const synctexLayer = document.getElementById(`synctex-layer-${data.page}`);
    if (!synctexLayer) return;

    synctexLayer.innerHTML = '';
    const ring = document.createElement('div');
    ring.className = 'synctex-ring';
    ring.style.left = `${data.x * currentScale - 5}px`;
    ring.style.top = `${data.y * currentScale - 4}px`;
    ring.style.width = `${Math.max(data.width * currentScale, 30)}px`;
    ring.style.height = `${Math.max(data.height * currentScale, 18)}px`;

    synctexLayer.appendChild(ring);

    // Scroll ring into center
    setTimeout(() => {
      const containerRect = viewerContainer.getBoundingClientRect();
      const ringRect = ring.getBoundingClientRect();
      const offsetTop = viewerContainer.scrollTop + (ringRect.top - containerRect.top) - containerRect.height / 2;
      viewerContainer.scrollTo({ top: offsetTop, behavior: 'smooth' });
    }, 50);
  }

  function handlePageReady(msg) {
    const pageNum = msg.pageIndex + 1;
    const img = document.getElementById(`img-${pageNum}`);
    const skeleton = document.getElementById(`skeleton-${pageNum}`);
    if (img) {
      img.src = msg.dataUrl;
      img.style.display = 'block';
      if (skeleton) skeleton.style.display = 'none';
    }

    // Request text and links for selectable overlay
    vscode.postMessage({ type: 'getText', pageIndex: msg.pageIndex });
    vscode.postMessage({ type: 'getLinks', pageIndex: msg.pageIndex });
  }

  function handleTileReady(msg) {
    const pageNum = msg.pageIndex + 1;
    const tileLayer = document.getElementById(`tile-layer-${pageNum}`);
    if (!tileLayer) return;

    // Only apply if still zoomed in to high scale
    if (currentScale < 2.5) return;

    const tile = msg.tile;
    const img = document.createElement('img');
    img.className = 'tile-img';
    img.src = msg.dataUrl;
    img.style.left = `${tile.x * currentScale}px`;
    img.style.top = `${tile.y * currentScale}px`;
    img.style.width = `${tile.width * currentScale}px`;
    img.style.height = `${tile.height * currentScale}px`;

    // Remove older tiles to save memory
    while (tileLayer.children.length > 2) {
      tileLayer.removeChild(tileLayer.firstChild);
    }

    tileLayer.appendChild(img);
  }

  function handleTextReady(msg) {
    const pageNum = msg.pageIndex + 1;
    const textLayer = document.getElementById(`text-layer-${pageNum}`);
    if (!textLayer) return;

    textLayer.innerHTML = '';
    const spans = msg.spans || [];

    for (const span of spans) {
      const el = document.createElement('span');
      el.className = 'text-span';
      el.textContent = span.text;
      const x0 = span.bbox[0];
      const y0 = span.bbox[1];
      const x1 = span.bbox[2];
      const y1 = span.bbox[3];

      el.style.left = `${x0 * currentScale}px`;
      el.style.top = `${y0 * currentScale}px`;
      el.style.width = `${(x1 - x0) * currentScale}px`;
      el.style.height = `${(y1 - y0) * currentScale}px`;
      el.style.fontSize = `${span.fontSize * currentScale}px`;

      textLayer.appendChild(el);
    }
  }

  function handleLinksReady(msg) {
    const pageNum = msg.pageIndex + 1;
    const linksLayer = document.getElementById(`links-layer-${pageNum}`);
    if (!linksLayer) return;

    linksLayer.innerHTML = '';
    const links = msg.links || [];

    for (const link of links) {
      const el = document.createElement('a');
      el.className = 'pdf-link';
      const b = link.bbox;
      el.style.left = `${b[0] * currentScale}px`;
      el.style.top = `${b[1] * currentScale}px`;
      el.style.width = `${(b[2] - b[0]) * currentScale}px`;
      el.style.height = `${(b[3] - b[1]) * currentScale}px`;

      if (link.isExternal && link.uri) {
        el.title = link.uri;
        el.href = link.uri;
        el.target = '_blank';
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({ type: 'openLink', uri: link.uri });
        });
      } else if (typeof link.page === 'number') {
        el.title = `Jump to page ${link.page + 1}`;
        el.addEventListener('click', (e) => {
          e.preventDefault();
          goToPage(link.page + 1);
        });
      }

      linksLayer.appendChild(el);
    }
  }

  function handleOutlineReady(msg) {
    if (msg.outline) {
      buildOutlineTree(msg.outline);
    }
  }

  function buildOutlineTree(outline) {
    outlineContent.innerHTML = '';
    if (!outline || outline.length === 0) {
      outlineContent.innerHTML = '<div style="padding:10px;color:#888;font-size:12px;">No outline/bookmarks in this document.</div>';
      return;
    }

    const tree = document.createElement('ul');
    tree.className = 'outline-tree';

    function addNodes(nodes, container) {
      for (const node of nodes) {
        const li = document.createElement('li');
        li.className = 'outline-item';

        const row = document.createElement('div');
        row.className = 'outline-node';

        const chevron = document.createElement('span');
        chevron.className = 'outline-chevron';
        const hasChildren = node.children && node.children.length > 0;
        chevron.textContent = hasChildren ? '▼' : '';

        const title = document.createElement('span');
        title.className = 'outline-title';
        title.textContent = node.title;

        row.appendChild(chevron);
        row.appendChild(title);

        if (typeof node.page === 'number') {
          const pageBadge = document.createElement('span');
          pageBadge.className = 'outline-page-num';
          pageBadge.textContent = node.page + 1;
          row.appendChild(pageBadge);
        }

        row.addEventListener('click', () => {
          if (typeof node.page === 'number') {
            goToPage(node.page + 1);
          } else if (node.uri) {
            vscode.postMessage({ type: 'openLink', uri: node.uri });
          }
        });

        li.appendChild(row);

        if (hasChildren) {
          const sub = document.createElement('ul');
          sub.className = 'outline-subtree';
          addNodes(node.children, sub);
          li.appendChild(sub);

          chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            sub.classList.toggle('collapsed');
            chevron.textContent = sub.classList.contains('collapsed') ? '▶' : '▼';
          });
        }

        container.appendChild(li);
      }
    }

    addNodes(outline, tree);
    outlineContent.appendChild(tree);
  }

  function loadThumbnails() {
    thumbnailsContent.innerHTML = '';
    for (let i = 1; i <= pageCount; i++) {
      const item = document.createElement('div');
      item.className = `thumbnail-item ${i === currentPage ? 'active' : ''}`;
      item.id = `thumb-${i}`;

      const wrapper = document.createElement('div');
      wrapper.className = 'thumbnail-wrapper';

      const img = document.createElement('img');
      img.className = 'thumbnail-img';
      img.id = `thumb-img-${i}`;
      img.alt = `Thumbnail ${i}`;

      wrapper.appendChild(img);
      item.appendChild(wrapper);

      const label = document.createElement('div');
      label.className = 'thumbnail-label';
      label.textContent = `${i}`;
      item.appendChild(label);

      item.addEventListener('click', () => goToPage(i));
      thumbnailsContent.appendChild(item);
    }

    // Lazy load thumbnails with IntersectionObserver
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const page = parseInt(entry.target.getAttribute('id').replace('thumb-', ''), 10);
          requestThumbnail(page);
          observer.unobserve(entry.target);
        }
      });
    }, { root: thumbnailsContent, rootMargin: '100px' });

    document.querySelectorAll('.thumbnail-item').forEach((item) => observer.observe(item));
  }

  function requestThumbnail(pageNum) {
    vscode.postMessage({
      type: 'renderThumbnail',
      pageIndex: pageNum - 1
    });
  }

  // --- Seamless 1600% Zoom Engine ---

  function zoomStep(direction) {
    const presetScales = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 16.0];
    let nextScale;
    if (direction > 0) {
      nextScale = presetScales.find((s) => s > currentScale + 0.05) || 16.0;
    } else {
      for (let i = presetScales.length - 1; i >= 0; i--) {
        if (presetScales[i] < currentScale - 0.05) {
          nextScale = presetScales[i];
          break;
        }
      }
      if (!nextScale) nextScale = 0.25;
    }
    applyCustomScale(nextScale);
  }

  function setZoom(val) {
    zoomMode = val;
    if (val === 'fit-width' || val === 'fit-page' || val === 'auto') {
      calculateAutoZoom();
    } else {
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) {
        applyCustomScale(parsed);
      }
    }
  }

  function calculateAutoZoom() {
    const dim = dimensions[currentPage - 1] || dimensions[0] || { width: 595, height: 842 };
    const viewportWidth = viewerContainer.clientWidth - 40;
    const viewportHeight = viewerContainer.clientHeight - 40;

    let targetScale = 1.0;
    if (zoomMode === 'fit-width') {
      targetScale = viewportWidth / dim.width;
    } else if (zoomMode === 'fit-page') {
      targetScale = Math.min(viewportWidth / dim.width, viewportHeight / dim.height);
    } else {
      // auto
      targetScale = Math.min(viewportWidth / dim.width, 1.5);
    }

    targetScale = Math.max(0.25, Math.min(16.0, targetScale));
    applyCustomScale(targetScale);
  }

  function applyCustomScale(newScale, focalX, focalY) {
    const prevScale = currentScale;
    currentScale = Math.max(0.25, Math.min(16.0, newScale));

    // Update zoom dropdown text
    const pct = Math.round(currentScale * 100);
    const existingOpt = Array.from(zoomSelect.options).find((o) => o.value === `${currentScale}`);
    if (existingOpt) {
      zoomSelect.value = `${currentScale}`;
    } else {
      zoomSelect.value = 'custom';
      let customOpt = zoomSelect.querySelector('option[value="custom"]');
      if (!customOpt) {
        customOpt = document.createElement('option');
        customOpt.value = 'custom';
        zoomSelect.appendChild(customOpt);
      }
      customOpt.textContent = `${pct}%`;
      zoomSelect.value = 'custom';
    }

    // Adjust scroll to keep focal point invariant
    if (focalX !== undefined && focalY !== undefined) {
      const containerRect = viewerContainer.getBoundingClientRect();
      const mouseX = focalX - containerRect.left + viewerContainer.scrollLeft;
      const mouseY = focalY - containerRect.top + viewerContainer.scrollTop;
      const ratio = currentScale / prevScale;
      viewerContainer.scrollLeft = mouseX * ratio - (focalX - containerRect.left);
      viewerContainer.scrollTop = mouseY * ratio - (focalY - containerRect.top);
    } else {
      // Zoom centered on viewport center
      const centerX = viewerContainer.clientWidth / 2 + viewerContainer.scrollLeft;
      const centerY = viewerContainer.clientHeight / 2 + viewerContainer.scrollTop;
      const ratio = currentScale / prevScale;
      viewerContainer.scrollLeft = centerX * ratio - viewerContainer.clientWidth / 2;
      viewerContainer.scrollTop = centerY * ratio - viewerContainer.clientHeight / 2;
    }

    updateContainerDimensions();
    requestVisiblePages();
  }

  function updateContainerDimensions() {
    for (let i = 1; i <= pageCount; i++) {
      const dim = dimensions[i - 1] || { width: 595, height: 842 };
      const el = document.getElementById(`page-${i}`);
      if (el) {
        el.style.width = `${dim.width * currentScale}px`;
        el.style.height = `${dim.height * currentScale}px`;
      }
      // If scale < 2.5, clear any high-res tile layer
      if (currentScale < 2.5) {
        const tileLayer = document.getElementById(`tile-layer-${i}`);
        if (tileLayer) tileLayer.innerHTML = '';
      }
    }
  }

  function updateZoom() {
    if (zoomMode === 'fit-width' || zoomMode === 'fit-page' || zoomMode === 'auto') {
      calculateAutoZoom();
    } else {
      updateContainerDimensions();
    }
  }

  function handleResize() {
    if (zoomMode === 'fit-width' || zoomMode === 'fit-page' || zoomMode === 'auto') {
      calculateAutoZoom();
    } else {
      requestVisiblePages();
    }
  }

  // --- Page Visibility & Seamless 1600% Tile Requesting ---

  function handleScroll() {
    detectCurrentPage();
    requestVisiblePages();
  }

  function detectCurrentPage() {
    const containerTop = viewerContainer.scrollTop;
    const containerHeight = viewerContainer.clientHeight;
    const centerY = containerTop + containerHeight / 2;

    for (let i = 1; i <= pageCount; i++) {
      const el = document.getElementById(`page-${i}`);
      if (!el) continue;
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (centerY >= top && centerY <= bottom) {
        if (currentPage !== i) {
          currentPage = i;
          pageInput.value = currentPage;
          updateActiveThumbnail(currentPage);
        }
        break;
      }
    }
  }

  function updateActiveThumbnail(pageNum) {
    document.querySelectorAll('.thumbnail-item').forEach((item) => item.classList.remove('active'));
    const target = document.getElementById(`thumb-${pageNum}`);
    if (target) {
      target.classList.add('active');
    }
  }

  function goToPage(pageNum) {
    if (pageNum < 1) pageNum = 1;
    if (pageNum > pageCount) pageNum = pageCount;
    currentPage = pageNum;
    pageInput.value = currentPage;

    const el = document.getElementById(`page-${pageNum}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    updateActiveThumbnail(currentPage);
  }

  function requestVisiblePages(force = false) {
    const containerRect = viewerContainer.getBoundingClientRect();
    const visiblePages = [];

    for (let i = 1; i <= pageCount; i++) {
      const el = document.getElementById(`page-${i}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();

      // Check if page intersects viewer viewport (with 100px vertical buffer)
      if (rect.bottom >= containerRect.top - 100 && rect.top <= containerRect.bottom + 100) {
        visiblePages.push(i);
      }
    }

    // Always ensure current page is rendered
    if (!visiblePages.includes(currentPage) && currentPage >= 1 && currentPage <= pageCount) {
      visiblePages.push(currentPage);
    }

    // Render base pages (scale capped at 2.5 for full page to keep memory small and fast)
    const baseRenderScale = Math.min(currentScale, 2.0);
    for (const pageNum of visiblePages) {
      vscode.postMessage({
        type: 'renderPage',
        pageIndex: pageNum - 1,
        scale: baseRenderScale,
        force
      });
    }

    // If zoomed in high (>= 2.5 up to 16.0), render seamless viewport tiles!
    if (currentScale >= 2.5) {
      debounceTileRequests(visiblePages, containerRect);
    }
  }

  function debounceTileRequests(visiblePages, containerRect) {
    if (tileRequestDebounce) {
      clearTimeout(tileRequestDebounce);
    }

    tileRequestDebounce = setTimeout(() => {
      for (const pageNum of visiblePages) {
        const el = document.getElementById(`page-${pageNum}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const dim = dimensions[pageNum - 1];
        if (!dim) continue;

        // Calculate visible viewport rectangle within the page
        const visibleLeft = Math.max(0, containerRect.left - rect.left);
        const visibleTop = Math.max(0, containerRect.top - rect.top);
        const visibleRight = Math.min(rect.width, containerRect.right - rect.left);
        const visibleBottom = Math.min(rect.height, containerRect.bottom - rect.top);

        if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) continue;

        // Add 25% margin padding around viewport
        const marginX = (visibleRight - visibleLeft) * 0.25;
        const marginY = (visibleBottom - visibleTop) * 0.25;

        const tileLeftPx = Math.max(0, visibleLeft - marginX);
        const tileTopPx = Math.max(0, visibleTop - marginY);
        const tileRightPx = Math.min(rect.width, visibleRight + marginX);
        const tileBottomPx = Math.min(rect.height, visibleBottom + marginY);

        // Convert to unscaled PDF points
        const tileX = tileLeftPx / currentScale;
        const tileY = tileTopPx / currentScale;
        const tileW = (tileRightPx - tileLeftPx) / currentScale;
        const tileH = (tileBottomPx - tileTopPx) / currentScale;

        vscode.postMessage({
          type: 'renderTile',
          pageIndex: pageNum - 1,
          scale: currentScale,
          tile: {
            x: tileX,
            y: tileY,
            width: tileW,
            height: tileH
          }
        });
      }
    }, 60);
  }

  // --- Rotation & View Mode ---

  function updateRotation() {
    for (let i = 1; i <= pageCount; i++) {
      const el = document.getElementById(`page-${i}`);
      if (el) {
        el.style.transform = `rotate(${rotation}deg)`;
      }
    }
  }

  function updateViewMode() {
    viewModeBtn.classList.toggle('active', viewMode === 'single');
    if (viewMode === 'single') {
      documentFlow.style.flexDirection = 'column';
      for (let i = 1; i <= pageCount; i++) {
        const el = document.getElementById(`page-${i}`);
        if (el) el.style.display = i === currentPage ? 'block' : 'none';
      }
    } else {
      documentFlow.style.flexDirection = 'column';
      for (let i = 1; i <= pageCount; i++) {
        const el = document.getElementById(`page-${i}`);
        if (el) el.style.display = 'block';
      }
    }
  }

  // --- Sidebar & Search ---

  function toggleSidebar() {
    isSidebarOpen = !isSidebarOpen;
    sidebar.classList.toggle('collapsed', !isSidebarOpen);
    sidebarToggle.classList.toggle('active', isSidebarOpen);
    setTimeout(() => handleResize(), 220);
  }

  function switchSidebarTab(tab) {
    activeSidebarTab = tab;
    document.querySelectorAll('.sidebar-tab').forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    });
    thumbnailsContent.style.display = tab === 'thumbnails' ? 'block' : 'none';
    outlineContent.style.display = tab === 'outline' ? 'block' : 'none';
  }

  function toggleSearchBar() {
    isSearchOpen = !isSearchOpen;
    searchContainer.classList.toggle('visible', isSearchOpen);
    searchToggleBtn.classList.toggle('active', isSearchOpen);
    if (isSearchOpen) {
      searchInput.focus();
      searchInput.select();
    } else {
      clearSearchHighlights();
    }
  }

  function openSearchBar() {
    isSearchOpen = true;
    searchContainer.classList.add('visible');
    searchToggleBtn.classList.add('active');
    searchInput.focus();
    searchInput.select();
  }

  function closeSearchBar() {
    isSearchOpen = false;
    searchContainer.classList.remove('visible');
    searchToggleBtn.classList.remove('active');
    clearSearchHighlights();
  }

  let searchTimeout = null;
  function debounceSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = searchInput.value.trim();
      if (!q) {
        clearSearchHighlights();
        searchCount.textContent = '';
        return;
      }
      vscode.postMessage({ type: 'search', query: q });
    }, 200);
  }

  function handleSearchResults(msg) {
    clearSearchHighlights();
    const results = msg.results || [];
    searchMatches = [];

    for (const match of results) {
      const pageNum = match.pageIndex + 1;
      const searchLayer = document.getElementById(`search-layer-${pageNum}`);
      if (!searchLayer) continue;

      for (const r of match.rects) {
        const el = document.createElement('div');
        el.className = 'search-highlight';
        el.style.left = `${r[0] * currentScale}px`;
        el.style.top = `${r[1] * currentScale}px`;
        el.style.width = `${(r[2] - r[0]) * currentScale}px`;
        el.style.height = `${(r[3] - r[1]) * currentScale}px`;

        searchLayer.appendChild(el);
        searchMatches.push({
          page: pageNum,
          rect: r,
          el
        });
      }
    }

    if (searchMatches.length > 0) {
      currentSearchIndex = 0;
      updateActiveSearchMatch();
    } else {
      searchCount.textContent = '0 / 0';
    }
  }

  function updateActiveSearchMatch() {
    searchMatches.forEach((m, idx) => {
      m.el.classList.toggle('active', idx === currentSearchIndex);
    });

    searchCount.textContent = `${currentSearchIndex + 1} / ${searchMatches.length}`;
    const active = searchMatches[currentSearchIndex];
    if (active) {
      goToPage(active.page);
      active.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function nextSearchMatch() {
    if (searchMatches.length === 0) return;
    currentSearchIndex = (currentSearchIndex + 1) % searchMatches.length;
    updateActiveSearchMatch();
  }

  function prevSearchMatch() {
    if (searchMatches.length === 0) return;
    currentSearchIndex = (currentSearchIndex - 1 + searchMatches.length) % searchMatches.length;
    updateActiveSearchMatch();
  }

  function clearSearchHighlights() {
    document.querySelectorAll('.search-layer').forEach((layer) => {
      layer.innerHTML = '';
    });
    searchMatches = [];
    currentSearchIndex = -1;
  }
})();
