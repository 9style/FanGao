export const fullscreenVertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

export const backgroundFragment = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uTime;
uniform float uAspect;
uniform float uFlow;
uniform float uPalette;
uniform vec2 uFloor;
uniform vec3 uScreenRipple;

float hash(vec2 position) {
  return fract(sin(dot(position, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 position) {
  vec2 cell = floor(position);
  vec2 blend = fract(position);
  blend = blend * blend * (3.0 - 2.0 * blend);
  return mix(mix(hash(cell), hash(cell + vec2(1, 0)), blend.x),
    mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1)), blend.x), blend.y);
}
vec2 twist(vec2 position, vec2 center, float strength) {
  vec2 delta = position - center;
  float radius = length(delta);
  float angle = strength * exp(-radius * 2.3);
  float cosine = cos(angle);
  float sine = sin(angle);
  return center + mat2(cosine, -sine, sine, cosine) * delta;
}
void main() {
  vec2 position = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
  vec2 warped = twist(position, vec2(-0.43, 0.16), 5.6);
  warped = twist(warped, vec2(0.44, 0.16), -4.1);
  warped = twist(warped, vec2(0.0, -0.1), 1.8);
  float time = uTime * 0.025 * uFlow;
  float contour = warped.y * 17.0 + sin(warped.x * 6.0 + time) * 2.6 + warped.x * 3.0;
  float clouds = pow(0.5 + 0.5 * sin(contour), 2.0);
  float shortStroke = pow(0.5 + 0.5 * sin(contour * 9.0 + noise(warped * 29.0) * 3.0), 5.0);
  float canvasGrain = hash(gl_FragCoord.xy) * 0.009;
  vec3 deep = mix(vec3(0.009, 0.019, 0.048), vec3(0.02, 0.012, 0.055), uPalette);
  vec3 cobalt = mix(vec3(0.025, 0.084, 0.21), vec3(0.076, 0.043, 0.21), uPalette);
  vec3 color = deep + cobalt * clouds * (0.38 + shortStroke * 0.8);
  color += vec3(0.032, 0.11, 0.22) * shortStroke * pow(clouds, 3.0) * 0.43;
  float horizon = smoothstep(-0.46, -0.1, position.y);
  color *= 0.28 + horizon * 0.72;

  vec2 moonPosition = uAspect < 0.85 ? vec2(uAspect * 0.08, 0.40) : vec2(min(uAspect * 0.35, 0.59), 0.305);
  vec2 moonDelta = position - moonPosition;
  if (uAspect < 0.85) moonDelta /= 0.7;
  float moonDistance = length(moonDelta);
  float halo = exp(-moonDistance * 19.0);
  float haloStroke = 0.5 + 0.5 * sin(moonDistance * 650.0 + atan(moonDelta.y, moonDelta.x) * 10.0);
  vec3 gold = mix(vec3(0.87, 0.64, 0.24), vec3(0.51, 0.73, 0.88), uPalette);
  color += gold * halo * (0.10 + haloStroke * 0.07);
  float disc = 1.0 - smoothstep(0.031, 0.0325, moonDistance);
  float cutout = 1.0 - smoothstep(0.028, 0.031, length(moonDelta - vec2(0.012, 0.009)));
  color += gold * disc * (1.0 - cutout * 0.91) * 0.79;

  vec2 starCell = floor(position * 23.0);
  vec2 starOffset = fract(position * 23.0) - vec2(hash(starCell), hash(starCell + 13.4));
  float starDistance = length(starOffset);
  float starSelect = step(0.93, hash(starCell + 7.3));
  float star = exp(-starDistance * 53.0) * starSelect;
  color += gold * star * (0.5 + 0.3 * sin(uTime * 0.65 + hash(starCell) * 18.0)) * horizon;

  vec2 floorDelta = (vUv - uFloor) * vec2(uAspect, 4.7);
  color += mix(vec3(0.12, 0.31, 0.46), vec3(0.25, 0.1, 0.37), uPalette)
    * exp(-length(floorDelta) * 12.0) * 0.35;
  float age = uTime - uScreenRipple.z;
  float wave = exp(-pow((length(position * 8.8 - uScreenRipple.xy) - age * 2.0) * 4.0, 2.0));
  color += gold * wave * exp(-max(age, 0.0) * 0.8) * step(0.0, age) * 0.09;
  color += canvasGrain;
  outColor = vec4(color, 1.0);
}`;

export const hologramVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProjection;
uniform vec2 uOffset;
uniform float uTime;
uniform float uYaw;
uniform float uKind;
uniform float uHologram;
out vec3 vPosition;
out vec3 vNormal;
out vec3 vLocal;
mat3 yawMatrix(float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return mat3(cosine, 0, -sine, 0, 1, 0, sine, 0, cosine);
}
void main() {
  vec3 position = aPosition;
  float breath = sin(uTime * 0.95) * 0.006;
  position.x *= 1.0 + breath * smoothstep(-0.1, 1.1, position.y);
  if (uKind == 2.0) position.x += sin(position.y * 3.0 + uTime * 0.55) * 0.018;
  float glitch = step(0.997, sin(uTime * 1.7)) * step(0.0, sin(position.y * 16.0));
  position.x += glitch * sin(position.y * 58.0) * 0.07 * uHologram;
  vLocal = position;
  mat3 rotation = yawMatrix(uYaw);
  position = rotation * position;
  position.xy += uOffset;
  vPosition = position;
  vNormal = rotation * aNormal;
  gl_Position = uViewProjection * vec4(position, 1);
}`;

