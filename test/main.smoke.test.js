import { test } from "uvu";
import * as assert from "uvu/assert";
import { MockCanvas } from "./helpers/simulationEngine.js";
import { setupDom } from "./helpers/mockDom.js";

const simulationModulePromise = import("../src/main.js");

test("createSimulation runs in a headless Node environment", async () => {
  const { createSimulation } = await simulationModulePromise;
  const canvas = new MockCanvas(100, 100);
  const calls = [];

  const simulation = createSimulation({
    canvas,
    headless: true,
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: (cb) => {
      const id = setTimeout(() => {
        calls.push("raf");
        cb(0);
      }, 0);

      return id;
    },
    cancelAnimationFrame: (id) => clearTimeout(id),
  });

  assert.ok(simulation.grid, "grid is returned");
  assert.ok(simulation.uiManager, "uiManager is returned");

  const result = simulation.step();

  assert.type(result, "boolean", "step returns whether a tick occurred");

  simulation.stop();
  assert.ok(Array.isArray(calls));
});

test("createSimulation headless mode infers a canvas when omitted", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    performanceNow: () => 0,
    config: { rows: 8, cols: 12, cellSize: 5 },
  });

  assert.ok(simulation.engine.canvas, "engine exposes a fallback canvas");
  assert.is(simulation.engine.canvas.width, 60);
  assert.is(simulation.engine.canvas.height, 40);

  simulation.destroy();
});

test("headless canvas respects numeric strings for dimensions", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    config: { canvasWidth: "800", canvasHeight: "400", cellSize: "5" },
  });

  assert.is(simulation.engine.canvas.width, 800);
  assert.is(simulation.engine.canvas.height, 400);

  simulation.destroy();
});

test("createSimulation respects low diversity multiplier overrides in headless mode", async () => {
  const { createSimulation } = await simulationModulePromise;
  const configuredMultiplier = 0.24;

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    config: { lowDiversityReproMultiplier: configuredMultiplier },
  });

  assert.is(
    simulation.engine.getStateSnapshot().lowDiversityReproMultiplier,
    configuredMultiplier,
  );
  assert.is(
    simulation.uiManager.getLowDiversityReproMultiplier(),
    configuredMultiplier,
  );

  simulation.destroy();
});

test("headless UI setters coerce numeric string inputs", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({ headless: true, autoStart: false });

  simulation.uiManager.setUpdatesPerSecond("120");
  simulation.uiManager.setMatingDiversityThreshold("0.6");
  simulation.uiManager.setLowDiversityReproMultiplier("0.35");

  assert.is(simulation.uiManager.getUpdatesPerSecond(), 120);
  assert.is(simulation.uiManager.getMatingDiversityThreshold(), 0.6);
  assert.is(simulation.uiManager.getLowDiversityReproMultiplier(), 0.35);

  simulation.destroy();
});

test("headless UI forwards setting changes to the engine", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({ headless: true, autoStart: false });

  simulation.uiManager.setUpdatesPerSecond(42);
  simulation.uiManager.setMatingDiversityThreshold(0.55);
  simulation.uiManager.setLowDiversityReproMultiplier(0.28);
  simulation.uiManager.setAutoPauseOnBlur(false);

  const state = simulation.engine.getStateSnapshot();

  assert.is(state.updatesPerSecond, 42);
  assert.is(state.matingDiversityThreshold, 0.55);
  assert.is(state.lowDiversityReproMultiplier, 0.28);
  assert.is(simulation.engine.autoPauseOnBlur, false);

  simulation.destroy();
});

test("browser UI keeps auto-pause disabled by default", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await simulationModulePromise;

    const simulation = createSimulation({
      autoStart: false,
      canvas: new MockCanvas(60, 60),
    });

    assert.is(
      simulation.engine.autoPauseOnBlur,
      false,
      "engine starts with autoPauseOnBlur disabled",
    );
    assert.is(
      simulation.engine.state.autoPauseOnBlur,
      false,
      "engine state snapshot reflects disabled auto pause",
    );
    assert.is(
      typeof simulation.uiManager.getAutoPauseOnBlur === "function"
        ? simulation.uiManager.getAutoPauseOnBlur()
        : simulation.uiManager.autoPauseOnBlur,
      false,
      "UI surfaces a disabled auto-pause setting",
    );

    simulation.destroy();
  } finally {
    restore();
  }
});

