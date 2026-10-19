// History.js - Undo/redo command stack

import { Vec2 } from './Geometry.js';

/**
 * Deep clone a value, reconstructing Vec2 objects from {x, y} plain objects.
 */
function deepClone(val) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  // Reconstruct Vec2 from {x, y}
  if ('x' in val && 'y' in val && Object.keys(val).length === 2 && typeof val.x === 'number' && typeof val.y === 'number') {
    return new Vec2(val.x, val.y);
  }
  if (Array.isArray(val)) {
    return val.map(deepClone);
  }
  const cloned = {};
  for (const key of Object.keys(val)) {
    cloned[key] = deepClone(val[key]);
  }
  return cloned;
}

/**
 * Command classes for undo/redo operations.
 * Each command stores enough info to undo and redo the operation.
 */

export class AddObjectCommand {
  constructor(object, objectList) {
    this.object = object;
    this.objectList = objectList;
  }

  execute() {
    this.objectList.push(this.object);
  }

  undo() {
    const idx = this.objectList.indexOf(this.object);
    if (idx >= 0) this.objectList.splice(idx, 1);
  }

  redo() {
    this.execute();
  }
}

export class DeleteObjectCommand {
  constructor(object, objectList, index = -1) {
    this.object = object;
    this.objectList = objectList;
    this.index = index >= 0 ? index : objectList.indexOf(object);
  }

  execute() {
    const idx = this.objectList.indexOf(this.object);
    if (idx >= 0) this.objectList.splice(idx, 1);
  }

  undo() {
    if (this.index >= 0 && this.index <= this.objectList.length) {
      this.objectList.splice(this.index, 0, this.object);
    } else {
      this.objectList.push(this.object);
    }
  }

  redo() {
    this.execute();
  }
}

export class ModifyObjectCommand {
  constructor(object, oldData, newData) {
    this.object = object;
    this.oldData = oldData;
    this.newData = newData;
  }

  _restore(data) {
    // Restore object state from serialized data, preserving Vec2 instances
    for (const key of Object.keys(data)) {
      if (key === 'type' || key === 'id') continue;
      this.object[key] = deepClone(data[key]);
    }
  }

  execute() {
    this._restore(this.newData);
  }

  undo() {
    this._restore(this.oldData);
  }

  redo() {
    this.execute();
  }
}

export class MoveObjectCommand {
  constructor(object, delta) {
    this.object = object;
    this.delta = delta; // World-space delta
  }

  execute() {
    this.object.moveBy(this.delta);
  }

  undo() {
    this.object.moveBy(this.delta.scale ? this.delta.scale(-1) : { x: -this.delta.x, y: -this.delta.y });
  }

  redo() {
    this.execute();
  }
}

export class BatchCommand {
  constructor(commands = []) {
    this.commands = commands;
  }

  execute() {
    for (const cmd of this.commands) cmd.execute();
  }

  undo() {
    // Undo in reverse order
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }

  redo() {
    for (const cmd of this.commands) cmd.redo();
  }
}


/**
 * History manager - maintains undo and redo stacks
 */
export class HistoryManager {
  constructor(maxSize = 200) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = maxSize;
    this._onChange = null;
  }

  /**
   * Execute a command and push it to the undo stack.
   * @param {Object} command - Must have execute(), undo(), redo()
   */
  execute(command) {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // Clear redo stack on new action
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    if (this._onChange) this._onChange();
  }

  /**
   * Execute without pushing to undo stack (for initial setup, etc.)
   */
  executeSilent(command) {
    command.execute();
  }

  /**
   * Push a command directly without executing it first.
   */
  push(command) {
    this.undoStack.push(command);
    this.redoStack = [];
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    if (this._onChange) this._onChange();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const command = this.undoStack.pop();
    command.undo();
    this.redoStack.push(command);
    if (this._onChange) this._onChange();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const command = this.redoStack.pop();
    command.redo();
    this.undoStack.push(command);
    if (this._onChange) this._onChange();
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    if (this._onChange) this._onChange();
  }

  onChange(callback) {
    this._onChange = callback;
  }
}
