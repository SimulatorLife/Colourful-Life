import { cloneAstNode, assignClonedLocation } from "../shared/index.js";

const ADD = "+";
const SUBTRACT = "-";
const MULTIPLY = "*";
const DIVIDE = "/";

const BINARY_EXPRESSION = "BinaryExpression";
const CALL_EXPRESSION = "CallExpression";
const IDENTIFIER = "Identifier";
const LITERAL = "Literal";
const MEMBER_DOT_EXPRESSION = "MemberDotExpression";
const MEMBER_INDEX_EXPRESSION = "MemberIndexExpression";
const PARENTHESIZED_EXPRESSION = "ParenthesizedExpression";
const UNARY_EXPRESSION = "UnaryExpression";

const APPROXIMATION_EPSILON = Number.EPSILON * 12;

export function simplifyNumericExpressions(ast) {
  if (!ast || typeof ast !== "object") {
    return ast;
  }

  traverse(ast, new Set());

  return ast;
}

function traverse(node, seen) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (seen.has(node)) {
    return;
  }

  seen.add(node);

  if (Array.isArray(node)) {
    for (const element of node) {
      traverse(element, seen);
    }

    return;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      traverse(value, seen);
    }
  }

  if (node.type === BINARY_EXPRESSION) {
    simplifyBinaryExpression(node);
  } else if (node.type === PARENTHESIZED_EXPRESSION) {
    const expression = unwrapExpression(node.expression);

    if (expression && expression !== node.expression) {
      node.expression = expression;
    }
  } else if (node.type === UNARY_EXPRESSION && node.operator === "+") {
    const simplified = unwrapExpression(node.argument);

    if (simplified) {
      replaceNode(node, simplified);
    }
  }
}

function simplifyBinaryExpression(node) {
  const operator =
    typeof node.operator === "string" ? node.operator.toLowerCase() : null;

  if (operator === MULTIPLY || operator === DIVIDE) {
    const simplified = simplifyMultiplicativeExpression(node);

    if (simplified) {
      replaceNode(node, simplified);
    }

    return;
  }

  if (operator === ADD || operator === SUBTRACT) {
    const simplified = simplifyAdditiveExpression(node);

    if (simplified) {
      replaceNode(node, simplified);
    }
  }
}

function simplifyMultiplicativeExpression(node) {
  const { coefficient, numerator, denominator } = collectMultiplicativeFactors(node);

  const piIndex = numerator.findIndex((factor) => isPiIdentifier(factor));

  if (piIndex >= 0 && denominator.length === 0) {
    const remainingNumerator = numerator
      .slice(0, piIndex)
      .concat(numerator.slice(piIndex + 1));

    if (approximateEqual(coefficient, 1 / 180)) {
      const argument =
        buildProductExpression(
          remainingNumerator.map((factor) => cloneAstNode(factor)),
          node,
        ) ?? createNumericLiteral(1, node);

      return createCallExpression("degtorad", [argument], node);
    }
  }

  if (approximateZero(coefficient)) {
    return createNumericLiteral(0, node);
  }

  const numeratorFactors = numerator.map((factor) => cloneAstNode(factor));
  const denominatorFactors = denominator.map((factor) => cloneAstNode(factor));

  const sign = coefficient < 0 ? -1 : 1;
  const absoluteCoefficient = Math.abs(coefficient);

  if (!approximateEqual(absoluteCoefficient, 1)) {
    numeratorFactors.push(createNumericLiteral(absoluteCoefficient, node));
  }

  let product = buildProductExpression(numeratorFactors, node);

  if (sign < 0 && product) {
    product = createUnaryExpression("-", product, node);
  }

  if (!product) {
    product = createNumericLiteral(sign * absoluteCoefficient, node);
  }

  if (denominatorFactors.length === 0) {
    return product;
  }

  const denominatorProduct = buildProductExpression(denominatorFactors, node);

  if (!denominatorProduct) {
    return product;
  }

  return createBinaryExpression(DIVIDE, product, denominatorProduct, node);
}

