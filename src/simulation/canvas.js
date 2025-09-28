export function resolveCanvas(canvas, documentRef) {
  if (canvas) return canvas;

  if (documentRef && typeof documentRef.getElementById === 'function') {
    return documentRef.getElementById('gameCanvas');
  }

  return null;
}

export function ensureCanvasDimensions(canvas, config) {
  const candidates = [config?.width, config?.canvasWidth, config?.canvasSize?.width, canvas?.width];
  const heightCandidates = [
    config?.height,
    config?.canvasHeight,
    config?.canvasSize?.height,
    canvas?.height,
  ];

  const width = candidates.find((value) => typeof value === 'number');
  const height = heightCandidates.find((value) => typeof value === 'number');

  if (canvas && typeof width === 'number') canvas.width = width;
  if (canvas && typeof height === 'number') canvas.height = height;

  if (typeof canvas?.width === 'number' && typeof canvas?.height === 'number') {
    return { width: canvas.width, height: canvas.height };
  }

  if (typeof width === 'number' && typeof height === 'number') {
    return { width, height };
  }

  throw new Error('Simulation requires canvas dimensions to be specified.');
}
