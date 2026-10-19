// Geometry.js - Vector math and geometric utilities

/**
 * 2D Vector with immutable and mutable operations
 */
export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // --- Immutable operations (return new Vec2) ---

  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s) { return new Vec2(this.x * s, this.y * s); }
  neg() { return new Vec2(-this.x, -this.y); }
  perp() { return new Vec2(-this.y, this.x); }  // Rotate 90° CCW
  normalize() {
    const len = this.length();
    if (len < 1e-12) return new Vec2(0, 0);
    return this.scale(1 / len);
  }
  rotate(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  // --- Mutable operations (modify in place) ---

  set(x, y) { this.x = x; this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  iadd(v) { this.x += v.x; this.y += v.y; return this; }
  isub(v) { this.x -= v.x; this.y -= v.y; return this; }
  iscale(s) { this.x *= s; this.y *= s; return this; }

  // --- Properties ---

  length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  angle() { return Math.atan2(this.y, this.x); }

  // --- Static utilities ---

  static fromAngle(angle, length = 1) {
    return new Vec2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  static dot(a, b) { return a.x * b.x + a.y * b.y; }
  static cross(a, b) { return a.x * b.y - a.y * b.x; }  // Scalar cross in 2D
  static distance(a, b) { return a.sub(b).length(); }
  static distanceSq(a, b) { return a.sub(b).lengthSq(); }
  static midpoint(a, b) { return new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2); }
  static lerp(a, b, t) { return a.add(b.sub(a).scale(t)); }

  /**
   * Angle from a to b (signed, CCW positive)
   */
  static angleBetween(a, b) {
    return Math.atan2(Vec2.cross(a, b), Vec2.dot(a, b));
  }

  /**
   * Project point p onto line through a with direction d
   */
  static projectOntoLine(p, a, d) {
    const ap = p.sub(a);
    const t = Vec2.dot(ap, d) / Vec2.dot(d, d);
    return a.add(d.scale(t));
  }

  /**
   * Closest point on segment ab to point p
   */
  static closestOnSegment(p, a, b) {
    const ab = b.sub(a);
    const ap = p.sub(a);
    let t = Vec2.dot(ap, ab) / Vec2.dot(ab, ab);
    t = Math.max(0, Math.min(1, t));
    return a.add(ab.scale(t));
  }

  /**
   * Distance from point p to segment ab
   */
  static distanceToSegment(p, a, b) {
    return Vec2.distance(p, Vec2.closestOnSegment(p, a, b));
  }

  /**
   * Distance from point p to line through a with direction d
   */
  static distanceToLine(p, a, d) {
    return Math.abs(Vec2.cross(p.sub(a), d)) / d.length();
  }

  /**
   * Reflect point p across line through a with direction d
   */
  static reflect(p, a, d) {
    const proj = Vec2.projectOntoLine(p, a, d);
    return proj.scale(2).sub(p);
  }

  clone() { return new Vec2(this.x, this.y); }
  equals(v, tol = 1e-9) { return Math.abs(this.x - v.x) < tol && Math.abs(this.y - v.y) < tol; }
  toString() { return `(${this.x.toFixed(4)}, ${this.y.toFixed(4)})`; }
}

/**
 * Line-line intersection. Returns Vec2 or null.
 * line1: {p: Vec2, d: Vec2} (point + direction)
 * line2: {p: Vec2, d: Vec2}
 */
export function intersectLineLine(line1, line2) {
  const cross = Vec2.cross(line1.d, line2.d);
  if (Math.abs(cross) < 1e-12) return null; // Parallel
  const t = Vec2.cross(line2.p.sub(line1.p), line2.d) / cross;
  return line1.p.add(line1.d.scale(t));
}

/**
 * Segment-segment intersection. Returns Vec2 or null.
 */
export function intersectSegmentSegment(a1, b1, a2, b2) {
  const d1 = b1.sub(a1), d2 = b2.sub(a2);
  const cross = Vec2.cross(d1, d2);
  if (Math.abs(cross) < 1e-12) return null;
  const t = Vec2.cross(a2.sub(a1), d2) / cross;
  const u = Vec2.cross(a2.sub(a1), d1) / cross;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return a1.add(d1.scale(Math.max(0, Math.min(1, t))));
}

/**
 * Line-circle intersection. Returns array of Vec2 (0, 1, or 2 points).
 */
export function intersectLineCircle(lineP, lineD, center, radius) {
  const f = lineP.sub(center);
  const a = Vec2.dot(lineD, lineD);
  const b = 2 * Vec2.dot(f, lineD);
  const c = Vec2.dot(f, f) - radius * radius;
  let disc = b * b - 4 * a * c;
  if (disc < -1e-12) return [];
  if (disc < 1e-12) disc = 0;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  if (disc === 0) return [lineP.add(lineD.scale(t1))];
  return [lineP.add(lineD.scale(t1)), lineP.add(lineD.scale(t2))];
}

/**
 * Circle-circle intersection. Returns array of Vec2 (0, 1, or 2 points).
 */
export function intersectCircleCircle(c1, r1, c2, r2) {
  const d = Vec2.distance(c1, c2);
  if (d > r1 + r2 + 1e-12 || d < Math.abs(r1 - r2) - 1e-12 || d < 1e-12) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  const h = hSq > 1e-12 ? Math.sqrt(hSq) : 0;
  const mid = c1.add(c2.sub(c1).scale(a / d));
  if (h < 1e-12) return [mid];
  const perp = c2.sub(c1).perp().normalize().scale(h);
  return [mid.add(perp), mid.sub(perp)];
}

/**
 * Compute angle ABC (at vertex B). Returns radians in [0, PI].
 */
export function angleABC(a, b, c) {
  const ba = a.sub(b).normalize();
  const bc = c.sub(b).normalize();
  return Math.acos(Math.max(-1, Math.min(1, Vec2.dot(ba, bc))));
}

/**
 * Signed angle ABC (at vertex B). CCW positive. Returns [-PI, PI].
 */
export function signedAngleABC(a, b, c) {
  const ba = a.sub(b);
  const bc = c.sub(b);
  return Math.atan2(Vec2.cross(ba, bc), Vec2.dot(ba, bc));
}

/**
 * Polygon area (signed, CCW positive). vertices: Vec2[]
 */
export function polygonArea(vertices) {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return area / 2;
}

/**
 * Is point inside polygon? (ray casting)
 */
export function pointInPolygon(point, vertices) {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if ((yi > point.y) !== (yj > point.y) &&
        point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Convert degrees to radians
 */
export function degToRad(deg) { return deg * Math.PI / 180; }

/**
 * Convert radians to degrees
 */
export function radToDeg(rad) { return rad * 180 / Math.PI; }

/**
 * Clamp value between min and max
 */
export function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

/**
 * Round to nearest multiple
 */
export function roundTo(val, multiple) { return Math.round(val / multiple) * multiple; }

/**
 * Format a number for display
 */
export function formatNum(n, decimals = 2) {
  if (Math.abs(n) < 1e-12) return '0';
  const s = n.toFixed(decimals).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}
