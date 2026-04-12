        // --- Window Management ---
        let zIndexCounter = 100;
        
        function makeDraggable(panelId, headerId) {
            const panel = document.getElementById(panelId);
            const header = document.getElementById(headerId);
            let isDragging = false, startX, startY, startLeft, startTop;

            panel.addEventListener('mousedown', () => {
                panel.style.zIndex = ++zIndexCounter;
            });

            header.addEventListener('mousedown', (e) => {
                if(e.target.classList.contains('panel-close')) return;
                isDragging = true;
                startX = e.clientX; 
                startY = e.clientY;
                
                const rect = panel.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                
                panel.style.left = startLeft + 'px';
                panel.style.top = startTop + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.style.transform = 'none'; 
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                panel.style.left = startLeft + (e.clientX - startX) + 'px';
                panel.style.top = startTop + (e.clientY - startY) + 'px';
            });

            document.addEventListener('mouseup', () => { isDragging = false; });
        }

        ['panel-tools', 'panel-color', 'panel-layers', 'panel-frames'].forEach(id => {
            makeDraggable(id, id.replace('panel-', 'header-'));
        });

        function closePanel(panelId) {
            document.getElementById(panelId).style.display = 'none';
        }

        document.querySelectorAll('#window-dropdown .dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const panelId = e.currentTarget.dataset.panel;
                const panel = document.getElementById(panelId);
                panel.style.display = 'flex';
                panel.style.zIndex = ++zIndexCounter;
            });
        });

        // --- Core Editor State & Pipeline ---
        const AppState = {
            size: 32, scale: 16, zoomLevel: 1, activeTool: 'pencil',
            isDrawing: false, isPlaying: false, gridVisible: false,
            frames: [], currentFrameIdx: 0, currentLayerIdx: 0,
            color: '#FF0000', fps: 12, rgba: [255, 0, 0, 255],
            selection: { active: false, isDragging: false, x: 0, y: 0, w: 0, h: 0, dragStartX: 0, dragStartY: 0, buffer: null }
        };

        const intCanvas = document.getElementById('interactionCanvas');
        const compCanvas = document.getElementById('compositeCanvas');
        const onionCanvas = document.getElementById('onionCanvas');
        const gridCanvas = document.getElementById('gridCanvas');
        const intCtx = intCanvas.getContext('2d', { willReadFrequently: true });
        const compCtx = compCanvas.getContext('2d', { willReadFrequently: true });
        const onionCtx = onionCanvas.getContext('2d');
        const gridCtx = gridCanvas.getContext('2d');
        const wrapper = document.getElementById('canvas-wrapper');
        const colorInput = document.getElementById('primary-color');
        const hexInput = document.getElementById('hex-input');
        const ctxMenu = document.getElementById('ctx-menu');
        const playIcon = document.getElementById('play-icon');
        const opacitySlider = document.getElementById('layer-opacity');
        const opacityVal = document.getElementById('opacity-val');

        const RenderPipeline = {
            offscreenCanvas: document.createElement('canvas'),
            offscreenCtx: null,
            init(size) {
                this.offscreenCanvas.width = size;
                this.offscreenCanvas.height = size;
                this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
            },
            renderComposite() {
                compCtx.clearRect(0, 0, AppState.size, AppState.size);
                const frame = AppState.frames[AppState.currentFrameIdx];
                if (!frame) return;
                frame.layers.forEach(layer => {
                    if (!layer.visible) return;
                    this.offscreenCtx.putImageData(layer.bitmap, 0, 0);
                    compCtx.globalAlpha = layer.opacity;
                    compCtx.drawImage(this.offscreenCanvas, 0, 0);
                });
                compCtx.globalAlpha = 1.0;
                this.drawOnionSkin();
            },
            drawOnionSkin() {
                onionCtx.clearRect(0, 0, AppState.size, AppState.size);
                if (document.getElementById('onion-skin').checked && AppState.currentFrameIdx > 0 && !AppState.isPlaying) {
                    AppState.frames[AppState.currentFrameIdx - 1].layers.forEach(layer => {
                        if (!layer.visible) return;
                        this.offscreenCtx.putImageData(layer.bitmap, 0, 0);
                        onionCtx.globalAlpha = layer.opacity * 0.5;
                        onionCtx.drawImage(this.offscreenCanvas, 0, 0);
                    });
                    onionCtx.globalAlpha = 1.0;
                }
            },
            drawGrid() {
                gridCtx.clearRect(0, 0, AppState.size, AppState.size);
                if (!AppState.gridVisible) return;
                gridCtx.fillStyle = 'rgba(255,255,255,0.4)';
                for (let i = 0; i < AppState.size; i++) {
                    gridCtx.fillRect(i, 0, 0.5, AppState.size); 
                    gridCtx.fillRect(0, i, AppState.size, 0.5);
                }
            },
            renderInteraction() {
                intCtx.clearRect(0, 0, AppState.size, AppState.size);
                if (AppState.selection.active && AppState.selection.buffer) {
                    const temp = document.createElement('canvas');
                    temp.width = AppState.selection.w; temp.height = AppState.selection.h;
                    temp.getContext('2d').putImageData(AppState.selection.buffer, 0, 0);
                    intCtx.drawImage(temp, AppState.selection.x, AppState.selection.y);
                    
                    const sx = AppState.selection.x, sy = AppState.selection.y;
                    const sw = AppState.selection.w, sh = AppState.selection.h;
                    intCtx.fillStyle = 'rgba(0, 120, 212, 0.3)';
                    intCtx.fillRect(sx, sy, sw, sh);
                    intCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                    intCtx.fillRect(sx, sy, sw, 1);
                    intCtx.fillRect(sx, sy + sh - 1, sw, 1);
                    intCtx.fillRect(sx, sy, 1, sh);
                    intCtx.fillRect(sx + sw - 1, sy, 1, sh);
                }
            }
        };

        const HistoryManager = {
            undoStack: [], redoStack: [], maxLimit: 30,
            saveLayerState(fIdx, lIdx, oldBitmap) {
                this.undoStack.push({
                    type: 'layer_modify', fIdx, lIdx,
                    prevBitmap: new ImageData(new Uint8ClampedArray(oldBitmap.data), AppState.size, AppState.size),
                    nextBitmap: null
                });
                if (this.undoStack.length > this.maxLimit) this.undoStack.shift();
                this.redoStack = [];
            },
            undo() {
                if (!this.undoStack.length) return;
                const action = this.undoStack.pop();
                if (action.type === 'layer_modify') {
                    const layer = AppState.frames[action.fIdx].layers[action.lIdx];
                    action.nextBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size);
                    layer.bitmap.data.set(action.prevBitmap.data);
                    this.redoStack.push(action);
                }
                RenderPipeline.renderComposite();
            },
            redo() {
                if (!this.redoStack.length) return;
                const action = this.redoStack.pop();
                if (action.type === 'layer_modify') {
                    const layer = AppState.frames[action.fIdx].layers[action.lIdx];
                    layer.bitmap.data.set(action.nextBitmap.data);
                    this.undoStack.push(action);
                }
                RenderPipeline.renderComposite();
            }
        };

        function putPixel(imgData, x, y, rgba) {
            if (x < 0 || x >= AppState.size || y < 0 || y >= AppState.size) return;
            const idx = (y * AppState.size + x) * 4;
            if (rgba[3] === 0) {
                imgData.data[idx] = 0; imgData.data[idx+1] = 0; imgData.data[idx+2] = 0; imgData.data[idx+3] = 0;
            } else {
                imgData.data[idx] = rgba[0]; imgData.data[idx+1] = rgba[1]; imgData.data[idx+2] = rgba[2]; imgData.data[idx+3] = rgba[3];
            }
        }

        function floodFill(layer, startX, startY, rgba) {
            const data = layer.bitmap.data, size = AppState.size;
            const startPos = (startY * size + startX) * 4;
            const sR = data[startPos], sG = data[startPos+1], sB = data[startPos+2], sA = data[startPos+3];
            if (sR === rgba[0] && sG === rgba[1] && sB === rgba[2] && sA === rgba[3]) return;
            const stack = [[startX, startY]];
            while(stack.length > 0) {
                const [x, y] = stack.pop(), pos = (y * size + x) * 4;
                if (data[pos] === sR && data[pos+1] === sG && data[pos+2] === sB && data[pos+3] === sA) {
                    data[pos] = rgba[0]; data[pos+1] = rgba[1]; data[pos+2] = rgba[2]; data[pos+3] = rgba[3];
                    if (x > 0) stack.push([x - 1, y]); if (x < size - 1) stack.push([x + 1, y]);
                    if (y > 0) stack.push([x, y - 1]); if (y < size - 1) stack.push([x, y + 1]);
                }
            }
        }

        function bresenhamLine(imgData, x0, y0, x1, y1, rgba) {
            let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = (x0 < x1) ? 1 : -1, sy = (y0 < y1) ? 1 : -1, err = dx - dy;
            while (true) {
                putPixel(imgData, x0, y0, rgba); if (x0 === x1 && y0 === y1) break;
                let e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; }
            }
        }

        function drawRectFill(imgData, x0, y0, x1, y1, rgba) {
            const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
            for(let y = minY; y <= maxY; y++) for(let x = minX; x <= maxX; x++) putPixel(imgData, x, y, rgba);
        }

        function drawRectStroke(imgData, x0, y0, x1, y1, rgba) {
            const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
            for(let x = minX; x <= maxX; x++) { putPixel(imgData, x, minY, rgba); putPixel(imgData, x, maxY, rgba); }
            for(let y = minY; y <= maxY; y++) { putPixel(imgData, minX, y, rgba); putPixel(imgData, maxX, y, rgba); }
        }

        function drawCircleStroke(imgData, xc, yc, r, rgba) {
            let x = 0, y = r, d = 3 - 2 * r;
            const drawSym = (cx, cy, x, y) => {
                putPixel(imgData, cx+x, cy+y, rgba); putPixel(imgData, cx-x, cy+y, rgba); putPixel(imgData, cx+x, cy-y, rgba); putPixel(imgData, cx-x, cy-y, rgba);
                putPixel(imgData, cx+y, cy+x, rgba); putPixel(imgData, cx-y, cy+x, rgba); putPixel(imgData, cx+y, cy-x, rgba); putPixel(imgData, cx-y, cy-x, rgba);
            };
            while (y >= x) { drawSym(xc, yc, x, y); x++; if (d > 0) { y--; d = d + 4 * (x - y) + 10; } else d = d + 4 * x + 6; }
        }

        function drawCircleFill(imgData, xc, yc, r, rgba) {
            for(let y=-r; y<=r; y++) for(let x=-r; x<=r; x++) if(x*x + y*y <= r*r) putPixel(imgData, xc+x, yc+y, rgba);
        }

        function commitSelection() {
            if(!AppState.selection.active) return;
            const s = AppState.selection, layer = getActiveLayer();
            if(layer && s.buffer) {
                const oldBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size);
                for(let by=0; by<s.h; by++) {
                    for(let bx=0; bx<s.w; bx++) {
                        const bIdx = (by * s.w + bx) * 4, a = s.buffer.data[bIdx+3];
                        if (a > 0) putPixel(layer.bitmap, s.x + bx, s.y + by, [s.buffer.data[bIdx], s.buffer.data[bIdx+1], s.buffer.data[bIdx+2], a]);
                    }
                }
                HistoryManager.saveLayerState(AppState.currentFrameIdx, AppState.currentLayerIdx, oldBitmap);
                RenderPipeline.renderComposite();
            }
            s.active = false; s.buffer = null; intCtx.clearRect(0,0,AppState.size,AppState.size);
        }

        const Toolbox = {
            startX: 0, startY: 0, tempBitmap: null,
            pencil: { onDown: (x, y, layer) => { putPixel(layer.bitmap, x, y, AppState.rgba); RenderPipeline.renderComposite(); }, onMove: (x, y, layer) => { putPixel(layer.bitmap, x, y, AppState.rgba); RenderPipeline.renderComposite(); } },
            eraser: { onDown: (x, y, layer) => { putPixel(layer.bitmap, x, y, [0,0,0,0]); RenderPipeline.renderComposite(); }, onMove: (x, y, layer) => { putPixel(layer.bitmap, x, y, [0,0,0,0]); RenderPipeline.renderComposite(); } },
            fill: { onDown: (x, y, layer) => { floodFill(layer, x, y, AppState.rgba); RenderPipeline.renderComposite(); AppState.isDrawing = false; }, onMove: () => {} },
            picker: { onDown: (x, y) => { const p = compCtx.getImageData(x, y, 1, 1).data; if (p[3] > 0) { setColor("#" + (1<<24 | p[0]<<16 | p[1]<<8 | p[2]).toString(16).slice(1).toUpperCase()); setTool('pencil'); } AppState.isDrawing = false; }, onMove: () => {} },
            line: { onDown: (x, y, layer) => { Toolbox.startX = x; Toolbox.startY = y; Toolbox.tempBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size); }, onMove: (x, y, layer) => { layer.bitmap.data.set(Toolbox.tempBitmap.data); bresenhamLine(layer.bitmap, Toolbox.startX, Toolbox.startY, x, y, AppState.rgba); RenderPipeline.renderComposite(); } },
            rect: { onDown: (x, y, layer) => { Toolbox.startX = x; Toolbox.startY = y; Toolbox.tempBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size); }, onMove: (x, y, layer) => { layer.bitmap.data.set(Toolbox.tempBitmap.data); drawRectStroke(layer.bitmap, Toolbox.startX, Toolbox.startY, x, y, AppState.rgba); RenderPipeline.renderComposite(); } },
            "rect-fill": { onDown: (x, y, layer) => { Toolbox.startX = x; Toolbox.startY = y; Toolbox.tempBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size); }, onMove: (x, y, layer) => { layer.bitmap.data.set(Toolbox.tempBitmap.data); drawRectFill(layer.bitmap, Toolbox.startX, Toolbox.startY, x, y, AppState.rgba); RenderPipeline.renderComposite(); } },
            circle: { onDown: (x, y, layer) => { Toolbox.startX = x; Toolbox.startY = y; Toolbox.tempBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size); }, onMove: (x, y, layer) => { layer.bitmap.data.set(Toolbox.tempBitmap.data); const r = Math.round(Math.sqrt(Math.pow(x-Toolbox.startX,2) + Math.pow(y-Toolbox.startY,2))); drawCircleStroke(layer.bitmap, Toolbox.startX, Toolbox.startY, r, AppState.rgba); RenderPipeline.renderComposite(); } },
            "circle-fill": { onDown: (x, y, layer) => { Toolbox.startX = x; Toolbox.startY = y; Toolbox.tempBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size); }, onMove: (x, y, layer) => { layer.bitmap.data.set(Toolbox.tempBitmap.data); const r = Math.round(Math.sqrt(Math.pow(x-Toolbox.startX,2) + Math.pow(y-Toolbox.startY,2))); drawCircleFill(layer.bitmap, Toolbox.startX, Toolbox.startY, r, AppState.rgba); RenderPipeline.renderComposite(); } },
            select: {
                onDown: (x, y) => { Toolbox.startX = x; Toolbox.startY = y; },
                onMove: (x, y) => { 
                    intCtx.clearRect(0,0,AppState.size,AppState.size);
                    const minX = Math.min(Toolbox.startX, x), maxX = Math.max(Toolbox.startX, x), minY = Math.min(Toolbox.startY, y), maxY = Math.max(Toolbox.startY, y);
                    const w = maxX - minX + 1, h = maxY - minY + 1;
                    intCtx.fillStyle = 'rgba(0, 120, 212, 0.3)'; intCtx.fillRect(minX, minY, w, h);
                    intCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'; intCtx.fillRect(minX, minY, w, 1); intCtx.fillRect(minX, minY + h - 1, w, 1); intCtx.fillRect(minX, minY, 1, h); intCtx.fillRect(minX + w - 1, minY, 1, h);
                },
                onUp: (x, y, layer) => {
                    const minX = Math.min(Toolbox.startX, x), maxX = Math.max(Toolbox.startX, x), minY = Math.min(Toolbox.startY, y), maxY = Math.max(Toolbox.startY, y);
                    const w = maxX - minX + 1, h = maxY - minY + 1;
                    if(w > 0 && h > 0) {
                        const s = AppState.selection; s.w = w; s.h = h; s.x = minX; s.y = minY; s.buffer = new ImageData(w, h);
                        for(let by=0; by<h; by++) {
                            for(let bx=0; bx<w; bx++) {
                                const lx = s.x + bx, ly = s.y + by;
                                if(lx >= 0 && lx < AppState.size && ly >= 0 && ly < AppState.size) {
                                    const lIdx = (ly * AppState.size + lx) * 4, bIdx = (by * w + bx) * 4;
                                    for(let i=0; i<4; i++) { s.buffer.data[bIdx+i] = layer.bitmap.data[lIdx+i]; layer.bitmap.data[lIdx+i] = 0; }
                                }
                            }
                        }
                        s.active = true; RenderPipeline.renderComposite(); RenderPipeline.renderInteraction();
                    }
                }
            }
        };

        function createLayer(name) { return { name, visible: true, opacity: 1.0, bitmap: new ImageData(AppState.size, AppState.size) }; }

        function init() {
            AppState.size = parseInt(document.getElementById('matrix-size').value);
            AppState.scale = Math.floor(512 / AppState.size);
            [intCanvas, compCanvas, onionCanvas, gridCanvas].forEach(c => { c.width = AppState.size; c.height = AppState.size; });
            wrapper.style.width = `${AppState.size * AppState.scale}px`; wrapper.style.height = `${AppState.size * AppState.scale}px`;
            RenderPipeline.init(AppState.size); AppState.frames = [{ layers: [createLayer("Layer 1")] }]; AppState.currentFrameIdx = 0; AppState.currentLayerIdx = 0;
            HistoryManager.undoStack = []; HistoryManager.redoStack = []; commitSelection();
            buildPalette(); RenderPipeline.drawGrid(); updateFramesUI(); updateLayersUI(); RenderPipeline.renderComposite(); updateZoom();
        }

        const defaultPalette = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#888888', '#aaaaaa', '#880000', '#008800', '#000088', '#888800', '#008888', '#880088', '#ff8800', '#ff0088', '#88ff00', '#00ff88', '#8800ff', '#0088ff', '#ff8888', '#88ff88'];
        function buildPalette() { const pal = document.getElementById('palette'); pal.innerHTML = ''; defaultPalette.forEach(c => { const div = document.createElement('div'); div.className = 'swatch'; div.style.backgroundColor = c; div.onclick = () => setColor(c); pal.appendChild(div); }); }
        function setColor(hex) { AppState.color = hex.toUpperCase(); colorInput.value = AppState.color; hexInput.value = AppState.color; AppState.rgba = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16), 255]; }
        colorInput.addEventListener('input', () => setColor(colorInput.value));
        hexInput.addEventListener('input', () => { if (/^#[0-9A-F]{6}$/i.test(hexInput.value)) setColor(hexInput.value); });
        function getCoords(e) { const rect = intCanvas.getBoundingClientRect(); return { x: Math.floor((e.clientX - rect.left) / (rect.width / AppState.size)), y: Math.floor((e.clientY - rect.top) / (rect.height / AppState.size)) }; }
        function getActiveLayer() { return AppState.frames[AppState.currentFrameIdx].layers[AppState.currentLayerIdx]; }

        let preActionBitmap = null;
        intCanvas.addEventListener('mousedown', (e) => {
            if(e.button !== 0) return; const { x, y } = getCoords(e);
            if (AppState.selection.active) {
                const s = AppState.selection;
                if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) { s.isDragging = true; s.dragStartX = x - s.x; s.dragStartY = y - s.y; return; } else commitSelection();
            }
            if (AppState.isPlaying) togglePlay(); const layer = getActiveLayer(); if(!layer || !layer.visible) return;
            AppState.isDrawing = true; preActionBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size);
            Toolbox[AppState.activeTool].onDown(x, y, layer);
            if(!AppState.isDrawing && preActionBitmap && AppState.activeTool !== 'select') { HistoryManager.saveLayerState(AppState.currentFrameIdx, AppState.currentLayerIdx, preActionBitmap); preActionBitmap = null; }
        });

        intCanvas.addEventListener('mousemove', (e) => {
            const { x, y } = getCoords(e); document.getElementById('status-coords').textContent = (x >= 0 && x < AppState.size && y >= 0 && y < AppState.size) ? `X: ${x}, Y: ${y}` : `X: -, Y: -`;
            if (AppState.selection.isDragging) { AppState.selection.x = x - AppState.selection.dragStartX; AppState.selection.y = y - AppState.selection.dragStartY; RenderPipeline.renderInteraction(); return; }
            if (AppState.isDrawing) Toolbox[AppState.activeTool].onMove(x, y, getActiveLayer());
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                if (AppState.selection.isDragging) { AppState.selection.isDragging = false; return; }
                if (AppState.isDrawing) {
                    AppState.isDrawing = false; const layer = getActiveLayer();
                    if(Toolbox[AppState.activeTool].onUp) Toolbox[AppState.activeTool].onUp(getCoords(e).x, getCoords(e).y, layer);
                    if(Toolbox.tempBitmap) Toolbox.tempBitmap = null;
                    if(preActionBitmap && AppState.activeTool !== 'select') { HistoryManager.saveLayerState(AppState.currentFrameIdx, AppState.currentLayerIdx, preActionBitmap); preActionBitmap = null; }
                }
            }
        });

        function setTool(toolName) { commitSelection(); document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active')); document.querySelector(`[data-tool="${toolName}"]`).classList.add('active'); AppState.activeTool = toolName; }
        document.querySelectorAll('.tool-btn').forEach(btn => btn.addEventListener('click', (e) => setTool(e.currentTarget.dataset.tool)));

        function updateZoom() { wrapper.style.transform = `scale(${AppState.zoomLevel})`; document.getElementById('fl-zoom-reset').textContent = `${Math.round(AppState.zoomLevel*100)}%`; }
        document.getElementById('fl-zoom-in').onclick = () => { AppState.zoomLevel += 0.5; updateZoom(); }; document.getElementById('fl-zoom-out').onclick = () => { if(AppState.zoomLevel > 0.5) AppState.zoomLevel -= 0.5; updateZoom(); }; document.getElementById('fl-zoom-reset').onclick = () => { AppState.zoomLevel = 1; updateZoom(); };
        document.getElementById('fl-undo').onclick = () => { commitSelection(); HistoryManager.undo(); }; document.getElementById('fl-redo').onclick = () => { commitSelection(); HistoryManager.redo(); };
        document.getElementById('fl-grid').onclick = () => { AppState.gridVisible = !AppState.gridVisible; gridCanvas.style.display = AppState.gridVisible ? 'block' : 'none'; RenderPipeline.drawGrid(); };

        document.getElementById('menu-new').onclick = init; document.getElementById('menu-undo').onclick = () => { commitSelection(); HistoryManager.undo(); }; document.getElementById('menu-redo').onclick = () => { commitSelection(); HistoryManager.redo(); };

        function updateFramesUI() {
            const fList = document.getElementById('frames-list'); fList.innerHTML = '';
            AppState.frames.forEach((f, i) => {
                const div = document.createElement('div'); div.className = `list-item ${i === AppState.currentFrameIdx ? 'active' : ''}`; div.textContent = i + 1;
                div.onclick = () => { commitSelection(); if(AppState.isPlaying) togglePlay(); AppState.currentFrameIdx = i; AppState.currentLayerIdx = Math.min(AppState.currentLayerIdx, AppState.frames[AppState.currentFrameIdx].layers.length-1); updateFramesUI(); updateLayersUI(); RenderPipeline.renderComposite(); };
                fList.appendChild(div);
            }); RenderPipeline.drawOnionSkin();
        }

        function updateLayersUI() {
            const lList = document.getElementById('layers-list'); lList.innerHTML = ''; const currLayers = AppState.frames[AppState.currentFrameIdx].layers;
            for(let i = currLayers.length - 1; i >= 0; i--) {
                const l = currLayers[i], div = document.createElement('div'); div.className = `list-item ${i === AppState.currentLayerIdx ? 'active' : ''}`;
                const visBtn = document.createElement('span'); visBtn.className = `layer-vis ${l.visible ? '' : 'hidden'}`; visBtn.textContent = '👁'; visBtn.onclick = (e) => { commitSelection(); e.stopPropagation(); l.visible = !l.visible; updateLayersUI(); RenderPipeline.renderComposite(); };
                const nameSpan = document.createElement('span'); nameSpan.className = 'layer-name'; nameSpan.textContent = l.name;
                div.appendChild(visBtn); div.appendChild(nameSpan); div.onclick = () => { commitSelection(); AppState.currentLayerIdx = i; updateLayersUI(); }; lList.appendChild(div);
            }
            const controls = document.getElementById('layer-controls');
            if (currLayers.length > 0) { controls.style.display = 'flex'; opacitySlider.value = currLayers[AppState.currentLayerIdx].opacity; opacityVal.textContent = Math.round(opacitySlider.value * 100) + '%'; } else controls.style.display = 'none';
        }

        opacitySlider.addEventListener('input', (e) => { const layer = getActiveLayer(); if (!layer) return; layer.opacity = parseFloat(e.target.value); opacityVal.textContent = Math.round(layer.opacity * 100) + '%'; RenderPipeline.renderComposite(); });
        document.getElementById('onion-skin').onchange = () => RenderPipeline.drawOnionSkin();

        document.getElementById('btn-add-frame').onclick = () => { commitSelection(); if(AppState.isPlaying) togglePlay(); AppState.frames.push({ layers: [createLayer("Layer 1")] }); AppState.currentFrameIdx = AppState.frames.length - 1; AppState.currentLayerIdx = 0; updateFramesUI(); updateLayersUI(); RenderPipeline.renderComposite(); };
        document.getElementById('btn-dup-frame').onclick = () => { commitSelection(); if(AppState.isPlaying) togglePlay(); AppState.frames.push({ layers: AppState.frames[AppState.currentFrameIdx].layers.map(l => ({ name: l.name, visible: l.visible, opacity: l.opacity, bitmap: new ImageData(new Uint8ClampedArray(l.bitmap.data), AppState.size, AppState.size) })) }); AppState.currentFrameIdx = AppState.frames.length - 1; updateFramesUI(); RenderPipeline.renderComposite(); };
        document.getElementById('btn-del-frame').onclick = () => { commitSelection(); if(AppState.isPlaying) togglePlay(); if (AppState.frames.length > 1) { AppState.frames.splice(AppState.currentFrameIdx, 1); AppState.currentFrameIdx = Math.min(AppState.currentFrameIdx, AppState.frames.length - 1); AppState.currentLayerIdx = Math.min(AppState.currentLayerIdx, AppState.frames[AppState.currentFrameIdx].layers.length - 1); updateFramesUI(); updateLayersUI(); RenderPipeline.renderComposite(); } };
        document.getElementById('btn-add-layer').onclick = () => { commitSelection(); AppState.frames[AppState.currentFrameIdx].layers.push(createLayer(`Layer ${AppState.frames[AppState.currentFrameIdx].layers.length + 1}`)); AppState.currentLayerIdx = AppState.frames[AppState.currentFrameIdx].layers.length - 1; updateLayersUI(); };
        document.getElementById('btn-del-layer').onclick = () => { commitSelection(); if (AppState.frames[AppState.currentFrameIdx].layers.length > 1) { AppState.frames[AppState.currentFrameIdx].layers.splice(AppState.currentLayerIdx, 1); AppState.currentLayerIdx = Math.max(0, AppState.currentLayerIdx - 1); updateLayersUI(); RenderPipeline.renderComposite(); } };

        let playTimer = null;
        function togglePlay() {
            commitSelection();
            if (AppState.isPlaying) { AppState.isPlaying = false; clearInterval(playTimer); playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>'; RenderPipeline.drawOnionSkin(); } 
            else { if (AppState.frames.length <= 1) return; AppState.isPlaying = true; playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'; onionCtx.clearRect(0, 0, AppState.size, AppState.size); const fps = parseInt(document.getElementById('fps-input').value) || 12; playTimer = setInterval(() => { AppState.currentFrameIdx = (AppState.currentFrameIdx + 1) % AppState.frames.length; AppState.currentLayerIdx = Math.min(AppState.currentLayerIdx, AppState.frames[AppState.currentFrameIdx].layers.length-1); RenderPipeline.renderComposite(); updateFramesUI(); updateLayersUI(); }, 1000 / fps); }
        }
        document.getElementById('fl-play').onclick = togglePlay;

        document.getElementById('viewport').addEventListener('contextmenu', (e) => { e.preventDefault(); ctxMenu.style.display = 'flex'; ctxMenu.style.left = e.pageX + 'px'; ctxMenu.style.top = e.pageY + 'px'; }); document.addEventListener('click', (e) => { if (!ctxMenu.contains(e.target)) ctxMenu.style.display = 'none'; });
        document.getElementById('ctx-add-frame').onclick = () => { document.getElementById('btn-add-frame').click(); ctxMenu.style.display = 'none'; }; document.getElementById('ctx-dup-frame').onclick = () => { document.getElementById('btn-dup-frame').click(); ctxMenu.style.display = 'none'; };
        document.getElementById('ctx-clear-layer').onclick = () => { commitSelection(); const l = getActiveLayer(); if(l) { const pre = new ImageData(new Uint8ClampedArray(l.bitmap.data), AppState.size, AppState.size); l.bitmap.data.fill(0); HistoryManager.saveLayerState(AppState.currentFrameIdx, AppState.currentLayerIdx, pre); RenderPipeline.renderComposite(); } ctxMenu.style.display = 'none'; };
        document.getElementById('ctx-toggle-grid').onclick = () => { document.getElementById('fl-grid').click(); ctxMenu.style.display = 'none'; };

        function flipHorizontal() { commitSelection(); const layer = getActiveLayer(); if(!layer || !layer.visible) return; const oldBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size); const temp = new ImageData(AppState.size, AppState.size); for(let y=0; y<AppState.size; y++) { for(let x=0; x<AppState.size; x++) { const src = (y * AppState.size + x) * 4, dst = (y * AppState.size + (AppState.size - 1 - x)) * 4; temp.data[dst] = layer.bitmap.data[src]; temp.data[dst+1] = layer.bitmap.data[src+1]; temp.data[dst+2] = layer.bitmap.data[src+2]; temp.data[dst+3] = layer.bitmap.data[src+3]; } } layer.bitmap.data.set(temp.data); HistoryManager.saveLayerState(AppState.currentFrameIdx, AppState.currentLayerIdx, oldBitmap); RenderPipeline.renderComposite(); }
        function flipVertical() { commitSelection(); const layer = getActiveLayer(); if(!layer || !layer.visible) return; const oldBitmap = new ImageData(new Uint8ClampedArray(layer.bitmap.data), AppState.size, AppState.size); const temp = new ImageData(AppState.size, AppState.size); for(let y=0; y<AppState.size; y++) { for(let x=0; x<AppState.size; x++) { const src = (y * AppState.size + x) * 4, dst = ((AppState.size - 1 - y) * AppState.size + x) * 4; temp.data[dst] = layer.bitmap.data[src]; temp.data[dst+1] = layer.bitmap.data[src+1]; temp.data[dst+2] = layer.bitmap.data[src+2]; temp.data[dst+3] = layer.bitmap.data[src+3]; } } layer.bitmap.data.set(temp.data); HistoryManager.saveLayerState(AppState.currentFrameIdx, AppState.currentLayerIdx, oldBitmap); RenderPipeline.renderComposite(); }
        document.getElementById('menu-flip-h').onclick = flipHorizontal; document.getElementById('menu-flip-v').onclick = flipVertical;
        document.getElementById('menu-export-png').onclick = () => { commitSelection(); RenderPipeline.renderComposite(); const a = document.createElement('a'); a.download = `frame_${AppState.currentFrameIdx+1}.png`; a.href = compCanvas.toDataURL(); a.click(); };
        document.getElementById('menu-export-sheet').onclick = () => {
            commitSelection(); if (AppState.isPlaying) togglePlay(); const sheet = document.createElement('canvas'); sheet.width = AppState.size * AppState.frames.length; sheet.height = AppState.size; const sCtx = sheet.getContext('2d'); const temp = document.createElement('canvas'); temp.width = AppState.size; temp.height = AppState.size; const tCtx = temp.getContext('2d');
            AppState.frames.forEach((f, i) => { tCtx.clearRect(0, 0, AppState.size, AppState.size); f.layers.forEach(l => { if (!l.visible) return; const lc = document.createElement('canvas'); lc.width = AppState.size; lc.height = AppState.size; lc.getContext('2d').putImageData(l.bitmap, 0, 0); tCtx.globalAlpha = l.opacity; tCtx.drawImage(lc, 0, 0); }); tCtx.globalAlpha = 1.0; sCtx.drawImage(temp, i * AppState.size, 0); });
            const a = document.createElement('a'); a.download = `spritesheet_${AppState.frames.length}frames.png`; a.href = sheet.toDataURL(); a.click();
        };
        document.getElementById('menu-save-proj').onclick = () => {
            commitSelection(); const temp = document.createElement('canvas'); temp.width = AppState.size; temp.height = AppState.size; const tCtx = temp.getContext('2d');
            const proj = { size: AppState.size, fps: document.getElementById('fps-input').value, frames: AppState.frames.map(f => ({ layers: f.layers.map(l => { tCtx.putImageData(l.bitmap, 0, 0); return { name: l.name, visible: l.visible, opacity: l.opacity, dataUrl: temp.toDataURL() }; }) })) };
            const blob = new Blob([JSON.stringify(proj)], {type: "application/json"}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "sprite_project.json"; a.click();
        };
        document.getElementById('menu-load-proj').onclick = () => document.getElementById('load-file').click();
        document.getElementById('load-file').onchange = (e) => {
            const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const proj = JSON.parse(event.target.result); AppState.size = proj.size; document.getElementById('matrix-size').value = AppState.size; document.getElementById('fps-input').value = proj.fps || 12; AppState.scale = Math.floor(512 / AppState.size); wrapper.style.width = `${AppState.size * AppState.scale}px`; wrapper.style.height = `${AppState.size * AppState.scale}px`; [intCanvas, compCanvas, onionCanvas, gridCanvas].forEach(c => { c.width = AppState.size; c.height = AppState.size; }); RenderPipeline.init(AppState.size);
                    AppState.frames = []; for(let f of proj.frames) { const layers = []; for(let l of f.layers) { const img = new Image(); img.src = l.dataUrl; await new Promise(r => img.onload = r); const temp = document.createElement('canvas'); temp.width = AppState.size; temp.height = AppState.size; const tCtx = temp.getContext('2d'); tCtx.drawImage(img, 0, 0); layers.push({ name: l.name, visible: l.visible !== undefined ? l.visible : true, opacity: l.opacity !== undefined ? l.opacity : 1, bitmap: tCtx.getImageData(0, 0, AppState.size, AppState.size) }); } AppState.frames.push({layers}); }
                    AppState.currentFrameIdx = 0; AppState.currentLayerIdx = 0; HistoryManager.undoStack = []; HistoryManager.redoStack = []; updateFramesUI(); updateLayersUI(); RenderPipeline.drawGrid(); RenderPipeline.renderComposite();
                } catch (err) { alert("Invalid project file."); } e.target.value = '';
            }; reader.readAsText(file);
        };
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); commitSelection(); HistoryManager.undo(); }
            if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); commitSelection(); HistoryManager.redo(); }
            if (!e.ctrlKey && e.target.tagName !== 'INPUT') { switch(e.key.toLowerCase()) { case 'p': setTool('pencil'); break; case 'e': setTool('eraser'); break; case 'f': setTool('fill'); break; case 'i': setTool('picker'); break; case 'l': setTool('line'); break; case 'r': setTool('rect'); break; case 'c': setTool('circle'); break; case 's': setTool('select'); break; case 'g': document.getElementById('fl-grid').click(); break; } }
        });
        document.getElementById('matrix-size').onchange = init; setColor(AppState.color); init();
  