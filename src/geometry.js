import { clamp, createRandom, cross, mix, normalize, subtract } from './math.js';

const TAU = Math.PI * 2;

function surface(name, evaluate, around = 36, along = 28, kind = 0) {
  const positions = [];
  const normals = [];
  const indices = [];
  const epsilon = 0.0001;
  for (let vertical = 0; vertical <= along; vertical += 1) {
    for (let horizontal = 0; horizontal <= around; horizontal += 1) {
      const longitude = horizontal / around;
      const latitude = vertical / along;
      const position = evaluate(longitude, latitude);
      const horizontalDirection = subtract(evaluate(longitude + epsilon, latitude), evaluate(longitude - epsilon, latitude));
      const verticalDirection = subtract(evaluate(longitude, clamp(latitude + epsilon, 0, 1)), evaluate(longitude, clamp(latitude - epsilon, 0, 1)));
      const normal = normalize(cross(horizontalDirection, verticalDirection));
      positions.push(...position);
      normals.push(...normal);
      if (vertical < along && horizontal < around) {
        const start = vertical * (around + 1) + horizontal;
        indices.push(start, start + 1, start + around + 1, start + 1, start + around + 2, start + around + 1);
      }
    }
  }
  return { name, positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices), kind };
}

function ellipsoid(name, center, radius, kind = 0, deform) {
  return surface(name, (longitude, latitude) => {
    const angle = longitude * TAU;
    const polar = latitude * Math.PI;
    const point = [
      Math.sin(polar) * Math.cos(angle) * radius[0],
      Math.cos(polar) * radius[1],
      Math.sin(polar) * Math.sin(angle) * radius[2],
    ];
    if (deform) deform(point, angle, polar);
    return point.map((component, index) => component + center[index]);
  }, 48, 36, kind);
}

function tube(name, path, radius, kind = 0, segments = 28, sides = 12) {
  return surface(name, (longitude, latitude) => {
    const center = path(latitude);
    const tangent = normalize(subtract(path(clamp(latitude + 0.001, 0, 1)), path(clamp(latitude - 0.001, 0, 1))));
    const horizontal = normalize(cross(tangent, Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]));
    const vertical = cross(tangent, horizontal);
    const size = typeof radius === 'function' ? radius(latitude) : radius;
    const angle = longitude * TAU;
    return center.map((component, index) => component + size * (Math.cos(angle) * horizontal[index] + Math.sin(angle) * vertical[index]));
  }, sides, segments, kind);
}

function limb(name, start, end, startRadius, endRadius, kind = 0) {
  return tube(name, amount => start.map((component, index) => mix(component, end[index], amount)),
    amount => mix(startRadius, endRadius, amount) * (0.85 + 0.15 * Math.sin(amount * Math.PI)), kind);
}

function profileAt(profile, amount) {
  const scaled = amount * (profile.length - 1);
  const lower = Math.min(profile.length - 2, Math.floor(scaled));
  const fraction = scaled - lower;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return profile[lower].map((component, index) => mix(component, profile[lower + 1][index], smooth));
}

