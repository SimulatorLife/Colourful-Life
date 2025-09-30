import { suite } from 'uvu';
import * as assert from 'uvu/assert';

import {
  createControlButtonRow,
  createControlGrid,
  createSectionHeading,
  createSelectRow,
  createSliderRow,
} from '../src/ui/controlBuilders.js';

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.value = '';
    this.type = '';
    this.eventListeners = Object.create(null);
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  addEventListener(event, handler) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  }

  trigger(event) {
    (this.eventListeners[event] || []).forEach((handler) => handler({ target: this }));
  }
}

class MockDocument {
  createElement(tagName) {
    return new MockElement(tagName);
  }
}

function withMockDocument(run) {
  const previousDocument = globalThis.document;
  const mockDocument = new MockDocument();

  globalThis.document = mockDocument;
  try {
    return run(mockDocument);
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
}

const controls = suite('ui control builders');

controls('createControlGrid constructs a grid container with optional modifier', () => {
  withMockDocument(() => {
    const parent = document.createElement('section');
    const defaultGrid = createControlGrid(parent);

    assert.is(defaultGrid.tagName, 'DIV');
    assert.is(defaultGrid.className, 'control-grid');
    assert.is(parent.children.length, 1);
    assert.is(parent.children[0], defaultGrid);

    const customGrid = createControlGrid(parent, 'primary');

    assert.is(customGrid.className, 'control-grid primary');
    assert.is(parent.children.length, 2);
  });
});

controls('createSectionHeading renders headings with customizable class', () => {
  withMockDocument(() => {
    const parent = document.createElement('div');
    const heading = createSectionHeading(parent, 'Status', { className: 'status-heading' });

    assert.is(heading.tagName, 'H4');
    assert.is(heading.textContent, 'Status');
    assert.is(heading.className, 'status-heading');
    assert.is(parent.children[0], heading);
  });
});

controls('createControlButtonRow wraps buttons inside a flex row', () => {
  withMockDocument(() => {
    const parent = document.createElement('div');
    const row = createControlButtonRow(parent, { className: 'actions' });

    assert.is(row.tagName, 'DIV');
    assert.is(row.className, 'actions');
    assert.is(parent.children[0], row);
  });
});

controls('createSliderRow wires live formatting and change callbacks', () => {
  withMockDocument(() => {
    const parent = document.createElement('div');
    let receivedValue = null;
    const input = createSliderRow(parent, {
      label: 'Energy',
      min: 0,
      max: 10,
      step: 0.5,
      value: 2.5,
      title: 'Energy budget',
      format: (value) => `${value.toFixed(1)} J`,
      onInput: (value) => {
        receivedValue = value;
      },
    });

    const row = parent.children[0];
    const [label, line] = row.children;
    const [range, liveValue] = line.children;

    assert.is(row.tagName, 'LABEL');
    assert.is(row.title, 'Energy budget');
    assert.is(label.className, 'control-name');
    assert.is(label.textContent, 'Energy');
    assert.is(line.children.length, 2);
    assert.is(range.type, 'range');
    assert.is(range.min, '0');
    assert.is(range.max, '10');
    assert.is(range.step, '0.5');
    assert.is(range.value, '2.5');
    assert.is(liveValue.textContent, '2.5 J');

    range.value = '7.5';
    range.trigger('input');

    assert.is(liveValue.textContent, '7.5 J');
    assert.is(receivedValue, 7.5);
  });
});

controls('createSelectRow renders dropdowns and invokes change callbacks', () => {
  withMockDocument(() => {
    const parent = document.createElement('div');
    let changeCount = 0;
    const select = createSelectRow(parent, {
      label: 'Climate',
      title: 'Pick a climate preset',
      value: 'temperate',
      options: [
        null,
        { value: 'temperate', label: 'Temperate', description: 'Balanced seasons' },
        { value: 'arid', label: 'Arid' },
      ],
      onChange: () => {
        changeCount += 1;
      },
    });

    const row = parent.children[0];
    const [, line] = row.children;

    assert.is(row.tagName, 'LABEL');
    assert.is(row.title, 'Pick a climate preset');
    assert.is(select.tagName, 'SELECT');
    assert.is(select.value, 'temperate');
    assert.is(select.children.length, 2);
    assert.is(select.children[0].title, 'Balanced seasons');

    select.value = 'arid';
    select.trigger('input');

    assert.is(changeCount, 1);
  });
});

controls.run();
