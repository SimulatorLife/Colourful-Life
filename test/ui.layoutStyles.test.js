import { assert, suite } from "#tests/harness";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const test = suite("ui layout styles");

const stylesPath = fileURLToPath(new URL("../styles.css", import.meta.url));

const loadStyles = () => readFileSync(stylesPath, "utf8");

test("canvas container centers the canvas to preserve square aspect", () => {
  const css = loadStyles();
  const match = css.match(/\.canvas-container\s*\{[^}]*\}/s);

  assert.ok(match, "expected to locate the .canvas-container rule in styles.css");
  assert.match(
    match[0],
    /align-items\s*:\s*center\s*;/,
    "canvas container should center items to prevent stretching",
  );
});

test("canvas container stays anchored to the top when sidebar grows", () => {
  const css = loadStyles();
  const match = css.match(/\.canvas-container\s*\{[^}]*\}/s);

  assert.ok(match, "expected to locate the .canvas-container rule in styles.css");
  assert.match(
    match[0],
    /align-self\s*:\s*flex-start\s*;/,
    "canvas container should opt out of sidebar stretching to avoid jumping",
  );
});
