// Tools.js - All drawing/editing tool implementations

import { Vec2, angleABC, polygonArea, formatNum } from './Geometry.js';
import {
  GeoPoint, GeoSegment, GeoLine, GeoRay, GeoCircle, GeoPolygon,
  GeoFunctionGraph, GeoAngle, GeoText, GeoMeasurement
} from './Objects.js';
import { AddObjectCommand, DeleteObjectCommand, BatchCommand, ModifyObjectCommand, MoveObjectCommand } from './History.js';

// 支持旋转变换的对象类型（function / measurement 没有几何自由度，跳过以免产生空历史记录）
const ROTATABLE_TYPES = new Set(['point', 'segment', 'line', 'ray', 'circle', 'polygon', 'angle', 'text']);

// ============================================================
// ToolContext - shared state for all tools
// ============================================================

export class ToolContext {
  constructor() {
    this.objects = [];           // Array of all GeoObjects
    this.selectedObjects = [];   // Currently selected objects
    this.history = null;         // HistoryManager
    this.canvas = null;          // CanvasManager
    this.style = {               // Current drawing style
      baseColor: '#1a73e8', color: '#1a73e8',
      lineWidth: 2,
      fill: 'transparent',
      fillOpacity: 0,            // 封闭图形默认不填充
      lineStyle: 'solid',
    };
    this.snapEnabled = true;     // Snap to grid toggle
    this.snapPoint = null;       // Current snap point (world coords)
    this.renderAll = null;       // Callback to trigger re-render

    // Modals
    this.showFuncModal = null;
    this.showTextModal = null;
  }
}

// ============================================================
// Base Tool
// ============================================================

export class BaseTool {
  constructor(ctx) {
    this.ctx = ctx;
  }

  get name() { return 'base'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return ''; }

  activate() {}
  deactivate() {}

  onMouseDown(pos, event) {}
  onMouseMove(pos, event) {}
  onMouseUp(pos, event) {}
  onDoubleClick(pos, event) {}
  onKeyDown(event) {}
  onWheel(pos, delta) {}
}

// ============================================================
// Select Tool
// ============================================================

export class SelectTool extends BaseTool {
  get name() { return 'select'; }
  get cursor() { return 'default'; }
  get statusHint() { return '选择工具：点击选择对象，拖动移动 | Delete删除 | 右键取消选择'; }

  constructor(ctx) {
    super(ctx);
    this.dragging = false;
    this.dragStart = null;
    this.dragStartPositions = null;
    this.isSelecting = false; // Rectangle selection
    this.selectStart = null;
    this.hoverObject = null; // 鼠标悬停的对象
  }

  onMouseDown(pos, event) {
    // Check if we clicked on any object
    const hit = this._findHit(pos);
    if (hit) {
      if (event.shiftKey) {
        // Toggle selection
        const idx = this.ctx.selectedObjects.indexOf(hit);
        if (idx >= 0) {
          this.ctx.selectedObjects.splice(idx, 1);
        } else {
          this.ctx.selectedObjects.push(hit);
        }
      } else if (!this.ctx.selectedObjects.includes(hit)) {
        this.ctx.selectedObjects = [hit];
      }
      // Start drag
      this.dragging = true;
      this.dragStart = pos.clone();
      this.dragStartObjs = this.ctx.selectedObjects
        .filter(o => !o.locked);
      this._totalDelta = new Vec2(0, 0);
    } else {
      if (!event.shiftKey) {
        this.ctx.selectedObjects = [];
      }
      // Start rectangle selection
      this.isSelecting = true;
      this.selectStart = pos.clone();
    }
    this.ctx.renderAll();
  }

  onMouseMove(pos, event) {
    if (this.dragging && this.dragStart) {
      const delta = pos.sub(this.dragStart);
      this._totalDelta = this._totalDelta.add(delta);
      for (const obj of this.dragStartObjs) {
        obj.moveBy(delta);
      }
      this.dragStart = pos.clone();
      return;
    }
    if (this.isSelecting) return;
    // hover 检测（渲染由 main 的 mousemove 统一处理）
    this.hoverObject = this._findHit(pos);
  }

