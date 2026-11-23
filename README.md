# Remote SSH PDF Viewer for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero-Sudo](https://img.shields.io/badge/Dependencies-0%20Sudo%20%7C%20Zero--Config-brightgreen.svg)]()
[![WebP Streaming](https://img.shields.io/badge/Streaming-WebAssembly%20WebP-orange.svg)]()
[![Zoom](https://img.shields.io/badge/Zoom-Seamless%2010%2C000%25-purple.svg)]()

A high-performance, self-contained VS Code PDF viewer specifically engineered for **Remote SSH**, **Dev Containers**, and heavy **LaTeX / Typst** editing workflows.

Renders PDF pages directly on the remote server using high-speed WebAssembly, streaming ultra-lightweight **WebP images (typically 20KB–80KB)** to the local VS Code window. Experience zero-latency scrolling, instant live compilation reloads, and **seamless 10,000% zoom** without downloading multi-megabyte PDFs over SSH.

---

## Why Remote SSH PDF Viewer?

When editing complex documents, papers, or textbooks over Remote SSH:
1. **Traditional client-side viewers** transfer the entire raw PDF file over the SSH pipe on every single compilation. For 50MB documents or high-latency SSH connections, this causes noticeable freeze, stutter, and wasted bandwidth.
2. **Standard server-side tools** require `sudo apt-get install poppler-utils ghostscript imagemagick`, which is impossible on shared HPC clusters, cloud VMs without root privileges, or locked-down remote servers.
3. **Heavy zoom** in naive renderers either chokes the remote CPU with gigantic 500MB bitmap allocations at 16x scale or produces blurry, pixelated text.

**Remote SSH PDF Viewer solves all of these:**
- **Zero Sudo / Zero System Dependencies**: 100% self-contained in a single `.vsix` package. Powered by MuPDF WebAssembly and Google Squoosh WebP WebAssembly. Runs on standard Node.js on Linux (x64, ARM64), macOS, and Windows.
- **WebP Streaming**: Only the compressed view (20KB–80KB) travels through the SSH connection.
- **Seamless 10,000% Zoom**: Uses an adaptive sub-viewport tile engine at high magnifications (250%–10,000%). Only the visible screen region is rendered at subpixel precision in ~60ms, keeping memory tiny and math equations tack-sharp.
- **Live Reload for LaTeX / Typst**: Listens to file changes from `latexmk`, `pdflatex`, or `typst watch` with intelligent write-lock debouncing. Updates instantly without losing your scroll position or zoom level.
- **Full SyncTeX Integration**:
  - **Inverse Search**: Double-click (or Ctrl+click) any equation or text in the PDF to jump directly to the exact line in your `.tex` source file.
  - **Forward Search**: Run `Remote PDF: Jump to PDF Location (SyncTeX)` from any `.tex` file to highlight the corresponding region in the viewer with a smooth pulsing indicator.
- **Selectable Text & Search**: Transparent text layer overlaid with exact glyph coordinates allows selecting, copying (`Ctrl+C`), and searching (`Ctrl+F`) with highlighted bounding boxes.
- **Sidebar Navigation**: Page thumbnails and interactive document outline (bookmarks / table of contents).

---

## Architecture

```
+---------------------------------------------------------------------------------+
| REMOTE SERVER (Workspace Extension Host)                                        |
|                                                                                 |
|  [ *.pdf File on Disk ] <------- [ File Watcher (Debounced Live Sync) ]         |
|           |                                                                     |
|           v                                                                     |
|  [ MuPDF WASM Engine ] ------+                                                  |
|    - Vector Page Parsing      |--> [ Pixmap / Sub-Viewport Tile ]               |
|    - Text & Link Extraction   |          |                                      |
|    - Document Outline         |          v                                      |
|    - Exact Search Quads       |    [ @jsquash/webp WASM Encoder ]               |
|                               |          |                                      |
|  [ SyncTeX Parser (.gz) ]     |          v (Compressed WebP: ~20-80 KB)         |
|    - LaTeX <-> PDF Mapping    +---> [ Extension Host RPC (postMessage) ]        |
+---------------------------------------------------|-----------------------------+
                                                    | (Fast SSH Stream)
+---------------------------------------------------|-----------------------------+
| LOCAL CLIENT (VS Code Webview)                    v                             |
|                                                                                 |
|  +---------------------------------------------------------------------------+  |
|  | Modern VS Code Toolbar (Page Nav, Continuous/Single, 10,000% Zoom, Search)  |  |
|  +---------------------------------------------------------------------------+  |
|  | [Sidebar]        | [Continuous Scroll Viewport]                           |  |
|  | - Thumbnails     |   - Base WebP Layer (Hardware Accelerated)             |  |
|  | - Outline Tree   |   - High-Res 10,000% Viewport Tile Overlay             |  |
|  |                  |   - Transparent Selectable Text Layer (Copy/Paste)     |  |
|  |                  |   - Golden Search Highlight Boxes                      |  |
|  |                  |   - SyncTeX Pulsing Target Ring                        |  |
|  +------------------+--------------------------------------------------------+  |
+---------------------------------------------------------------------------------+
```

---

## Features in Detail

### 1. Seamless 10,000% Zoom
Zoom smoothly from **25% to 10,000%** using:
- Dropdown presets: `Fit Width`, `Fit Page`, `Automatic`, `25%`, `50%`, `75%`, `100%`, `125%`, `150%`, `200%`, `300%`, `400%`, `600%`, `800%`, `1200%`, `1600%`, `2500%`, `3500%`, `5000%`, `7500%`, `10000% (Ultra Res)`.
- `+` and `-` toolbar buttons.
- `Ctrl + MouseWheel` or trackpad pinch zoom.
- `Space + Drag` or `Middle-Click Drag` to smoothly pan across high-zoom details.
- Keyboard shortcuts: `Ctrl + Plus`, `Ctrl + Minus`, `Ctrl + 0` (Reset to Fit Width).

**How it stays seamless:**
- Zoom transformations respond instantly at 60 FPS using GPU-accelerated CSS scaling.
- At magnifications above 250%, the client calculates the visible viewport bounding box in PDF point coordinates and streams an exact high-res tile rendered on the server.
- The tile blends on top of the base image within milliseconds without any flicker, checkerboard pattern, or blank screen.

### 2. LaTeX & Typst Live Compilation Sync
When running `latexmk -pvc`, `pdflatex`, `tectonic`, or `typst watch`:
- The extension automatically detects when the compiler writes a new PDF.
- Debounced reload logic handles atomic file replacements, transient locks, and multi-pass writes gracefully.
- The viewer updates smoothly while **preserving your exact scroll position, zoom, and current page**.
- A subtle **Live** badge pulses in the header, flashing "Updated" on each compilation.

### 3. SyncTeX Forward & Reverse Search
- **Reverse Search (PDF -> TeX)**: Double-click or Ctrl+click anywhere on an equation or paragraph. VS Code immediately opens the source `.tex` document and places your cursor on that line.
- **Forward Search (TeX -> PDF)**: With your cursor anywhere in a `.tex` file, press `Ctrl+Shift+P` and run `Remote PDF: Jump to PDF Location (SyncTeX)`. The PDF viewer scrolls to the exact point and displays an animated highlight ring.

### 4. Selectable Text & In-Document Search
- Hover over text, drag to select, and press `Ctrl+C` to copy text directly to your clipboard.
- Press `Ctrl+F` to open the search bar. Matches are highlighted in gold with the active match highlighted in bright orange. Navigate seamlessly with `Enter` / `Shift+Enter` or the previous/next buttons.

### 5. Document Outline & Thumbnails
- Toggle the sidebar to view page thumbnails or the interactive Table of Contents.
- Click any section or chapter to jump immediately to that page.

---

## Installation

### Easy VSIX Install (Recommended for Remote SSH)
1. Download or transfer the pre-built `remote-ssh-pdf-viewer-1.0.0.vsix` to your machine or remote server.
2. In VS Code:
   - Open the Extensions view (`Ctrl+Shift+X`).
   - Click the **`...`** menu at the top right of the Extensions panel.
   - Select **Install from VSIX...** and choose `remote-ssh-pdf-viewer-1.0.0.vsix`.
   - *Or from terminal:*
     ```bash
     code --install-extension remote-ssh-pdf-viewer-1.0.0.vsix
     ```
3. Click any `.pdf` file in the Explorer. It opens instantly with the Remote PDF Viewer!

---

## Extension Settings

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `remotePdfViewer.webpQuality` | `number` | `80` | Server-side WebP compression quality (20–100). |
| `remotePdfViewer.defaultZoom` | `string` | `"fit-width"` | Initial zoom mode (`fit-width`, `fit-page`, `auto`, `1.0`, etc.). |
| `remotePdfViewer.maxZoom` | `number` | `10000` | Maximum zoom percentage. |
| `remotePdfViewer.autoReload` | `boolean` | `true` | Automatically reload when PDF is recompiled on disk. |
| `remotePdfViewer.autoReloadDelay` | `number` | `200` | Debounce delay in milliseconds before reloading after file write. |
| `remotePdfViewer.invertColorsInDarkMode` | `boolean` | `false` | Inverts PDF colors in dark mode for high-contrast reading. |

---

## Commands

| Command | Title | Keybinding / Context |
| :--- | :--- | :--- |
| `remotePdfViewer.openPreview` | Remote PDF: Open Preview | PDF file context menu |
| `remotePdfViewer.openPreviewToTheSide` | Remote PDF: Open Preview to the Side | Editor tab title bar |
| `remotePdfViewer.synctexForward` | Remote PDF: Jump to PDF Location (SyncTeX) | Active `.tex` file editor |
| `remotePdfViewer.refresh` | Remote PDF: Reload Document | Viewer toolbar or Command Palette |

---

## Keyboard Shortcuts in Viewer

- `Ctrl +` / `Cmd +`: Zoom In
- `Ctrl -` / `Cmd -`: Zoom Out
- `Ctrl 0` / `Cmd 0`: Fit Width
- `Ctrl + MouseWheel`: Smooth continuous zoom centered on cursor (up to 10,000%)
- `Space + Drag` / `Middle-Click Drag`: Smooth pan across page (especially at 10,000% zoom)
- `Ctrl + F`: Open Find / Search bar
- `Escape`: Close Search bar
- `r`: Rotate 90° clockwise
- `j` / `ArrowDown`: Scroll down
- `k` / `ArrowUp`: Scroll up
- `PageDown` / `PageUp`: Navigate page by page
- `Double-Click`: SyncTeX reverse search (jump to LaTeX source)

---

## Building from Source

```bash
# Clone the repository
git clone https://github.com/remote-ssh-pdf-viewer/remote-ssh-pdf-viewer.git
cd remote-ssh-pdf-viewer

# Install dependencies
npm install

# Run automated tests
npm test

# Build production bundle
npm run build

# Package into self-contained VSIX
npm run package
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
All bundled WebAssembly engines are licensed under compatible open-source licenses (Apache 2.0 / Artifex).
