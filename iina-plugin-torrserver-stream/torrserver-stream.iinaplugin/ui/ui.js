class TorrServerUI {
  constructor() {
    this.localListeners = new Map();
    this.patchBridge();
    this.initFilePicker();
    this.initBridge();
  }

  patchBridge() {
    const self = this;
    const patchObj = (wIina) => {
      if (!wIina || wIina.__patched) return;
      if (!wIina.listeners) wIina.listeners = {};
      const origEmit = wIina._emit;
      wIina._emit = function(name, data) {
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
      self.localListeners.forEach((cbs, name) => {
        wIina.listeners[name] = (data) => {
          cbs.forEach(cb => cb(data));
        };
      });
      wIina.__patched = true;
    };

    let cur = window.iina;
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
      if (window.iina && !window.iina.__patched) {
        patchObj(window.iina);
      }
    }, 100);
  }

  send(name, data) {
    const payload = data !== undefined ? data : {};
    try {
      if (window.iina && typeof window.iina.postMessage === 'function') {
        window.iina.postMessage(name, payload);
      } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.iina) {
        window.webkit.messageHandlers.iina.postMessage([name, JSON.stringify(payload)]);
      }
    } catch (e) {
      console.error('Error sending message:', e);
    }
  }

  on(name, callback) {
    if (!this.localListeners.has(name)) {
      this.localListeners.set(name, []);
    }
    this.localListeners.get(name).push(callback);

    if (window.iina && window.iina.listeners) {
      window.iina.listeners[name] = (data) => {
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch { parsed = data; }
        }
        callback(parsed);
      };
    }
  }

  initFilePicker() {
    const dropArea = document.getElementById('dropArea');
    const fileLabel = document.getElementById('fileLabel');

    if (!dropArea) return;

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

    dropArea.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const file = dt && dt.files ? dt.files[0] : null;
      if (!file) return;

      if (fileLabel) {
        fileLabel.innerText = file.name;
      }

      this.processFile(file);
    });

    dropArea.addEventListener('click', () => {
      const loader = document.getElementById('loaderArea');
      const loaderText = document.getElementById('loaderText');
      const emptyState = document.getElementById('emptyState');
      const fileListContainer = document.getElementById('fileListContainer');
      
      if (loader) loader.style.display = 'block';
      if (loaderText) loaderText.innerText = 'Ожидание выбора файла в Finder...';
      if (emptyState) emptyState.style.display = 'none';
      if (fileListContainer) fileListContainer.style.display = 'none';

      this.send('pickFile');
    });
  }

  processFile(file) {
    const loader = document.getElementById('loaderArea');
    const loaderText = document.getElementById('loaderText');
    const emptyState = document.getElementById('emptyState');
    const fileListContainer = document.getElementById('fileListContainer');
    
    if (loader) loader.style.display = 'block';
    if (loaderText) loaderText.innerText = 'Загрузка торрента в TorrServer...';
    if (emptyState) emptyState.style.display = 'none';
    if (fileListContainer) fileListContainer.style.display = 'none';

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
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
        emptyState.innerHTML = '<span style="color: var(--leech-red);">Ошибка чтения файла. Кликните по области для выбора через Finder.</span>';
      }
    };
    reader.readAsDataURL(file);
  }

  initBridge() {
    this.on('torrentCanceled', () => {
      const loader = document.getElementById('loaderArea');
      if (loader) loader.style.display = 'none';
    });

    this.on('torrentLoaded', (data) => {
      const loader = document.getElementById('loaderArea');
      if (loader) loader.style.display = 'none';
      this.renderFiles(data.hash, data.title, data.files);
    });

    this.on('torrentError', (data) => {
      const loader = document.getElementById('loaderArea');
      const emptyState = document.getElementById('emptyState');
      
      if (loader) loader.style.display = 'none';
      if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.innerHTML = `<span style="color: var(--leech-red);">Ошибка: ${this.escapeHtml(data.message)}</span>`;
      }
    });
  }

  renderFiles(hash, title, files) {
    const container = document.getElementById('fileListContainer');
    const list = document.getElementById('resultsList');
    const titleEl = document.getElementById('torrentTitle');
    
    if (!list || !container) return;

    if (!files || files.length === 0) {
      container.style.display = 'none';
      const emptyState = document.getElementById('emptyState');
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

      const playBtn = card.querySelector('.play-btn');
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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new TorrServerUI();
});
