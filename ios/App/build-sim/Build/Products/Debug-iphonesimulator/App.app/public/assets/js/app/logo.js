export function logoMark(size = 40) {
  const s = size;
  const barW = s * 0.11;
  const gap = s * 0.055;
  const heights = [0.32, 0.5, 0.68, 0.46, 0.28];
  const colors = ['#35d6a0', '#35d6a0', '#35d6a0', '#f26483', '#f26483'];
  const totalW = heights.length * barW + (heights.length - 1) * gap;
  const startX = (s - totalW) / 2;
  const baseY = s * 0.78;
  const bars = heights.map((hf, i) => {
    const x = startX + i * (barW + gap);
    const h = s * hf;
    const y = baseY - h;
    const wickX = x + barW / 2;
    return `<line x1="${wickX}" y1="${y - s * 0.06}" x2="${wickX}" y2="${baseY + s * 0.05}" stroke="${colors[i]}" stroke-width="${Math.max(1, s * 0.02)}" opacity="0.55"/>
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="${barW * 0.25}" fill="${colors[i]}"/>`;
  }).join('');
  return `
  <svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" style="flex:none">
    <rect width="${s}" height="${s}" rx="${s * 0.26}" fill="#292b31"/>
    ${bars}
  </svg>`;
}
