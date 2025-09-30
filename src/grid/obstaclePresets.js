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

export default OBSTACLE_PRESETS;