  onMouseUp(pos, event) {
    if (this.dragging && this.dragStartObjs) {
      const moved = this._totalDelta && this._totalDelta.length() > 0.001;
      if (moved) {
        // Move objects back to original position first
        const reverseDelta = this._totalDelta.scale(-1);
        for (const obj of this.dragStartObjs) obj.moveBy(reverseDelta);
        // Then commit via MoveObjectCommand
        const batch = this.dragStartObjs.map(obj => new MoveObjectCommand(obj, this._totalDelta));
        this.ctx.history.execute(batch.length === 1 ? batch[0] : new BatchCommand(batch));
      }
      this.dragging = false;
      this.dragStart = null;
      this.dragStartObjs = null;
      this._totalDelta = null;
    }
    if (this.isSelecting && this.selectStart) {
      // 框选区域的大小
      const minX = Math.min(this.selectStart.x, pos.x);
      const maxX = Math.max(this.selectStart.x, pos.x);
      const minY = Math.min(this.selectStart.y, pos.y);
      const maxY = Math.max(this.selectStart.y, pos.y);
      const selW = maxX - minX;
      const selH = maxY - minY;
      const minSelSize = this.ctx.canvas.screenToWorldDist(5);

      // 只有拖拽出足够大的区域才进行框选，否则视为单纯点击（不选中任何对象）
      if (selW > minSelSize || selH > minSelSize) {
        this.ctx.selectedObjects = [];
        for (const obj of this.ctx.objects) {
          if (obj.locked || !obj.visible) continue;
          const bounds = obj.getBounds();
          if (bounds.maxX >= minX && bounds.minX <= maxX &&
              bounds.maxY >= minY && bounds.minY <= maxY) {
            this.ctx.selectedObjects.push(obj);
          }
        }
      }
      this.isSelecting = false;
      this.selectStart = null;
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.ctx.selectedObjects.length > 0) {
        const cmds = this.ctx.selectedObjects.map(o => new DeleteObjectCommand(o, this.ctx.objects));
        this.ctx.history.execute(cmds.length === 1 ? cmds[0] : new BatchCommand(cmds));
        this.ctx.selectedObjects = [];
        this.ctx.renderAll();
      }
    }
  }

  _findHit(pos) {
    let best = null, bestDist = Infinity;
    for (const obj of this.ctx.objects) {
      if (!obj.visible || obj.locked) continue;
      const result = obj.hitTest(pos, this.ctx.canvas);
      if (result.hit && result.distance < bestDist) {
        best = obj;
        bestDist = result.distance;
      }
    }
    return best;
  }

  onDoubleClick(pos, event) {
    const hit = this._findHit(pos);
    if (hit && hit.type === 'function' && this.ctx.showFuncModal) {
      this.ctx.showFuncModal(hit);
    }
  }
}


// ============================================================
// Point Tool
// ============================================================

