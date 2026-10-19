// main.js - Application entry point, event wiring, main loop

import { Vec2, roundTo, formatNum } from './Geometry.js';
import { CanvasManager } from './Canvas.js';
import { ToolContext, createTool, SelectTool, TextTool, CircleTool } from './Tools.js';
import { HistoryManager, DeleteObjectCommand, BatchCommand, AddObjectCommand, ModifyObjectCommand } from './History.js';
import { GeoFunctionGraph } from './Objects.js';

// ============================================================
// Application State
// ============================================================

const canvas = document.getElementById('main-canvas');
const cm = new CanvasManager(canvas);
const history = new HistoryManager();
const toolCtx = new ToolContext();

let currentTool = null;

// ============================================================
// Initialize ToolContext
// ============================================================

toolCtx.canvas = cm;
toolCtx.history = history;
toolCtx.renderAll = () => render();
toolCtx.showFuncModal = (editObj) => showFuncModal(editObj);
toolCtx.showTextModal = () => showTextModal();
toolCtx._lastMousePos = null;
toolCtx._snapPoint = null;

// ============================================================
// Snap System
// ============================================================

function findSnapPoint(worldPos) {
  if (!toolCtx.snapEnabled) return null;
  const snapDist = cm.screenToWorldDist(15);

  // Snap to existing points (priority)
  let bestDist = snapDist;
  let bestPoint = null;
  for (const obj of toolCtx.objects) {
    if (!obj.visible) continue;
    if (obj.type === 'point') {
      const d = Vec2.distance(worldPos, obj.pos);
      if (d < bestDist) { bestDist = d; bestPoint = obj.pos; }
    }
  }
  if (bestPoint) return bestPoint;

  // Snap to grid
  const gridSpacing = getGridSpacing();
  const snapped = new Vec2(
    roundTo(worldPos.x, gridSpacing),
    roundTo(worldPos.y, gridSpacing)
  );
  const d = Vec2.distance(worldPos, snapped);
  if (d < snapDist) return snapped;

  return null;
}

function getGridSpacing() {
  const screenSpacing = cm.worldToScreenDist(1);
  if (screenSpacing < 10) return 10;
  if (screenSpacing < 20) return 5;
  if (screenSpacing < 35) return 2;
  return 1;
}

// ============================================================
// Rendering
// ============================================================

function render() {
  cm.render(
    (ctx) => {
      const selectedSet = new Set(toolCtx.selectedObjects);
      // 获取 hover 对象（排除已选中的）
      const hoverObj = (currentTool instanceof SelectTool && currentTool.hoverObject)
        ? currentTool.hoverObject : null;
      const hoverIsSelected = hoverObj && selectedSet.has(hoverObj);

      // 先画未选中且非 hover 的对象
      for (const obj of toolCtx.objects) {
        if (!obj.visible || selectedSet.has(obj) || obj === hoverObj) continue;
        obj.draw(ctx, cm);
      }
      // 画 hover 对象（明显高亮）
      if (hoverObj && hoverObj.visible && !hoverIsSelected) {
        ctx.save();
        // 线类对象：画一条更粗更亮的线作为背景
        const lineTypes = new Set(['segment', 'line', 'ray', 'function']);
        if (lineTypes.has(hoverObj.type)) {
          const origWidth = hoverObj.style.lineWidth;
          hoverObj.style.lineWidth = Math.max(origWidth * 3, 6);
          ctx.shadowColor = '#7C83FF';
          ctx.shadowBlur = 16;
          hoverObj.draw(ctx, cm);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.7;
          hoverObj.draw(ctx, cm);
          ctx.globalAlpha = 1;
          hoverObj.style.lineWidth = origWidth;
        } else {
          ctx.shadowColor = '#7C83FF';
          ctx.shadowBlur = 16;
          hoverObj.draw(ctx, cm);
          ctx.shadowBlur = 0;
          hoverObj.draw(ctx, cm);
        }
        ctx.restore();
      }
      // 再画选中的对象（强发光效果）
      for (const obj of toolCtx.selectedObjects) {
        if (!obj.visible) continue;
        ctx.save();
        ctx.shadowColor = '#7C83FF';
        ctx.shadowBlur = 20;
        obj.draw(ctx, cm);
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#a5aaff';
        obj.draw(ctx, cm);
        ctx.shadowBlur = 0;
        obj.draw(ctx, cm);
        ctx.restore();
      }
    },
    (ctx) => drawToolPreview(ctx),
    (ctx) => {
      drawSelectionOverlay(ctx);
      drawSnapOverlay(ctx);
      drawRotateOverlay(ctx);
    }
  );
  updateObjectList();
  updateStatusBar();
}

