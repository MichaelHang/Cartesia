// Canvas.js - Canvas manager, coordinate transforms, grid, axes, rendering

import { Vec2, clamp } from './Geometry.js';

export class CanvasManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Coordinate transform: screen = world * zoom + offset
    this.offset = new Vec2(0, 0);   // Pan offset in screen pixels (CSS)
    this.zoom = 40;                  // Pixels per world unit
    this.minZoom = 5;
    this.maxZoom = 200;

    // Grid options
    this.showGrid = true;
    this.showAxes = true;
    this.gridColor = 'rgba(255, 255, 255, 0.04)';
    this.gridMajorColor = 'rgba(255, 255, 255, 0.07)';
    this.axisColor = 'rgba(255, 255, 255, 0.2)';
    this.backgroundColor = '#0E0E1A';
    // 浅色配色开关（导出白底图像时置为 true，网格/坐标轴/标签改用深色）
    this.lightMode = false;

    // Pan state
    this.isPanning = false;
    this.panStart = new Vec2(0, 0);
    this.panOffsetStart = new Vec2(0, 0);

    // Resize（window resize 由 main.js 统一监听；dpr/容器尺寸变化由 _syncSize 每帧自检）
    this._onResize = this._onResize.bind(this);
    this._onResize();
  }

  // --- Dimensions (CSS pixels) ---

  getWidth() {
    return this.canvas.width / (window.devicePixelRatio || 1);
  }

  getHeight() {
    return this.canvas.height / (window.devicePixelRatio || 1);
  }

  get w() { return this.getWidth(); }
  get h() { return this.getHeight(); }

  // --- Coordinate Transforms ---

  worldToScreen(worldPos) {
    const w = this.getWidth(), h = this.getHeight();
    return new Vec2(
      worldPos.x * this.zoom + this.offset.x + w / 2,
      -worldPos.y * this.zoom + this.offset.y + h / 2
    );
  }

  screenToWorld(screenPos) {
    const w = this.getWidth(), h = this.getHeight();
    return new Vec2(
      (screenPos.x - this.offset.x - w / 2) / this.zoom,
      -(screenPos.y - this.offset.y - h / 2) / this.zoom
    );
  }

  worldToScreenDist(worldDist) {
    return worldDist * this.zoom;
  }

  screenToWorldDist(screenDist) {
    return screenDist / this.zoom;
  }

  getVisibleBounds() {
    const topLeft = this.screenToWorld(new Vec2(0, 0));
    const bottomRight = this.screenToWorld(new Vec2(this.getWidth(), this.getHeight()));
    return {
      minX: topLeft.x,
      maxX: bottomRight.x,
      minY: bottomRight.y,
      maxY: topLeft.y,
    };
  }

  // --- Pan and Zoom ---

  startPan(screenPos) {
    this.isPanning = true;
    this.panStart = screenPos.clone();
    this.panOffsetStart = this.offset.clone();
  }

  updatePan(screenPos) {
    if (!this.isPanning) return;
    this.offset = this.panOffsetStart.add(screenPos.sub(this.panStart));
  }

  endPan() {
    this.isPanning = false;
  }

  zoomAt(screenPos, delta) {
    const worldBefore = this.screenToWorld(screenPos);
    const factor = delta > 0 ? 1.15 : 1 / 1.15;
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);

    // Adjust offset to keep the point under cursor fixed
    const w = this.getWidth(), h = this.getHeight();
    const newScreenX = worldBefore.x * this.zoom + this.offset.x + w / 2;
    const newScreenY = -worldBefore.y * this.zoom + this.offset.y + h / 2;
    this.offset.x += screenPos.x - newScreenX;
    this.offset.y += screenPos.y - newScreenY;
  }

  resetView() {
    this.offset = new Vec2(0, 0);
    this.zoom = 40;
  }

  // --- Rendering ---

  clear() {
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.getWidth(), this.getHeight());
  }

  drawGrid() {
    if (!this.showGrid) return;
    const ctx = this.ctx;
    const bounds = this.getVisibleBounds();
    const w = this.getWidth(), h = this.getHeight();

    const baseSpacing = 1;
    const screenSpacing = this.worldToScreenDist(baseSpacing);
    let spacing = baseSpacing;
    if (screenSpacing < 20) spacing = 2;
    if (screenSpacing < 15) spacing = 5;
    if (screenSpacing < 10) spacing = 10;
    const majorEvery = 5;
    const minorColor = this.lightMode ? 'rgba(0, 0, 0, 0.05)' : this.gridColor;
    const majorColor = this.lightMode ? 'rgba(0, 0, 0, 0.1)' : this.gridMajorColor;

    const startX = Math.floor(bounds.minX / spacing) * spacing;
    const endX = Math.ceil(bounds.maxX / spacing) * spacing;
    const startY = Math.floor(bounds.minY / spacing) * spacing;
    const endY = Math.ceil(bounds.maxY / spacing) * spacing;

    for (let x = startX; x <= endX; x += spacing) {
      const isMajor = (Math.abs(x) % (spacing * majorEvery) < 1e-9) || x === 0;
      ctx.strokeStyle = isMajor ? majorColor : minorColor;
      ctx.lineWidth = isMajor ? 0.8 : 0.4;
      ctx.setLineDash([]);
      const screenX = this.worldToScreen(new Vec2(x, 0)).x;
      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, h);
      ctx.stroke();
    }

    for (let y = startY; y <= endY; y += spacing) {
      const isMajor = (Math.abs(y) % (spacing * majorEvery) < 1e-9) || y === 0;
      ctx.strokeStyle = isMajor ? majorColor : minorColor;
      ctx.lineWidth = isMajor ? 0.8 : 0.4;
      ctx.setLineDash([]);
      const screenY = this.worldToScreen(new Vec2(0, y)).y;
      ctx.beginPath();
      ctx.moveTo(0, screenY);
      ctx.lineTo(w, screenY);
      ctx.stroke();
    }
  }

  drawAxes() {
    if (!this.showAxes) return;
    const ctx = this.ctx;
    const w = this.getWidth(), h = this.getHeight();

    const axisCol = this.lightMode ? 'rgba(0, 0, 0, 0.55)' : this.axisColor;
    ctx.strokeStyle = axisCol;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([]);

    const origin = this.worldToScreen(new Vec2(0, 0));
    const oy = clamp(origin.y, -1000, h + 1000);
    const ox = clamp(origin.x, -1000, w + 1000);

    // X-axis
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.stroke();

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, h);
    ctx.stroke();

    // Arrow heads
    this._drawArrowHead(new Vec2(w - 5, oy), new Vec2(1, 0), 8, axisCol);
    this._drawArrowHead(new Vec2(ox, 5), new Vec2(0, -1), 8, axisCol);

    // Labels
    ctx.fillStyle = this.lightMode ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.4)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('x', w - 15, oy - 18);
    ctx.fillText('y', ox + 10, 8);

    // Tick marks
    this._drawAxisTicks(true);  // X-axis
    this._drawAxisTicks(false); // Y-axis
  }

  _drawAxisTicks(isXAxis) {
    const ctx = this.ctx;
    const bounds = this.getVisibleBounds();
    const w = this.getWidth(), h = this.getHeight();
    const range = isXAxis ? { min: bounds.minX, max: bounds.maxX } : { min: bounds.minY, max: bounds.maxY };

    const screenRange = this.worldToScreenDist(range.max - range.min);
    let tickSpacing = 1;
    const tickScreenSize = tickSpacing * this.zoom;
    if (tickScreenSize < 40) tickSpacing = 2;
    if (tickScreenSize < 35) tickSpacing = 5;
    if (tickScreenSize < 28) tickSpacing = 10;

    const start = Math.ceil(range.min / tickSpacing) * tickSpacing;
    const end = Math.floor(range.max / tickSpacing) * tickSpacing;
    const origin = this.worldToScreen(new Vec2(0, 0));
    const oy = clamp(origin.y, -1000, h + 1000);
    const ox = clamp(origin.x, -1000, w + 1000);

    ctx.fillStyle = this.lightMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.3)';
    ctx.font = '10px system-ui, sans-serif';

    for (let val = start; val <= end; val += tickSpacing) {
      if (Math.abs(val) < tickSpacing / 2) continue;
      const worldPos = isXAxis ? new Vec2(val, 0) : new Vec2(0, val);
      const screenPos = this.worldToScreen(worldPos);

      if (isXAxis && screenPos.y > -100 && screenPos.y < h + 100) {
        ctx.beginPath();
        ctx.moveTo(screenPos.x, oy - 4);
        ctx.lineTo(screenPos.x, oy + 4);
        ctx.strokeStyle = this.lightMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(val, screenPos.x, oy + 6);
      } else if (!isXAxis && screenPos.x > -100 && screenPos.x < w + 100) {
        ctx.beginPath();
        ctx.moveTo(ox - 4, screenPos.y);
        ctx.lineTo(ox + 4, screenPos.y);
        ctx.strokeStyle = this.lightMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(val, ox - 6, screenPos.y);
      }
    }

    // Origin label
    ctx.fillStyle = this.lightMode ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('O', ox - 6, oy + 4);
  }

  _drawArrowHead(tip, direction, size, color = this.axisColor) {
    const ctx = this.ctx;
    const angle = Math.atan2(direction.y, direction.x);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - size * Math.cos(angle - Math.PI / 6),
      tip.y - size * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      tip.x - size * Math.cos(angle + Math.PI / 6),
      tip.y - size * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Main render function.
   */
  render(drawObjects, drawPreview, drawOverlay) {
    this._syncSize();
    this.clear();
    this.drawGrid();
    this.drawAxes();

    if (drawObjects) drawObjects(this.ctx, this);
    if (drawPreview) drawPreview(this.ctx, this);
    if (drawOverlay) drawOverlay(this.ctx, this);
  }

  /**
   * 帧首自愈：devicePixelRatio 或容器尺寸变化而没触发 window resize 时
   * （例如窗口跨显示器拖动），画布背衬会和布局失配，表现为内容错位/被裁切。
   * 每帧检测一次，失配则重建背衬。
   */
  _syncSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    if (this.canvas.width !== Math.floor(rect.width * dpr) ||
        this.canvas.height !== Math.floor(rect.height * dpr)) {
      this._onResize();
    }
  }

  // --- Internal ---

  _onResize() {
    const container = this.canvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return; // Skip zero-size
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
