import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PDFEngine } from './pdfEngine.js';
import { getViewerHtml } from './webview/viewerHtml.js';
import { reverseSearch, forwardSearch } from './synctex.js';

export class PDFEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'remotePdfViewer.viewer';

  // Active panels map (uri string -> WebviewPanel)
  private static readonly activePanels = new Map<string, vscode.WebviewPanel>();

  // Epoch tracking to preempt and discard obsolete render requests during rapid zooming
  private readonly latestEpochPerPage = new Map<string, number>();
  private readonly latestTileEpochPerPage = new Map<string, number>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static getActivePanel(uri?: vscode.Uri): vscode.WebviewPanel | undefined {
    if (uri) {
      return PDFEditorProvider.activePanels.get(uri.toString());
    }
    // Return first active panel if any
    const first = PDFEditorProvider.activePanels.values().next();
    return first.done ? undefined : first.value;
  }

  public async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return {
      uri,
      dispose: () => {
        PDFEngine.invalidateDocument(uri.fsPath);
      }
    };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const filePath = document.uri.fsPath;
    const uriString = document.uri.toString();
    PDFEditorProvider.activePanels.set(uriString, webviewPanel);

    webviewPanel.onDidDispose(() => {
      PDFEditorProvider.activePanels.delete(uriString);
    });

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    const config = vscode.workspace.getConfiguration('remotePdfViewer');
    const invertColors = config.get<boolean>('invertColorsInDarkMode', false);
    const fileName = path.basename(filePath);

    webviewPanel.webview.html = getViewerHtml(
      webviewPanel.webview,
      this.context.extensionUri,
      fileName,
      invertColors
    );

    // Setup file watcher for auto-reload on disk modification (LaTeX / Typst compilation)
    const autoReload = config.get<boolean>('autoReload', true);
    const reloadDelay = config.get<number>('autoReloadDelay', 200);

    let reloadTimer: NodeJS.Timeout | null = null;
    let fileWatcher: vscode.FileSystemWatcher | null = null;

    if (autoReload) {
      fileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath))
      );

      const triggerReload = () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
          try {
            // Verify file exists and is readable
            if (!fs.existsSync(filePath)) return;

            PDFEngine.invalidateDocument(filePath);
            const meta = await PDFEngine.getMetadata(filePath);
            webviewPanel.webview.postMessage({
              type: 'docUpdated',
              pageCount: meta.pageCount,
              dimensions: meta.dimensions
            });
          } catch (err) {
            // If file was temporarily locked or mid-write during latexmk compile, retry once after 150ms
            setTimeout(async () => {
              try {
                PDFEngine.invalidateDocument(filePath);
                const meta = await PDFEngine.getMetadata(filePath);
                webviewPanel.webview.postMessage({
                  type: 'docUpdated',
                  pageCount: meta.pageCount,
                  dimensions: meta.dimensions
                });
              } catch {
                // Silently ignore transient compiler locks
              }
            }, 150);
          }
        }, reloadDelay);
      };

      fileWatcher.onDidChange(triggerReload);
      fileWatcher.onDidCreate(triggerReload);
      webviewPanel.onDidDispose(() => {
        if (fileWatcher) fileWatcher.dispose();
        if (reloadTimer) clearTimeout(reloadTimer);
      });
    }

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready': {
            const meta = await PDFEngine.getMetadata(filePath);
            const outline = await PDFEngine.getOutline(filePath);
            webviewPanel.webview.postMessage({
              type: 'init',
              pageCount: meta.pageCount,
              dimensions: meta.dimensions,
              outline
            });
            break;
          }

          case 'renderPage': {
            const pageIndex = msg.pageIndex;
            const epoch = msg.epoch ?? 0;
            const pageKey = `${filePath}:${pageIndex}`;
            this.latestEpochPerPage.set(pageKey, epoch);

            const quality = config.get<number>('webpQuality', 80);
            const render = await PDFEngine.renderPage(filePath, pageIndex, msg.scale, quality);

            // If another zoom or render request arrived while this was rendering, abort immediately
            if (this.latestEpochPerPage.get(pageKey) !== epoch) {
              return;
            }

            webviewPanel.webview.postMessage({
              type: 'pageReady',
              pageIndex: render.pageIndex,
              scale: render.scale,
              epoch,
              dataUrl: render.dataUrl,
              width: render.width,
              height: render.height
            });
            break;
          }

          // Seamless 10,000% Zoom Tile Renderer
          case 'renderTile': {
            const pageIndex = msg.pageIndex;
            const epoch = msg.epoch ?? 0;
            const tileKey = `${filePath}:${pageIndex}`;
            this.latestTileEpochPerPage.set(tileKey, epoch);

            const quality = config.get<number>('webpQuality', 80);
            const render = await PDFEngine.renderTile(
              filePath,
              pageIndex,
              msg.scale,
              msg.tile,
              quality
            );

            // If superseded by a newer zoom/pan while rendering, abort
            if (this.latestTileEpochPerPage.get(tileKey) !== epoch) {
              return;
            }

            webviewPanel.webview.postMessage({
              type: 'tileReady',
              pageIndex: render.pageIndex,
              scale: render.scale,
              epoch,
              tile: render.tile,
              dataUrl: render.dataUrl,
              width: render.width,
              height: render.height
            });
            break;
          }

          case 'renderThumbnail': {
            // Render smaller thumbnail for sidebar (scale 0.2, quality 60)
            const render = await PDFEngine.renderPage(filePath, msg.pageIndex, 0.2, 60);
            webviewPanel.webview.postMessage({
              type: 'thumbnailReady',
              pageIndex: render.pageIndex,
              dataUrl: render.dataUrl
            });
            break;
          }

          case 'getText': {
            const spans = await PDFEngine.extractText(filePath, msg.pageIndex);
            webviewPanel.webview.postMessage({
              type: 'textReady',
              pageIndex: msg.pageIndex,
              spans
            });
            break;
          }

          case 'getLinks': {
            const links = await PDFEngine.extractLinks(filePath, msg.pageIndex);
            webviewPanel.webview.postMessage({
              type: 'linksReady',
              pageIndex: msg.pageIndex,
              links
            });
            break;
          }

          case 'getOutline': {
            const outline = await PDFEngine.getOutline(filePath);
            webviewPanel.webview.postMessage({
              type: 'outlineReady',
              outline
            });
            break;
          }

          case 'search': {
            const results = await PDFEngine.search(filePath, msg.query);
            webviewPanel.webview.postMessage({
              type: 'searchResults',
              query: msg.query,
              results
            });
            break;
          }

          // Reverse SyncTeX (PDF click -> TeX source editor)
          case 'reverseSyncTeX': {
            const result = reverseSearch(filePath, msg.page, msg.x, msg.y);
            if (result && fs.existsSync(result.file)) {
              const doc = await vscode.workspace.openTextDocument(result.file);
              const targetLine = Math.max(0, result.line - 1);
              const editor = await vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(targetLine, 0, targetLine, 0),
                viewColumn: vscode.ViewColumn.One
              });
              editor.revealRange(new vscode.Range(targetLine, 0, targetLine, 0), vscode.TextEditorRevealType.InCenter);
            }
            break;
          }

          case 'openLink': {
            if (msg.uri) {
              vscode.env.openExternal(vscode.Uri.parse(msg.uri));
            }
            break;
          }

          case 'refresh': {
            PDFEngine.invalidateDocument(filePath);
            const meta = await PDFEngine.getMetadata(filePath);
            webviewPanel.webview.postMessage({
              type: 'docUpdated',
              pageCount: meta.pageCount,
              dimensions: meta.dimensions
            });
            break;
          }
        }
      } catch (err: any) {
        console.error('[PDFEditorProvider] Error handling message:', err);
      }
    });
  }
}
