// Objects.js - Geometry object classes and rendering

import { Vec2, formatNum } from './Geometry.js';

let _nextId = 1;
export function generateId() { return `obj_${_nextId++}`; }

// ============================================================
// Base Class
// ============================================================

export class GeoObject {
  constructor(type) {
    this.id = generateId();
    this.type = type;
    this.style = {
      color: '#1a73e8',
      lineWidth: 2,
      fill: 'transparent',
      fillOpacity: 0,      // 封闭图形默认不填充
      lineStyle: 'solid',  // 'solid' | 'dashed' | 'dotted'
    };
    this.visible = true;
    this.locked = false;
    this.label = '';
  }

  setStyle(style) {
    Object.assign(this.style, style);
    return this;
  }

  /**
   * Draw this object to the canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./Canvas.js').CanvasManager} cm
   */
  draw(ctx, cm) {
    // Subclasses override
  }

  /**
   * Hit test: is the given world position "close enough" to this object?
   * @param {Vec2} worldPos
   * @param {import('./Canvas.js').CanvasManager} cm
   * @returns {{ hit: boolean, distance: number }}
   */
  hitTest(worldPos, cm) {
    return { hit: false, distance: Infinity };
  }

  /**
   * Get world-space bounding box
   * @returns {{ minX: number, maxX: number, minY: number, maxY: number }}
   */
  getBounds() {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  /**
   * Move this object by a world-space delta
   */
  moveBy(delta) {
    // Subclasses override
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      style: { ...this.style },
      visible: this.visible,
      locked: this.locked,
      label: this.label,
    };
  }

  // --- Drawing helpers ---

  _applyStyle(ctx, cm) {
    ctx.strokeStyle = this.style.color;
    ctx.fillStyle = this.style.fill;
    ctx.lineWidth = this.style.lineWidth;
    ctx.globalAlpha = 1;
    switch (this.style.lineStyle) {
      case 'dashed': ctx.setLineDash([8, 4]); break;
      case 'dotted': ctx.setLineDash([2, 4]); break;
      default: ctx.setLineDash([]);
    }
  }

  _worldToScreen(p, cm) { return cm.worldToScreen(p); }

  /**
   * 标签颜色：画布是深色主题，导出白底图像（cm.lightMode）时改用深色
   */
  _labelColor(cm) {
    return cm && cm.lightMode ? '#333' : 'rgba(232, 232, 240, 0.92)';
  }
}


// ============================================================
// Point
// ============================================================

export class GeoPoint extends GeoObject {
  constructor(x, y) {
    super('point');
    this.pos = new Vec2(x, y);
    this.style.fill = this.style.color;
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    const s = cm.worldToScreen(this.pos);
    const r = 5;
    ctx.fillStyle = this.style.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (this.label) {
      ctx.fillStyle = this._labelColor(cm);
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.label, s.x + 8, s.y - 6);
    }
  }

  hitTest(worldPos, cm) {
    const d = Vec2.distance(worldPos, this.pos);
    const threshold = cm.screenToWorldDist(12);
    return { hit: d < threshold, distance: d };
  }

  getBounds() {
    return { minX: this.pos.x, maxX: this.pos.x, minY: this.pos.y, maxY: this.pos.y };
  }

  moveBy(delta) {
    this.pos = this.pos.add(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      x: this.pos.x,
      y: this.pos.y,
    };
  }
}


// ============================================================
// Segment
// ============================================================

export class GeoSegment extends GeoObject {
  constructor(p1, p2) {
    super('segment');
    this.p1 = p1.clone();
    this.p2 = p2.clone();
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    this._applyStyle(ctx, cm);
    const s1 = cm.worldToScreen(this.p1);
    const s2 = cm.worldToScreen(this.p2);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();

    if (this.label) {
      const mid = cm.worldToScreen(Vec2.midpoint(this.p1, this.p2));
      ctx.fillStyle = this._labelColor(cm);
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.setLineDash([]);
      ctx.fillText(this.label, mid.x, mid.y - 6);
    }
  }

