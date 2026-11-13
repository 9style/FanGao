import { clamp, cross, lookAt, multiplyMatrices, normalize, perspective, subtract } from './math.js';
import { isNarrowLayout, isPhonePortrait } from './device.js';

const minimumDistance = 2.6;
const maximumDistance = 22;
const maximumPitch = 75 * Math.PI / 180;

export function createView() {
  return {
    active: false, immersive: false, framing: null,
    yaw: 0, pitch: 0, distance: 13.3,
    pan: [0, 0, 0], focus: [0, -0.65, 0], preset: 'composition',
  };
}

function activateView(view, frame) {
  if (view.active) return;
  if (frame?.flat) {
    view.distance = frame.distance;
  } else if (frame) {
    const center = view.focus.map((component, axis) => component + view.pan[axis] + (axis < 2 ? frame.offset[axis] : 0));
    const delta = subtract(frame.eye, center);
    view.distance = Math.hypot(...delta);
    const direction = normalize(delta);
    view.yaw = Math.atan2(direction[0], direction[2]);
    view.pitch = Math.asin(clamp(direction[1], -1, 1));
    const right = normalize(cross([0, 1, 0], direction));
    const up = cross(direction, right);
    const lookOffset = subtract(frame.target, center);
    view.framing = {
      distance: view.distance,
      offset: [right, up, direction].map(basis => basis.reduce((sum, component, axis) => sum + component * lookOffset[axis], 0)),
    };
  }
  view.active = true;
}

export function orbitView(view, horizontal, vertical, frame) {
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return;
  activateView(view, frame);
  view.yaw += horizontal;
  view.pitch = clamp(view.pitch + vertical, -maximumPitch, maximumPitch);
  view.preset = 'custom';
}

export function zoomView(view, delta, frame) {
  if (!Number.isFinite(delta)) return;
  activateView(view, frame);
  view.distance = clamp(view.distance * Math.exp(clamp(delta * 0.001, -10, 10)), minimumDistance, maximumDistance);
  view.preset = 'custom';
}

export function panView(view, horizontal, vertical, height, frame) {
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || height <= 0) return;
  activateView(view, frame);
  const scale = 2 * frame.distance * Math.tan(frame.fov / 2) / height;
  view.pan = view.pan.map((component, axis) => clamp(
    component - horizontal * scale * frame.right[axis] + vertical * scale * frame.up[axis],
    axis === 1 ? -2.8 : -1.6, axis === 1 ? 2.8 : 1.6,
  ));
  view.preset = 'custom';
}

export function presetView(view, name) {
  if (!['composition', 'front', 'side', 'back', 'face'].includes(name)) return;
  Object.assign(view, createView());
  view.active = name !== 'composition';
  view.immersive = view.active;
  view.preset = name;
  if (name === 'side') view.yaw = Math.PI / 2;
  if (name === 'back') view.yaw = Math.PI;
  if (name === 'face') {
    view.focus = [0, 2.2, 0.1];
    view.distance = 2.8;
  }
}

function safeDistance(target, direction, distance, offset) {
  const minimum = [-1.05 + offset[0], -2.8 + offset[1], -0.8];
  const maximum = [1.5 + offset[0], 2.95 + offset[1], 0.75];
  const eye = target.map((component, axis) => component + direction[axis] * distance);
  if (!eye.every((component, axis) => component > minimum[axis] && component < maximum[axis])) return distance;
  const exits = direction.map((component, axis) => {
    if (Math.abs(component) < 0.00001) return Infinity;
    return ((component > 0 ? maximum[axis] : minimum[axis]) - target[axis]) / component;
  }).filter(value => value >= distance);
  return Math.min(...exits) + 0.08;
}

