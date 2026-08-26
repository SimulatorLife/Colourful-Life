import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
);

test("package scripts expose dev as the canonical Parcel development command", () => {
  assert.equal(packageJson.scripts.dev, "parcel ./index.html");
  assert.equal(packageJson.scripts.start, undefined);
});