export const hologramFragment = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec3 vLocal;
out vec4 outColor;
uniform vec3 uEye;
uniform float uTime;
uniform float uKind;
uniform float uHologram;
uniform float uPalette;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(uEye - vPosition);
  float fresnel = pow(1.0 - abs(dot(view, normal)), 2.35);
  float light = max(0.0, dot(normal, normalize(vec3(-0.7, 0.65, 1.0))));
  float brush = sin(vLocal.y * 36.0 + sin(vLocal.x * 20.0 + vLocal.z * 13.0) * 1.6);
  float pigment = 0.5 + 0.5 * sin(vLocal.y * 4.0 + vLocal.x * 3.0);
  vec3 blue = mix(vec3(0.045, 0.16, 0.42), vec3(0.15, 0.1, 0.43), uPalette);
  vec3 violet = mix(vec3(0.33, 0.13, 0.44), vec3(0.39, 0.09, 0.43), uPalette);
  vec3 cyan = mix(vec3(0.20, 0.52, 0.8), vec3(0.21, 0.69, 0.74), uPalette);
  vec3 gold = mix(vec3(0.87, 0.6, 0.24), vec3(0.66, 0.81, 0.97), uPalette);
  vec3 base = mix(blue, violet, pigment * 0.63);
  if (uKind == 0.0) base = mix(base, vec3(0.49, 0.35, 0.5), 0.46);
  if (uKind == 2.0) base = mix(blue, vec3(0.10, 0.12, 0.3), 0.4);
  float scan = 0.83 + 0.17 * sin(gl_FragCoord.y * 2.6 - uTime * 4.0);
  float band = pow(0.5 + 0.5 * sin(vLocal.y * 2.4 - uTime * 0.9), 26.0);
  vec3 color = base * (0.52 + light * 0.85) + cyan * fresnel * (0.38 + uHologram * 0.57);
  color += gold * pow(max(brush, 0.0), 18.0) * 0.045;
  color += cyan * band * uHologram * 0.11;
  float alpha = (0.50 + light * 0.15 + fresnel * 0.12) * (0.48 + uHologram * 0.52);
  if (uKind == 3.0) {
    color = vec3(0.06, 0.04, 0.13);
    alpha = 0.83;
  }
  if (uKind == 4.0) {
    color = gold * (0.65 + fresnel * 0.4);
    alpha = 0.7;
  }
  outColor = vec4(color * scan, alpha);
}`;

export const brushVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aPosition;
layout(location = 2) in vec3 aNormal;
layout(location = 3) in vec4 aSeed;
uniform mat4 uViewProjection;
uniform vec2 uOffset;
uniform vec2 uResolution;
uniform vec3 uPointer;
uniform vec4 uRipple;
uniform float uTime;
uniform float uYaw;
uniform float uFlow;
uniform float uHologram;
uniform float uMode;
out vec2 vUv;
out float vGold;
out float vFade;
out float vSeed;
void main() {
  vec3 position = aPosition;
  float angle = aSeed.x * 6.28318;
  float fade = 1.0;
  float gold = step(0.89, aSeed.z);
  float size = 2.2 + aSeed.y * 2.4;
  if (uMode == 0.0) {
    float cycle = fract(uTime * 0.075 + aSeed.y);
    float edge = max(smoothstep(1.4, 2.7, position.y), 1.0 - smoothstep(-2.4, -0.7, position.y));
    float dissolve = step(0.78, aSeed.x) * edge;
    position += aNormal * cycle * dissolve * 0.8;
    position.xy += vec2(sin(cycle * 4.0 + aSeed.x * 7.0) * 0.65, cycle * 1.1) * dissolve;
    fade = (1.0 - cycle * dissolve) * 0.65;
    if (aPosition.y > 1.8 && aSeed.w == 0.0) fade *= 0.18;
    if (aSeed.w == 2.0) fade *= 0.7;
    gold = max(gold, dissolve * cycle);
    float cosine = cos(uYaw);
    float sine = sin(uYaw);
    position = mat3(cosine, 0, -sine, 0, 1, 0, sine, 0, cosine) * position;
    position.xy += uOffset;
    angle = aSeed.x * 1.2 + sin(position.y * 3.0) * 0.5;
    size *= 0.66 + uHologram * 0.44;
  } else if (uMode == 1.0) {
    angle = aNormal.y + uTime * aNormal.z * 0.13 * uFlow;
    float radius = aNormal.x;
    position.x += cos(angle + radius * 0.43) * radius;
    position.y += sin(angle + radius * 0.43) * radius * 0.47;
    position.z += sin(angle) * 0.25;
    angle += 1.5708 + radius * 0.2;
    gold = step(0.80, aSeed.z);
    size = 2.0 + aSeed.y * 3.2;
    fade = 0.24 + aSeed.y * 0.32;
  } else {
    angle = aNormal.y + uTime * 0.025 * uFlow;
    float radius = aNormal.x;
    position = vec3(cos(angle) * radius + uOffset.x, -2.61 + sin(angle) * radius * 0.12 + uOffset.y, sin(angle) * radius);
    angle = -angle;
    size = 1.5 + aSeed.y * 1.5;
    gold = 0.9;
    fade = 0.38;
  }
  vec3 delta = position - uPointer;
  if (uMode == 1.0) delta.z = 0.0;
  float distanceToPointer = length(delta);
  float force = exp(-distanceToPointer * distanceToPointer * 1.5) * uFlow;
  position += delta / max(distanceToPointer, 0.05) * force * 0.23;
  float age = uTime - uRipple.w;
  vec3 rippleDelta = position - uRipple.xyz;
  if (uMode == 1.0) rippleDelta.z = 0.0;
  float wave = exp(-pow((length(rippleDelta) - age * 2.0) * 3.0, 2.0)) * exp(-max(age, 0.0) * 0.7) * step(0.0, age);
  position += normalize(rippleDelta + vec3(0.001)) * wave * 0.24;
  gold = max(gold, wave * 0.9);
  vec4 projected = uViewProjection * vec4(position, 1.0);
  float cosine = cos(angle);
  float sine = sin(angle);
  vec2 brush = aCorner * vec2(size * 1.6, size * 0.42);
  brush = mat2(cosine, -sine, sine, cosine) * brush;
  projected.xy += brush * 2.0 / uResolution * projected.w;
  gl_Position = projected;
  vUv = aCorner;
  vGold = gold;
  vFade = fade;
  vSeed = aSeed.z;
}`;