export class PointTool extends BaseTool {
  get name() { return 'point'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击放置点'; }

  onMouseDown(pos, event) {
    const p = new GeoPoint(pos.x, pos.y);
    p.setStyle({ ...this.ctx.style });
    this.ctx.history.execute(new AddObjectCommand(p, this.ctx.objects));
    this.ctx.renderAll();
  }
}


// ============================================================
// Segment Tool
// ============================================================

export class SegmentTool extends BaseTool {
  get name() { return 'segment'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击起点，再点击终点画线段 | Esc取消'; }

  constructor(ctx) {
    super(ctx);
    this.startPoint = null;
  }

  onMouseDown(pos, event) {
    if (!this.startPoint) {
      this.startPoint = pos.clone();
    } else {
      const seg = new GeoSegment(this.startPoint, pos);
      seg.setStyle({ ...this.ctx.style });
      this.ctx.history.execute(new AddObjectCommand(seg, this.ctx.objects));
      this.startPoint = null;
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape' && this.startPoint) {
      this.startPoint = null;
      this.ctx.renderAll();
    }
  }

  activate() { this.startPoint = null; }
  deactivate() { this.startPoint = null; }
}


// ============================================================
// Line Tool
// ============================================================

export class LineTool extends BaseTool {
  get name() { return 'line'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击两个点确定一条直线 | Esc取消'; }

  constructor(ctx) {
    super(ctx);
    this.startPoint = null;
  }

  onMouseDown(pos, event) {
    if (!this.startPoint) {
      this.startPoint = pos.clone();
    } else {
      const line = new GeoLine(this.startPoint, pos);
      line.setStyle({ ...this.ctx.style });
      this.ctx.history.execute(new AddObjectCommand(line, this.ctx.objects));
      this.startPoint = null;
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape' && this.startPoint) {
      this.startPoint = null;
      this.ctx.renderAll();
    }
  }

  activate() { this.startPoint = null; }
  deactivate() { this.startPoint = null; }
}


// ============================================================
// Ray Tool
// ============================================================

export class RayTool extends BaseTool {
  get name() { return 'ray'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击起点，再点击方向点画射线 | Esc取消'; }

  constructor(ctx) {
    super(ctx);
    this.startPoint = null;
  }

  onMouseDown(pos, event) {
    if (!this.startPoint) {
      this.startPoint = pos.clone();
    } else {
      const dir = pos.sub(this.startPoint);
      if (dir.length() > 0.001) {
        const ray = new GeoRay(this.startPoint, dir);
        ray.setStyle({ ...this.ctx.style });
        this.ctx.history.execute(new AddObjectCommand(ray, this.ctx.objects));
      }
      this.startPoint = null;
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') this.startPoint = null;
  }

  activate() { this.startPoint = null; }
  deactivate() { this.startPoint = null; }
}


// ============================================================
// Circle Tool
// ============================================================

export class CircleTool extends BaseTool {
  get name() { return 'circle'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击确定圆心，拖动设定半径'; }

  constructor(ctx) {
    super(ctx);
    this.center = null;
  }

  onMouseDown(pos, event) {
    if (!this.center) {
      this.center = pos.clone();
    } else {
      const radius = Vec2.distance(this.center, pos);
      if (radius > 0.001) {
        const circle = new GeoCircle(this.center, radius);
        circle.setStyle({ ...this.ctx.style });
        this.ctx.history.execute(new AddObjectCommand(circle, this.ctx.objects));
      }
      this.center = null;
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') this.center = null;
  }

  activate() { this.center = null; }
  deactivate() { this.center = null; }
}


// ============================================================
// Polygon Tool
// ============================================================

export class PolygonTool extends BaseTool {
  get name() { return 'polygon'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击添加顶点，双击或点击起点闭合多边形 | Esc取消'; }

  constructor(ctx) {
    super(ctx);
    this.vertices = [];
  }

  onMouseDown(pos, event) {
    if (this.vertices.length >= 3) {
      // Check if clicking near start point to close
      const distToStart = Vec2.distance(pos, this.vertices[0]);
      if (distToStart < this.ctx.canvas.screenToWorldDist(15)) {
        this._finishPolygon();
        return;
      }
    }
    this.vertices.push(pos.clone());
    this.ctx.renderAll();
  }

  onDoubleClick(pos, event) {
    if (this.vertices.length >= 3) {
      this._finishPolygon();
    }
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      if (this.vertices.length >= 3) {
        this._finishPolygon();
      } else {
        this.vertices = [];
      }
      this.ctx.renderAll();
    }
    if (event.key === 'Enter' && this.vertices.length >= 3) {
      this._finishPolygon();
    }
  }

  _finishPolygon() {
    if (this.vertices.length < 3) return;
    const poly = new GeoPolygon(this.vertices);
    poly.setStyle({ ...this.ctx.style });
    this.ctx.history.execute(new AddObjectCommand(poly, this.ctx.objects));
    this.vertices = [];
  }

  activate() { this.vertices = []; }
  deactivate() { this.vertices = []; }
}


// ============================================================
// Function Plot Tool
// ============================================================

export class FunctionTool extends BaseTool {
  get name() { return 'function'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '输入函数表达式绘制图像'; }

  activate() {
    if (this.ctx.showFuncModal) {
      this.ctx.showFuncModal();
    }
  }
}


// ============================================================
// Angle Tool
// ============================================================

export class AngleTool extends BaseTool {
  get name() { return 'angle-draw'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '依次点击：角顶点 → 第一条边的点 → 第二条边的点'; }

  constructor(ctx) {
    super(ctx);
    this.points = [];
  }

  onMouseDown(pos, event) {
    this.points.push(pos.clone());
    if (this.points.length === 3) {
      const angle = new GeoAngle(this.points[0], this.points[1], this.points[2]);
      angle.setStyle({ ...this.ctx.style });
      this.ctx.history.execute(new AddObjectCommand(angle, this.ctx.objects));
      this.points = [];
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') { this.points = []; this.ctx.renderAll(); }
  }

  activate() { this.points = []; }
  deactivate() { this.points = []; }
}


// ============================================================
// Text Tool
// ============================================================

export class TextTool extends BaseTool {
  get name() { return 'text'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击放置文字位置，然后输入文字'; }

  constructor(ctx) {
    super(ctx);
    this.pendingPos = null;
  }

  onMouseDown(pos, event) {
    this.pendingPos = pos.clone();
    if (this.ctx.showTextModal) {
      this.ctx.showTextModal();
    }
  }

  commitText(content) {
    if (!this.pendingPos || !content.trim()) return;
    const text = new GeoText(this.pendingPos, content);
    text.setStyle({ ...this.ctx.style });
    this.ctx.history.execute(new AddObjectCommand(text, this.ctx.objects));
    this.pendingPos = null;
    this.ctx.renderAll();
  }

  activate() { this.pendingPos = null; }
  deactivate() { this.pendingPos = null; }
}


// ============================================================
// Perpendicular Line Tool
// ============================================================

export class PerpendicularTool extends BaseTool {
  get name() { return 'perpendicular'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击一条已知直线，再点击一个点 — 过该点作垂线'; }

  constructor(ctx) {
    super(ctx);
    this.line = null;
  }

  onMouseDown(pos, event) {
    // First click: find a line/segment
    if (!this.line) {
      const hit = this._findLine(pos);
      if (hit) {
        this.line = hit;
      }
    } else {
      // Second click: point through which perpendicular passes
      const d = this._getLineDirection(this.line);
      const lineP = this._getLinePoint(this.line);
      const perpD = d.perp();
      const perpLine = new GeoLine(pos, pos.add(perpD));
      perpLine.setStyle({ ...this.ctx.style, color: '#d93025' });
      this.ctx.history.execute(new AddObjectCommand(perpLine, this.ctx.objects));
      this.line = null;
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') { this.line = null; this.ctx.renderAll(); }
  }

  _findLine(pos) {
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'line' || obj.type === 'segment' || obj.type === 'ray') {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit) return obj;
      }
    }
    return null;
  }

  _getLineDirection(obj) {
    if (obj.type === 'line' || obj.type === 'segment') return obj.p2.sub(obj.p1);
    if (obj.type === 'ray') return obj.direction;
    return new Vec2(1, 0);
  }

  _getLinePoint(obj) {
    if (obj.type === 'line' || obj.type === 'segment') return obj.p1;
    if (obj.type === 'ray') return obj.origin;
    return new Vec2(0, 0);
  }

  activate() { this.line = null; }
  deactivate() { this.line = null; }
}


// ============================================================
// Parallel Line Tool
// ============================================================

export class ParallelTool extends BaseTool {
  get name() { return 'parallel'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击一条已知直线，再点击一个点 — 过该点作平行线'; }

  constructor(ctx) {
    super(ctx);
    this.line = null;
  }

  onMouseDown(pos, event) {
    if (!this.line) {
      const hit = this._findLine(pos);
      if (hit) this.line = hit;
    } else {
      const d = this._getLineDirection(this.line);
      const paraLine = new GeoLine(pos, pos.add(d));
      paraLine.setStyle({ ...this.ctx.style, color: '#188038' });
      this.ctx.history.execute(new AddObjectCommand(paraLine, this.ctx.objects));
      this.line = null;
    }
    this.ctx.renderAll();
  }

  _findLine(pos) {
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'line' || obj.type === 'segment' || obj.type === 'ray') {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit) return obj;
      }
    }
    return null;
  }

  _getLineDirection(obj) {
    if (obj.type === 'line' || obj.type === 'segment') return obj.p2.sub(obj.p1);
    if (obj.type === 'ray') return obj.direction;
    return new Vec2(1, 0);
  }

  onKeyDown(event) {
    if (event.key === 'Escape') { this.line = null; this.ctx.renderAll(); }
  }

  activate() { this.line = null; }
  deactivate() { this.line = null; }
}


// ============================================================
// Midpoint Tool
// ============================================================

export class MidpointTool extends BaseTool {
  get name() { return 'midpoint'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '依次点击两个点，或点击一条线段 — 创建中点'; }

  constructor(ctx) {
    super(ctx);
    this.points = [];
  }

  onMouseDown(pos, event) {
    // Try to snap to existing points
    const snapped = this._findPoint(pos);
    const p = snapped || pos.clone();
    this.points.push(p);

    if (this.points.length === 2) {
      const mid = Vec2.midpoint(this.points[0], this.points[1]);
      const point = new GeoPoint(mid.x, mid.y);
      point.setStyle({ ...this.ctx.style, color: '#d93025', fill: '#d93025' });
      point.label = '中点';
      this.ctx.history.execute(new AddObjectCommand(point, this.ctx.objects));
      this.points = [];
    }
    this.ctx.renderAll();
  }

  _findPoint(pos) {
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'point') {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit) return obj.pos;
      }
    }
    return null;
  }

