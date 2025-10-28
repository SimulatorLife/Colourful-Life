/**
 * Minimal `classList` implementation used by the mock DOM helpers. Mirrors the
 * DOMTokenList API surface relied upon by tests without pulling in a full DOM
 * shim.
 */
class MockClassList {
  constructor(owner) {
    this.owner = owner;
    this.classes = new Set();
  }

  #apply() {
    this.owner.className = Array.from(this.classes).join(" ");
  }

  _setFromString(value) {
    this.classes.clear();

    if (typeof value !== "string" || value.length === 0) {
      return;
    }

    value
      .split(/\s+/)
      .filter(Boolean)
      .forEach((token) => {
        this.classes.add(token);
      });
  }

  add(token) {
    if (!token) return;
    this._setFromString(this.owner?._className ?? this.owner?.className ?? "");
    this.classes.add(token);
    this.#apply();
  }

  remove(token) {
    if (!token) return;
    this._setFromString(this.owner?._className ?? this.owner?.className ?? "");
    this.classes.delete(token);
    this.#apply();
  }

  toggle(token, force) {
    if (!token) return false;
    this._setFromString(this.owner?._className ?? this.owner?.className ?? "");
    const shouldAdd = force ?? !this.classes.has(token);

    if (shouldAdd) {
      this.add(token);
    } else {
      this.remove(token);
    }

    return shouldAdd;
  }

  contains(token) {
    if (typeof token !== "string" || token.length === 0) {
      return false;
    }

    if (this.classes.size === 0) {
      this._setFromString(this.owner?._className ?? this.owner?.className ?? "");
    }

    if (this.classes.has(token)) {
      return true;
    }

    if (typeof this.owner?.className === "string" && this.owner.className.length > 0) {
      const classNames = this.owner.className.split(/\s+/).filter(Boolean);

      return classNames.includes(token);
    }

    return false;
  }
}

/**
 * Lightweight DOM element facsimile that powers UI tests in Node. Supports the
 * subset of methods/properties exercised by control builders and overlay code
 * without requiring JSDOM.
 */
export class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this._className = "";
    this.classList = new MockClassList(this);
    this.className = "";
    this.attributes = {};
    this.eventListeners = Object.create(null);
    this.style = {};
    this._textContent = "";
    this.innerHTML = "";
    this.id = "";
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = value != null ? String(value) : "";

    if (this.classList) {
      this.classList._setFromString(this._className);
    }
  }

  #matchesSelector(selector) {
    if (!selector) return false;

    const selectors = selector
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    return selectors.some((candidate) => {
      if (!candidate) return false;

      if (candidate.startsWith(".")) {
        const classTokens = candidate.slice(1).split(".").filter(Boolean);

        if (classTokens.length === 0) return false;

        return classTokens.every((token) => this.classList.contains(token));
      }

      if (candidate.startsWith("#")) {
        return this.id === candidate.slice(1);
      }

      return this.tagName === candidate.toUpperCase();
    });
  }

  matches(selector) {
    return this.#matchesSelector(selector);
  }

  closest(selector) {
    if (!selector) return null;

    let current = this;

    while (current) {
      if (current.#matchesSelector(selector)) return current;
      current = current.parentElement;
    }

    return null;
  }

  get textContent() {
    if (!Array.isArray(this.children) || this.children.length === 0) {
      return this._textContent;
    }

    const childText = this.children
      .map((child) =>
        child && typeof child.textContent === "string" ? child.textContent : "",
      )
      .join("");

    return `${this._textContent}${childText}`;
  }

  set textContent(value) {
    this._textContent = value != null ? String(value) : "";
  }

  querySelector(selector) {
    if (!selector) return null;

    if (this.#matchesSelector(selector)) return this;

    for (const child of this.children) {
      if (typeof child.querySelector === "function") {
        const match = child.querySelector(selector);

        if (match) return match;
      }
    }

    return null;
  }

  appendChild(child) {
    if (!child) return child;
    this.children.push(child);
    child.parentElement = this;

    return child;
  }

  insertBefore(child, before) {
    if (!child) return null;

    if (!before) {
      return this.appendChild(child);
    }

    const index = this.children.indexOf(before);

    if (index >= 0) {
      this.children.splice(index, 0, child);
    } else {
      this.children.push(child);
    }

    child.parentElement = this;

    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);

    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }

    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === "id") this.id = value;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, handler) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }

    this.eventListeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.eventListeners[type];

    if (!list) return;
    const index = list.indexOf(handler);

    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(event) {
    this.trigger(event.type, event);
  }

  trigger(type, payload = {}) {
    const handlers = this.eventListeners[type] || [];
    const event = {
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...payload,
      type,
      target: payload.target ?? this,
    };

    handlers.forEach((handler) => handler(event));
  }

  getBoundingClientRect() {
    return this.boundingRect || { left: 0, top: 0, width: 0, height: 0 };
  }
}

class MockCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = false;
    this.fillStyle = "#000";
    this.strokeStyle = "#000";
    this.lineWidth = 1;
    this.font = "";
    this.textBaseline = "top";
    this.textAlign = "left";
    this.globalAlpha = 1;
    this.lineJoin = "miter";
    this.lineCap = "butt";
    this.lastTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    this.lastScale = { x: 1, y: 1 };
  }

  clearRect() {}
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  arc() {}
  setTransform(a, b, c, d, e, f) {
    this.lastTransform = { a, b, c, d, e, f };
  }
  resetTransform() {
    this.lastTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  scale(x, y) {
    this.lastScale = { x, y };
  }
  createLinearGradient() {
    return {
      addColorStop() {},
    };
  }
  fillText() {}
  strokeText() {}
}

export class MockCanvas extends MockElement {
  constructor(width, height) {
    super("canvas");
    this.width = width;
    this.height = height;
    this.boundingRect = { left: 0, top: 0, width, height };
    this._context = null;
  }

  getContext(type) {
    if (type !== "2d") return null;

    if (!this._context) {
      this._context = new MockCanvasContext(this);
    }

    return this._context;
  }
}

export class MockDocument {
  constructor() {
    this.body = new MockElement("body");
    this.eventListeners = Object.create(null);
    this.nodesById = new Map();
  }

  createElement(tagName) {
    return new MockElement(tagName);
  }

  registerElement(element) {
    if (element.id) {
      this.nodesById.set(element.id, element);
    }
  }

  querySelector(selector) {
    if (selector?.startsWith("#")) {
      return this.nodesById.get(selector.slice(1)) ?? null;
    }

    return null;
  }

  getElementById(id) {
    return this.nodesById.get(id) ?? null;
  }

  addEventListener(type, handler) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }

    this.eventListeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.eventListeners[type];

    if (!list) return;
    const index = list.indexOf(handler);

    if (index >= 0) {
      list.splice(index, 1);
    }
  }
}

export function setupDom() {
  const originalDocument = global.document;
  const originalNode = global.Node;
  const originalHTMLElement = global.HTMLElement;
  const originalWindow = global.window;

  const document = new MockDocument();
  const appRoot = new MockElement("div");

  appRoot.id = "app";
  document.registerElement(appRoot);
  document.body.appendChild(appRoot);

  global.document = document;
  global.Node = MockElement;
  global.HTMLElement = MockElement;
  global.window = {
    grid: null,
    requestAnimationFrame(callback) {
      if (typeof callback === "function") {
        callback(0);
      }

      return 1;
    },
    addEventListener() {},
    removeEventListener() {},
  };

  return () => {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
    if (originalNode === undefined) delete global.Node;
    else global.Node = originalNode;
    if (originalHTMLElement === undefined) delete global.HTMLElement;
    else global.HTMLElement = originalHTMLElement;
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  };
}

export default {
  MockElement,
  MockCanvas,
  MockDocument,
  setupDom,
};
