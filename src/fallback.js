import { createRandom } from './math.js';
import { flatCameraFrame, projectToScreen } from './camera.js';

export function createFallback(canvas, state) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create an artwork canvas.');
  const random = createRandom(79);
  const stars = Array.from({ length: 1200 }, () => [random(), random(), random()]);
  let frameCount = 0;

  function resize() {
    canvas.width = Math.max(1, canvas.clientWidth);
    canvas.height = Math.max(1, canvas.clientHeight);
  }

  function render(time, interaction) {
    const { width, height } = canvas;
    const view = interaction.view;
    const frame = flatCameraFrame(view, width, height);
    const { scale } = frame;
    const [centerX, centerY] = frame.center;
    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#071326');
    background.addColorStop(0.55, '#0a1832');
    background.addColorStop(1, '#040910');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    for (const [horizontal, vertical, seed] of stars) {
      const angle = horizontal * Math.PI * 8 + time * 0.015 * state.flow / 65;
      const radius = vertical * width * 0.6;
      const positionX = width * 0.51 + Math.cos(angle + radius / 200) * radius;
      const positionY = height * 0.36 + Math.sin(angle + radius / 200) * radius * 0.33;
      context.strokeStyle = seed > 0.88 ? '#bd944d77' : '#35648c66';
      context.lineWidth = 0.6 + seed;
      context.beginPath();
      context.moveTo(positionX, positionY);
      context.lineTo(positionX + Math.cos(angle) * 5, positionY + Math.sin(angle) * 2);
      context.stroke();
    }
    context.save();
    context.translate(centerX, centerY);
    context.scale(scale, scale);
    context.shadowColor = state.palette ? '#ac6bf0' : '#588de6';
    context.shadowBlur = 20;
    context.fillStyle = state.palette ? '#8963ad77' : '#6483b177';
    context.strokeStyle = '#8abce6aa';
    context.lineWidth = 0.013;
    context.beginPath();
    context.moveTo(-0.4, -1.25);
    context.bezierCurveTo(-0.7, -0.5, -0.75, 0.1, -0.75, 0.45);
    context.lineTo(-0.64, 0.45);
    context.lineTo(-0.5, -0.35);
    context.bezierCurveTo(-0.28, -0.1, -0.25, 0.1, -0.4, 0.5);
    context.bezierCurveTo(-0.5, 1.1, -0.55, 2, -0.85, 2.53);
    context.quadraticCurveTo(0, 2.65, 0.85, 2.53);
    context.bezierCurveTo(0.5, 1.25, 0.42, 0.4, 0.3, 0.2);
    context.bezierCurveTo(0.2, -0.2, 0.4, -0.8, 0.45, -1.05);
    context.lineTo(0.88, -0.8);
    context.lineTo(1.17, -1.56);
    context.lineTo(1.08, -1.7);
    context.lineTo(0.83, -0.95);
    context.lineTo(0.48, -1.29);
    context.lineTo(0.15, -1.46);
    context.lineTo(-0.15, -1.46);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.ellipse(0, -2.18, 0.33, 0.49, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.strokeStyle = '#5274b3bb';
    context.lineWidth = 0.08;
    for (let strand = 0; strand < 12; strand += 1) {
      const side = strand < 6 ? -1 : 1;
      context.beginPath();
      context.moveTo(side * (0.21 + strand % 6 * 0.02), -2.48);
      context.bezierCurveTo(side * 0.42, -2.15, side * 0.4, -1.45, side * 0.55, -1.13);
      context.stroke();
    }
    context.strokeStyle = '#d2a45199';
    context.lineWidth = 0.012;
    context.beginPath();
    context.ellipse(0, 2.64, 1.1, 0.16, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    const age = time - interaction.ripple[3];
    if (age >= 0 && age < 4) {
      context.strokeStyle = `rgba(230,185,93,${Math.exp(-age) * 0.6})`;
      context.lineWidth = 1;
      context.beginPath();
      const point = projectToScreen(interaction.ripple.slice(0, 3), frame);
      context.arc(point[0] * width, (1 - point[1]) * height, age * scale * 2, 0, Math.PI * 2);
      context.stroke();
    }
    canvas.dataset.frames = String(++frameCount);
    canvas.dataset.time = time.toFixed(3);
    canvas.dataset.eye = JSON.stringify(frame.eye);
  }

  canvas.dataset.engine = 'canvas2d';
  canvas.dataset.particles = String(stars.length);
  resize();
  return { render, resize, dispose() {}, info: { engine: 'canvas2d', particles: stars.length } };
}
