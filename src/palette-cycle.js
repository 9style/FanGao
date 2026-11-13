// 色板自动循环：在星夜(0)与霓虹(1)两套色板之间按“停留 → 淡入淡出 → 停留”节奏循环。
// 渲染时钟在暂停或页面隐藏时会冻结，传入相同的 elapsed 即自动停在当前混合值。
export const PALETTE_HOLD_SECONDS = 8;
export const PALETTE_FADE_SECONDS = 2;

const smoothstep = progress => progress * progress * (3 - 2 * progress);

export function createPaletteCycle(elapsed = 0) {
  return { epoch: elapsed, from: 0, to: 1 };
}

// 返回当前色板混合值 0..1（0 = 星夜色板，1 = 霓虹色板，小数即两套颜色的平滑混合）
export function samplePaletteCycle(
  cycle,
  elapsed,
  hold = PALETTE_HOLD_SECONDS,
  fade = PALETTE_FADE_SECONDS,
) {
  const span = 2 * (hold + fade);
  let t = (elapsed - cycle.epoch) % span;
  if (t < 0) t += span;
  if (t < hold) return cycle.from;
  if (t < hold + fade) {
    return cycle.from + (cycle.to - cycle.from) * smoothstep((t - hold) / fade);
  }
  if (t < 2 * hold + fade) return cycle.to;
  return cycle.to + (cycle.from - cycle.to) * smoothstep((t - (2 * hold + fade)) / fade);
}

// 手动点按色板：从当前混合值立刻开始朝目标色板淡入，淡入结束后完整停留一个 hold 周期
export function jumpPaletteCycle(
  cycle,
  elapsed,
  target,
  hold = PALETTE_HOLD_SECONDS,
  fade = PALETTE_FADE_SECONDS,
) {
  const current = samplePaletteCycle(cycle, elapsed, hold, fade);
  return { epoch: elapsed - hold, from: current, to: target === 1 ? 1 : 0 };
}