export const brushFragment = `#version 300 es
precision highp float;
in vec2 vUv;
in float vGold;
in float vFade;
in float vSeed;
out vec4 outColor;
uniform float uPalette;
uniform float uMode;
void main() {
  float shape = pow(max(0.0, 1.0 - abs(vUv.x)), 0.5) * pow(max(0.0, 1.0 - abs(vUv.y)), 1.4);
  float bristle = 0.64 + 0.36 * sin(vUv.y * 26.0 + vSeed * 18.0);
  vec3 blue = mix(vec3(0.11, 0.28, 0.6), vec3(0.24, 0.15, 0.6), uPalette);
  vec3 lightBlue = mix(vec3(0.27, 0.49, 0.77), vec3(0.23, 0.62, 0.69), uPalette);
  vec3 gold = mix(vec3(0.98, 0.72, 0.29), vec3(0.65, 0.83, 0.94), uPalette);
  vec3 color = mix(mix(blue, lightBlue, vSeed), gold, vGold);
  float alpha = shape * bristle * vFade * (uMode == 0.0 ? 0.55 : 0.84);
  outColor = vec4(color, alpha);
}`;

export const bloomFragment = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTexture;
uniform vec2 uDirection;
uniform float uExtract;
vec3 readColor(vec2 coordinate) {
  vec3 color = texture(uTexture, coordinate).rgb;
  if (uExtract > 0.5) {
    float brightness = max(color.r, max(color.g, color.b));
    color *= smoothstep(0.28, 0.65, brightness);
  }
  return color;
}
void main() {
  vec3 color = readColor(vUv) * 0.227027;
  color += readColor(vUv + uDirection * 1.384615) * 0.316216;
  color += readColor(vUv - uDirection * 1.384615) * 0.316216;
  color += readColor(vUv + uDirection * 3.230769) * 0.070270;
  color += readColor(vUv - uDirection * 3.230769) * 0.070270;
  outColor = vec4(color, 1);
}`;

export const compositeFragment = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform float uHologram;
void main() {
  vec2 shift = (vUv - 0.5) * 0.0008 * uHologram;
  vec3 color = texture(uTexture, vUv).rgb;
  color.r = texture(uTexture, vUv + shift).r;
  color.b = texture(uTexture, vUv - shift).b;
  color += texture(uBloom, vUv).rgb * (0.48 + uHologram * 0.46);
  float vignette = 1.0 - smoothstep(0.25, 0.85, distance(vUv, vec2(0.52, 0.51))) * 0.42;
  color *= vignette;
  color = pow(max(color, vec3(0)), vec3(0.86));
  outColor = vec4(color, 1);
}`;