  onKeyDown(event) {
    if (event.key === 'Escape') { this.points = []; this.ctx.renderAll(); }
  }

  activate() { this.points = []; }
  deactivate() { this.points = []; }
}


// ============================================================
// Angle Bisector Tool
// ============================================================

export class AngleBisectorTool extends BaseTool {
  get name() { return 'angle-bisector'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '依次点击：角顶点 → 第一条边的点 → 第二条边的点'; }

  constructor(ctx) {
    super(ctx);
    this.points = [];
  }

  onMouseDown(pos, event) {
    this.points.push(pos.clone());
    if (this.points.length === 3) {
      // Bisector direction = normalized(BA + BC)
      const ba = this.points[1].sub(this.points[0]).normalize();
      const bc = this.points[2].sub(this.points[0]).normalize();
      const bisector = ba.add(bc).normalize();
      const farPoint = this.points[0].add(bisector);
      const line = new GeoLine(this.points[0], farPoint);
      line.setStyle({ ...this.ctx.style, color: '#d93025' });
      this.ctx.history.execute(new AddObjectCommand(line, this.ctx.objects));
      this.points = [];
    }
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') { this.points = []; this.ctx.renderAll(); }
  }

  activate() { this.points = []; }
  deactivate() { this.points = []; }
}


// ============================================================
// Perpendicular Bisector Tool
// ============================================================

export class PerpendicularBisectorTool extends BaseTool {
  get name() { return 'perp-bisector'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击一条线段 — 创建该线段的垂直平分线'; }

  onMouseDown(pos, event) {
    // Find a clicked segment
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'segment') {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit) {
          const mid = Vec2.midpoint(obj.p1, obj.p2);
          const dir = obj.p2.sub(obj.p1).perp();
          const perpLine = new GeoLine(mid, mid.add(dir));
          perpLine.setStyle({ ...this.ctx.style, color: '#d93025' });
          perpLine.label = '垂直平分线';
          this.ctx.history.execute(new AddObjectCommand(perpLine, this.ctx.objects));
          this.ctx.renderAll();
          return;
        }
      }
    }
  }
}


// ============================================================
// Measure Distance Tool
// ============================================================

export class MeasureDistanceTool extends BaseTool {
  get name() { return 'measure-distance'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击两个点测量距离'; }

  constructor(ctx) {
    super(ctx);
    this.points = [];
  }

  onMouseDown(pos, event) {
    const snapped = this._findPoint(pos);
    this.points.push(snapped || pos.clone());

    if (this.points.length === 2) {
      const dist = Vec2.distance(this.points[0], this.points[1]);
      const measurement = new GeoMeasurement('distance', this.points, dist, '');
      measurement.label = `${formatNum(dist)}`;
      this.ctx.history.execute(new AddObjectCommand(measurement, this.ctx.objects));
      this.points = [];
    }
    this.ctx.renderAll();
  }

  _findPoint(pos) {
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'point') {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit) return obj.pos;
      }
    }
    return null;
  }

  onKeyDown(event) {
    if (event.key === 'Escape') { this.points = []; this.ctx.renderAll(); }
  }

  activate() { this.points = []; }
  deactivate() { this.points = []; }
}