export function createFigure() {
  const meshes = [];
  const profile = [
    [1.77, 0.14, 0.135], [1.48, 0.15, 0.14], [1.29, 0.43, 0.195],
    [1.12, 0.475, 0.24], [0.83, 0.435, 0.275], [0.49, 0.33, 0.215],
    [0.21, 0.295, 0.205], [-0.1, 0.39, 0.275], [-0.48, 0.47, 0.32],
    [-0.95, 0.49, 0.33], [-1.45, 0.55, 0.37], [-1.96, 0.66, 0.42],
    [-2.53, 0.85, 0.49],
  ];
  meshes.push(surface('silk silhouette', (longitude, latitude) => {
    const [height, width, depth] = profileAt(profile, latitude);
    const angle = longitude * TAU;
    const folds = Math.max(0, -height) / 2.53;
    const pleat = 1 + (Math.sin(angle * 11 + height * 0.7) * 0.055 + Math.sin(angle * 19) * 0.018) * folds;
    return [Math.cos(angle) * width * pleat + Math.sin(height * 1.1) * folds * 0.09, height, Math.sin(angle) * depth * pleat];
  }, 72, 104, 1));
  meshes.push(ellipsoid('face', [0, 2.18, 0.035], [0.335, 0.49, 0.305], 0, (point, angle) => {
    const face = Math.max(0, Math.sin(angle));
    const lower = clamp((-point[1] + 0.08) / 0.48, 0, 1);
    point[0] *= 1 - lower * 0.26;
    point[2] += face ** 10 * (0.048 * Math.exp(-(((point[1] - 0.05) / 0.14) ** 2)));
    point[2] += face ** 5 * 0.014 * Math.exp(-(((point[1] + 0.18) / 0.11) ** 2));
  }));
  meshes.push(ellipsoid('nose', [0, 2.205, 0.328], [0.049, 0.112, 0.075]));
  meshes.push(ellipsoid('left ear', [-0.319, 2.21, 0], [0.039, 0.093, 0.06]));
  meshes.push(ellipsoid('right ear', [0.319, 2.21, 0], [0.039, 0.093, 0.06]));
  for (const direction of [-1, 1]) {
    meshes.push(ellipsoid(`${direction} eyelid`, [direction * 0.132, 2.293, 0.312], [0.085, 0.018, 0.019], 3));
    meshes.push(tube(`${direction} brow`, amount => [
      direction * (0.066 + amount * 0.135), 2.365 + Math.sin(amount * Math.PI) * 0.015, 0.305 - amount * 0.022,
    ], 0.009, 3, 20, 8));
    meshes.push(tube(`${direction} lash`, amount => [
      direction * (0.055 + amount * 0.153), 2.295 + Math.sin(amount * Math.PI) * 0.012, 0.326 - amount * 0.024,
    ], 0.0045, 4, 20, 6));
  }
  meshes.push(tube('upper lip', amount => [
    mix(-0.09, 0.09, amount), 2.028 + Math.sin(amount * Math.PI * 2) ** 2 * 0.009, 0.321 + Math.sin(amount * Math.PI) * 0.013,
  ], amount => 0.007 + Math.sin(amount * Math.PI) * 0.003, 3, 24, 8));
  meshes.push(tube('lower lip', amount => [
    mix(-0.082, 0.082, amount), 2.018 - Math.sin(amount * Math.PI) * 0.012, 0.326,
  ], 0.007, 0, 24, 8));

  meshes.push(limb('left upper arm', [-0.43, 1.19, 0], [-0.64, 0.52, 0.035], 0.145, 0.098));
  meshes.push(ellipsoid('left elbow', [-0.64, 0.52, 0.035], [0.098, 0.1, 0.098]));
  meshes.push(limb('left forearm', [-0.64, 0.52, 0.035], [-0.72, -0.1, 0.12], 0.098, 0.054));
  meshes.push(ellipsoid('left palm', [-0.735, -0.22, 0.13], [0.076, 0.15, 0.041]));
  meshes.push(limb('right upper arm', [0.43, 1.19, 0], [0.87, 0.83, 0.08], 0.143, 0.095));
  meshes.push(ellipsoid('right elbow', [0.87, 0.83, 0.08], [0.094, 0.093, 0.092]));
  meshes.push(limb('right forearm', [0.87, 0.83, 0.08], [1.14, 1.43, 0.19], 0.095, 0.051));
  meshes.push(ellipsoid('right palm', [1.15, 1.545, 0.195], [0.073, 0.125, 0.035]));
  for (let finger = 0; finger < 4; finger += 1) {
    const offset = (finger - 1.5) * 0.031;
    const length = [0.16, 0.195, 0.185, 0.145][finger];
    meshes.push(tube(`raised finger ${finger}`, amount => [
      1.15 + offset + Math.sin(amount * 2) * (finger - 1.4) * 0.023,
      1.61 + amount * length, 0.195 + Math.sin(amount * Math.PI) * 0.022,
    ], amount => 0.015 * (1 - amount * 0.5), 0, 16, 8));
    meshes.push(tube(`resting finger ${finger}`, amount => [
      -0.735 + offset, -0.3 - amount * length, 0.13 + Math.sin(amount * 2) * 0.022,
    ], amount => 0.013 * (1 - amount * 0.5), 0, 16, 8));
  }
  meshes.push(limb('raised thumb', [1.095, 1.52, 0.2], [1.017, 1.618, 0.245], 0.023, 0.014));
  meshes.push(limb('resting thumb', [-0.678, -0.2, 0.14], [-0.639, -0.315, 0.17], 0.022, 0.013));

  meshes.push(ellipsoid('hair crown', [0, 2.305, -0.068], [0.355, 0.43, 0.295], 2, (point, angle, polar) => {
    const front = Math.max(0, Math.sin(angle));
    point[2] -= front * Math.max(0, -Math.cos(polar) + 0.2) * 0.18;
  }));
  for (let strand = 0; strand < 26; strand += 1) {
    const angle = Math.PI * 0.74 + strand / 25 * Math.PI * 1.53;
    const length = 1.27 + Math.sin(strand * 1.9) * 0.23;
    const startX = Math.cos(angle) * 0.3;
    const startZ = Math.sin(angle) * 0.26 - 0.045;
    meshes.push(tube(`flowing hair ${strand}`, amount => [
      startX * (1 + amount * 0.65) + Math.sin(amount * 5 + strand * 0.43) * amount * 0.095 + amount ** 3 * 0.23,
      2.56 - amount * length,
      startZ - amount * 0.13 + Math.sin(amount * 4 + strand * 0.35) * 0.055,
    ], amount => (0.024 + Math.sin(strand * 2) * 0.006) * (1 - amount * 0.8), 2, 40, 10));
  }
  meshes.push(tube('side swept fringe', amount => [
    -0.31 + amount * 0.64, 2.5 + Math.sin(amount * Math.PI) * 0.105, 0.178 + Math.sin(amount * Math.PI) * 0.03,
  ], amount => 0.016 + Math.sin(amount * Math.PI) * 0.022, 2, 36, 12));
  meshes.push(tube('gilded neckline', amount => [
    Math.cos(amount * TAU) * 0.183, 1.45 - Math.max(0, Math.sin(amount * TAU)) * 0.32, Math.sin(amount * TAU) * 0.183,
  ], 0.008, 4, 60, 6));
  meshes.push(tube('waist orbit', amount => [
    Math.cos(amount * TAU) * 0.307, 0.24 + Math.sin(amount * TAU * 2) * 0.018, Math.sin(amount * TAU) * 0.217,
  ], 0.009, 4, 64, 6));
  for (let seam = 0; seam < 7; seam += 1) {
    const angle = seam / 7 * TAU;
    meshes.push(tube(`dress filament ${seam}`, amount => {
      const [height, width, depth] = profileAt(profile, mix(0.44, 1, amount));
      return [Math.cos(angle + amount * 0.17) * width * 1.018 + Math.sin(height * 1.1) * Math.max(0, -height) / 2.53 * 0.09,
        height, Math.sin(angle + amount * 0.17) * depth * 1.025];
    }, amount => 0.003 + amount * 0.002, 4, 48, 6));
  }

  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let offset = 0; offset < mesh.positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis], mesh.positions[offset + axis]);
        maximum[axis] = Math.max(maximum[axis], mesh.positions[offset + axis]);
      }
    }
  }
  return { meshes, bounds: { min: minimum, max: maximum } };
}