test("headless UI clamps diversity controls to the 0..1 range", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({ headless: true, autoStart: false });

  simulation.uiManager.setMatingDiversityThreshold(2);
  simulation.uiManager.setLowDiversityReproMultiplier(-0.25);

  const state = simulation.engine.getStateSnapshot();

  assert.is(simulation.uiManager.getMatingDiversityThreshold(), 1);
  assert.is(state.matingDiversityThreshold, 1);
  assert.is(simulation.uiManager.getLowDiversityReproMultiplier(), 0);
  assert.is(state.lowDiversityReproMultiplier, 0);

  simulation.destroy();
});

test("headless UI clamps update frequency like the engine", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({ headless: true, autoStart: false });

  simulation.uiManager.setUpdatesPerSecond(0);
  assert.is(simulation.uiManager.getUpdatesPerSecond(), 1);
  assert.is(simulation.engine.getStateSnapshot().updatesPerSecond, 1);

  simulation.uiManager.setUpdatesPerSecond(59.4);
  assert.is(simulation.uiManager.getUpdatesPerSecond(), 59);
  assert.is(simulation.engine.getStateSnapshot().updatesPerSecond, 59);

  simulation.uiManager.setUpdatesPerSecond(59.6);
  assert.is(simulation.uiManager.getUpdatesPerSecond(), 60);
  assert.is(simulation.engine.getStateSnapshot().updatesPerSecond, 60);

  simulation.destroy();
});

test("createSimulation controller step delegates to engine.step", async () => {
  const { createSimulation } = await simulationModulePromise;
  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    config: { paused: true },
  });

  let calls = 0;
  const delegatedReturn = { delegated: true, args: null };
  const originalStep = simulation.engine.step;

  try {
    simulation.engine.step = (...args) => {
      calls += 1;
      delegatedReturn.args = args;

      return delegatedReturn;
    };

    const result = simulation.step("custom-timestamp");

    assert.is(calls, 1, "controller step should call engine.step exactly once");
    assert.is(result, delegatedReturn, "controller returns engine.step result");
    assert.equal(delegatedReturn.args, ["custom-timestamp"]);
  } finally {
    simulation.engine.step = originalStep;
    simulation.destroy();
  }
});

