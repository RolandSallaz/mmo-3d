const shellImages = new WeakMap();
const FRAME_COUNT = 48;
const FRAME_COLUMNS = 8;
const FRAME_SCALE = 1.5;
const SHIMMER_PERIOD = 2900;
const TAU = 2 * Math.PI;

function projectedHexes(radius) {
  const side = radius / 5.1;
  const cells = [];
  const tilt = 0.2;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);

  for (let row = -5; row <= 5; row++) {
    for (let col = -5; col <= 5; col++) {
      const u = (col + (Math.abs(row) % 2) * 0.5) * Math.sqrt(3) * side;
      const v = row * 1.5 * side;
      if (Math.hypot(u, v) > radius + side * 0.3) continue;

      const path = new Path2D();
      for (let edge = 0; edge < 6; edge++) {
        const angle = edge * TAU / 6 + TAU / 12;
        const nextAngle = angle + TAU / 6;
        const ax = Math.cos(angle) * side;
        const ay = Math.sin(angle) * side;
        for (let step = 0; step < 3; step++) {
          const t = step / 3;
          const px = u + ax * (1 - t) + Math.cos(nextAngle) * side * t;
          const py = v + ay * (1 - t) + Math.sin(nextAngle) * side * t;
          const x = px * cosTilt - py * sinTilt;
          const y = px * sinTilt + py * cosTilt;
          const distance = Math.hypot(x, y);
          const fraction = distance / radius;
          const corrected = fraction <= 1
            ? Math.sin(fraction * Math.PI / 2)
            : 1 + (fraction - 1) * 0.25;
          const scale = distance ? corrected * radius / distance : 1;
          if (edge === 0 && step === 0) path.moveTo(x * scale, y * scale);
          else path.lineTo(x * scale, y * scale);
        }
      }
      path.closePath();
      cells.push({ path, phase: u * 0.12 + v * 0.085 });
    }
  }
  return cells;
}

function createShell(model) {
  const radius = model.radius;
  const frameExtent = Math.ceil((radius + 10) * 2 * FRAME_SCALE);
  const extent = frameExtent / FRAME_SCALE;
  const center = extent / 2;

  const base = document.createElement("canvas");
  base.width = base.height = frameExtent;
  const surface = base.getContext("2d");
  surface.setTransform(FRAME_SCALE, 0, 0, FRAME_SCALE, frameExtent / 2, frameExtent / 2);
  const tint = (alpha) => `rgba(${model.color}, ${alpha})`;

  const glow = surface.createRadialGradient(0, 0, radius * 0.91, 0, 0, center);
  glow.addColorStop(0, tint(0));
  glow.addColorStop(0.35, tint(0.27));
  glow.addColorStop(1, tint(0));
  surface.fillStyle = glow;
  surface.fillRect(-center, -center, extent, extent);

  const disk = new Path2D();
  disk.arc(0, 0, radius, 0, TAU);
  const rim = surface.createRadialGradient(0, 0, 0, 0, 0, radius);
  rim.addColorStop(0, tint(0.015));
  rim.addColorStop(0.66, tint(0.045));
  rim.addColorStop(0.9, tint(0.16));
  rim.addColorStop(1, tint(0.43));
  surface.fillStyle = rim;
  surface.fill(disk);

  const [cool, warm] = model.shimmerHues ?? [185, 274];
  const hexes = projectedHexes(radius);
  const atlas = document.createElement("canvas");
  atlas.width = frameExtent * FRAME_COLUMNS;
  atlas.height = frameExtent * Math.ceil(FRAME_COUNT / FRAME_COLUMNS);
  const context = atlas.getContext("2d");

  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const x = (frame % FRAME_COLUMNS) * frameExtent;
    const y = Math.floor(frame / FRAME_COLUMNS) * frameExtent;
    const phase = frame * TAU / FRAME_COUNT;
    context.resetTransform();
    context.drawImage(base, x, y);
    context.setTransform(FRAME_SCALE, 0, 0, FRAME_SCALE, x + frameExtent / 2, y + frameExtent / 2);
    context.save();
    context.clip(disk);
    context.lineJoin = "round";
    context.lineWidth = 0.68;
    for (const cell of hexes) {
      const wave = (1 + Math.cos(cell.phase - phase)) / 2;
      const sheen = wave ** 3;
      const hue = cool + (warm - cool) * ((1 + Math.sin(cell.phase * 0.63 + phase)) / 2);
      context.fillStyle = `hsla(${hue}, 92%, 61%, ${0.02 + sheen * 0.14})`;
      context.strokeStyle = `hsla(${hue}, 100%, ${62 + sheen * 19}%, ${0.14 + sheen * 0.52})`;
      context.fill(cell.path);
      context.stroke(cell.path);
    }
    context.restore();

    const spectrum = context.createConicGradient(phase, 0, 0);
    spectrum.addColorStop(0, tint(0.66));
    spectrum.addColorStop(0.1, `hsla(${cool}, 100%, 85%, 0.95)`);
    spectrum.addColorStop(0.31, `hsla(${warm}, 96%, 77%, 0.85)`);
    spectrum.addColorStop(0.55, tint(0.46));
    spectrum.addColorStop(0.79, `hsla(${cool}, 100%, 74%, 0.79)`);
    spectrum.addColorStop(1, tint(0.66));
    context.lineWidth = 1.3;
    context.strokeStyle = spectrum;
    context.stroke(disk);
  }

  return { atlas, frameExtent, extent };
}

export function drawShieldShell(context, model, x, y, time) {
  if (!shellImages.has(model)) shellImages.set(model, createShell(model));
  const { atlas, frameExtent, extent } = shellImages.get(model);
  const frame = Math.floor(time * FRAME_COUNT / SHIMMER_PERIOD) % FRAME_COUNT;
  const sourceX = (frame % FRAME_COLUMNS) * frameExtent;
  const sourceY = Math.floor(frame / FRAME_COLUMNS) * frameExtent;
  context.drawImage(atlas, sourceX, sourceY, frameExtent, frameExtent,
    x - extent / 2, y - extent / 2, extent, extent);
}