export function sampleSurface(meshes, count, seed = 79) {
  const triangles = [];
  let totalArea = 0;
  for (const mesh of meshes) {
    if (mesh.kind >= 3) continue;
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const vertexOffsets = Array.from(mesh.indices.slice(offset, offset + 3), index => index * 3);
      const vertices = vertexOffsets.map(index => Array.from(mesh.positions.slice(index, index + 3)));
      const area = Math.hypot(...cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]))) * 0.5;
      if (area > 0.0000001) {
        totalArea += area;
        triangles.push({ mesh, vertexOffsets, cumulative: totalArea });
      }
    }
  }
  const sampleCount = totalArea > 0 ? Math.max(0, Math.floor(count)) : 0;
  const positions = new Float32Array(sampleCount * 3);
  const normals = new Float32Array(sampleCount * 3);
  const seeds = new Float32Array(sampleCount * 4);
  const random = createRandom(seed);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const target = random() * totalArea;
    let lower = 0;
    let upper = triangles.length - 1;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (triangles[middle].cumulative < target) lower = middle + 1;
      else upper = middle;
    }
    const triangle = triangles[lower];
    const root = Math.sqrt(random());
    const weights = [1 - root, root * (1 - random()), 0];
    weights[2] = 1 - weights[0] - weights[1];
    const normal = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = triangle.vertexOffsets[corner] + axis;
        positions[sample * 3 + axis] += triangle.mesh.positions[offset] * weights[corner];
        normal[axis] += triangle.mesh.normals[offset] * weights[corner];
      }
    }
    normals.set(normalize(normal), sample * 3);
    seeds.set([random(), random(), random(), triangle.mesh.kind], sample * 4);
  }
  return { positions, normals, seeds };
}