// ============================================================
// Measure Angle Tool
// ============================================================

export class MeasureAngleTool extends BaseTool {
  get name() { return 'measure-angle'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击三点测量角度（第二个点为角顶点）'; }

  constructor(ctx) {
    super(ctx);
    this.points = [];
  }

  onMouseDown(pos, event) {
    const snapped = this._findPoint(pos);
    this.points.push(snapped || pos.clone());

    if (this.points.length === 3) {
      const ang = angleABC(this.points[0], this.points[1], this.points[2]);
      const angDeg = ang * 180 / Math.PI;
      const measurement = new GeoMeasurement('angle', this.points, angDeg, '°');
      measurement.label = `${formatNum(angDeg)}°`;
      this.ctx.history.execute(new AddObjectCommand(measurement, this.ctx.objects));
      this.points = [];
    }
    this.ctx.renderAll();
  }

  _findPoint(pos) {
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'point') {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit) return obj.pos;
      }
    }
    return null;
  }

  onKeyDown(event) {
    if (event.key === 'Escape') { this.points = []; this.ctx.renderAll(); }
  }

  activate() { this.points = []; }
  deactivate() { this.points = []; }
}


// ============================================================
// Measure Area Tool
// ============================================================

export class MeasureAreaTool extends BaseTool {
  get name() { return 'measure-area'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '点击一个多边形测量面积'; }

