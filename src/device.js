// 设备形态判断。部分安卓厂商浏览器（如 Miui 浏览器）会以 980px 桌面布局视口渲染页面，
// 此时 innerWidth 远大于真实手机宽度，单纯用 width < 700 判断会错误走桌面构图与样式，
// 因此手机形态以「触屏指针 + 竖屏」为准，视口宽度只作为窄布局的补充条件。

function coarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function isPhonePortrait(width = globalThis.innerWidth, height = globalThis.innerHeight) {
  return coarsePointer()
    && Number.isFinite(width) && Number.isFinite(height)
    && width < height;
}

export function isNarrowLayout(width = globalThis.innerWidth, height = globalThis.innerHeight) {
  return (Number.isFinite(width) && width < 700) || isPhonePortrait(width, height);
}