function simplifyAdditiveExpression(node) {
  const terms = [];

  collectAdditiveTerms(node, 1, terms);

  if (terms.length === 0) {
    return null;
  }

  const merged = [];

  for (const term of terms) {
    if (approximateZero(term.coefficient)) {
      continue;
    }

    const match = merged.find((candidate) =>
      areFactorListsEquivalent(candidate.factors, term.factors),
    );

    if (match) {
      match.coefficient += term.coefficient;
      continue;
    }

    merged.push({
      coefficient: term.coefficient,
      factors: term.factors,
    });
  }

  const filtered = merged.filter((term) => !approximateZero(term.coefficient));

  if (filtered.length === 0) {
    return createNumericLiteral(0, node);
  }

  if (filtered.length === 1) {
    return buildTermExpression(filtered[0], node);
  }

  const [first, ...rest] = filtered;
  let expression = buildTermExpression(first, node);

  for (const term of rest) {
    const termExpression = buildPositiveTermExpression(term, node);

    if (!termExpression) {
      continue;
    }

    if (term.coefficient >= 0) {
      expression = createBinaryExpression(ADD, expression, termExpression, node);
    } else {
      expression = createBinaryExpression(SUBTRACT, expression, termExpression, node);
    }
  }

  return expression;
}

function collectAdditiveTerms(node, sign, output) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return;
  }

  if (expression.type === BINARY_EXPRESSION) {
    const operator =
      typeof expression.operator === "string" ? expression.operator : null;

    if (operator === ADD) {
      collectAdditiveTerms(expression.left, sign, output);
      collectAdditiveTerms(expression.right, sign, output);

      return;
    }

    if (operator === SUBTRACT) {
      collectAdditiveTerms(expression.left, sign, output);
      collectAdditiveTerms(expression.right, -sign, output);

      return;
    }
  }

  const factors = collectMultiplicativeFactors(expression);

  output.push({
    coefficient: factors.coefficient * sign,
    factors: factors.numerator,
  });
}

function buildTermExpression(term, template) {
  if (!term) {
    return null;
  }

  if (term.factors.length === 0) {
    return createNumericLiteral(term.coefficient, template);
  }

  const positive = buildPositiveTermExpression(term, template);

  if (!positive) {
    return createNumericLiteral(term.coefficient, template);
  }

  if (term.coefficient >= 0) {
    return positive;
  }

  return createUnaryExpression("-", positive, template);
}

function buildPositiveTermExpression(term, template) {
  const factors = term.factors.map((factor) => cloneAstNode(factor));
  const absolute = Math.abs(term.coefficient);

  if (factors.length === 0) {
    return createNumericLiteral(absolute, template);
  }

  if (!approximateEqual(absolute, 1)) {
    factors.push(createNumericLiteral(absolute, template));
  }

  return buildProductExpression(factors, template);
}

function collectMultiplicativeFactors(node) {
  const numerator = [];
  const denominator = [];
  let coefficient = 1;

  function helper(current, exponent) {
    const expression = unwrapExpression(current);

    if (!expression) {
      return;
    }

    if (expression.type === BINARY_EXPRESSION) {
      const operator =
        typeof expression.operator === "string" ? expression.operator : null;

      if (operator === MULTIPLY) {
        helper(expression.left, exponent);
        helper(expression.right, exponent);

        return;
      }

      if (operator === DIVIDE) {
        helper(expression.left, exponent);
        helper(expression.right, -exponent);

        return;
      }
    }

    if (expression.type === UNARY_EXPRESSION) {
      if (expression.operator === "-") {
        coefficient *= -1;
        helper(expression.argument, exponent);

        return;
      }

      if (expression.operator === "+") {
        helper(expression.argument, exponent);

        return;
      }
    }

    const numeric = evaluateNumericExpression(expression);

    if (numeric !== null) {
      if (exponent >= 0) {
        coefficient *= numeric;
      } else {
        coefficient /= numeric;
      }

      return;
    }

    if (exponent >= 0) {
      numerator.push(expression);
    } else {
      denominator.push(expression);
    }
  }

  helper(node, 1);
  cancelSharedFactors(numerator, denominator);

  return { coefficient, numerator, denominator };
}