function drawToolPreview(ctx) {
  if (!currentTool) return;

  ctx.strokeStyle = toolCtx.style.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 3]);
  ctx.globalAlpha = 0.5;

  const mousePos = toolCtx._lastMousePos;
  if (!mousePos) { ctx.globalAlpha = 1; ctx.setLineDash([]); return; }

  // Segment / Line / Ray preview (startPoint pattern)
  if (currentTool.startPoint !== undefined && currentTool.startPoint) {
    const s1 = cm.worldToScreen(currentTool.startPoint);
    const s2 = cm.worldToScreen(mousePos);

    // Highlight start point
    ctx.fillStyle = toolCtx.style.color;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(s1.x, s1.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Ghost line to cursor
    ctx.strokeStyle = toolCtx.style.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();

    // Distance label
    const dist = Vec2.distance(currentTool.startPoint, mousePos);
    const mid = cm.worldToScreen(Vec2.midpoint(currentTool.startPoint, mousePos));
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.setLineDash([]);
    ctx.fillText(formatNum(dist), mid.x + 4, mid.y - 4);
  }

  // Circle preview (center pattern) — 仅限圆工具，避免旋转工具的 center 误触发虚线预览圆
  if (currentTool instanceof CircleTool && currentTool.center) {
    const sc = cm.worldToScreen(currentTool.center);
    const r = Vec2.distance(currentTool.center, mousePos) * cm.zoom;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`r = ${formatNum(Vec2.distance(currentTool.center, mousePos))}`, sc.x + r + 5, sc.y - 5);
  }

  // Polygon preview (vertices pattern)
  if (currentTool.vertices !== undefined && currentTool.vertices.length > 0) {
    const verts = currentTool.vertices;
    ctx.beginPath();
    const s0 = cm.worldToScreen(verts[0]);
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < verts.length; i++) {
      const si = cm.worldToScreen(verts[i]);
      ctx.lineTo(si.x, si.y);
    }
    const sm = cm.worldToScreen(mousePos);
    ctx.lineTo(sm.x, sm.y);
    if (verts.length >= 3) ctx.closePath();
    ctx.stroke();
    if (verts.length >= 3) {
      const distToStart = Vec2.distance(mousePos, verts[0]);
      if (distToStart < cm.screenToWorldDist(15)) {
        const sFirst = cm.worldToScreen(verts[0]);
        ctx.fillStyle = '#1a73e8';
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(sFirst.x, sFirst.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Angle/preview (points pattern - for Angle, Midpoint, AngleBisector, Measure* tools)
  if (currentTool.points !== undefined && currentTool.points.length > 0) {
    const pts = currentTool.points;
    if (pts.length === 1) {
      const s1 = cm.worldToScreen(pts[0]);
      const s2 = cm.worldToScreen(mousePos);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    } else if (pts.length === 2) {
      const sv = cm.worldToScreen(pts[0]);
      const s1 = cm.worldToScreen(pts[1]);
      const s2 = cm.worldToScreen(mousePos);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(sv.x, sv.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function drawSelectionOverlay(ctx) {
  // 线类对象不需要画包围框，发光效果已足够
  const lineTypes = new Set(['segment', 'line', 'ray', 'function']);
  for (const obj of toolCtx.selectedObjects) {
    if (!obj.visible) continue;
    if (lineTypes.has(obj.type)) continue;
    const bounds = obj.getBounds();
    const minS = cm.worldToScreen(new Vec2(bounds.minX, bounds.minY));
    const maxS = cm.worldToScreen(new Vec2(bounds.maxX, bounds.maxY));
    const x = Math.min(minS.x, maxS.x);
    const y = Math.min(minS.y, maxS.y);
    const w = Math.abs(maxS.x - minS.x);
    const h = Math.abs(maxS.y - minS.y);

    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
  }

  // Rectangle selection preview
  if (currentTool instanceof SelectTool && currentTool.isSelecting && currentTool.selectStart) {
    const mousePos = toolCtx._lastMousePos;
    if (mousePos) {
      const s1 = cm.worldToScreen(currentTool.selectStart);
      const s2 = cm.worldToScreen(mousePos);
      const rx = Math.min(s1.x, s2.x);
      const ry = Math.min(s1.y, s2.y);
      const rw = Math.abs(s2.x - s1.x);
      const rh = Math.abs(s2.y - s1.y);
      ctx.fillStyle = 'rgba(26,115,232,0.08)';
      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
  }
}

function drawSnapOverlay(ctx) {
  const mousePos = toolCtx._lastMousePos;
  if (!mousePos) return;

  // Only show cursor preview for actual drawing tools
  const drawingTools = ['point', 'segment', 'line', 'ray', 'circle', 'polygon', 'angle-draw', 'midpoint', 'perp-bisector'];
  const isDrawingTool = currentTool && drawingTools.includes(currentTool.name);
  if (!isDrawingTool) return;

  const snap = toolCtx._snapPoint;
  const displayPos = snap || mousePos;
  if (!displayPos) return;

  const s = cm.worldToScreen(displayPos);

  if (snap) {
    // Snap indicator - more prominent
    ctx.fillStyle = 'rgba(26,115,232,0.25)';
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Outer ring
    ctx.strokeStyle = 'rgba(26,115,232,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isDrawingTool) {
    // Cursor preview dot
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRotateOverlay(ctx) {
  if (!currentTool || currentTool.name !== 'rotate') return;
  if (!currentTool.center) return;

  const sc = cm.worldToScreen(currentTool.center);
  const mousePos = toolCtx._lastMousePos;

  // 旋转中心标记（设置后立即显示）
  ctx.fillStyle = 'rgba(255, 107, 157, 0.3)';
  ctx.strokeStyle = '#ff6b9d';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 十字标记
  ctx.beginPath();
  ctx.moveTo(sc.x - 12, sc.y); ctx.lineTo(sc.x + 12, sc.y);
  ctx.moveTo(sc.x, sc.y - 12); ctx.lineTo(sc.x, sc.y + 12);
  ctx.stroke();

  // 角度弧线（拖动时才显示）
  if (!currentTool.dragging || !mousePos) return;
  const angleDeg = (currentTool.currentAngle * 180 / Math.PI);
  if (Math.abs(angleDeg) > 0.1) {
    const startA = currentTool.startAngle;
    const endA = startA + currentTool.currentAngle;
    const r = 40;
    ctx.strokeStyle = 'rgba(255, 107, 157, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, r, -endA, -startA, currentTool.currentAngle < 0);
    ctx.stroke();

    // 角度标注
    const midA = (startA + endA) / 2;
    const labelR = r + 18;
    const lx = sc.x + labelR * Math.cos(-midA);
    const ly = sc.y + labelR * Math.sin(-midA);
    ctx.fillStyle = '#ff6b9d';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.abs(angleDeg).toFixed(1) + '°', lx, ly);
  }
}

// ============================================================
// Object List UI
// ============================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _lastListSignature = null;

function updateObjectList() {
  const listEl = document.getElementById('object-list');
  if (toolCtx.objects.length === 0) {
    if (_lastListSignature !== 'empty') {
      listEl.innerHTML = '<p class="empty-hint">画布为空</p>';
      _lastListSignature = 'empty';
    }
    return;
  }

  // 内容签名：没变化就不重建 DOM（鼠标移动每帧都会走到这里）
  const signature = toolCtx.objects.map(o => `${o.id}:${o.type}:${o.label || ''}`).join('|')
    + '#' + toolCtx.selectedObjects.map(o => o.id).join(',');
  if (signature === _lastListSignature) return;
  _lastListSignature = signature;

  const scrollTop = listEl.scrollTop;
  listEl.innerHTML = toolCtx.objects.map(obj => {
    const selected = toolCtx.selectedObjects.includes(obj);
    let icon = '○';
    switch (obj.type) {
      case 'point': icon = '•'; break;
      case 'segment': icon = '•–•'; break;
      case 'line': icon = '╱'; break;
      case 'ray': icon = '→'; break;
      case 'circle': icon = '○'; break;
      case 'polygon': icon = '⬠'; break;
      case 'function': icon = '𝑓'; break;
      case 'angle': icon = '∠'; break;
      case 'text': icon = 'T'; break;
      case 'measurement':
        icon = obj.measureType === 'distance' ? '📏' : obj.measureType === 'angle' ? '📐' : '⬜';
        break;
    }
    const label = obj.label || obj.type;
    return `
      <div class="object-item${selected ? ' selected' : ''}" data-id="${obj.id}">
        <span class="obj-icon">${icon}</span>
        <span class="obj-label">${escapeHtml(label)}</span>
        <button class="obj-delete" data-id="${obj.id}" aria-label="删除对象">×</button>
      </div>`;
  }).join('');
  listEl.scrollTop = scrollTop;
}

// 事件委托：只在初始化时绑定一次，列表重建不需要重新挂监听
document.getElementById('object-list').addEventListener('click', (e) => {
  const item = e.target.closest('.object-item');
  if (!item) return;
  const obj = toolCtx.objects.find(o => o.id === item.dataset.id);
  if (!obj) return;

  if (e.target.closest('.obj-delete')) {
    history.execute(new DeleteObjectCommand(obj, toolCtx.objects));
    toolCtx.selectedObjects = toolCtx.selectedObjects.filter(o => o !== obj);
  } else if (e.shiftKey) {
    const idx = toolCtx.selectedObjects.indexOf(obj);
    if (idx >= 0) toolCtx.selectedObjects.splice(idx, 1);
    else toolCtx.selectedObjects.push(obj);
  } else {
    toolCtx.selectedObjects = [obj];
  }
  render();
});

// ============================================================
// Status Bar
// ============================================================

function updateStatusBar() {
  const toolEl = document.getElementById('status-tool');
  const zoomEl = document.getElementById('status-zoom');
  const toolText = currentTool && currentTool.statusHint ? currentTool.statusHint : '';
  if (toolEl.textContent !== toolText) toolEl.textContent = toolText;
  const zoomText = `缩放: ${Math.round(cm.zoom / 40 * 100)}%`;
  if (zoomEl.textContent !== zoomText) zoomEl.textContent = zoomText;

  const coordEl = document.getElementById('coord-display');
  if (toolCtx._lastMousePos) {
    const wp = toolCtx._lastMousePos;
    const coordText = `(${formatNum(wp.x)}, ${formatNum(wp.y)})`;
    if (coordEl.textContent !== coordText) coordEl.textContent = coordText;
  }
}

// ============================================================
// Tool Management
// ============================================================

function switchTool(toolName) {
  if (currentTool) currentTool.deactivate();
  currentTool = createTool(toolName, toolCtx);
  currentTool.activate();

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });

  canvas.style.cursor = currentTool.cursor;
  render();
}

// ============================================================
// Modals
// ============================================================

let _editingFuncObj = null;

function showFuncModal(editObj) {
  _editingFuncObj = editObj || null;
  const overlay = document.getElementById('modal-overlay');
  const input = document.getElementById('func-input');
  overlay.classList.remove('hidden');
  input.value = editObj ? editObj.expression : '';
  setTimeout(() => input.focus(), 50);
}

function hideFuncModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function showTextModal() {
  const overlay = document.getElementById('text-modal-overlay');
  const input = document.getElementById('text-input');
  overlay.classList.remove('hidden');
  input.value = '';
  setTimeout(() => input.focus(), 50);
}

function hideTextModal() {
  document.getElementById('text-modal-overlay').classList.add('hidden');
}

function commitFunctionNow() {
  const input = document.getElementById('func-input');
  const expr = input.value.trim();
  if (!expr) return;
  if (_editingFuncObj) {
    // 编辑已有函数
    const oldExpr = _editingFuncObj.expression;
    _editingFuncObj.expression = expr;
    _editingFuncObj.invalidateCache();
    history.push({
      execute() { _editingFuncObj.expression = expr; _editingFuncObj.invalidateCache(); },
      undo() { _editingFuncObj.expression = oldExpr; _editingFuncObj.invalidateCache(); },
      redo() { _editingFuncObj.expression = expr; _editingFuncObj.invalidateCache(); },
    });
    _editingFuncObj = null;
  } else {
    // 新建函数
    const graph = new GeoFunctionGraph(expr, -10, 10);
    graph.setStyle({ ...toolCtx.style });
    history.execute(new AddObjectCommand(graph, toolCtx.objects));
  }
  hideFuncModal();
  render();
}

function commitTextNow() {
  const input = document.getElementById('text-input');
  const content = input.value.trim();
  if (!content) return;
  if (currentTool instanceof TextTool) {
    currentTool.commitText(content);
  }
  hideTextModal();
}

// ============================================================
// Canvas Event Handlers
// ============================================================

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return new Vec2(e.clientX - rect.left, e.clientY - rect.top);
}

function getWorldPos(e) {
  return cm.screenToWorld(getCanvasPos(e));
}

canvas.addEventListener('mousedown', (e) => {
  // Middle-click or Alt+click for pan
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault(); // 阻止中键触发浏览器自动滚动
    cm.startPan(getCanvasPos(e));
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (e.button === 2) {
    // Cancel current action
    if (currentTool) currentTool.onKeyDown({ key: 'Escape' });
    return;
  }

  if (e.button === 0 && currentTool) {
    let worldPos = getWorldPos(e);
    const snap = findSnapPoint(worldPos);
    if (snap) {
      toolCtx._snapPoint = snap;
      worldPos = snap;
    } else {
      toolCtx._snapPoint = null;
    }
    currentTool.onMouseDown(worldPos, e);
  }
});

canvas.addEventListener('mousemove', (e) => {
  const screenPos = getCanvasPos(e);
  const worldPos = cm.screenToWorld(screenPos);
  toolCtx._lastMousePos = worldPos;

  if (cm.isPanning) {
    cm.updatePan(screenPos);
    render();
    return;
  }

  const snap = findSnapPoint(worldPos);
  toolCtx._snapPoint = snap;

  if (currentTool) {
    currentTool.onMouseMove(snap || worldPos, e);
  }
  // Always re-render on mouse move for live previews (snap dot, etc.)
  render();
});

canvas.addEventListener('mouseup', (e) => {
  if (cm.isPanning) {
    cm.endPan();
    canvas.style.cursor = currentTool ? currentTool.cursor : 'crosshair';
    return;
  }

  if (e.button === 0 && currentTool) {
    const worldPos = getWorldPos(e);
    const snap = findSnapPoint(worldPos);
    toolCtx._snapPoint = null;
    currentTool.onMouseUp(snap || worldPos, e);
  }
});

canvas.addEventListener('dblclick', (e) => {
  if (currentTool) {
    currentTool.onDoubleClick(getWorldPos(e), e);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const screenPos = getCanvasPos(e);
  cm.zoomAt(screenPos, e.deltaY > 0 ? -1 : 1);
  if (currentTool && currentTool.onWheel) {
    currentTool.onWheel(cm.screenToWorld(screenPos), e.deltaY);
  }
  render();
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ============================================================
// Keyboard Shortcuts
// ============================================================

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  // Undo/Redo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    history.undo();
    render();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    history.redo();
    render();
    return;
  }

  // Delete：无论当前是什么工具，都允许删除选中对象
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (toolCtx.selectedObjects.length > 0) {
      const cmds = toolCtx.selectedObjects.map(o => new DeleteObjectCommand(o, toolCtx.objects));
      history.execute(cmds.length === 1 ? cmds[0] : new BatchCommand(cmds));
      toolCtx.selectedObjects = [];
      render();
    } else if (currentTool) {
      currentTool.onKeyDown(e);
    }
    return;
  }

  // Escape
  if (e.key === 'Escape') {
    hideFuncModal();
    hideTextModal();
    if (currentTool) currentTool.onKeyDown(e);
    toolCtx.selectedObjects = [];
    render();
    return;
  }

  // Tool shortcuts (when no modifiers)
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const toolKeys = {
      'v': 'select', 'p': 'point', 's': 'segment', 'l': 'line',
      'c': 'circle', 'f': 'function', 't': 'text',
    };
    if (toolKeys[e.key.toLowerCase()]) {
      switchTool(toolKeys[e.key.toLowerCase()]);
      return;
    }
  }

  if (currentTool) currentTool.onKeyDown(e);
});

// ============================================================
// Toolbar Buttons
// ============================================================

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => switchTool(btn.dataset.tool));
});

