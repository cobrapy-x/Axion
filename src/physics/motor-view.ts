// SPDX-License-Identifier: Apache-2.0
/** Drawing helpers shared by the motor views (front view of a gear motor). */

const NS = 'http://www.w3.org/2000/svg';

/** Front view of a motor: housing, rotating hub with spokes, and an RPM readout. */
export function motorFace(cx: number, cy: number, r: number, accent: string): string {
  const spokes = [0, 120, 240]
    .map((a) => `<rect x="${cx - 2.5}" y="${cy - r * 0.62}" width="5" height="${r * 0.62}" rx="2" fill="#e5e7eb" transform="rotate(${a} ${cx} ${cy})"/>`)
    .join('');
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#9ca3af" stroke="#4b5563" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="#374151"/>
    <g class="rotor">
      <circle cx="${cx}" cy="${cy}" r="${r * 0.7}" fill="#111827"/>
      ${spokes}
      <circle cx="${cx}" cy="${cy - r * 0.48}" r="${r * 0.11}" fill="${accent}"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.18}" fill="#d1d5db" stroke="#6b7280"/>
    </g>`;
}

/** Rotate the `.rotor` group and update the `.rpm` label. */
export function updateMotor(el: HTMLElement, cx: number, cy: number, s: Record<string, unknown>): void {
  const rotor = el.querySelector('.rotor');
  if (rotor) rotor.setAttribute('transform', `rotate(${Number(s.angle) || 0} ${cx} ${cy})`);
  const label = el.querySelector('.rpm');
  if (label) label.textContent = `${Number(s.rpm) || 0} rpm`;
}

export function resetMotor(el: HTMLElement): void {
  el.querySelector('.rotor')?.removeAttribute('transform');
  const label = el.querySelector('.rpm');
  if (label) label.textContent = '';
}

export function svgRoot(w: number, h: number, body: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui,sans-serif">${body}</svg>`;
  return el;
}

/**
 * A header pin drawn at (x, y) on the bottom edge of a part. The label is written
 * vertically above it so closely spaced pins stay readable.
 */
export function terminal(x: number, y: number, label: string, color = '#d4a017', textColor = '#f3f4f6'): string {
  const ty = y - 10;
  return `
    <rect x="${x - 3}" y="${y - 7}" width="6" height="7" fill="${color}" stroke="#7c5e0a" stroke-width="0.6"/>
    <text x="${x + 2.5}" y="${ty}" font-size="7.5" fill="${textColor}" transform="rotate(-90 ${x + 2.5} ${ty})">${label}</text>`;
}