function cancelSharedFactors(numerator, denominator) {
  if (numerator.length === 0 || denominator.length === 0) {
    return;
  }

  const denominatorUsage = new Array(denominator.length).fill(false);

  for (let i = numerator.length - 1; i >= 0; i -= 1) {
    const factor = numerator[i];

    for (let j = 0; j < denominator.length; j += 1) {
      if (denominatorUsage[j]) {
        continue;
      }

      if (areNodesEquivalent(factor, denominator[j])) {
        denominatorUsage[j] = true;
        numerator.splice(i, 1);
        break;
      }
    }
  }

  for (let index = denominatorUsage.length - 1; index >= 0; index -= 1) {
    if (denominatorUsage[index]) {
      denominator.splice(index, 1);
    }
  }
}

function areFactorListsEquivalent(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  const used = new Array(right.length).fill(false);

  outer: for (const factor of left) {
    for (let index = 0; index < right.length; index += 1) {
      if (used[index]) {
        continue;
      }

      if (areNodesEquivalent(factor, right[index])) {
        used[index] = true;
        continue outer;
      }
    }

    return false;
  }

  return true;
}

function buildProductExpression(factors, template) {
  if (!Array.isArray(factors) || factors.length === 0) {
    return null;
  }

  if (factors.length === 1) {
    return factors[0];
  }

  let expression = factors[0];

  for (let index = 1; index < factors.length; index += 1) {
    expression = createBinaryExpression(MULTIPLY, expression, factors[index], template);
  }

  return expression;
}

function evaluateNumericExpression(node) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return null;
  }

  if (expression.type === LITERAL) {
    return parseNumericLiteral(expression);
  }

  if (expression.type === UNARY_EXPRESSION) {
    const operand = evaluateNumericExpression(expression.argument);

    if (operand === null) {
      return null;
    }

    if (expression.operator === "-") {
      return -operand;
    }

    if (expression.operator === "+") {
      return operand;
    }

    return null;
  }

  if (expression.type === BINARY_EXPRESSION) {
    const left = evaluateNumericExpression(expression.left);
    const right = evaluateNumericExpression(expression.right);

    if (left === null || right === null) {
      return null;
    }

    switch (expression.operator) {
      case ADD:
        return left + right;
      case SUBTRACT:
        return left - right;
      case MULTIPLY:
        return left * right;
      case DIVIDE:
        if (approximateZero(right)) {
          return null;
        }

        return left / right;
      default:
        return null;
    }
  }

  return null;
}