  hitTest(worldPos, cm) {
    const d = Vec2.distanceToSegment(worldPos, this.p1, this.p2);
    const threshold = cm.screenToWorldDist(4);
    return { hit: d < threshold, distance: d };
  }

  getBounds() {
    return {
      minX: Math.min(this.p1.x, this.p2.x),
      maxX: Math.max(this.p1.x, this.p2.x),
      minY: Math.min(this.p1.y, this.p2.y),
      maxY: Math.max(this.p1.y, this.p2.y),
    };
  }

  getLength() { return Vec2.distance(this.p1, this.p2); }
  getMidpoint() { return Vec2.midpoint(this.p1, this.p2); }

  moveBy(delta) {
    this.p1 = this.p1.add(delta);
    this.p2 = this.p2.add(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      p1: { x: this.p1.x, y: this.p1.y },
      p2: { x: this.p2.x, y: this.p2.y },
    };
  }
}


// ============================================================
// Line (infinite)
// ============================================================

export class GeoLine extends GeoObject {
  constructor(p1, p2) {
    super('line');
    this.p1 = p1.clone();
    this.p2 = p2.clone();
  }

  getDirection() { return this.p2.sub(this.p1); }

  draw(ctx, cm) {
    if (!this.visible) return;
    this._applyStyle(ctx, cm);
    const d = this.getDirection();
    const bounds = cm.getVisibleBounds();
    // Extend line across visible area
    const points = this._clipToRect(bounds, cm);
    if (points.length < 2) return;
    const s1 = cm.worldToScreen(points[0]);
    const s2 = cm.worldToScreen(points[1]);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();

    if (this.label) {
      const mid = cm.worldToScreen(Vec2.midpoint(this.p1, this.p2));
      ctx.fillStyle = this._labelColor(cm);
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.setLineDash([]);
      ctx.fillText(this.label, mid.x, mid.y - 6);
    }
  }

  _clipToRect(bounds, cm) {
    // Compute line in form ax + by + c = 0
    const d = this.getDirection();
    const a = -d.y, b = d.x;
    const c = -(a * this.p1.x + b * this.p1.y);
    const result = [];

    // Check intersections with the four edges
    const edges = [
      [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }], // bottom
      [{ x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }], // right
      [{ x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }], // top
      [{ x: bounds.minX, y: bounds.maxY }, { x: bounds.minX, y: bounds.minY }], // left
    ];

    for (const [e1, e2] of edges) {
      const ex = e2.x - e1.x, ey = e2.y - e1.y;
      const denom = a * ex + b * ey;
      if (Math.abs(denom) < 1e-12) continue;
      const t = -(a * e1.x + b * e1.y + c) / denom;
      if (t >= 0 && t <= 1) {
        result.push(new Vec2(e1.x + t * ex, e1.y + t * ey));
        if (result.length >= 2) break;
      }
    }
    return result;
  }

  hitTest(worldPos, cm) {
    const d = Vec2.distanceToLine(worldPos, this.p1, this.getDirection());
    const threshold = cm.screenToWorldDist(4);
    return { hit: d < threshold, distance: d };
  }

  getBounds() {
    // 返回定义点的范围（用于选中框显示）
    return {
      minX: Math.min(this.p1.x, this.p2.x),
      maxX: Math.max(this.p1.x, this.p2.x),
      minY: Math.min(this.p1.y, this.p2.y),
      maxY: Math.max(this.p1.y, this.p2.y),
    };
  }

  moveBy(delta) {
    this.p1 = this.p1.add(delta);
    this.p2 = this.p2.add(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      p1: { x: this.p1.x, y: this.p1.y },
      p2: { x: this.p2.x, y: this.p2.y },
    };
  }
}


// ============================================================
// Ray
// ============================================================

