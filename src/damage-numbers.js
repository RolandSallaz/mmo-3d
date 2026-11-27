const LIFETIME = 950;
const BURST_WINDOW = 105;

export function addDamageNumber(numbers, hit, time) {
  const burst = numbers.findLast((entry) => time - entry.time <= BURST_WINDOW && entry.target === hit.target);
  if (burst) {
    burst.hull += hit.hull;
    burst.shield += hit.shield;
    return;
  }
  const overlap = numbers.filter((entry) => entry.target === hit.target && time - entry.time < 520).length;
  const lane = [0, 1, -1, 2, -2][overlap % 5];
  numbers.push({ ...hit, time, offset: lane * 24 });
}

export function drawDamageNumbers(ctx, numbers, xOffset, yOffset, width, height, time) {
  while (numbers.length && time - numbers[0].time >= LIFETIME) numbers.shift();
  if (!numbers.length) return false;
  ctx.save();
  ctx.font = "bold 17px system-ui";
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#140e1c";
  ctx.lineWidth = 3;
  for (const number of numbers) {
    const progress = Math.max(0, (time - number.time) / LIFETIME);
    const x = number.x + xOffset + number.offset;
    const y = number.y + yOffset - 27 - 45 * progress;
    if (x < -75 || x > width + 75 || y < -20 || y > height + 20) continue;
    ctx.globalAlpha = Math.min(1, (1 - progress) * 2.4);
    if (number.shield) {
      drawValue(ctx, number.shield, x, y, "#87eaff");
    }
    if (number.hull) {
      drawValue(ctx, number.hull, x, y + (number.shield ? 19 : 0), number.incoming ? "#ff8671" : "#ffdb83");
    }
  }
  ctx.restore();
  return true;
}

function drawValue(ctx, value, x, y, color) {
  const text = `−${Math.max(0.1, Math.round(value * 10) / 10).toString().replace(".", ",")}`;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
