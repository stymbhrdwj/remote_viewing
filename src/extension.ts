import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PDFEditorProvider } from './pdfEditorProvider.js';
import { initWebPEncoder } from './webpEncoder.js';
import { forwardSearch } from './synctex.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Pre-initialize WebAssembly WebP encoder asynchronously
  initWebPEncoder(context.extensionPath).catch((err) => {
    console.warn('[Remote PDF Viewer] Background WebP init warning:', err);
  });

  // Register Custom Editor Provider for *.pdf
  const provider = new PDFEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PDFEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        },
        supportsMultipleEditorsPerDocument: true
      }
    )
  );

  // Command: Open Preview
  context.subscriptions.push(
    vscode.commands.registerCommand('remotePdfViewer.openPreview', async (uri?: vscode.Uri) => {
      const targetUri = uri || getActivePdfUri();
      if (!targetUri) {
        vscode.window.showInformationMessage('Please select a PDF file to open.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, PDFEditorProvider.viewType);
    })
  );

  // Command: Open Preview to the Side
  context.subscriptions.push(
    vscode.commands.registerCommand('remotePdfViewer.openPreviewToTheSide', async (uri?: vscode.Uri) => {
      const targetUri = uri || getActivePdfUri();
      if (!targetUri) {
        vscode.window.showInformationMessage('Please select a PDF file to open.');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        targetUri,
        PDFEditorProvider.viewType,
        vscode.ViewColumn.Beside
      );
    })
  );

  // Command: SyncTeX Forward Search (TeX editor -> PDF viewer)
  context.subscriptions.push(
    vscode.commands.registerCommand('remotePdfViewer.synctexForward', async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showInformationMessage('No active TeX editor found.');
        return;
      }

      const texPath = activeEditor.document.uri.fsPath;
      const ext = path.extname(texPath).toLowerCase();
      if (ext !== '.tex' && ext !== '.latex') {
        vscode.window.showInformationMessage('SyncTeX forward search is only available from .tex files.');
        return;
      }

      const line = activeEditor.selection.active.line + 1; // 1-indexed

      // Locate corresponding PDF in same directory or outdir
      const dir = path.dirname(texPath);
      const base = path.basename(texPath, ext);
      const candidates = [
        path.join(dir, `${base}.pdf`),
        path.join(dir, 'build', `${base}.pdf`),
        path.join(dir, 'out', `${base}.pdf`)
      ];

      let pdfPath: string | null = null;
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          pdfPath = c;
          break;
        }
      }

      if (!pdfPath) {
        vscode.window.showWarningMessage(`Could not find compiled PDF for ${base}.tex`);
        return;
      }

      const forwardResult = forwardSearch(pdfPath, texPath, line);
      if (!forwardResult) {
        vscode.window.showInformationMessage(`No SyncTeX match found for ${path.basename(texPath)}:${line}`);
        return;
      }

      const pdfUri = vscode.Uri.file(pdfPath);
      let panel = PDFEditorProvider.getActivePanel(pdfUri);

      if (!panel) {
        // Open PDF beside the editor
        await vscode.commands.executeCommand(
          'vscode.openWith',
          pdfUri,
          PDFEditorProvider.viewType,
          vscode.ViewColumn.Beside
        );
        panel = PDFEditorProvider.getActivePanel(pdfUri);
      }

      if (panel) {
        panel.webview.postMessage({
          type: 'synctexForward',
          page: forwardResult.page,
          x: forwardResult.x,
          y: forwardResult.y,
          width: forwardResult.width,
          height: forwardResult.height
        });
      }
    })
  );

  // Command: Refresh / Reload
  context.subscriptions.push(
    vscode.commands.registerCommand('remotePdfViewer.refresh', async () => {
      const panel = PDFEditorProvider.getActivePanel();
      if (panel) {
        panel.webview.postMessage({ type: 'refresh' });
      }
    })
  );
}

function getActivePdfUri(): vscode.Uri | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.uri.fsPath.toLowerCase().endsWith('.pdf')) {
    return activeEditor.document.uri;
  }
  return undefined;
}

export function deactivate(): void {}
