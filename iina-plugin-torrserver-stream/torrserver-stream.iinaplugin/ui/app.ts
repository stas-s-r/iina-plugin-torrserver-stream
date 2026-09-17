// TypeScript for IINA WebView UI

interface Window {
  iina?: {
    postMessage(name: string, data?: any): void;
    _emit?: (name: string, data: any) => void;
    __patched?: boolean;
  };
  webkit?: {
    messageHandlers?: {
      iina?: {
        postMessage(args: [string, string]): void;
      };
    };
  };
}

class TorrServerUI {
  private localListeners: Map<string, ((data: any) => void)[]> = new Map();
  private selectedFileBase64: string | null = null;
  private selectedFileName: string = '';

  constructor() {
    this.patchBridge();
    this.initFilePicker();
    this.initBridge();
  }

  private patchBridge() {
    const self = this;
    const patchObj = (wIina: any) => {
      if (!wIina || wIina.__patched) return;
      if (!wIina.listeners) wIina.listeners = {};
      const origEmit = wIina._emit;
      wIina._emit = function(name: string, data: any) {
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch { parsed = data; }
        }
        const cbs = self.localListeners.get(name) || [];
        cbs.forEach((cb) => {
          try { cb(parsed); } catch (e) { console.error(e); }
        });
        if (typeof origEmit === 'function') {
          try { origEmit.call(this, name, data); } catch {}
        }
      };
      // Keep listeners object mapped as well
      self.localListeners.forEach((cbs, name) => {
        wIina.listeners[name] = (data: any) => {
          cbs.forEach(cb => cb(data));
        };
      });
      wIina.__patched = true;
    };

    let cur = (window as any).iina;
    if (cur) patchObj(cur);

    try {
      Object.defineProperty(window, 'iina', {
        configurable: true,
        enumerable: true,
        get: () => cur,
        set: (v) => {
          cur = v;
          patchObj(cur);
        }
      });
    } catch {}