// ---- JS Tooltip (appended to body, avoids clipping by overflow) ----
const tooltipEl = document.createElement('div');
tooltipEl.id = 'js-tooltip';
tooltipEl.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;background:rgba(20,20,40,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(124,131,255,0.3);color:#E8E8F0;padding:5px 12px;border-radius:6px;font-size:11px;white-space:nowrap;display:none;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
document.body.appendChild(tooltipEl);

document.querySelectorAll('.tool-btn[data-tip]').forEach(btn => {
  btn.addEventListener('mouseenter', (e) => {
    const tip = btn.getAttribute('data-tip');
    if (!tip) return;
    tooltipEl.textContent = tip;
    tooltipEl.style.display = 'block';
  });
  btn.addEventListener('mouseleave', () => {
    tooltipEl.style.display = 'none';
  });
  btn.addEventListener('mousemove', (e) => {
    tooltipEl.style.left = (e.clientX + 14) + 'px';
    tooltipEl.style.top = (e.clientY - 30) + 'px';
  });
});

// 无障碍：工具按钮的可访问名称取自提示文本
document.querySelectorAll('.tool-btn[data-tip]').forEach(btn => {
  btn.setAttribute('aria-label', btn.getAttribute('data-tip'));
});

// ============================================================
// Action Buttons
// ============================================================

document.getElementById('btn-undo').addEventListener('click', () => {
  history.undo();
  render();
});

document.getElementById('btn-redo').addEventListener('click', () => {
  history.redo();
  render();
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (toolCtx.objects.length === 0) return;
  if (confirm('确定要清空画布吗？此操作可以撤销。')) {
    const cmds = [...toolCtx.objects].map(o => new DeleteObjectCommand(o, toolCtx.objects));
    history.execute(new BatchCommand(cmds));
    toolCtx.selectedObjects = [];
    render();
  }
});

document.getElementById('btn-reset-view').addEventListener('click', () => {
  cm.resetView();
  render();
});

// ============================================================
// Export Modal
// ============================================================

let _exportFormat = 'png';

document.getElementById('btn-export').addEventListener('click', () => {
  document.getElementById('export-modal-overlay').classList.remove('hidden');
});

// 格式按钮切换
document.querySelectorAll('.export-format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.export-format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _exportFormat = btn.dataset.format;
  });
});