export class GeoRay extends GeoObject {
  constructor(origin, direction) {
    super('ray');
    this.origin = origin.clone();
    this.direction = direction.clone(); // Does not need to be normalized
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    this._applyStyle(ctx, cm);
    const bounds = cm.getVisibleBounds();
    const dir = this.direction.normalize();
    // 画到可见区域边缘，让箭头落在视口内
    const exit = this._exitPoint(bounds);
    const farPoint = exit || this.origin.add(dir.scale(10000 / (cm.zoom || 1)));
    const s1 = cm.worldToScreen(this.origin);
    const s2 = cm.worldToScreen(farPoint);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();

    // Arrow at end (screen-space)
    this._drawArrowHead(ctx, s2, s2.sub(s1).normalize(), 10);
  }

  /**
   * 射线沿正方向与可见区域边界的最远交点；射线不经过视口时返回 null
   */
  _exitPoint(bounds) {
    const d = this.direction;
    const a = -d.y, b = d.x;
    const c = -(a * this.origin.x + b * this.origin.y);
    const edges = [
      [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }],
      [{ x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }],
      [{ x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }],
      [{ x: bounds.minX, y: bounds.maxY }, { x: bounds.minX, y: bounds.minY }],
    ];
    let best = null, bestS = -Infinity;
    for (const [e1, e2] of edges) {
      const ex = e2.x - e1.x, ey = e2.y - e1.y;
      const denom = a * ex + b * ey;
      if (Math.abs(denom) < 1e-12) continue;
      const t = -(a * e1.x + b * e1.y + c) / denom;
      if (t < 0 || t > 1) continue;
      const p = new Vec2(e1.x + t * ex, e1.y + t * ey);
      const s = Vec2.dot(p.sub(this.origin), d) / Vec2.dot(d, d);
      if (s >= 0 && s > bestS) { bestS = s; best = p; }
    }
    return best;
  }

  _drawArrowHead(ctx, tip, dir, size) {
    const angle = Math.atan2(dir.y, dir.x);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.setLineDash([]);
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

  hitTest(worldPos, cm) {
    // 只检测可见区域内的射线部分
    const bounds = cm.getVisibleBounds();
    const dir = this.direction.normalize();
    const far = this.origin.add(dir.scale(10000 / (cm.zoom || 1)));
    const d = Vec2.distanceToSegment(worldPos, this.origin, far);
    const threshold = cm.screenToWorldDist(4);
    return { hit: d < threshold, distance: d };
  }

  getBounds() {
    return {
      minX: this.origin.x,
      maxX: this.origin.x,
      minY: this.origin.y,
      maxY: this.origin.y,
    };
  }

  moveBy(delta) {
    this.origin = this.origin.add(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      origin: { x: this.origin.x, y: this.origin.y },
      direction: { x: this.direction.x, y: this.direction.y },
    };
  }
}


// ============================================================
// Circle
// ============================================================

export class GeoCircle extends GeoObject {
  /**
   * @param {Vec2} center
   * @param {number} radius - world units
   */
  constructor(center, radius) {
    super('circle');
    this.center = center.clone();
    this.radius = radius;
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    this._applyStyle(ctx, cm);
    const s = cm.worldToScreen(this.center);
    const r = cm.worldToScreenDist(this.radius);

    // Fill
    if (this.style.fill && this.style.fillOpacity > 0) {
      ctx.globalAlpha = this.style.fillOpacity;
      ctx.fillStyle = this.style.fill;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Stroke
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = this.style.color;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fill();

    if (this.label) {
      ctx.fillStyle = this._labelColor(cm);
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.label, s.x + r + 4, s.y - r);
    }
  }

  hitTest(worldPos, cm) {
    const d = Math.abs(Vec2.distance(worldPos, this.center) - this.radius);
    const threshold = cm.screenToWorldDist(10);
    return { hit: d < threshold, distance: d };
  }

  getBounds() {
    return {
      minX: this.center.x - this.radius,
      maxX: this.center.x + this.radius,
      minY: this.center.y - this.radius,
      maxY: this.center.y + this.radius,
    };
  }