    setInterval(() => {
      if ((window as any).iina && !(window as any).iina.__patched) {
        patchObj((window as any).iina);
      }
    }, 100);
  }

  private send(name: string, data: any = {}) {
    const payload = data !== undefined ? data : {};
    try {
      if (window.iina && typeof window.iina.postMessage === 'function') {
        window.iina.postMessage(name, payload);
      } else if (window.webkit?.messageHandlers?.iina) {
        window.webkit.messageHandlers.iina.postMessage([name, JSON.stringify(payload)]);
      }
    } catch (e) {
      console.error(`Error sending message "${name}":`, e);
    }
  }

  private on(name: string, callback: (data: any) => void) {
    if (!this.localListeners.has(name)) {
      this.localListeners.set(name, []);
    }
    this.localListeners.get(name)!.push(callback);

    const w = window as any;
    if (w.iina && w.iina.listeners) {
      w.iina.listeners[name] = (data: any) => {
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch { parsed = data; }
        }
        callback(parsed);
      };
    }
  }

  private initFilePicker() {
    const dropArea = document.getElementById('dropArea') as HTMLElement;
    const fileLabel = document.getElementById('fileLabel') as HTMLElement;

    if (!dropArea) return;

    // Prevent default browser drag/drop behavior
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      document.body.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Highlight on drag
    ['dragenter', 'dragover'].forEach((eventName) => {
      dropArea.addEventListener(eventName, () => {
        dropArea.style.borderColor = 'var(--accent)';
        dropArea.style.background = 'rgba(0, 122, 255, 0.1)';
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropArea.addEventListener(eventName, () => {
        dropArea.style.borderColor = 'var(--accent)';
        dropArea.style.background = '';
      });
    });

    // Handle dropped file
    dropArea.addEventListener('drop', (e: DragEvent) => {
      const dt = e.dataTransfer;
      const file = dt?.files?.[0];
      if (!file) return;

      if (fileLabel) {
        fileLabel.innerText = file.name;
      }

      this.processFile(file);
    });

    // Also handle click to pick
    dropArea.addEventListener('click', () => {
      const loader = document.getElementById('loaderArea') as HTMLElement;
      const loaderText = document.getElementById('loaderText') as HTMLElement;
      const emptyState = document.getElementById('emptyState') as HTMLElement;
      const fileListContainer = document.getElementById('fileListContainer') as HTMLElement;
      
      if (loader) loader.style.display = 'block';
      if (loaderText) loaderText.innerText = 'Ожидание выбора файла в Finder...';
      if (emptyState) emptyState.style.display = 'none';
      if (fileListContainer) fileListContainer.style.display = 'none';

      this.send('pickFile');
    });
  }

  private processFile(file: File) {
    const loader = document.getElementById('loaderArea') as HTMLElement;
    const loaderText = document.getElementById('loaderText') as HTMLElement;
    const emptyState = document.getElementById('emptyState') as HTMLElement;
    const fileListContainer = document.getElementById('fileListContainer') as HTMLElement;
    
    if (loader) loader.style.display = 'block';
    if (loaderText) loaderText.innerText = 'Загрузка торрента в TorrServer...';
    if (emptyState) emptyState.style.display = 'none';
    if (fileListContainer) fileListContainer.style.display = 'none';

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;

      this.send('loadTorrentBase64', {
        name: file.name,
        base64: base64
      });
    };
    reader.onerror = (err) => {
      console.error('[FileReader error]', err);
      if (loader) loader.style.display = 'none';
      if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.innerHTML = '<span style="color: var(--leech-red);">Ошибка чтения файла. Попробуйте нажать на область и выбрать файл через Finder.</span>';
      }
    };
    reader.readAsDataURL(file);
  }

  private initBridge() {
    this.on('torrentCanceled', () => {
      const loader = document.getElementById('loaderArea') as HTMLElement;
      if (loader) loader.style.display = 'none';
    });

    this.on('torrentLoaded', (data: { hash: string, title: string, files: any[] }) => {
      const loader = document.getElementById('loaderArea') as HTMLElement;
      const loadBtn = document.getElementById('loadBtn') as HTMLButtonElement;
      if (loader) loader.style.display = 'none';
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.innerText = '▶ Запустить торрент';
      }
      this.renderFiles(data.hash, data.title, data.files);
    });

    this.on('torrentError', (data: { message: string }) => {
      const loader = document.getElementById('loaderArea') as HTMLElement;
      const loadBtn = document.getElementById('loadBtn') as HTMLButtonElement;
      const emptyState = document.getElementById('emptyState') as HTMLElement;
      
      if (loader) loader.style.display = 'none';
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.innerText = 'Загрузить торрент';
      }
      if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.innerHTML = `<span style="color: var(--leech-red);">Ошибка: ${this.escapeHtml(data.message)}</span>`;
      }
    });
  }

  private renderFiles(hash: string, title: string, files: any[]) {
    const container = document.getElementById('fileListContainer') as HTMLElement;
    const list = document.getElementById('resultsList') as HTMLElement;
    const titleEl = document.getElementById('torrentTitle') as HTMLElement;
    
    if (!list || !container) return;

    if (!files || files.length === 0) {
      container.style.display = 'none';
      const emptyState = document.getElementById('emptyState') as HTMLElement;
      if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.innerHTML = 'В этом торренте нет видеофайлов.';
      }
      return;
    }

    container.style.display = 'block';
    if (titleEl) {
      titleEl.innerText = title ? `Файлы: ${title}` : 'Список видеофайлов';
    }

    list.innerHTML = '';
    
    if (files.length > 1) {
      const playAllBtn = document.createElement('button');
      playAllBtn.className = 'btn btn-accent';
      playAllBtn.style.width = '100%';
      playAllBtn.style.marginBottom = '12px';
      playAllBtn.innerText = '▶ Смотреть всё (Плейлист)';
      playAllBtn.onclick = () => {
        this.send('playFile', { hash, asPlaylist: true });
      };
      list.appendChild(playAllBtn);
    }

    files.forEach((file) => {
      const card = document.createElement('div');
      card.className = 'release-card';
      card.innerHTML = `
        <div class="release-title">${this.escapeHtml(file.name)}</div>
        <div class="release-meta">
          <span>📁 ${file.sizeFormatted}</span>
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary play-btn" data-id="${file.id}">
            ▶ Смотреть
          </button>
        </div>
      `;

      const playBtn = card.querySelector('.play-btn') as HTMLButtonElement;
      if (playBtn) {
        playBtn.addEventListener('click', () => {
          playBtn.disabled = true;
          playBtn.innerText = 'Запуск...';
          this.send('playFile', { hash, fileId: file.id });
          setTimeout(() => {
            playBtn.disabled = false;
            playBtn.innerText = '▶ Смотреть';
          }, 3000);
        });
      }

      list.appendChild(card);
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new TorrServerUI();
});
