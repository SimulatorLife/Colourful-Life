import { toPlainObject } from "../utils/object.js";

let controlRowSequence = 0;

/**
 * Creates the two-column grid wrapper used across control panels.
 *
 * @param {HTMLElement} parent - Node the grid is appended to.
 * @param {string} [className] - Optional modifier class.
 * @returns {HTMLDivElement} Rendered grid element.
 */
export function createControlGrid(parent, className = "") {
  const grid = document.createElement("div");

  grid.className = className ? `control-grid ${className}` : "control-grid";
  parent.appendChild(grid);

  return grid;
}

/**
 * Renders a section heading to group related controls.
 *
 * @param {HTMLElement} parent - Node the heading is appended to.
 * @param {string} text - Heading text content.
 * @param {{className?: string}} [options] - Styling overrides.
 * @returns {HTMLHeadingElement} Created heading element.
 */
export function createSectionHeading(parent, text, options = {}) {
  const { className = "control-section-title" } = toPlainObject(options);
  const heading = document.createElement("h4");

  heading.className = className;
  heading.textContent = text;
  parent.appendChild(heading);

  return heading;
}

/**
 * Builds a flex row for action buttons within the control grid.
 *
 * @param {HTMLElement} parent - Container node.
 * @param {{className?: string}} [options] - Styling overrides.
 * @returns {HTMLDivElement} Wrapper element for buttons.
 */
export function createControlButtonRow(parent, options = {}) {
  const { className = "control-button-row" } = toPlainObject(options);
  const row = document.createElement("div");

  row.className = className;
  parent.appendChild(row);

  return row;
}

/**
 * Shared factory that renders the labelled row shell used by sliders and
 * select dropdowns.
 *
 * @param {HTMLElement} parent - Node receiving the rendered row.
 * @param {string} labelText - Text content shown in the left column.
 * @param {{title?: string, lineClass?: string}} [options] - Optional
 *   configuration for the row.
 * @returns {{row: HTMLLabelElement, name: HTMLDivElement, line: HTMLDivElement}}
 *   The created row wrapper elements.
 */
function createLabeledControlRow(parent, labelText, options = {}) {
  const { title, lineClass } = toPlainObject(options);
  const row = document.createElement("label");

  row.className = "control-row";
  if (title) row.title = title;
  const name = document.createElement("div");

  name.className = "control-name";
  name.textContent = labelText != null ? String(labelText) : "";
  const line = document.createElement("div");

  line.className = lineClass || "control-line";
  row.appendChild(name);
  row.appendChild(line);
  parent.appendChild(row);

  return { row, name, line };
}

/**
 * Creates a labelled slider row with live value feedback.
 *
 * @param {HTMLElement} parent - Container node.
 * @param {Object} opts - Slider options.
 * @param {string} opts.label - Display label for the control.
 * @param {number} opts.min - Minimum slider value.
 * @param {number} opts.max - Maximum slider value.
 * @param {number} opts.step - Slider step size.
 * @param {number} opts.value - Initial slider value.
 * @param {string} [opts.title] - Optional tooltip.
 * @param {(value:number)=>void} [opts.onInput] - Callback invoked on change.
 * @param {(value:number)=>string} [opts.format] - Formatter for the live value.
 * @returns {HTMLInputElement} The generated range input element.
 */
export function createSliderRow(parent, opts = {}) {
  const {
    label,
    min,
    max,
    step,
    value,
    title,
    onInput,
    format = (v) => String(v),
  } = toPlainObject(opts);
  const { line } = createLabeledControlRow(parent, label, { title });
  const valSpan = document.createElement("span");

  valSpan.className = "control-value";
  valSpan.textContent = format(value);
  const input = document.createElement("input");

  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const updateDisplay = (nextValue) => {
    const numericValue = Number(nextValue);

    if (Number.isFinite(numericValue)) {
      input.value = String(numericValue);
      valSpan.textContent = format(numericValue);
    }
  };

  input.addEventListener("input", () => {
    const numericValue = Number.parseFloat(input.value);

    valSpan.textContent = format(numericValue);
    if (typeof onInput === "function") onInput(numericValue);
  });
  input.updateDisplay = updateDisplay;
  line.appendChild(input);

  line.appendChild(valSpan);

  return input;
}

