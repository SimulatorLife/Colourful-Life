/**
 * Creates the two-column grid wrapper used across control panels.
 *
 * @param {HTMLElement} parent - Node the grid is appended to.
 * @param {string} [className] - Optional modifier class.
 * @returns {HTMLDivElement} Rendered grid element.
 */
export function createControlGrid(parent, className = '') {
  const grid = document.createElement('div');

  grid.className = className ? `control-grid ${className}` : 'control-grid';
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
  const { className = 'control-section-title' } = options || {};
  const heading = document.createElement('h4');

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
  const { className = 'control-button-row' } = options || {};
  const row = document.createElement('div');

  row.className = className;
  parent.appendChild(row);

  return row;
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
  const { label, min, max, step, value, title, onInput, format = (v) => String(v) } = opts;
  const row = document.createElement('label');

  row.className = 'control-row';
  if (title) row.title = title;
  const name = document.createElement('div');

  name.className = 'control-name';
  name.textContent = label;
  const valSpan = document.createElement('span');

  valSpan.className = 'control-value';
  valSpan.textContent = format(value);
  const input = document.createElement('input');

  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const numericValue = parseFloat(input.value);

    valSpan.textContent = format(numericValue);
    if (typeof onInput === 'function') onInput(numericValue);
  });
  const line = document.createElement('div');

  line.className = 'control-line';
  line.appendChild(input);
  line.appendChild(valSpan);
  row.appendChild(name);
  row.appendChild(line);
  parent.appendChild(row);

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
  const { label, title, value, options = [], onChange } = opts;
  const row = document.createElement('label');

  row.className = 'control-row';
  if (title) row.title = title;
  const name = document.createElement('div');

  name.className = 'control-name';
  name.textContent = label;
  const line = document.createElement('div');

  line.className = 'control-line';
  const select = document.createElement('select');

  options.forEach((option) => {
    if (!option) return;
    const opt = document.createElement('option');

    opt.value = option.value;
    opt.textContent = option.label;
    if (option.description) opt.title = option.description;
    select.appendChild(opt);
  });
  if (value !== undefined) select.value = value;
  select.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange(select.value);
  });
  line.appendChild(select);
  row.appendChild(name);
  row.appendChild(line);
  parent.appendChild(row);

  return select;
}
