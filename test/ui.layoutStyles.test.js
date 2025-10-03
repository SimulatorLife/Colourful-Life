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

test("controls panel header no longer loses width to the scrollbar gutter", () => {
  const css = loadStyles();
  const match = css.match(/\.controls-panel\s*\{[^}]*\}/s);

  assert.ok(match, "expected to locate the .controls-panel rule in styles.css");
  assert.match(
    match[0],
    /display\s*:\s*flex\s*;/,
    "controls panel should use flexbox so the header and body share width",
  );
  assert.match(
    match[0],
    /flex-direction\s*:\s*column\s*;/,
    "controls panel should stack its header above the scrollable body",
  );
  assert.notMatch(
    match[0],
    /overflow\s*:/,
    "overflow is managed on the panel body to keep the toggle aligned",
  );
  assert.notMatch(
    match[0],
    /scrollbar-gutter\s*:/,
    "scrollbar gutter should be applied to the body so the header keeps its width",
  );
});

test("controls panel body manages scrolling and gutter spacing", () => {
  const css = loadStyles();
  const match = css.match(/\.controls-panel\s*\.panel-body\s*\{[^}]*\}/s);

  assert.ok(
    match,
    "expected to locate the .controls-panel .panel-body rule in styles.css",
  );
  assert.match(
    match[0],
    /overflow\s*:\s*auto\s*;/,
    "panel body should scroll independently so the header alignment stays fixed",
  );
  assert.match(
    match[0],
    /scrollbar-gutter\s*:\s*stable\s*;/,
    "panel body should reserve gutter space to avoid layout shifts",
  );
  assert.match(
    match[0],
    /min-height\s*:\s*0\s*;/,
    "panel body should allow flexbox to shrink it for scrolling",
  );
});
