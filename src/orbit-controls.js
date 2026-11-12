import { orbitView, panView, zoomView } from './camera.js';

export function createOrbitControls(canvas, view, callbacks) {
  const pointers = new Map();
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let pair = null;

  function metrics() {
    const active = [...pointers.values()];
    if (active.length < 2) return null;
    return {
      horizontal: (active[0].horizontal + active[1].horizontal) / 2,
      vertical: (active[0].vertical + active[1].vertical) / 2,
      distance: Math.max(1, Math.hypot(active[0].horizontal - active[1].horizontal, active[0].vertical - active[1].vertical)),
    };
  }

  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top];
  }

  function releaseAll() {
    for (const id of pointers.keys()) {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    pointers.clear();
    pair = null;
    canvas.classList.remove('dragging');
    callbacks.onLeave();
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 2 && event.button !== 1) return;
    if (event.pointerType === 'mouse' && pointers.size) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, {
      horizontal: event.clientX, vertical: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: 0,
      panning: event.button !== 0 || event.shiftKey,
      suppressClick: event.button !== 0 || event.shiftKey,
    });
    if (pointers.size > 1) {
      pointers.forEach(pointer => { pointer.suppressClick = true; });
      pair = metrics();
    }
    canvas.classList.add('dragging');
  }, options);

  canvas.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) {
      if (!pointers.size) callbacks.onPointer(point(event));
      return;
    }
    const horizontal = event.clientX - pointer.horizontal;
    const vertical = event.clientY - pointer.vertical;
    pointer.horizontal = event.clientX;
    pointer.vertical = event.clientY;
    pointer.moved = Math.max(pointer.moved, Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY));
    if (pointers.size > 1) {
      const next = metrics();
      if (pair) {
        zoomView(view, Math.log(pair.distance / next.distance) * 1000, callbacks.getFrame());
        panView(view, next.horizontal - pair.horizontal, next.vertical - pair.vertical, canvas.clientHeight, callbacks.getFrame());
      }
      pair = next;
    } else if (pointer.moved >= 7) {
      if (pointer.panning || event.shiftKey || !callbacks.canOrbit()) {
        panView(view, horizontal, vertical, canvas.clientHeight, callbacks.getFrame());
      } else {
        orbitView(view, horizontal / Math.max(1, canvas.clientWidth) * Math.PI * 2, vertical / Math.max(1, canvas.clientHeight) * Math.PI, callbacks.getFrame());
      }
    }
    if (pointer.moved >= 7 || pointers.size > 1) {
      callbacks.onLeave();
      callbacks.onChange();
    }
  }, options);

  function release(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointers.delete(event.pointerId);
    if (event.type === 'pointerup' && pointer.moved < 7 && !pointer.suppressClick && !pointers.size) callbacks.onRipple(point(event));
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pair = metrics();
    if (!pointers.size) {
      canvas.classList.remove('dragging');
      if (event.pointerType !== 'mouse') callbacks.onLeave();
    }
  }

  canvas.addEventListener('pointerup', release, options);
  canvas.addEventListener('pointercancel', release, options);
  canvas.addEventListener('lostpointercapture', event => {
    if (pointers.has(event.pointerId)) release(event);
  }, options);
  canvas.addEventListener('pointerleave', () => {
    if (!pointers.size) callbacks.onLeave();
  }, options);
  canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
  canvas.addEventListener('wheel', event => {
    if (!event.deltaY) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    zoomView(view, event.deltaY * scale, callbacks.getFrame());
    callbacks.onLeave();
    callbacks.onChange();
  }, { ...options, passive: false });
  window.addEventListener('blur', releaseAll, options);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  }, options);

  return {
    cancel: releaseAll,
    dispose() {
      releaseAll();
      controller.abort();
    },
  };
}
