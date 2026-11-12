export function createAmbientAudio() {
  let context = null;
  let master = null;
  let enabled = false;
  const nodes = [];

  function initialize() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = 0;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    master.connect(filter);
    filter.connect(context.destination);
    nodes.push(master, filter);
    for (const [index, frequency] of [110, 164.81, 220, 329.63].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index % 2 ? 3 : -3;
      gain.gain.value = index === 0 ? 0.28 : 0.1;
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start();
      nodes.push(oscillator, gain);
    }
    const shimmer = context.createOscillator();
    const modulation = context.createGain();
    shimmer.frequency.value = 0.09;
    modulation.gain.value = 110;
    shimmer.connect(modulation);
    modulation.connect(filter.frequency);
    shimmer.start();
    nodes.push(shimmer, modulation);
    return true;
  }

  return {
    get enabled() { return enabled; },
    async toggle() {
      if (!context && !initialize()) return false;
      await context.resume();
      enabled = !enabled;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(master.gain.value, context.currentTime);
      master.gain.linearRampToValueAtTime(enabled ? 0.085 : 0, context.currentTime + 1.2);
      return enabled;
    },
    async suspend() {
      if (context && (context.state === 'running' || context.state === 'interrupted')) {
        try { await context.suspend(); } catch {}
      }
    },
    async resume() {
      if (enabled && context && (context.state === 'suspended' || context.state === 'interrupted')) {
        try { await context.resume(); } catch {}
      }
    },
    dispose() {
      nodes.forEach(node => {
        if (typeof node.stop === 'function') node.stop();
        node.disconnect();
      });
      context?.close();
    },
  };
}
