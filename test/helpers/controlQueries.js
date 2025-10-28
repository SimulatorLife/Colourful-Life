function hasClass(element, className) {
  if (!element || typeof element.className !== "string") {
    return false;
  }

  return element.className.split(/\s+/).includes(className);
}

function extractTextContent(element) {
  if (!element) return "";
  if (typeof element.textContent === "string" && element.textContent.trim()) {
    return element.textContent;
  }
  if (!Array.isArray(element.children) || element.children.length === 0) {
    return "";
  }

  return element.children.map((child) => extractTextContent(child)).join("");
}

export function findCheckboxByLabel(root, label) {
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.shift();

    if (node && Array.isArray(node.children)) {
      queue.push(...node.children);
    }

    if (!node || node.tagName !== "LABEL" || !Array.isArray(node.children)) {
      continue;
    }

    const line = node.children[0];

    if (!line || !Array.isArray(line.children)) continue;

    const input = line.children.find((child) => child?.tagName === "INPUT");
    const directName = line.children.find(
      (child) => child?.className === "control-name",
    );
    const nestedLabel = line.children.find(
      (child) => child?.className === "control-checkbox-label",
    );
    const nestedName = Array.isArray(nestedLabel?.children)
      ? nestedLabel.children.find((child) => child?.className === "control-name")
      : null;
    const name = directName ?? nestedName;

    if (name && extractTextContent(name).trim() === label) {
      return input ?? null;
    }
  }

  return null;
}

export function findSliderByLabel(root, label) {
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.shift();

    if (node && Array.isArray(node.children)) {
      queue.push(...node.children);
    }

    if (!node || node.tagName !== "LABEL" || !Array.isArray(node.children)) {
      continue;
    }

    const name = node.children.find((child) => child?.className === "control-name");
    const line = node.children.find((child) => child?.className === "control-line");

    if (!line || !Array.isArray(line.children)) continue;

    const input = line.children.find(
      (child) => child?.tagName === "INPUT" && child?.type === "range",
    );

    if (!input) continue;

    if (name && extractTextContent(name).trim() === label) {
      return input;
    }
  }

  return null;
}

export function findSelectByLabel(root, label) {
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.shift();

    if (node && Array.isArray(node.children)) {
      queue.push(...node.children);
    }

    if (!node || node.tagName !== "LABEL" || !Array.isArray(node.children)) {
      continue;
    }

    const name = node.children.find((child) => child?.className === "control-name");
    const line = node.children.find((child) => hasClass(child, "control-line"));

    if (!line || !Array.isArray(line.children)) continue;

    const select = line.children.find((child) => child?.tagName === "SELECT");

    if (!select) continue;

    if (name && extractTextContent(name).trim() === label) {
      return select;
    }
  }

  return null;
}