  moveBy(delta) {
    this.center = this.center.add(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      center: { x: this.center.x, y: this.center.y },
      radius: this.radius,
    };
  }
}


// ============================================================
// Polygon
// ============================================================

export class GeoPolygon extends GeoObject {
  constructor(vertices) {
    super('polygon');
    this.vertices = vertices.map(v => v.clone());
    this.closed = true;
  }

  draw(ctx, cm) {
    if (!this.visible || this.vertices.length < 2) return;
    this._applyStyle(ctx, cm);
    const screenVerts = this.vertices.map(v => cm.worldToScreen(v));

    // Fill
    if (this.closed && this.vertices.length >= 3 && this.style.fill && this.style.fillOpacity > 0) {
      ctx.globalAlpha = this.style.fillOpacity;
      ctx.fillStyle = this.style.fill;
      ctx.beginPath();
      ctx.moveTo(screenVerts[0].x, screenVerts[0].y);
      for (let i = 1; i < screenVerts.length; i++) {
        ctx.lineTo(screenVerts[i].x, screenVerts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Stroke
    ctx.beginPath();
    ctx.moveTo(screenVerts[0].x, screenVerts[0].y);
    for (let i = 1; i < screenVerts.length; i++) {
      ctx.lineTo(screenVerts[i].x, screenVerts[i].y);
    }
    if (this.closed) ctx.closePath();
    ctx.stroke();

    // Vertex dots
    ctx.fillStyle = this.style.color;
    ctx.setLineDash([]);
    for (const sv of screenVerts) {
      ctx.beginPath();
      ctx.arc(sv.x, sv.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  hitTest(worldPos, cm) {
    // Check distance to each edge
    let minDist = Infinity;
    const n = this.vertices.length;
    const end = this.closed ? n : n - 1;
    for (let i = 0; i < end; i++) {
      const j = (i + 1) % n;
      const d = Vec2.distanceToSegment(worldPos, this.vertices[i], this.vertices[j]);
      if (d < minDist) minDist = d;
    }
    // Also check if inside polygon
    let inside = false;
    if (this.closed && n >= 3) {
      inside = this._pointInPolygon(worldPos);
    }
    const threshold = cm.screenToWorldDist(10);
    return { hit: minDist < threshold || inside, distance: minDist, inside };
  }

  _pointInPolygon(point) {
    let inside = false;
    const n = this.vertices.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = this.vertices[i].x, yi = this.vertices[i].y;
      const xj = this.vertices[j].x, yj = this.vertices[j].y;
      if ((yi > point.y) !== (yj > point.y) &&
          point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  getBounds() {
    if (this.vertices.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of this.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { minX, maxX, minY, maxY };
  }

  moveBy(delta) {
    for (const v of this.vertices) {
      v.x += delta.x;
      v.y += delta.y;
    }
  }

  serialize() {
    return {
      ...super.serialize(),
      vertices: this.vertices.map(v => ({ x: v.x, y: v.y })),
      closed: this.closed,
    };
  }
}


// ============================================================
// Function Graph
// ============================================================

export class GeoFunctionGraph extends GeoObject {
  /**
   * @param {string} expression - e.g., "Math.sin(x)", "x*x", "2*x+1"
   * @param {number} domainMin
   * @param {number} domainMax
   */
  constructor(expression, domainMin = -10, domainMax = 10) {
    super('function');
    this.expression = expression;
    this.domainMin = domainMin;
    this.domainMax = domainMax;
    this._cachedPoints = null;
    this._cachedExpr = null;
    this._cachedDomain = null;
  }

  _preprocess(expr) {
    // Remove y= or f(x)= prefix
    expr = expr.replace(/^\s*y\s*=\s*/i, '');
    expr = expr.replace(/^\s*f\s*\(\s*x\s*\)\s*=\s*/i, '');
    // Replace ^ with ** for exponentiation
    expr = expr.replace(/\^/g, '**');
    return this._insertImplicitMultiplication(expr);
  }

  /**
   * Insert implicit multiplication: 2x -> 2*x, 3(x+1) -> 3*(x+1), )x -> )*x
   * 科学计数法字面量（1e3、2.5E-2）保持原样，避免被拆成 1*e3
   */
  _insertImplicitMultiplication(expr) {
    expr = expr.replace(/(\d)([a-zA-Z_(])/g, (m, digit, letter, offset, str) => {
      if ((letter === 'e' || letter === 'E') && /^[+-]?\d/.test(str.slice(offset + 2))) return m;
      return `${digit}*${letter}`;
    });
    expr = expr.replace(/\)([a-zA-Z_\d(])/g, ')*$1');
    return expr;
  }

  /**
   * 表达式安全检查：求值通过 new Function 在本地执行，
   * 只允许纯数学表达式，拒绝任何带副作用能力的 token。
   */
  _isSafe(expr) {
    return !/[;{}<>`]|=>/i.test(expr) &&
      !/\b(window|document|globalThis|fetch|XMLHttpRequest|localStorage|indexedDB|eval|Function|constructor|prototype|__proto__|import|require|process|alert|setTimeout|setInterval|new|this|while|for|do|if|let|var|const|class|function)\b/i.test(expr);
  }

  _isImplicit() {
    const cleaned = this.expression.replace(/sqrt|any|poly/gi, '');
    return /=/.test(cleaned) && /\by\b/i.test(cleaned);
  }

  _makeImplicitFn() {
    let raw = this.expression.replace(/\s/g, '');
    raw = raw.replace(/\^/g, '**');
    raw = this._insertImplicitMultiplication(raw);
    raw = raw.replace(/\by\*\*(\d+)/g, 'Math.pow(y,$1)');
    if (!this._isSafe(raw)) return null;

    const eqIdx = raw.indexOf('=');
    if (eqIdx < 0) return null;
    const left = raw.substring(0, eqIdx);
    const right = raw.substring(eqIdx + 1);

    const helpers = 'var sin=Math.sin, cos=Math.cos, tan=Math.tan, sqrt=Math.sqrt, abs=Math.abs, pow=Math.pow, log=Math.log, exp=Math.exp, pi=Math.PI;';
    try {
      return new Function('x', 'y', helpers + 'return (' + left + ')-(' + right + ');');
    } catch (e) {
      return null;
    }
  }

  _solveImplicit(x) {
    const fn = this._makeImplicitFn();
    if (!fn) return [];
    const yMin = -20, yMax = 20, steps = 200;
    const dy = (yMax - yMin) / steps;
    const solutions = [];
    let py = yMin, pv = fn(x, py);
    for (let i = 1; i <= steps; i++) {
      const cy = yMin + i * dy;
      const cv = fn(x, cy);
      if (isFinite(pv) && isFinite(cv) && pv * cv < 0) {
        let lo = py, hi = cy, fv = pv;
        for (let j = 0; j < 30; j++) {
          const mid = (lo + hi) / 2;
          const mv = fn(x, mid);
          if (!isFinite(mv)) break;
          if (fv * mv <= 0) { hi = mid; } else { lo = mid; fv = mv; }
        }
        solutions.push((lo + hi) / 2);
      }
      py = cy; pv = cv;
    }
    return solutions;
  }

  _evaluate(x) {
    if (this._isImplicit()) {
      const s = this._solveImplicit(x);
      return s.length > 0 ? s[0] : NaN;
    }
    try {
      const expr = this._preprocess(this.expression);
      if (!this._isSafe(expr)) return NaN;
      const fn = new Function('x',
        'var sin=Math.sin, cos=Math.cos, tan=Math.tan, asin=Math.asin, acos=Math.acos, atan=Math.atan;' +
        'var sqrt=Math.sqrt, abs=Math.abs, log=Math.log, log2=Math.log2, log10=Math.log10, exp=Math.exp;' +
        'var pi=Math.PI, PI=Math.PI, e=Math.E, floor=Math.floor, ceil=Math.ceil, round=Math.round;' +
        'var pow=Math.pow, sign=Math.sign;' +
        'return ' + expr + ';'
      );
      return fn(x);
    } catch (e) {
      return NaN;
    }
  }

  _samplePoints() {
    // Check cache
    const domainKey = `${this.domainMin}_${this.domainMax}`;
    if (this._cachedPoints && this._cachedExpr === this.expression && this._cachedDomain === domainKey) {
      return this._cachedPoints;
    }

    const points = [];
    const range = this.domainMax - this.domainMin;
    const step = Math.min(range / 500, 0.05);

    if (this._isImplicit()) {
      // 隐式方程：先收集所有解，再按分支分组
      const allPts = [];
      for (let x = this.domainMin; x <= this.domainMax; x += step) {
        const solutions = this._solveImplicit(x);
        for (const y of solutions) {
          allPts.push({ x, y });
        }
      }
      // 按 y 值排序后分组：y 跳变超过阈值则认为是新分支
      allPts.sort((a, b) => a.x - b.x || a.y - b.y);
      const branchThreshold = 1.0; // y 跳变阈值
      let lastPt = null;
      for (const pt of allPts) {
        if (lastPt && Math.abs(pt.x - lastPt.x) < step * 1.5 && Math.abs(pt.y - lastPt.y) > branchThreshold) {
          points.push(null); // 分支分隔
        }
        points.push(new Vec2(pt.x, pt.y));
        lastPt = pt;
      }
    } else {
      // 显式函数
      for (let x = this.domainMin; x <= this.domainMax; x += step) {
        const y = this._evaluate(x);
        if (isNaN(y) || !isFinite(y)) {
          if (points.length > 0) points.push(null);
          continue;
        }
        points.push(new Vec2(x, y));
      }
    }

    this._cachedPoints = points;
    this._cachedExpr = this.expression;
    this._cachedDomain = domainKey;
    return points;
  }

  invalidateCache() {
    this._cachedPoints = null;
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    this._applyStyle(ctx, cm);
    const points = this._samplePoints();
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      if (p === null) {
        started = false;
        continue;
      }
      const s = cm.worldToScreen(p);
      // Skip points that are way off screen
      if (s.x < -2000 || s.x > cm.getWidth() + 2000 || s.y < -2000 || s.y > cm.getHeight() + 2000) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(s.x, s.y);
        started = true;
      } else {
        ctx.lineTo(s.x, s.y);
      }
    }
    ctx.stroke();

    if (this.label) {
      // Place label at x = domainMin + 1
      const labelX = this.domainMin + 1;
      const labelY = this._evaluate(labelX);
      if (isFinite(labelY)) {
        const s = cm.worldToScreen(new Vec2(labelX, labelY));
        ctx.fillStyle = this._labelColor(cm);
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.setLineDash([]);
        ctx.fillText(this.label || `f(x)=${this.expression}`, s.x + 6, s.y - 6);
      }
    }
  }

  hitTest(worldPos, cm) {
    const points = this._samplePoints();
    let minDist = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i] === null || points[i + 1] === null) continue;
      const d = Vec2.distanceToSegment(worldPos, points[i], points[i + 1]);
      if (d < minDist) minDist = d;
    }
    const threshold = cm.screenToWorldDist(4);
    return { hit: minDist < threshold, distance: minDist };
  }

  getBounds() {
    return {
      minX: this.domainMin,
      maxX: this.domainMax,
      minY: -10,
      maxY: 10,
    };
  }

  moveBy(delta) {
    // 平移定义域实现图像水平移动（函数图像没有竖直自由度）
    this.domainMin += delta.x;
    this.domainMax += delta.x;
    this.invalidateCache();
  }

  serialize() {
    return {
      ...super.serialize(),
      expression: this.expression,
      domainMin: this.domainMin,
      domainMax: this.domainMax,
    };
  }
}


// ============================================================
// Angle drawing (arc between two rays)
// ============================================================

export class GeoAngle extends GeoObject {
  /**
   * @param {Vec2} vertex
   * @param {Vec2} pointA - point on first ray
   * @param {Vec2} pointB - point on second ray
   */
  constructor(vertex, pointA, pointB) {
    super('angle');
    this.vertex = vertex.clone();
    this.pointA = pointA.clone();
    this.pointB = pointB.clone();
  }

  getAngle() {
    return Math.abs(this.getSignedAngle());
  }

  getSignedAngle() {
    const va = this.pointA.sub(this.vertex);
    const vb = this.pointB.sub(this.vertex);
    return Math.atan2(Vec2.cross(va, vb), Vec2.dot(va, vb));
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    const sv = cm.worldToScreen(this.vertex);
    const sa = cm.worldToScreen(this.pointA);
    const sb = cm.worldToScreen(this.pointB);

    const angleA = Math.atan2(sa.y - sv.y, sa.x - sv.x);
    const angleB = Math.atan2(sb.y - sv.y, sb.x - sv.x);

    // 归一化扫过角度到 (-PI, PI]，保证画的是劣弧、与标注角度数值一致
    let sweep = angleB - angleA;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    const endA = angleA + sweep;

    // Draw arc
    const radius = 30; // Screen pixels
    ctx.strokeStyle = this.style.color;
    ctx.lineWidth = this.style.lineWidth;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(sv.x, sv.y, radius, angleA, endA, sweep < 0);
    ctx.stroke();

    // Fill arc
    if (this.style.fill && this.style.fillOpacity > 0) {
      ctx.globalAlpha = this.style.fillOpacity;
      ctx.fillStyle = this.style.fill;
      ctx.beginPath();
      ctx.moveTo(sv.x, sv.y);
      ctx.arc(sv.x, sv.y, radius, angleA, endA, sweep < 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Label
    const labelAngle = angleA + sweep / 2;
    const labelR = radius + 16;
    const labelPos = new Vec2(
      sv.x + labelR * Math.cos(labelAngle),
      sv.y + labelR * Math.sin(labelAngle)
    );
    const angleDeg = this.getAngle() * 180 / Math.PI;
    ctx.fillStyle = this._labelColor(cm);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label || `${angleDeg.toFixed(1)}°`, labelPos.x, labelPos.y);
  }

  hitTest(worldPos, cm) {
    // Check if near the vertex or near the arc
    const dVertex = Vec2.distance(worldPos, this.vertex);
    const threshold = cm.screenToWorldDist(15);
    return { hit: dVertex < threshold, distance: dVertex };
  }

  getBounds() {
    const minX = Math.min(this.vertex.x, this.pointA.x, this.pointB.x);
    const maxX = Math.max(this.vertex.x, this.pointA.x, this.pointB.x);
    const minY = Math.min(this.vertex.y, this.pointA.y, this.pointB.y);
    const maxY = Math.max(this.vertex.y, this.pointA.y, this.pointB.y);
    return { minX, maxX, minY, maxY };
  }

  moveBy(delta) {
    this.vertex = this.vertex.add(delta);
    this.pointA = this.pointA.add(delta);
    this.pointB = this.pointB.add(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      vertex: { x: this.vertex.x, y: this.vertex.y },
      pointA: { x: this.pointA.x, y: this.pointA.y },
      pointB: { x: this.pointB.x, y: this.pointB.y },
    };
  }
}


// ============================================================
// Text label
// ============================================================

export class GeoText extends GeoObject {
  constructor(position, content = '') {
    super('text');
    this.position = position.clone();
    this.content = content;
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    const s = cm.worldToScreen(this.position);
    ctx.fillStyle = this.style.color;
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.setLineDash([]);
    ctx.fillText(this.content, s.x, s.y);
  }

  hitTest(worldPos, cm) {
    const d = Vec2.distance(worldPos, this.position);
    const threshold = cm.screenToWorldDist(20);
    return { hit: d < threshold, distance: d };
  }

  getBounds() {
    return {
      minX: this.position.x,
      maxX: this.position.x + 2,
      minY: this.position.y,
      maxY: this.position.y + 1,
    };
  }

  moveBy(delta) {
    this.position = this.position.add(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      position: { x: this.position.x, y: this.position.y },
      content: this.content,
    };
  }
}


// ============================================================
// Measurement (distance, angle, area)
// ============================================================

export class GeoMeasurement extends GeoObject {
  /**
   * @param {string} measureType - 'distance' | 'angle' | 'area'
   * @param {Vec2[]} points - reference points
   * @param {number} value - the measured value
   * @param {string} unit
   */
  constructor(measureType, points, value, unit = '') {
    super('measurement');
    this.measureType = measureType;
    this.points = points.map(p => p.clone());
    this.value = value;
    this.unit = unit;
  }

  draw(ctx, cm) {
    if (!this.visible) return;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#e37400';
    ctx.lineWidth = 1.2;
    ctx.fillStyle = '#e37400';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    switch (this.measureType) {
      case 'distance': {
        if (this.points.length < 2) return;
        const s1 = cm.worldToScreen(this.points[0]);
        const s2 = cm.worldToScreen(this.points[1]);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();

        const mid = Vec2.midpoint(s1, s2);
        ctx.setLineDash([]);
        ctx.fillText(`${formatNum(this.value)}`, mid.x, mid.y - 8);
        break;
      }
      case 'angle': {
        if (this.points.length < 3) return;
        const sv = cm.worldToScreen(this.points[1]); // vertex is middle point
        const s1 = cm.worldToScreen(this.points[0]);
        const s2 = cm.worldToScreen(this.points[2]);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(sv.x, sv.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();

        const angleA = Math.atan2(s1.y - sv.y, s1.x - sv.x);
        const angleB = Math.atan2(s2.y - sv.y, s2.x - sv.x);
        let sweep = angleB - angleA;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep <= -Math.PI) sweep += 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(sv.x, sv.y, 25, angleA, angleA + sweep, sweep < 0);
        ctx.stroke();

        const labelAngle = angleA + sweep / 2;
        const labelPos = new Vec2(sv.x + 38 * Math.cos(labelAngle), sv.y + 38 * Math.sin(labelAngle));
        ctx.setLineDash([]);
        ctx.fillText(`${formatNum(this.value)}°`, labelPos.x, labelPos.y);
        break;
      }
      case 'area': {
        if (this.points.length < 3) return;
        ctx.beginPath();
        const s0 = cm.worldToScreen(this.points[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < this.points.length; i++) {
          const si = cm.worldToScreen(this.points[i]);
          ctx.lineTo(si.x, si.y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#e37400';
        ctx.fill();
        ctx.globalAlpha = 1;

        // Label in center of polygon
        const center = this._getCenter();
        const sc = cm.worldToScreen(center);
        ctx.setLineDash([]);
        ctx.fillText(`${formatNum(this.value)} 平方单位`, sc.x, sc.y);
        break;
      }
    }
  }

  _getCenter() {
    let cx = 0, cy = 0;
    for (const p of this.points) { cx += p.x; cy += p.y; }
    return new Vec2(cx / this.points.length, cy / this.points.length);
  }

  hitTest(worldPos, cm) {
    const center = this._getCenter();
    const d = Vec2.distance(worldPos, center);
    const threshold = cm.screenToWorldDist(30);
    return { hit: d < threshold, distance: d };
  }

  moveBy(delta) {
    for (const p of this.points) p.iadd(delta);
  }

  serialize() {
    return {
      ...super.serialize(),
      measureType: this.measureType,
      points: this.points.map(p => ({ x: p.x, y: p.y })),
      value: this.value,
      unit: this.unit,
    };
  }
}
