export function createControlGrid(parent, className = '') {
  const grid = document.createElement('div');

  grid.className = className ? `control-grid ${className}` : 'control-grid';
  parent.appendChild(grid);

  return grid;
}

export function createSectionHeading(parent, text, options = {}) {
  const { className = 'control-section-title' } = options || {};
  const heading = document.createElement('h4');

  heading.className = className;
  heading.textContent = text;
  parent.appendChild(heading);

  return heading;
}

export function createControlButtonRow(parent, options = {}) {
  const { className = 'control-button-row' } = options || {};
  const row = document.createElement('div');

  row.className = className;
  parent.appendChild(row);

  return row;
}

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
