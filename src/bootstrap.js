import { createSimulation } from "./main.js";
import { resolveBootstrapOptions } from "./bootstrapConfig.js";

const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};
const DOCUMENT = typeof document !== "undefined" ? document : null;

const options = resolveBootstrapOptions({
  globalOptions: GLOBAL.COLOURFUL_LIFE_BOOT_OPTIONS,
  documentRef: DOCUMENT,
});

createSimulation(options);