/**
 * Creates a labelled numeric input row with optional suffix text and helper
 * copy.
 *
 * @param {HTMLElement} parent - Container node.
 * @param {Object} opts - Input options.
 * @param {string} opts.label - Display label for the control.
 * @param {number} [opts.min] - Minimum accepted value.
 * @param {number} [opts.max] - Maximum accepted value.
 * @param {number} [opts.step=1] - Increment applied when using the input arrows.
 * @param {number} [opts.value] - Initial value shown in the input.
 * @param {string} [opts.title] - Optional tooltip description.
 * @param {string} [opts.suffix] - Optional suffix rendered beside the input.
 * @param {string} [opts.description] - Optional helper text rendered below the row.
 * @param {(value:number)=>void} [opts.onChange] - Callback invoked when value changes.
 * @returns {HTMLInputElement} The generated number input element.
 */
export function createNumberInputRow(parent, opts = {}) {
  const {
    label,
    min,
    max,
    step = 1,
    value,
    title,
    suffix,
    description,
    onChange,
  } = toPlainObject(opts);

  const { line } = createLabeledControlRow(parent, label, { title });
  const input = document.createElement("input");

  input.type = "number";
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  if (step != null) input.step = String(step);
  if (value != null && value !== "") {
    input.value = String(value);
  }

  const numericStep = Number(step);

  if (Number.isFinite(numericStep)) {
    const isIntegerStep = Number.isInteger(numericStep);

    input.inputMode = isIntegerStep ? "numeric" : "decimal";
  }

  const handleChange = () => {
    if (typeof onChange !== "function") return;

    const numericValue = Number.parseFloat(input.value);

    if (Number.isFinite(numericValue)) {
      onChange(numericValue);
    }
  };

  input.addEventListener("change", handleChange);

  input.updateDisplay = (nextValue) => {
    const numericValue = Number(nextValue);

    if (Number.isFinite(numericValue)) {
      input.value = String(numericValue);
    }
  };

  line.appendChild(input);

  const rowElement = line.parentElement;

  if (suffix) {
    const suffixEl = document.createElement("span");

    suffixEl.className = "control-value control-suffix";
    suffixEl.textContent = suffix;
    line.appendChild(suffixEl);
    line.classList.add("control-line--with-suffix");
  }

  if (description) {
    const descriptionEl = document.createElement("p");

    descriptionEl.className = "control-description control-hint";
    descriptionEl.textContent = description;
    const descriptionId = `control-description-${controlRowSequence++}`;

    descriptionEl.id = descriptionId;
    rowElement?.appendChild(descriptionEl);

    const readDescribedBy = () => {
      if (typeof input.getAttribute === "function") {
        return input.getAttribute("aria-describedby");
      }

      if (input.attributes && typeof input.attributes === "object") {
        const raw = input.attributes["aria-describedby"];

        if (typeof raw === "string") return raw;
      }

      return input.ariaDescribedby || input.ariaDescribedBy || "";
    };

    const existingDescription = readDescribedBy();
    const nextDescription = existingDescription
      ? `${existingDescription} ${descriptionId}`
      : descriptionId;

    if (typeof input.setAttribute === "function") {
      input.setAttribute("aria-describedby", nextDescription.trim());
    } else {
      input.ariaDescribedby = nextDescription.trim();
    }
  }

  return input;
}

/**
 * Creates a labelled `<select>` dropdown row.
 *
 * @param {HTMLElement} parent - Container node.
 * @param {Object} opts - Dropdown options.
 * @param {string} opts.label - Display label.
 * @param {string} [opts.title] - Optional tooltip text.
 * @param {string} [opts.value] - Selected option value.
 * @param {{value:string,label:string,description?:string}[]} [opts.options] -
 *   Select options with optional descriptions.
 * @param {(value:string)=>void} [opts.onChange] - Invoked when the selection
 *   changes.
 * @returns {HTMLSelectElement} The generated select element.
 */
export function createSelectRow(parent, opts = {}) {
  const { label, title, value, options = [], onChange } = toPlainObject(opts);
  const { line } = createLabeledControlRow(parent, label, { title });
  const select = document.createElement("select");

  options.forEach((option) => {
    if (!option) return;
    const opt = document.createElement("option");

    opt.value = option.value;
    opt.textContent = option.label;
    if (option.description) opt.title = option.description;
    select.appendChild(opt);
  });
  if (value !== undefined) select.value = value;
  let lastEmittedValue = select.value;
  const handleChange = () => {
    if (typeof onChange !== "function") return;
    const nextValue = select.value;

    if (nextValue === lastEmittedValue) return;

    lastEmittedValue = nextValue;
    onChange(nextValue);
  };

  select.addEventListener("change", handleChange);
  select.addEventListener("input", handleChange);
  line.appendChild(select);

  return select;
}
