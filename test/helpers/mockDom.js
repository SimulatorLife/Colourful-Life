class MockClassList {
  constructor(owner) {
    this.owner = owner;
    this.classes = new Set();
  }

  #apply() {
    this.owner.className = Array.from(this.classes).join(" ");
  }

  add(token) {
    if (!token) return;
    this.classes.add(token);
    this.#apply();
  }

  remove(token) {
    if (!token) return;
    this.classes.delete(token);
    this.#apply();
  }

  toggle(token, force) {
    if (!token) return false;
    const shouldAdd = force ?? !this.classes.has(token);

    if (shouldAdd) this.add(token);
    else this.remove(token);

    return shouldAdd;
  }

  contains(token) {
    return this.classes.has(token);
  }
}

export class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this.classList = new MockClassList(this);
    this.attributes = {};
    this.eventListeners = Object.create(null);
    this.style = {};
    this._textContent = "";
    this.innerHTML = "";
    this.id = "";
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

    const matchesSelf = () => {
      if (selector.startsWith(".")) {
        const name = selector.slice(1);

        return this.classList.contains(name);
      }

      if (selector.startsWith("#")) {
        return this.id === selector.slice(1);
      }

      return false;
    };

    if (matchesSelf()) return this;

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

export class MockCanvas extends MockElement {
  constructor(width, height) {
    super("canvas");
    this.width = width;
    this.height = height;
    this.boundingRect = { left: 0, top: 0, width, height };
    this.captured = new Set();
  }

  getContext(type) {
    if (type !== "2d") return null;

    return {
      canvas: this,
      fillRect() {},
      strokeRect() {},
      save() {},
      restore() {},
      beginPath() {},
      stroke() {},
      createLinearGradient() {
        return {
          addColorStop() {},
        };
      },
      fillText() {},
      strokeText() {},
    };
  }

  setPointerCapture(pointerId) {
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captured.delete(pointerId);
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

export class MockPointerEvent {
  constructor({ clientX, clientY, pointerId = 1 }) {
    this.clientX = clientX;
    this.clientY = clientY;
    this.pointerId = pointerId;
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
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
  MockPointerEvent,
  setupDom,
};
