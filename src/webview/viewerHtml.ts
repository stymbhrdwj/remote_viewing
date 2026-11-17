import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getViewerHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  pdfTitle: string,
  invertColorsInDarkMode: boolean
): string {
  // Read CSS and JS files
  const cssPath = path.join(extensionUri.fsPath, 'src', 'webview', 'viewer.css');
  const jsPath = path.join(extensionUri.fsPath, 'src', 'webview', 'viewer.js');

  let cssContent = '';
  let jsContent = '';

  try {
    if (fs.existsSync(cssPath)) {
      cssContent = fs.readFileSync(cssPath, 'utf8');
    } else {
      // In bundled production mode
      const distCssPath = path.join(extensionUri.fsPath, 'dist', 'viewer.css');
      if (fs.existsSync(distCssPath)) {
        cssContent = fs.readFileSync(distCssPath, 'utf8');
      }
    }
  } catch (err) {
    console.warn('Could not read viewer.css:', err);
  }

  try {
    if (fs.existsSync(jsPath)) {
      jsContent = fs.readFileSync(jsPath, 'utf8');
    } else {
      // In bundled production mode
      const distJsPath = path.join(extensionUri.fsPath, 'dist', 'viewer.js');
      if (fs.existsSync(distJsPath)) {
        jsContent = fs.readFileSync(distJsPath, 'utf8');
      }
    }
  } catch (err) {
    console.warn('Could not read viewer.js:', err);
  }

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(pdfTitle)}</title>
  <style>
${cssContent}
  </style>
</head>
<body class="${invertColorsInDarkMode ? 'invert-dark-mode' : ''}">

  <!-- Top Toolbar -->
  <header class="toolbar" id="toolbar">
    <div class="toolbar-group">
      <button class="tool-button" id="sidebarToggle" title="Toggle Sidebar (Thumbnails & Outline)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm4 1H2v8h4V4zm1 8h7V4H7v8z"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <!-- Navigation -->
    <div class="toolbar-group">
      <button class="tool-button" id="prevPageBtn" title="Previous Page (Up / PageUp)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4l-5 5h10l-5-5z"/>
        </svg>
      </button>
      <input type="number" id="pageInput" class="page-input" value="1" min="1" title="Go to Page" />
      <span id="pageCountLabel" class="page-count-label">/ 1</span>
      <button class="tool-button" id="nextPageBtn" title="Next Page (Down / PageDown)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 12l5-5H3l5 5z"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <!-- Zoom Controls -->
    <div class="toolbar-group">
      <button class="tool-button" id="zoomOutBtn" title="Zoom Out (Ctrl -)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 8h10v1H3z"/>
        </svg>
      </button>
      <select id="zoomSelect" class="zoom-select" title="Zoom Level">
        <option value="fit-width">Fit Width</option>
        <option value="fit-page">Fit Page</option>
        <option value="auto">Automatic</option>
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
        <option value="3">300%</option>
        <option value="4">400%</option>
        <option value="6">600%</option>
        <option value="8">800%</option>
        <option value="12">1200%</option>
        <option value="16">1600% (High Res)</option>
      </select>
      <button class="tool-button" id="zoomInBtn" title="Zoom In (Ctrl +)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 3v5H3v1h5v5h1V9h5V8H9V3H8z"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <!-- Rotate & View Mode -->
    <div class="toolbar-group">
      <button class="tool-button" id="rotateBtn" title="Rotate Clockwise (R)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 0 1 7 7h-1.5a5.5 5.5 0 1 0-1.6 3.9l1.1 1.1A7 7 0 1 1 8 1zm3 3v4H7l4-4z"/>
        </svg>
      </button>
      <button class="tool-button" id="viewModeBtn" title="Toggle View Mode (Continuous / Single Page)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2h12v3H2V2zm0 4h12v3H2V6zm0 4h12v3H2v-3z"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <!-- Search -->
    <div class="toolbar-group">
      <button class="tool-button" id="searchToggleBtn" title="Find in Document (Ctrl+F)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.8 4.9l3.6 3.6.7-.7-3.6-3.6a5.5 5.5 0 1 0-.7.7z"/>
        </svg>
      </button>
      <button class="tool-button" id="refreshBtn" title="Reload Document">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.6 2.4A7.9 7.9 0 0 0 8 0a8 8 0 1 0 8 8h-1.5A6.5 6.5 0 1 1 8 1.5c1.8 0 3.4.7 4.6 1.9L10 6h6V0l-2.4 2.4z"/>
        </svg>
      </button>
    </div>

    <!-- Live Compilation Status Badge -->
    <div class="live-badge" id="liveBadge" title="Server-side WebP Live Sync (LaTeX/Typst ready)">
      <span class="live-dot"></span>
      <span>Live</span>
    </div>
  </header>

  <!-- Search Floating Bar -->
  <div class="search-container" id="searchContainer">
    <input type="text" id="searchInput" class="search-input" placeholder="Find in document..." />
    <span id="searchCount" class="search-count"></span>
    <button class="tool-button" id="searchPrevBtn" title="Previous Match (Shift+Enter)">▲</button>
    <button class="tool-button" id="searchNextBtn" title="Next Match (Enter)">▼</button>
    <button class="tool-button" id="searchCloseBtn" title="Close (Escape)">✕</button>
  </div>

  <!-- Main View -->
  <div class="main-container" id="mainContainer">
    <!-- Collapsible Sidebar -->
    <aside class="sidebar collapsed" id="sidebar">
      <div class="sidebar-tabs">
        <button class="sidebar-tab active" data-tab="thumbnails">Thumbnails</button>
        <button class="sidebar-tab" data-tab="outline">Outline</button>
      </div>
      <div class="sidebar-content" id="thumbnailsContent"></div>
      <div class="sidebar-content" id="outlineContent" style="display: none;"></div>
    </aside>

    <!-- Scrollable Document Viewport -->
    <main class="viewer-container" id="viewerContainer">
      <div class="document-flow" id="documentFlow"></div>
    </main>
  </div>

  <script nonce="${nonce}">
${jsContent}
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}