  onMouseDown(pos, event) {
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'polygon' && obj.closed && obj.vertices.length >= 3) {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit && result.inside) {
          const area = Math.abs(polygonArea(obj.vertices));
          const measurement = new GeoMeasurement('area', [...obj.vertices], area, '');
          measurement.label = `${formatNum(area)} 平方单位`;
          this.ctx.history.execute(new AddObjectCommand(measurement, this.ctx.objects));
          this.ctx.renderAll();
          return;
        }
      }
    }
  }
}


// ============================================================
// Translate Tool
// ============================================================

export class TranslateTool extends BaseTool {
  get name() { return 'translate'; }
  get cursor() { return 'move'; }
  get statusHint() { return '选择对象后，拖动进行平移'; }

  constructor(ctx) {
    super(ctx);
    this.dragging = false;
    this.dragStart = null;
    this.dragObjs = [];
    this._totalDelta = null;
  }

  onMouseDown(pos, event) {
    if (this.ctx.selectedObjects.length === 0) {
      const hit = this._findHit(pos);
      if (hit) {
        this.ctx.selectedObjects = [hit];
      } else {
        return;
      }
    }

    this.dragging = true;
    this.dragStart = pos.clone();
    this.dragObjs = this.ctx.selectedObjects.filter(o => !o.locked);
    this._totalDelta = new Vec2(0, 0);
  }

  onMouseMove(pos, event) {
    if (!this.dragging || !this.dragStart) return;
    const delta = pos.sub(this.dragStart);
    this._totalDelta = this._totalDelta.add(delta);
    for (const obj of this.dragObjs) {
      obj.moveBy(delta);
    }
    this.dragStart = pos.clone();
  }

  onMouseUp(pos, event) {
    if (this.dragging && this.dragObjs.length > 0) {
      const moved = this._totalDelta && this._totalDelta.length() > 0.001;
      if (moved) {
        const reverse = this._totalDelta.scale(-1);
        for (const obj of this.dragObjs) obj.moveBy(reverse);
        const batch = this.dragObjs.map(obj => new MoveObjectCommand(obj, this._totalDelta));
        this.ctx.history.execute(batch.length === 1 ? batch[0] : new BatchCommand(batch));
      }
    }
    this.dragging = false;
    this.dragStart = null;
    this.dragObjs = [];
    this._totalDelta = null;
    this.ctx.renderAll();
  }

  _findHit(pos) {
    let best = null, bestDist = Infinity;
    for (const obj of this.ctx.objects) {
      if (!obj.visible || obj.locked) continue;
      const result = obj.hitTest(pos, this.ctx.canvas);
      if (result.hit && result.distance < bestDist) {
        best = obj;
        bestDist = result.distance;
      }
    }
    return best;
  }
}


// ============================================================
// Rotate Tool
// ============================================================

export class RotateTool extends BaseTool {
  get name() { return 'rotate'; }
  get cursor() { return 'crosshair'; }
  get statusHint() {
    if (this.ctx.selectedObjects.length === 0) return '第一步：点击选择要旋转的对象';
    if (!this.center) return '第二步：点击设置旋转中心';
    return '第三步：拖动旋转 | Shift吸附15° | Esc取消';
  }

  constructor(ctx) {
    super(ctx);
    this.center = null;
    this.startAngle = null;
    this.currentAngle = 0;
    this.objectsToRotate = [];
    this.startData = [];
    this.dragging = false;
  }

  onMouseDown(pos, event) {
    // 第一步：还没选中对象时，点击选中
    if (this.ctx.selectedObjects.length === 0) {
      const hit = this._findHit(pos);
      if (hit) {
        this.ctx.selectedObjects = [hit];
        this.ctx.renderAll();
      }
      return;
    }

    // 第二步：已选中对象，点击设置旋转中心
    if (!this.center) {
      this.center = pos.clone();
      this.objectsToRotate = this.ctx.selectedObjects.filter(o => !o.locked && ROTATABLE_TYPES.has(o.type));
      this.startData = this.objectsToRotate.map(o => ({ obj: o, data: o.serialize() }));
      this.startAngle = null;
      this.dragging = false;
      this.ctx.renderAll();
      return;
    }
  }

  onMouseMove(pos, event) {
    if (!this.center || this.objectsToRotate.length === 0) return;
    const currentAngle = Math.atan2(pos.y - this.center.y, pos.x - this.center.x);
    if (!this.dragging) {
      // 按住左键拖动才开始旋转，避免设置中心后鼠标划过就误触发
      if (!(event.buttons & 1)) return;
      this.startAngle = currentAngle;
      this.dragging = true;
      return;
    }

    let deltaAngle = currentAngle - this.startAngle;
    // Shift键吸附到15度
    if (event.shiftKey) {
      const snap = Math.PI / 12; // 15°
      deltaAngle = Math.round(deltaAngle / snap) * snap;
    }
    this.currentAngle = deltaAngle;

    // 从原始状态重新旋转，避免累积误差
    for (const { obj, data } of this.startData) {
      this._restoreObject(obj, data);
      this._rotateObject(obj, this.center, deltaAngle);
    }
  }

