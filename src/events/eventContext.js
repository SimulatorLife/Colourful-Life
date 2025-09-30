import { getEventEffect } from '../eventEffects.js';

/**
 * Determines whether the supplied event overlaps the provided grid
 * coordinates. Events operate on rectangular regions described by their
 * `affectedArea` bounds.
 *
 * @param {Object} event - Event definition.
 * @param {number} row - Tile row to test.
 * @param {number} col - Tile column to test.
 * @returns {boolean} Whether the tile is affected by the event.
 */
export function defaultIsEventAffecting(event, row, col) {
  if (!event || !event.affectedArea) return false;
  const { x, y, width, height } = event.affectedArea;

  return row >= y && row < y + height && col >= x && col < x + width;
}

function toFunction(candidate, fallback) {
  return typeof candidate === 'function' ? candidate : fallback;
}

/**
 * Produces a normalized event context consumed by grid energy logic. Consumers
 * can inject custom `isEventAffecting`/`getEventEffect` helpers while falling
 * back to canonical behaviour otherwise.
 *
 * @param {Object} [overrides]
 * @param {Function} [overrides.isEventAffecting]
 * @param {Function} [overrides.getEventEffect]
 * @returns {{isEventAffecting: Function, getEventEffect: Function}}
 */
export function createEventContext(overrides = {}) {
  const context = overrides && typeof overrides === 'object' ? overrides : {};
  const isEventAffecting = toFunction(context.isEventAffecting, defaultIsEventAffecting);
  const resolveEventEffect = toFunction(context.getEventEffect, getEventEffect);

  return { isEventAffecting, getEventEffect: resolveEventEffect };
}

export const defaultEventContext = createEventContext();