test("step control calls engine.step when using createSimulation", async () => {
  const { createSimulation } = await simulationModulePromise;

  class MockClassList {
    constructor(element) {
      this.element = element;
      this._set = new Set();
    }

    add(...tokens) {
      tokens.forEach((token) => {
        if (token) this._set.add(token);
      });
      this.#sync();
    }

    remove(...tokens) {
      tokens.forEach((token) => {
        this._set.delete(token);
      });
      this.#sync();
    }

    toggle(token, force) {
      if (force === true) {
        this._set.add(token);
      } else if (force === false) {
        this._set.delete(token);
      } else if (this._set.has(token)) {
        this._set.delete(token);
      } else {
        this._set.add(token);
      }
      this.#sync();

      return this._set.has(token);
    }

    contains(token) {
      return this._set.has(token);
    }

    toString() {
      return Array.from(this._set).join(" ");
    }

    setFromString(value) {
      this._set = new Set((value || "").split(/\s+/).filter(Boolean));
      this.#sync(false);
    }

    #sync(updateAttribute = true) {
      const value = this.toString();

      this.element._className = value;
      if (updateAttribute) this.element.attributes.class = value;
    }
  }

  class MockElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.attributes = {};
      this.style = { setProperty() {} };
      this.eventListeners = new Map();
      this._ownerDocument = null;
      this._id = "";
      this._className = "";
      this.classList = new MockClassList(this);
      this.textContent = "";
      this.title = "";
    }

    set ownerDocument(doc) {
      this._ownerDocument = doc;
      if (this._id) this._ownerDocument?.registerId(this._id, this);
      this.children.forEach((child) => {
        child.ownerDocument = doc;
      });
    }

    get ownerDocument() {
      return this._ownerDocument;
    }

    set id(value) {
      this._id = value || "";
      if (this._ownerDocument) {
        this._ownerDocument.registerId(this._id, this);
      }
    }

    get id() {
      return this._id;
    }

    set className(value) {
      this._className = value || "";
      this.classList.setFromString(this._className);
    }

    get className() {
      return this._className;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
      if (name === "id") this.id = value;
      if (name === "class") this.className = value;
    }

    appendChild(child) {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);

      return child;
    }

    insertBefore(child, reference) {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      const index = reference ? this.children.indexOf(reference) : -1;

      if (index >= 0) this.children.splice(index, 0, child);
      else this.children.push(child);

      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);

      if (index >= 0) {
        this.children.splice(index, 1);
        child.parentElement = null;
        child.ownerDocument = null;
      }

      return child;
    }

    remove() {
      if (this.parentElement) {
        this.parentElement.removeChild(this);
      }
    }

    hasChildNodes() {
      return this.children.length > 0;
    }

    querySelector(selector) {
      if (!selector) return null;

      const predicate = (element) => {
        if (selector.startsWith("#")) {
          return element.id === selector.slice(1);
        }
        if (selector.startsWith(".")) {
          return element.classList.contains(selector.slice(1));
        }

        return element.tagName.toLowerCase() === selector.toLowerCase();
      };

      if (predicate(this)) return this;

      for (const child of this.children) {
        const found = child.querySelector(selector);

        if (found) return found;
      }

      return null;
    }

    addEventListener(type, handler) {
      if (!this.eventListeners.has(type)) {
        this.eventListeners.set(type, []);
      }
      this.eventListeners.get(type).push(handler);
    }

    trigger(type, event = {}) {
      const listeners = this.eventListeners.get(type);

      if (!listeners) return;

      const payload = {
        type,
        target: this,
        currentTarget: this,
        preventDefault() {},
        stopPropagation() {},
        ...event,
      };

      listeners.forEach((listener) => listener(payload));
    }

    click() {
      this.trigger("click");
    }

    getBoundingClientRect() {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
  }

  class MockCanvasContext {
    constructor(canvas) {
      this.canvas = canvas;
    }

    clearRect() {}
    fillRect() {}
    strokeRect() {}
    save() {}
    restore() {}
    beginPath() {}
    stroke() {}
    fillText() {}
    strokeText() {}
    createLinearGradient() {
      return { addColorStop() {} };
    }
  }

  class MockCanvasElement extends MockElement {
    constructor(width = 100, height = 100) {
      super("canvas");
      this.width = width;
      this.height = height;
      this._context = new MockCanvasContext(this);
    }

    getContext(type) {
      return type === "2d" ? this._context : null;
    }

    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.width, height: this.height };
    }
  }

  class MockDocument {
    constructor() {
      this.body = new MockElement("body");
      this.body.ownerDocument = this;
      this._ids = new Map();
      this._listeners = new Map();
    }

    createElement(tagName) {
      const element =
        tagName === "canvas" ? new MockCanvasElement() : new MockElement(tagName);

      element.ownerDocument = this;

      return element;
    }

    registerId(id, element) {
      if (!id) return;
      this._ids.set(id, element);
    }

    getElementById(id) {
      return this._ids.get(id) ?? null;
    }

    querySelector(selector) {
      return this.body.querySelector(selector);
    }

    addEventListener(type, handler) {
      if (!this._listeners.has(type)) {
        this._listeners.set(type, []);
      }
      this._listeners.get(type).push(handler);
    }

    removeEventListener(type, handler) {
      const handlers = this._listeners.get(type);

      if (!handlers) return;

      const index = handlers.indexOf(handler);

      if (index >= 0) handlers.splice(index, 1);
    }
  }

  const mockDocument = new MockDocument();
  const appRoot = new MockElement("div");

  appRoot.ownerDocument = mockDocument;
  appRoot.id = "app";
  mockDocument.body.appendChild(appRoot);
  const canvas = new MockCanvasElement(100, 100);

  canvas.ownerDocument = mockDocument;
  appRoot.appendChild(canvas);

  const mockWindow = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalNode = global.Node;
  const originalHTMLElement = global.HTMLElement;
  const originalHTMLCanvasElement = global.HTMLCanvasElement;

  let simulation;

  try {
    global.window = mockWindow;
    global.document = mockDocument;
    global.Node = MockElement;
    global.HTMLElement = MockElement;
    global.HTMLCanvasElement = MockCanvasElement;

    simulation = createSimulation({
      canvas,
      autoStart: false,
      window: mockWindow,
      document: mockDocument,
      config: {
        paused: true,
        ui: {
          mountSelector: "#app",
          actions: { selectionManager: null, obstaclePresets: [] },
          layout: { canvasElement: canvas },
        },
      },
    });

    let stepCalls = 0;
    const originalStep = simulation.engine.step.bind(simulation.engine);

    simulation.engine.step = (...args) => {
      stepCalls += 1;

      return originalStep(...args);
    };

    simulation.uiManager.stepButton.click();

    assert.is(stepCalls, 1, "clicking Step delegates to engine.step");
  } finally {
    simulation?.destroy?.();
    global.window = originalWindow;
    global.document = originalDocument;
    global.Node = originalNode;
    global.HTMLElement = originalHTMLElement;
    global.HTMLCanvasElement = originalHTMLCanvasElement;
  }
});

test.run();