document.getElementById('btn-export-ok').addEventListener('click', doExport);
document.getElementById('btn-export-cancel').addEventListener('click', hideExportModal);
document.getElementById('export-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideExportModal();
});

function hideExportModal() {
  document.getElementById('export-modal-overlay').classList.add('hidden');
}

function doExport() {
  const includeAxes = document.getElementById('export-axes').checked;
  hideExportModal();

  if (_exportFormat === 'svg') {
    exportSVG(includeAxes);
  } else {
    exportPNG(includeAxes);
  }
}

function exportPNG(includeAxes) {
  const exportCanvas = document.createElement('canvas');
  const scale = 2;
  const w = Math.floor(cm.getWidth());
  const h = Math.floor(cm.getHeight());
  exportCanvas.width = w * scale;
  exportCanvas.height = h * scale;
  const ctx = exportCanvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  ctx.save();
  ctx.scale(scale, scale);

  const origCtx = cm.ctx;
  cm.ctx = ctx;

  // 白底导出：切换浅色配色（网格 / 坐标轴 / 标签）
  cm.lightMode = true;

  if (includeAxes) {
    cm.drawGrid();
    cm.drawAxes();
  }

  for (const obj of toolCtx.objects) {
    if (!obj.visible) continue;
    obj.draw(ctx, cm);
  }

  cm.lightMode = false;
  cm.ctx = origCtx;
  ctx.restore();

  const link = document.createElement('a');
  link.download = 'geometry-board.png';
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}

