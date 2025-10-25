import { assert, test } from "#tests/harness";
import { MockCanvas } from "./helpers/simulationEngine.js";
import { setupDom } from "./helpers/mockDom.js";

const simulationModulePromise = import("../src/main.js");

test("createSimulation runs in a headless Node environment", async () => {
  const { createSimulation } = await simulationModulePromise;
  const canvas = new MockCanvas(100, 100);
  const rafCallbacks = [];
  const rafHandles = [];
  const cancelledHandles = [];
  let nextHandle = 1;

  const simulation = createSimulation({
    canvas,
    headless: true,
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: (cb) => {
      const handle = nextHandle++;

      rafHandles.push(handle);
      rafCallbacks.push(cb);

      return handle;
    },
    cancelAnimationFrame: (handle) => {
      cancelledHandles.push(handle);
    },
  });

  assert.ok(simulation.grid, "grid is returned");
  assert.ok(simulation.uiManager, "uiManager is returned");

  simulation.pause();
  const stepped = simulation.step(123);

  assert.is(stepped, true, "step should advance once when paused");
  assert.is(
    rafHandles.length,
    0,
    "autoStart=false should not schedule frames immediately",
  );

  simulation.start();

  assert.is(rafHandles.length, 1, "starting schedules the first animation frame");
  const [firstCallback] = rafCallbacks;

  assert.type(firstCallback, "function", "start captures an animation frame callback");

  firstCallback(16);

  assert.is(
    rafHandles.length,
    2,
    "running frames enqueue a follow-up animation frame for the loop",
  );

  simulation.stop();

  assert.equal(
    cancelledHandles,
    [2],
    "stop cancels the pending animation frame handle",
  );

  simulation.destroy();
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

test("headless canvas ignores blank dimension strings", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    config: { width: "", height: "" },
  });

  assert.is(simulation.engine.canvas.width, 600);
  assert.is(simulation.engine.canvas.height, 600);

  simulation.destroy();
});

test("headless canvas sanitizes invalid dimension overrides", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    config: { cellSize: -4, width: -200, height: 0 },
  });

  assert.is(simulation.engine.canvas.width, 600);
  assert.is(simulation.engine.canvas.height, 600);
  assert.is(simulation.engine.cellSize, 5);

  simulation.destroy();
});

test("createSimulation preserves provided headless canvas dimensions", async () => {
  const [{ createSimulation }, { createHeadlessCanvas }] = await Promise.all([
    simulationModulePromise,
    import("../src/engine/environment.js"),
  ]);

  const customCanvas = createHeadlessCanvas({ width: 320, height: 200 });
  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    canvas: customCanvas,
  });

  assert.is(simulation.engine.canvas.width, 320);
  assert.is(simulation.engine.canvas.height, 200);

  simulation.destroy();
});

test("headless canvas derives dimensions when provided canvas lacks size", async () => {
  const { createSimulation } = await simulationModulePromise;
  const canvas = new MockCanvas();

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    canvas,
    config: { rows: 12, cols: 18, cellSize: 5 },
  });

  assert.is(simulation.engine.canvas.width, 90);
  assert.is(simulation.engine.canvas.height, 60);

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

test("headless UI suppresses callbacks for engine-driven updates", async () => {
  const { createSimulation } = await simulationModulePromise;
  const observed = [];

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    config: {
      ui: {
        onSettingChange(key, value) {
          observed.push([key, value]);
        },
      },
    },
  });

  try {
    assert.equal(
      observed,
      [],
      "initial engine state sync should not emit headless UI callbacks",
    );

    simulation.engine.setAutoPauseOnBlur(true);
    simulation.engine.setLowDiversityReproMultiplier(0.33);
    simulation.engine.setInitialTileEnergyFraction(0.42);

    assert.equal(
      observed,
      [],
      "engine-driven updates should not trigger headless onSettingChange callbacks",
    );
  } finally {
    simulation.destroy();
  }
});

test("createSimulation accepts a custom brain snapshot collector", async () => {
  const { createSimulation } = await simulationModulePromise;
  const collector = { captureFromEntries: () => [] };

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    brainSnapshotCollector: collector,
  });

  assert.is(simulation.engine.brainSnapshotCollector, collector);

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

