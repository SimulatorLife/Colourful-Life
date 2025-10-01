import { suite } from "uvu";
import * as assert from "uvu/assert";

const test = suite("ui selection drawing");

class MockClassList {
  constructor(owner) {
    this.owner = owner;
    this.classes = new Set();
  }

  #apply() {
    this.owner.className = Array.from(this.classes).join(" ");
  }

  add(token) {
    this.classes.add(token);
    this.#apply();
  }

  remove(token) {
    this.classes.delete(token);
    this.#apply();
  }

  toggle(token, force) {
    const shouldAdd = force ?? !this.classes.has(token);

    if (shouldAdd) this.add(token);
    else this.remove(token);

    return shouldAdd;
  }

  contains(token) {
    return this.classes.has(token);
  }
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this.classList = new MockClassList(this);
    this.attributes = {};
    this.eventListeners = Object.create(null);
    this.style = {};
    this.textContent = "";
    this.innerHTML = "";
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
    this.children.push(child);
    child.parentElement = this;

    return child;
  }

  insertBefore(child, before) {
    const index = before ? this.children.indexOf(before) : -1;

    if (index >= 0) {
      this.children.splice(index, 0, child);
      child.parentElement = this;

      return child;
    }

    return this.appendChild(child);
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

    if (name === "id") {
      this.id = value;
    }
  }

  addEventListener(type, handler) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }

    this.eventListeners[type].push(handler);
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
}

class MockCanvas extends MockElement {
  constructor(width, height) {
    super("canvas");
    this.width = width;
    this.height = height;
    this.boundingRect = { left: 0, top: 0, width, height };
    this.captured = new Set();
  }

  getBoundingClientRect() {
    return { ...this.boundingRect };
  }

  setPointerCapture(pointerId) {
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captured.delete(pointerId);
  }
}

class MockDocument {
  constructor() {
    this.body = new MockElement("body");
    this.eventListeners = Object.create(null);
    this.nodesById = new Map();
  }

  createElement(tagName) {
    const element = new MockElement(tagName);

    if (typeof element.querySelector !== "function") {
      element.querySelector = () => null;
    }

    return element;
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

class MockPointerEvent {
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

function setupDom() {
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

test("selection drawing respects canvas CSS scaling", async () => {
  const restore = setupDom();

  const [{ default: UIManager }, { default: SelectionManager }] = await Promise.all([
    import("../src/ui/uiManager.js"),
    import("../src/ui/selectionManager.js"),
  ]);

  const selectionManager = new SelectionManager(120, 120);
  const canvas = new MockCanvas(600, 600);

  canvas.boundingRect = { left: 0, top: 0, width: 300, height: 300 };

  const uiManager = new UIManager(
    {
      requestFrame: () => {},
      togglePause: () => false,
      step: () => {},
      onSettingChange: () => {},
    },
    "#app",
    { selectionManager, getCellSize: () => 5 },
    { canvasElement: canvas },
  );

  uiManager.drawZoneButton.trigger("click");

  const pointerDown = new MockPointerEvent({ clientX: 50, clientY: 50, pointerId: 1 });
  const pointerMove = new MockPointerEvent({
    clientX: 250,
    clientY: 250,
    pointerId: 1,
  });
  const pointerUp = new MockPointerEvent({ clientX: 250, clientY: 250, pointerId: 1 });

  canvas.trigger("pointerdown", pointerDown);
  canvas.trigger("pointermove", pointerMove);
  canvas.trigger("pointerup", pointerUp);

  assert.is(selectionManager.customZones.length, 1, "custom zone should be created");
  const bounds = selectionManager.customZones[0].bounds;

  assert.equal(bounds, {
    startRow: 20,
    endRow: 100,
    startCol: 20,
    endCol: 100,
  });

  restore();
});

test.run();