  onMouseUp(pos, event) {
    if (!this.dragging) {
      // 只是设置旋转中心的点击：保留 center，等待下一步拖动旋转
      this.ctx.renderAll();
      return;
    }
    if (this.startData.length > 0 && Math.abs(this.currentAngle) > 0.001) {
      const batch = this.startData.map(({ obj, data }) => {
        return new ModifyObjectCommand(obj, data, obj.serialize());
      });
      this.ctx.history.execute(batch.length === 1 ? batch[0] : new BatchCommand(batch));
    }
    // 旋转完成，重置状态，但保留选中对象，方便连续操作
    this.center = null;
    this.startAngle = null;
    this.currentAngle = 0;
    this.objectsToRotate = [];
    this.startData = [];
    this.dragging = false;
    this.ctx.renderAll();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      // 恢复原始状态
      for (const { obj, data } of this.startData) {
        this._restoreObject(obj, data);
      }
      this.center = null;
      this.startAngle = null;
      this.currentAngle = 0;
      this.objectsToRotate = [];
      this.startData = [];
      this.dragging = false;
      this.ctx.selectedObjects = [];
      this.ctx.renderAll();
    }
  }

  _restoreObject(obj, data) {
    // 从序列化数据恢复对象关键属性
    switch (obj.type) {
      case 'point':
        obj.pos = new Vec2(data.x, data.y);
        break;
      case 'segment':
      case 'line':
        obj.p1 = new Vec2(data.p1.x, data.p1.y);
        obj.p2 = new Vec2(data.p2.x, data.p2.y);
        break;
      case 'ray':
        obj.origin = new Vec2(data.origin.x, data.origin.y);
        obj.direction = new Vec2(data.direction.x, data.direction.y);
        break;
      case 'circle':
        obj.center = new Vec2(data.center.x, data.center.y);
        break;
      case 'polygon':
        obj.vertices = data.vertices.map(v => new Vec2(v.x, v.y));
        break;
      case 'angle':
        obj.vertex = new Vec2(data.vertex.x, data.vertex.y);
        obj.pointA = new Vec2(data.pointA.x, data.pointA.y);
        obj.pointB = new Vec2(data.pointB.x, data.pointB.y);
        break;
      case 'text':
        obj.position = new Vec2(data.position.x, data.position.y);
        break;
    }
  }

  _rotateObject(obj, center, angle) {
    switch (obj.type) {
      case 'point':
        obj.pos = this._rotatePoint(obj.pos, center, angle);
        break;
      case 'segment':
      case 'line':
        obj.p1 = this._rotatePoint(obj.p1, center, angle);
        obj.p2 = this._rotatePoint(obj.p2, center, angle);
        break;
      case 'ray':
        obj.origin = this._rotatePoint(obj.origin, center, angle);
        obj.direction = obj.direction.rotate(angle);
        break;
      case 'circle':
        obj.center = this._rotatePoint(obj.center, center, angle);
        break;
      case 'polygon':
        for (let i = 0; i < obj.vertices.length; i++) {
          obj.vertices[i] = this._rotatePoint(obj.vertices[i], center, angle);
        }
        break;
      case 'angle':
        obj.vertex = this._rotatePoint(obj.vertex, center, angle);
        obj.pointA = this._rotatePoint(obj.pointA, center, angle);
        obj.pointB = this._rotatePoint(obj.pointB, center, angle);
        break;
      case 'text':
        obj.position = this._rotatePoint(obj.position, center, angle);
        break;
    }
  }

  _rotatePoint(p, center, angle) {
    return p.sub(center).rotate(angle).add(center);
  }

  _findHit(pos) {
    let best = null, bestDist = Infinity;
    for (const obj of this.ctx.objects) {
      if (!obj.visible || obj.locked) continue;
      const result = obj.hitTest(pos, this.ctx.canvas);
      if (result.hit && result.distance < bestDist) {
        best = obj;
        bestDist = result.distance;
      }
    }
    return best;
  }

  activate() {
    this.center = null;
    this.objectsToRotate = [];
    this.startData = [];
    this.dragging = false;
  }
  deactivate() {
    this.center = null;
    this.objectsToRotate = [];
    this.startData = [];
    this.dragging = false;
  }
}