test("browser UI setter toggles auto-pause through the engine", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await simulationModulePromise;

    const simulation = createSimulation({
      autoStart: false,
      canvas: new MockCanvas(60, 60),
    });

    assert.is(simulation.engine.autoPauseOnBlur, false);
    assert.is(simulation.engine.getStateSnapshot().autoPauseOnBlur, false);

    simulation.uiManager.setAutoPauseOnBlur(true);

    assert.is(simulation.uiManager.autoPauseOnBlur, true);
    assert.is(simulation.engine.autoPauseOnBlur, true);
    assert.is(simulation.engine.getStateSnapshot().autoPauseOnBlur, true);

    simulation.uiManager.setAutoPauseOnBlur(false);

    assert.is(simulation.uiManager.autoPauseOnBlur, false);
    assert.is(simulation.engine.autoPauseOnBlur, false);
    assert.is(simulation.engine.getStateSnapshot().autoPauseOnBlur, false);

    simulation.destroy();
  } finally {
    restore();
  }
});

test("browser UI exposes low diversity reproduction controls", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await simulationModulePromise;

    const simulation = createSimulation({
      autoStart: false,
      canvas: new MockCanvas(60, 60),
    });

    assert.type(
      simulation.uiManager.setLowDiversityReproMultiplier,
      "function",
      "UI manager should expose a setter for the low diversity penalty",
    );

    simulation.uiManager.setLowDiversityReproMultiplier("0.35");

    assert.is(simulation.uiManager.lowDiversityReproMultiplier, 0.35);
    assert.is(simulation.engine.getStateSnapshot().lowDiversityReproMultiplier, 0.35);
    assert.is(simulation.uiManager.lowDiversitySlider.value, "0.35");

    simulation.engine.setLowDiversityReproMultiplier(0.6);

    assert.is(simulation.uiManager.lowDiversityReproMultiplier, 0.6);
    assert.is(simulation.engine.getStateSnapshot().lowDiversityReproMultiplier, 0.6);
    assert.is(simulation.uiManager.lowDiversitySlider.value, "0.6");

    simulation.uiManager.setLowDiversityReproMultiplier(-0.25);

    assert.is(simulation.uiManager.lowDiversityReproMultiplier, 0);
    assert.is(simulation.engine.getStateSnapshot().lowDiversityReproMultiplier, 0);

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

test("createSimulation merges obstacle preset overrides into the catalog", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await simulationModulePromise;
    const canvas = new MockCanvas(60, 60);
    const injectedPresets = {
      includeDefaults: false,
      presets: [
        { id: "midline", label: "Alternate Midline" },
        { id: "custom", label: "Custom Layout", description: "Injected" },
        "none",
      ],
    };
    const simulation = createSimulation({
      canvas,
      autoStart: false,
      config: { obstaclePresets: injectedPresets },
    });

    const enginePresets = simulation.engine.obstaclePresets;
    const presetIds = enginePresets.map((preset) => preset.id);

    assert.ok(
      presetIds.includes("custom"),
      "custom preset should be appended to the catalog",
    );
    assert.is(
      enginePresets.find((preset) => preset.id === "midline")?.label,
      "Alternate Midline",
    );
    assert.is(
      enginePresets.find((preset) => preset.id === "custom")?.description,
      "Injected",
    );
    assert.ok(
      simulation.grid.obstaclePresets.some((preset) => preset.id === "custom"),
      "GridManager should receive the injected preset",
    );

    simulation.destroy();
  } finally {
    restore();
  }
});

test("engine.resetWorld clears the ecosystem by default and reseeds on request", async () => {
  const { createSimulation } = await simulationModulePromise;
  const deterministicRng = () => 0.01;

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    rng: deterministicRng,
    config: { rows: 12, cols: 12, cellSize: 5 },
  });

  simulation.engine.tick();

  const { stats, selectionManager, grid } = simulation;

  assert.ok(stats.history.population.length > 0, "history populated before reset");
  assert.is(selectionManager.hasActiveZones(), false, "no zones active before reset");

  simulation.engine.resetWorld();

  let snapshot = grid.buildSnapshot();

  assert.is(snapshot.population, 0, "population cleared after default reset");
  assert.is(stats.totals.ticks, 1, "tick counter restarted after reset");
  assert.is(stats.history.population.length, 1, "history contains a fresh sample");
  assert.is(stats.getRecentLifeEvents().length, 0, "life event log cleared");

  simulation.engine.resetWorld({ reseed: true });

  snapshot = grid.buildSnapshot();

  assert.ok(snapshot.population > 0, "population reseeded when explicitly requested");

  simulation.destroy();
});