function parseNumericLiteral(literal) {
  const raw = literal?.value;

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw === "string") {
    const parsed = Number(raw);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function approximateZero(value) {
  return Math.abs(value) <= APPROXIMATION_EPSILON;
}

function approximateEqual(left, right) {
  if (left === right) {
    return true;
  }

  const scale = Math.max(1, Math.abs(left), Math.abs(right));

  return Math.abs(left - right) <= scale * APPROXIMATION_EPSILON;
}

function createNumericLiteral(value, template) {
  let normalized = value;

  if (approximateZero(normalized)) {
    normalized = 0;
  }

  if (!Number.isFinite(normalized)) {
    return null;
  }

  const literal = {
    type: LITERAL,
    value: formatNumericLiteral(normalized),
  };

  assignClonedLocation(literal, template);

  return literal;
}

function formatNumericLiteral(value) {
  if (Number.isNaN(value)) {
    return "NaN";
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? "Infinity" : "-Infinity";
  }

  if (approximateZero(value)) {
    return "0";
  }

  let formatted = value.toFixed(15);

  formatted = formatted.replace(/(\.\d*?[1-9])0+$/u, "$1");
  formatted = formatted.replace(/\.0+$/u, "");

  if (formatted === "-0") {
    return "0";
  }

  return formatted;
}

function createBinaryExpression(operator, left, right, template) {
  const expression = {
    type: BINARY_EXPRESSION,
    operator,
    left,
    right,
  };

  assignClonedLocation(expression, template);

  return expression;
}

function createUnaryExpression(operator, argument, template) {
  const expression = {
    type: UNARY_EXPRESSION,
    operator,
    argument,
  };

  assignClonedLocation(expression, template);

  return expression;
}

function createCallExpression(name, args, template) {
  const identifier = createIdentifier(name, template);

  if (!identifier) {
    return null;
  }

  const call = {
    type: CALL_EXPRESSION,
    object: identifier,
    arguments: Array.isArray(args) ? args : [],
  };

  assignClonedLocation(call, template);

  return call;
}

function createIdentifier(name, template) {
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }

  const identifier = {
    type: IDENTIFIER,
    name,
  };

  assignClonedLocation(identifier, template);

  return identifier;
}

function replaceNode(target, replacement) {
  if (!replacement || typeof replacement !== "object") {
    return;
  }

  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, replacement);
}

function unwrapExpression(node) {
  let current = node;

  while (
    current &&
    typeof current === "object" &&
    current.type === PARENTHESIZED_EXPRESSION &&
    current.expression
  ) {
    current = current.expression;
  }

  return current ?? null;
}

function isPiIdentifier(node) {
  const expression = unwrapExpression(node);

  return (
    expression &&
    expression.type === IDENTIFIER &&
    typeof expression.name === "string" &&
    expression.name.toLowerCase() === "pi"
  );
}

function areNodesEquivalent(leftNode, rightNode) {
  if (leftNode === rightNode) {
    return true;
  }

  const left = unwrapExpression(leftNode);
  const right = unwrapExpression(rightNode);

  if (!left || !right || left.type !== right.type) {
    return false;
  }

  switch (left.type) {
    case IDENTIFIER:
      return left.name === right.name;
    case LITERAL:
      return left.value === right.value;
    case MEMBER_DOT_EXPRESSION:
      return (
        areNodesEquivalent(left.object, right.object) &&
        areNodesEquivalent(left.property, right.property)
      );
    case MEMBER_INDEX_EXPRESSION:
      return (
        areNodesEquivalent(left.object, right.object) &&
        compareIndexProperties(left.property, right.property)
      );
    case BINARY_EXPRESSION:
      return (
        left.operator === right.operator &&
        areNodesEquivalent(left.left, right.left) &&
        areNodesEquivalent(left.right, right.right)
      );
    case UNARY_EXPRESSION:
      return (
        left.operator === right.operator &&
        areNodesEquivalent(left.argument, right.argument)
      );
    case CALL_EXPRESSION: {
      const leftName = getIdentifierName(left.object);
      const rightName = getIdentifierName(right.object);

      if (leftName !== rightName) {
        return false;
      }

      const leftArgs = Array.isArray(left.arguments) ? left.arguments : [];
      const rightArgs = Array.isArray(right.arguments) ? right.arguments : [];

      if (leftArgs.length !== rightArgs.length) {
        return false;
      }

      for (let index = 0; index < leftArgs.length; index += 1) {
        if (!areNodesEquivalent(leftArgs[index], rightArgs[index])) {
          return false;
        }
      }

      return true;
    }
    default:
      return false;
  }
}

function compareIndexProperties(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areNodesEquivalent(left[index], right[index])) {
      return false;
    }
  }

  return true;
}

function getIdentifierName(node) {
  const expression = unwrapExpression(node);

  if (!expression || expression.type !== IDENTIFIER) {
    return null;
  }

  return expression.name ?? null;
}
