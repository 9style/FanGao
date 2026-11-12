export const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
export const mix = (start, end, amount) => start + (end - start) * amount;

export function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map(component => component / length);
}

export function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function subtract(left, right) {
  return left.map((component, index) => component - right[index]);
}

export function perspective(fov, aspect, near, far) {
  const scale = 1 / Math.tan(fov / 2);
  const depth = 1 / (near - far);
  return new Float32Array([
    scale / aspect, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, (far + near) * depth, -1,
    0, 0, 2 * far * near * depth, 0,
  ]);
}

export function lookAt(eye, target, up) {
  const backward = normalize(subtract(eye, target));
  const right = normalize(cross(up, backward));
  const vertical = cross(backward, right);
  const dot = vector => vector.reduce((total, component, index) => total + component * eye[index], 0);
  return new Float32Array([
    right[0], vertical[0], backward[0], 0,
    right[1], vertical[1], backward[1], 0,
    right[2], vertical[2], backward[2], 0,
    -dot(right), -dot(vertical), -dot(backward), 1,
  ]);
}

export function multiplyMatrices(left, right) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}