test("engine.resetWorld preserves paused state for running simulations", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({ headless: true, autoStart: true });

  simulation.engine.pause();
  assert.ok(simulation.engine.isRunning, "engine keeps running loop while paused");
  assert.is(simulation.engine.isPaused(), true, "engine paused before reset");

  simulation.engine.resetWorld();

  assert.ok(
    simulation.engine.isRunning,
    "reset should resume the engine loop when it was previously running",
  );
  assert.is(
    simulation.engine.isPaused(),
    true,
    "reset should not resume playback when simulation was paused",
  );

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

test("createSimulation controller update delegates to engine.tick", async () => {
  const { createSimulation } = await simulationModulePromise;
  const simulation = createSimulation({
    headless: true,
    autoStart: false,
  });

  let calls = 0;
  const delegatedReturn = { delegated: true, args: null };
  const originalTick = simulation.engine.tick;

  try {
    simulation.engine.tick = (...args) => {
      calls += 1;
      delegatedReturn.args = args;

      return delegatedReturn;
    };

    const result = simulation.update("custom-timestamp");

    assert.is(calls, 1, "controller update should call engine.tick exactly once");
    assert.is(result, delegatedReturn, "controller returns engine.tick result");
    assert.equal(delegatedReturn.args, ["custom-timestamp"]);
  } finally {
    simulation.engine.tick = originalTick;
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

    stepCalls = 0;

    const keydownHandlers = mockDocument._listeners.get("keydown") || [];

    assert.ok(keydownHandlers.length > 0, "UI manager registers keyboard hotkeys");

    const pausedEvent = {
      key: "s",
      target: mockDocument.body,
      preventDefault() {
        this.defaultPrevented = true;
      },
      defaultPrevented: false,
    };

    keydownHandlers.forEach((handler) => handler(pausedEvent));

    assert.is(
      stepCalls,
      1,
      "pressing the step hotkey triggers a single step while paused",
    );
    assert.ok(
      pausedEvent.defaultPrevented,
      "hotkey prevents default behavior while paused",
    );

    stepCalls = 0;

    const runningEvent = {
      key: "s",
      target: mockDocument.body,
      preventDefault() {
        this.defaultPrevented = true;
      },
      defaultPrevented: false,
    };

    simulation.engine.togglePause();
    assert.ok(
      !simulation.uiManager.isPaused(),
      "simulation resumes before running hotkey test",
    );

    keydownHandlers.forEach((handler) => handler(runningEvent));

    assert.is(
      stepCalls,
      1,
      "pressing the step hotkey while running pauses and advances once",
    );
    assert.ok(
      simulation.uiManager.isPaused(),
      "hotkey leaves the simulation paused after stepping",
    );
    assert.ok(
      runningEvent.defaultPrevented,
      "hotkey prevents default behavior after resuming from running state",
    );

    const spaceToggleEvent = {
      key: " ",
      target: mockDocument.body,
      preventDefault() {
        this.defaultPrevented = true;
      },
      defaultPrevented: false,
    };

    keydownHandlers.forEach((handler) => handler(spaceToggleEvent));

    assert.ok(
      spaceToggleEvent.defaultPrevented,
      "space hotkey prevents default scrolling",
    );
    assert.ok(
      !simulation.uiManager.isPaused(),
      "pressing space resumes the simulation via the pause hotkey",
    );

    const spacePauseEvent = {
      key: " ",
      target: mockDocument.body,
      preventDefault() {
        this.defaultPrevented = true;
      },
      defaultPrevented: false,
    };

    keydownHandlers.forEach((handler) => handler(spacePauseEvent));

    assert.ok(
      simulation.uiManager.isPaused(),
      "pressing space again pauses the simulation",
    );
    assert.ok(
      spacePauseEvent.defaultPrevented,
      "space hotkey prevents default scrolling on subsequent presses",
    );
  } finally {
    simulation?.destroy?.();
    global.window = originalWindow;
    global.document = originalDocument;
    global.Node = originalNode;
    global.HTMLElement = originalHTMLElement;
    global.HTMLCanvasElement = originalHTMLCanvasElement;
  }
});