export function cameraFrame(view, viewportWidth, viewportHeight) {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const phonePortrait = isPhonePortrait(width, height);
  const narrow = isNarrowLayout(width, height);
  // 手机竖屏：水平偏移归零让人物居中（桌面偏移会把人物推出窄屏右缘），仅保留轻微上移
  const offset = phonePortrait ? [0, 0.12] : narrow ? [0.25, 0.15] : [1.65, 0.35];
  // 竖屏手机加大垂直视场，等效拉远，避免人物在窄屏上显得过大
  const fov = (height < 500 ? 52 : phonePortrait ? 54 : narrow ? 46 : 37) * Math.PI / 180;
  let target = view.active
    ? view.focus.map((component, axis) => component + view.pan[axis] + (axis < 2 ? offset[axis] : 0))
    : [0, 0.18, 0];
  let eye = [0, 0.26, 11.8];
  if (view.active) {
    const direction = [
      Math.sin(view.yaw) * Math.cos(view.pitch),
      Math.sin(view.pitch),
      Math.cos(view.yaw) * Math.cos(view.pitch),
    ];
    const distance = safeDistance(target, direction, view.distance, offset);
    eye = target.map((component, axis) => component + direction[axis] * distance);
    if (view.framing) {
      const right = normalize(cross([0, 1, 0], direction));
      const up = cross(direction, right);
      const scale = distance / view.framing.distance;
      target = target.map((component, axis) => component + scale * (
        right[axis] * view.framing.offset[0] + up[axis] * view.framing.offset[1] + direction[axis] * view.framing.offset[2]
      ));
    }
  }
  const backward = normalize(subtract(eye, target));
  const right = normalize(cross([0, 1, 0], backward));
  const up = cross(backward, right);
  const distance = Math.hypot(...subtract(eye, target));
  const projection = perspective(fov, width / height, 0.08, 80);
  return {
    eye, target, right, up, distance, fov, offset,
    viewProjection: multiplyMatrices(projection, lookAt(eye, target, [0, 1, 0])),
  };
}

export function flatCameraFrame(view, viewportWidth, viewportHeight) {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const frame = cameraFrame(view, width, height);
  const distance = view.active ? view.distance : 11.8;
  const scale = height / 8.9 * 11.8 / distance;
  const center = view.immersive
    ? [width / 2 - (view.focus[0] + view.pan[0]) * scale, height / 2 + (view.focus[1] + view.pan[1]) * scale]
    : [(isNarrowLayout(width, height) ? width * 0.5 : width * 0.69) - view.pan[0] * scale, height * 0.53 + view.pan[1] * scale];
  return {
    ...frame, flat: true, scale, center, width, height, distance,
    right: [1, 0, 0], up: [0, 1, 0],
    fov: 2 * Math.atan(height / (2 * scale * distance)),
    target: [frame.offset[0] + (width / 2 - center[0]) / scale, frame.offset[1] + (center[1] - height / 2) / scale, 0],
  };
}

export function screenToWorld(horizontal, vertical, viewportWidth, viewportHeight, frame) {
  if (viewportWidth <= 0 || viewportHeight <= 0) return [...frame.target];
  if (frame.flat) {
    return [
      (horizontal - frame.center[0]) / frame.scale + frame.offset[0],
      (frame.center[1] - vertical) / frame.scale + frame.offset[1],
      0,
    ];
  }
  const halfHeight = frame.distance * Math.tan(frame.fov / 2);
  const screenX = (horizontal / viewportWidth * 2 - 1) * viewportWidth / viewportHeight * halfHeight;
  const screenY = (1 - vertical / viewportHeight * 2) * halfHeight;
  return frame.target.map((component, axis) => component + frame.right[axis] * screenX + frame.up[axis] * screenY);
}

export function projectToScreen(point, frame) {
  if (frame.flat) {
    return [
      (frame.center[0] + (point[0] - frame.offset[0]) * frame.scale) / frame.width,
      1 - (frame.center[1] - (point[1] - frame.offset[1]) * frame.scale) / frame.height,
    ];
  }
  const matrix = frame.viewProjection;
  const projected = [0, 1, 3].map(row => point.reduce((sum, component, axis) => sum + matrix[axis * 4 + row] * component, matrix[12 + row]));
  const divisor = Math.abs(projected[2]) > 0.0001 ? projected[2] : 0.0001;
  return [projected[0] / divisor * 0.5 + 0.5, projected[1] / divisor * 0.5 + 0.5];
}
