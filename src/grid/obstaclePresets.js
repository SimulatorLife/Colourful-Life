export const OBSTACLE_PRESETS = [
  {
    id: "none",
    label: "Open Field",
    description: "Clears all obstacles for free movement.",
  },
  {
    id: "midline",
    label: "Midline Wall",
    description: "Single vertical barrier with regular gates.",
  },
  {
    id: "corridor",
    label: "Triple Corridor",
    description: "Two vertical walls that divide the map into three lanes.",
  },
  {
    id: "checkerboard",
    label: "Checkerboard Gaps",
    description: "Alternating impassable tiles to force weaving paths.",
  },
  {
    id: "perimeter",
    label: "Perimeter Ring",
    description: "Walls around the rim that keep populations in-bounds.",
  },
  {
    id: "sealed-quadrants",
    label: "Sealed Quadrants",
    description: "Thick cross-shaped walls isolate four distinct quadrants.",
  },
  {
    id: "sealed-chambers",
    label: "Sealed Chambers",
    description: "Grid partitions create multiple closed rectangular chambers.",
  },
  {
    id: "corner-islands",
    label: "Corner Islands",
    description: "Four isolated pockets carved out of a blocked landscape.",
  },
];

function normalizeObstaclePreset(candidate) {
  if (!candidate) return null;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();

    if (!trimmed) return null;

    const match = OBSTACLE_PRESETS.find((preset) => preset.id === trimmed);

    return match ? { ...match } : null;
  }

  if (typeof candidate !== "object") return null;

  const id =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : "";

  if (!id) return null;

  const label =
    typeof candidate.label === "string" && candidate.label.trim().length > 0
      ? candidate.label
      : id;
  const normalized = { ...candidate, id, label };

  if (typeof candidate.description === "string") {
    normalized.description = candidate.description;
  } else if ("description" in normalized) {
    delete normalized.description;
  }

  return normalized;
}

/**
 * Resolves the obstacle preset catalog using optional user-supplied overrides.
 * Callers can pass either an array of preset descriptors/IDs or an object with
 * `{ presets, includeDefaults }`. Defaults are preserved unless explicitly
 * disabled so existing behaviour remains unchanged.
 *
 * @param {Array|{presets?: Array, includeDefaults?: boolean}} [candidate]
 *   Optional preset configuration supplied by embedding environments.
 * @returns {Array} Final preset catalog with defaults plus overrides.
 */
export function resolveObstaclePresetCatalog(candidate) {
  const isConfigObject =
    candidate && typeof candidate === "object" && !Array.isArray(candidate);
  const customPresets = Array.isArray(candidate)
    ? candidate
    : Array.isArray(candidate?.presets)
      ? candidate.presets
      : [];
  const includeDefaults = isConfigObject ? candidate.includeDefaults !== false : true;
  const catalog = [];
  const indexById = new Map();

  const addPreset = (preset, { allowOverride = true } = {}) => {
    const normalized = normalizeObstaclePreset(preset);

    if (!normalized) return;

    const existingIndex = indexById.get(normalized.id);

    if (existingIndex != null) {
      if (!allowOverride) return;

      catalog[existingIndex] = normalized;

      return;
    }

    indexById.set(normalized.id, catalog.length);
    catalog.push(normalized);
  };

  if (includeDefaults) {
    for (const preset of OBSTACLE_PRESETS) {
      addPreset(preset, { allowOverride: false });
    }
  }

  for (const preset of customPresets) {
    addPreset(preset, { allowOverride: true });
  }

  if (catalog.length === 0) {
    return OBSTACLE_PRESETS.map((preset) => normalizeObstaclePreset(preset)).filter(
      Boolean,
    );
  }

  return catalog;
}

export default OBSTACLE_PRESETS;
