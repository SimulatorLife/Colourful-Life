import GridInteractionAdapter from "./gridAdapter.js";

/**
 * Default factory used when no custom interaction adapter factory has been
 * registered. The function only depends on the constructor arguments provided
 * by callers, keeping the {@link GridInteractionAdapter} reference localized to
 * this module so higher-level systems do not couple to the concrete
 * implementation.
 *
 * @param {{
 *   gridManager?: import("./gridManager.js").default|null,
 *   options?: object,
 * }} [context]
 *   Optional context describing the active grid manager.
 * @returns {import("./gridAdapter.js").default} Interaction adapter instance.
 */
const defaultFactory = ({ gridManager } = {}) =>
  new GridInteractionAdapter({ gridManager });

let interactionAdapterFactory = defaultFactory;

/**
 * Registers a custom factory used to create interaction adapters for the grid.
 * Supplying a falsy or non-function value restores the default factory.
 *
 * @param {(context: {
 *   gridManager?: import("./gridManager.js").default|null,
 *   options?: object,
 * }) => import("./gridAdapter.js").default} [factory]
 */
export function setInteractionAdapterFactory(factory) {
  interactionAdapterFactory = typeof factory === "function" ? factory : defaultFactory;
}

/**
 * Restores the default interaction adapter factory.
 */
export function resetInteractionAdapterFactory() {
  interactionAdapterFactory = defaultFactory;
}

/**
 * Returns the currently registered interaction adapter factory.
 *
 * @returns {(context: {
 *   gridManager?: import("./gridManager.js").default|null,
 *   options?: object,
 * }) => import("./gridAdapter.js").default}
 */
export function getInteractionAdapterFactory() {
  return interactionAdapterFactory;
}

/**
 * Creates a new interaction adapter using the registered factory.
 *
 * @param {{
 *   gridManager?: import("./gridManager.js").default|null,
 *   options?: object,
 * }} [context]
 *   Optional context describing the active grid manager.
 * @returns {import("./gridAdapter.js").default}
 */
export function createInteractionAdapter(context = {}) {
  return interactionAdapterFactory(context);
}