function exportSVG(includeAxes) {
  const w = Math.floor(cm.getWidth());
  const h = Math.floor(cm.getHeight());
  const bounds = cm.getVisibleBounds();

  let svgParts = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  svgParts.push(`<rect width="${w}" height="${h}" fill="#ffffff"/>`);

  // 坐标变换函数
  function w2s(p) {
    return cm.worldToScreen(p);
  }

  if (includeAxes) {
    // 简化的网格和坐标轴
    const origin = w2s({x:0, y:0});
    svgParts.push(`<line x1="0" y1="${origin.y}" x2="${w}" y2="${origin.y}" stroke="#ccc" stroke-width="1"/>`);
    svgParts.push(`<line x1="${origin.x}" y1="0" x2="${origin.x}" y2="${h}" stroke="#ccc" stroke-width="1"/>`);
  }

  // 导出对象为 SVG 元素
  for (const obj of toolCtx.objects) {
    if (!obj.visible) continue;
    const elem = objectToSVG(obj, w2s);
    if (elem) svgParts.push(elem);
  }

  svgParts.push('</svg>');

  const blob = new Blob([svgParts.join('\n')], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'geometry-board.svg';
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function objectToSVG(obj, w2s) {
  const color = obj.style.color || '#1a73e8';
  const width = obj.style.lineWidth || 2;
  const dashMap = { solid: '', dashed: 'stroke-dasharray="8 4"', dotted: 'stroke-dasharray="2 4"' };
  const dash = dashMap[obj.style.lineStyle] || '';
  const strokeAttrs = `stroke="${color}" stroke-width="${width}"${dash ? ' ' + dash : ''}`;
  const label = obj.label
    ? `<text x="0" y="0" fill="#333" font-size="12" font-family="system-ui">${escapeHtml(obj.label)}</text>`
    : null;

  const placeLabel = (x, y, anchor = 'start') =>
    label ? label.replace('x="0" y="0"', `x="${x.toFixed(1)}" y="${y.toFixed(1)}"`).replace('font-family="system-ui"', `font-family="system-ui" text-anchor="${anchor}"`) : '';

  switch (obj.type) {
    case 'point': {
      const s = w2s(obj.pos);
      return `<circle cx="${s.x}" cy="${s.y}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/>`
        + placeLabel(s.x + 8, s.y - 6);
    }
    case 'segment': {
      const s1 = w2s(obj.p1), s2 = w2s(obj.p2);
      const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
      return `<line x1="${s1.x}" y1="${s1.y}" x2="${s2.x}" y2="${s2.y}" ${strokeAttrs}/>`
        + placeLabel(mid.x, mid.y - 6, 'middle');
    }
    case 'line': {
      const pts = obj._clipToRect(cm.getVisibleBounds(), cm);
      if (pts.length < 2) return '';
      const s1 = w2s(pts[0]), s2 = w2s(pts[1]);
      return `<line x1="${s1.x}" y1="${s1.y}" x2="${s2.x}" y2="${s2.y}" ${strokeAttrs}/>`;
    }
    case 'ray': {
      const exit = obj._exitPoint(cm.getVisibleBounds());
      if (!exit) return '';
      const s1 = w2s(obj.origin), s2 = w2s(exit);
      const len = Math.hypot(s2.x - s1.x, s2.y - s1.y) || 1;
      const angle = Math.atan2(s2.y - s1.y, s2.x - s1.x);
      const size = 10;
      const b1 = `${(s2.x - size * Math.cos(angle - Math.PI / 6)).toFixed(1)},${(s2.y - size * Math.sin(angle - Math.PI / 6)).toFixed(1)}`;
      const b2 = `${(s2.x - size * Math.cos(angle + Math.PI / 6)).toFixed(1)},${(s2.y - size * Math.sin(angle + Math.PI / 6)).toFixed(1)}`;
      return `<line x1="${s1.x.toFixed(1)}" y1="${s1.y.toFixed(1)}" x2="${s2.x.toFixed(1)}" y2="${s2.y.toFixed(1)}" ${strokeAttrs}/>`
        + `<polygon points="${s2.x.toFixed(1)},${s2.y.toFixed(1)} ${b1} ${b2}" fill="${color}"/>`;
    }
    case 'circle': {
      const s = w2s(obj.center);
      const r = obj.radius * cm.zoom;
      return `<circle cx="${s.x}" cy="${s.y}" r="${r}" fill="none" ${strokeAttrs}/>`
        + `<circle cx="${s.x}" cy="${s.y}" r="3" fill="${color}"/>`
        + placeLabel(s.x + r + 4, s.y - r);
    }
    case 'polygon': {
      const pts = obj.vertices.map(v => w2s(v)).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const fill = (obj.style.fill && obj.style.fillOpacity > 0 && obj.closed)
        ? `fill="${obj.style.fill}" fill-opacity="${obj.style.fillOpacity}"` : 'fill="none"';
      const dots = obj.vertices.map(v => w2s(v))
        .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}"/>`).join('');
      return `<polygon points="${pts}" ${fill} ${strokeAttrs}/>` + dots;
    }
    case 'function': {
      const points = obj._samplePoints();
      const out = [];
      let seg = [];
      const flush = () => {
        if (seg.length > 1) out.push(`<polyline points="${seg.join(' ')}" fill="none" ${strokeAttrs}/>`);
        seg = [];
      };
      for (const p of points) {
        if (!p) { flush(); continue; }
        const sp = w2s(p);
        seg.push(`${sp.x.toFixed(1)},${sp.y.toFixed(1)}`);
      }
      flush();
      return out.join('');
    }
    case 'angle': {
      const sv = w2s(obj.vertex);
      const sa = w2s(obj.pointA), sb = w2s(obj.pointB);
      const a0 = Math.atan2(sa.y - sv.y, sa.x - sv.x);
      const a1 = Math.atan2(sb.y - sv.y, sb.x - sv.x);
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      const r = 30;
      const x1 = (sv.x + r * Math.cos(a0)).toFixed(1), y1 = (sv.y + r * Math.sin(a0)).toFixed(1);
      const x2 = (sv.x + r * Math.cos(a0 + sweep)).toFixed(1), y2 = (sv.y + r * Math.sin(a0 + sweep)).toFixed(1);
      const la = a0 + sweep / 2;
      const deg = (obj.getAngle() * 180 / Math.PI).toFixed(1);
      return `<path d="M ${x1} ${y1} A ${r} ${r} 0 0 ${sweep > 0 ? 1 : 0} ${x2} ${y2}" fill="none" ${strokeAttrs}/>`
        + `<text x="${(sv.x + 46 * Math.cos(la)).toFixed(1)}" y="${(sv.y + 46 * Math.sin(la)).toFixed(1)}" fill="#333" font-size="12" font-family="system-ui" text-anchor="middle" dominant-baseline="middle">${deg}°</text>`;
    }
    case 'text': {
      const s = w2s(obj.position);
      return `<text x="${s.x.toFixed(1)}" y="${(s.y + 11).toFixed(1)}" fill="${color}" font-size="14" font-family="system-ui">${escapeHtml(obj.content)}</text>`;
    }
    case 'measurement': {
      const mStroke = 'stroke="#e37400" stroke-width="1.2" stroke-dasharray="4 3"';
      const mText = (x, y, txt) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="#e37400" font-size="13" font-family="system-ui" text-anchor="middle">${escapeHtml(txt)}</text>`;
      if (obj.measureType === 'distance' && obj.points.length >= 2) {
        const s1 = w2s(obj.points[0]), s2 = w2s(obj.points[1]);
        const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
        return `<line x1="${s1.x.toFixed(1)}" y1="${s1.y.toFixed(1)}" x2="${s2.x.toFixed(1)}" y2="${s2.y.toFixed(1)}" ${mStroke}/>`
          + mText(mid.x, mid.y - 8, formatNum(obj.value));
      }
      if (obj.measureType === 'angle' && obj.points.length >= 3) {
        const sv = w2s(obj.points[1]), s1 = w2s(obj.points[0]), s2 = w2s(obj.points[2]);
        const a0 = Math.atan2(s1.y - sv.y, s1.x - sv.x);
        const a1 = Math.atan2(s2.y - sv.y, s2.x - sv.x);
        let sweep = a1 - a0;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep <= -Math.PI) sweep += 2 * Math.PI;
        const x1 = (sv.x + 25 * Math.cos(a0)).toFixed(1), y1 = (sv.y + 25 * Math.sin(a0)).toFixed(1);
        const x2 = (sv.x + 25 * Math.cos(a0 + sweep)).toFixed(1), y2 = (sv.y + 25 * Math.sin(a0 + sweep)).toFixed(1);
        const la = a0 + sweep / 2;
        return `<polyline points="${s1.x.toFixed(1)},${s1.y.toFixed(1)} ${sv.x.toFixed(1)},${sv.y.toFixed(1)} ${s2.x.toFixed(1)},${s2.y.toFixed(1)}" fill="none" ${mStroke}/>`
          + `<path d="M ${x1} ${y1} A 25 25 0 0 ${sweep > 0 ? 1 : 0} ${x2} ${y2}" fill="none" ${mStroke}/>`
          + mText(sv.x + 38 * Math.cos(la), sv.y + 38 * Math.sin(la) + 4, `${formatNum(obj.value)}°`);
      }
      if (obj.measureType === 'area' && obj.points.length >= 3) {
        const pts = obj.points.map(p => w2s(p)).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const center = obj.points.reduce((acc, p) => ({ x: acc.x + p.x / obj.points.length, y: acc.y + p.y / obj.points.length }), { x: 0, y: 0 });
        const sc = w2s(center);
        return `<polygon points="${pts}" fill="#e37400" fill-opacity="0.15" ${mStroke}/>`
          + mText(sc.x, sc.y, `${formatNum(obj.value)} 平方单位`);
      }
      return '';
    }
    default:
      return '';
  }
}

document.getElementById('btn-snap').addEventListener('click', () => {
  toolCtx.snapEnabled = !toolCtx.snapEnabled;
  const btn = document.getElementById('btn-snap');
  btn.setAttribute('data-tip', toolCtx.snapEnabled ? '吸附到网格/点 (开)' : '吸附到网格/点 (关)');
  btn.style.opacity = toolCtx.snapEnabled ? '1' : '0.4';
  render();
});

// ============================================================
// Style Panel Handlers
// ============================================================

/**
 * 将 hex 颜色和透明度(0-1)合并为带 alpha 的 hex 颜色
 * 例如: applyOpacity('#1a73e8', 0.5) => '#1a73e880'
 */
function applyOpacity(hex, alpha) {
  const a = Math.round(alpha * 255);
  return hex + a.toString(16).padStart(2, '0');
}

/**
 * 根据当前基础颜色和透明度，同步更新样式中的 color 和 fill
 */
function syncColors() {
  const base = toolCtx.style.baseColor || '#1a73e8';
  const opacity = toolCtx.style.fillOpacity;
  // 描边始终保持不透明；透明度滑块只控制内部填充（0 = 无填充）
  toolCtx.style.color = applyOpacity(base, 1);
  toolCtx.style.fill = opacity > 0 ? applyOpacity(base, opacity * 0.3) : 'transparent';
}

// ---- 样式修改纳入撤销历史 ----
// 交互开始时（第一次 input）记录快照，交互结束（change）时提交命令
let _pendingStyleSnapshot = null;

function beginStyleChange() {
  if (_pendingStyleSnapshot || toolCtx.selectedObjects.length === 0) return;
  _pendingStyleSnapshot = toolCtx.selectedObjects.map(obj => ({
    obj,
    oldStyle: { ...obj.style },
  }));
}

function commitStyleChange() {
  if (!_pendingStyleSnapshot) return;
  const cmds = _pendingStyleSnapshot.map(({ obj, oldStyle }) =>
    new ModifyObjectCommand(obj, { style: oldStyle }, { style: { ...obj.style } }));
  history.execute(cmds.length === 1 ? cmds[0] : new BatchCommand(cmds));
  _pendingStyleSnapshot = null;
}

document.getElementById('stroke-color').addEventListener('input', (e) => {
  beginStyleChange();
  toolCtx.style.baseColor = e.target.value;
  syncColors();
  for (const obj of toolCtx.selectedObjects) {
    obj.style.color = toolCtx.style.color;
    obj.style.fill = toolCtx.style.fill;
  }
  render();
});
document.getElementById('stroke-color').addEventListener('change', commitStyleChange);

document.getElementById('line-width').addEventListener('input', (e) => {
  beginStyleChange();
  const val = parseInt(e.target.value);
  document.getElementById('line-width-val').textContent = val;
  toolCtx.style.lineWidth = val;
  for (const obj of toolCtx.selectedObjects) obj.style.lineWidth = val;
  render();
});
document.getElementById('line-width').addEventListener('change', commitStyleChange);

document.getElementById('line-style').addEventListener('change', (e) => {
  beginStyleChange();
  toolCtx.style.lineStyle = e.target.value;
  for (const obj of toolCtx.selectedObjects) obj.style.lineStyle = e.target.value;
  commitStyleChange();
  render();
});

document.getElementById('fill-opacity').addEventListener('input', (e) => {
  beginStyleChange();
  const val = parseInt(e.target.value);
  document.getElementById('fill-opacity-val').textContent = val + '%';
  toolCtx.style.fillOpacity = val / 100;
  syncColors();
  for (const obj of toolCtx.selectedObjects) {
    obj.style.color = toolCtx.style.color;
    obj.style.fill = toolCtx.style.fill;
  }
  render();
});
document.getElementById('fill-opacity').addEventListener('change', commitStyleChange);



// ============================================================
// Modal Buttons
// ============================================================

document.getElementById('btn-func-ok').addEventListener('click', commitFunctionNow);
document.getElementById('btn-func-cancel').addEventListener('click', hideFuncModal);
document.getElementById('btn-text-ok').addEventListener('click', commitTextNow);
document.getElementById('btn-text-cancel').addEventListener('click', hideTextModal);

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideFuncModal();
});
document.getElementById('text-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideTextModal();
});

// Enter key in modal inputs
document.getElementById('func-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitFunctionNow();
  if (e.key === 'Escape') hideFuncModal();
});
document.getElementById('text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitTextNow();
  if (e.key === 'Escape') hideTextModal();
});

// ============================================================
// Initialize
// ============================================================

switchTool('select');
render();

window.addEventListener('resize', () => {
  cm._onResize();
  render();
});

console.log('🎨 Geometry Board initialized!');
console.log('Shortcuts: V=Select P=Point S=Segment L=Line C=Circle F=Function T=Text');
console.log('Ctrl+Z=Undo Ctrl+Y=Redo Delete=Delete Esc=Cancel');