// ============================================================
// Reflect Tool
// ============================================================

export class ReflectTool extends BaseTool {
  get name() { return 'reflect'; }
  get cursor() { return 'crosshair'; }
  get statusHint() { return '选择要镜像的对象，点击镜像线（直线或线段）'; }

  onMouseDown(pos, event) {
    if (this.ctx.selectedObjects.length === 0) {
      // Try to select
      const hit = this._findHit(pos);
      if (hit) this.ctx.selectedObjects = [hit];
      this.ctx.renderAll();
      return;
    }

    // Find a line to reflect across
    const mirrorLine = this._findLine(pos);
    if (!mirrorLine) return;

    const d = this._getLineDirection(mirrorLine);
    const lineP = this._getLinePoint(mirrorLine);

    const newObjects = [];
    for (const obj of this.ctx.selectedObjects) {
      if (obj.locked) continue;
      const reflected = this._reflectObject(obj, lineP, d);
      if (reflected) {
        reflected.setStyle({ ...obj.style });
        newObjects.push(reflected);
      }
    }

    if (newObjects.length > 0) {
      const cmds = newObjects.map(o => new AddObjectCommand(o, this.ctx.objects));
      this.ctx.history.execute(cmds.length === 1 ? cmds[0] : new BatchCommand(cmds));
    }
    this.ctx.renderAll();
  }

  _findLine(pos) {
    for (const obj of this.ctx.objects) {
      if (!obj.visible) continue;
      if (obj.type === 'line' || obj.type === 'segment') {
        const result = obj.hitTest(pos, this.ctx.canvas);
        if (result.hit) return obj;
      }
    }
    return null;
  }

  _getLineDirection(obj) {
    if (obj.type === 'line' || obj.type === 'segment') return obj.p2.sub(obj.p1);
    return new Vec2(1, 0);
  }

  _getLinePoint(obj) {
    if (obj.type === 'line' || obj.type === 'segment') return obj.p1;
    return new Vec2(0, 0);
  }

  _reflectObject(obj, lineP, lineD) {
    switch (obj.type) {
      case 'point': {
        const rp = Vec2.reflect(obj.pos, lineP, lineD);
        return new GeoPoint(rp.x, rp.y);
      }
      case 'segment': {
        const rp1 = Vec2.reflect(obj.p1, lineP, lineD);
        const rp2 = Vec2.reflect(obj.p2, lineP, lineD);
        return new GeoSegment(rp1, rp2);
      }
      case 'circle': {
        const rc = Vec2.reflect(obj.center, lineP, lineD);
        return new GeoCircle(rc, obj.radius);
      }
      case 'polygon': {
        const rv = obj.vertices.map(v => Vec2.reflect(v, lineP, lineD));
        return new GeoPolygon(rv);
      }
      case 'line': {
        const rp1 = Vec2.reflect(obj.p1, lineP, lineD);
        const rp2 = Vec2.reflect(obj.p2, lineP, lineD);
        return new GeoLine(rp1, rp2);
      }
      default:
        return null;
    }
  }

  _findHit(pos) {
    let best = null, bestDist = Infinity;
    for (const obj of this.ctx.objects) {
      if (!obj.visible || obj.locked) continue;
      const result = obj.hitTest(pos, this.ctx.canvas);
      if (result.hit && result.distance < bestDist) {
        best = obj;
        bestDist = result.distance;
      }
    }
    return best;
  }
}


// ============================================================
// Tool Registry
// ============================================================

export const TOOL_MAP = {
  'select': SelectTool,
  'point': PointTool,
  'segment': SegmentTool,
  'line': LineTool,
  'ray': RayTool,
  'circle': CircleTool,
  'polygon': PolygonTool,
  'function': FunctionTool,
  'angle-draw': AngleTool,
  'text': TextTool,
  'perpendicular': PerpendicularTool,
  'parallel': ParallelTool,
  'midpoint': MidpointTool,
  'angle-bisector': AngleBisectorTool,
  'perp-bisector': PerpendicularBisectorTool,
  'measure-distance': MeasureDistanceTool,
  'measure-angle': MeasureAngleTool,
  'measure-area': MeasureAreaTool,
  'translate': TranslateTool,
  'rotate': RotateTool,
  'reflect': ReflectTool,
};

/**
 * Create a tool instance by name
 */
export function createTool(name, context) {
  const ToolClass = TOOL_MAP[name];
  if (!ToolClass) {
    console.warn('Unknown tool:', name);
    return new SelectTool(context);
  }
  return new ToolClass(context);
}
