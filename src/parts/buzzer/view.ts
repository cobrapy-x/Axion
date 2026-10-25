// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/buzzer-element.js';
import type { PartView } from '../../core/types';

type BuzzerElement = HTMLElement & { hasSignal: boolean };

const VOLUME = 0.05;
/** Silence a voice that stops receiving updates (part deleted, simulation paused). */
const WATCHDOG_MS = 250;

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  on: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

// One AudioContext for every buzzer, created on first use. null = audio unavailable.
let audio: AudioContext | null | undefined;
const voices = new WeakMap<HTMLElement, Voice>();

function audioContext(): AudioContext | null {
  if (audio === undefined) {
    try {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      audio = AC ? new AC() : null;
    } catch {
      audio = null;
    }
  }
  return audio;
}

function voiceFor(el: HTMLElement, ac: AudioContext): Voice {
  let v = voices.get(el);
  if (!v) {
    const osc = ac.createOscillator();
    osc.type = 'square';
    const gain = ac.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ac.destination);
    osc.start();
    v = { osc, gain, on: false };
    voices.set(el, v);
  }
  return v;
}

function silence(el: HTMLElement, stop: boolean): void {
  const v = voices.get(el);
  if (!v || !audio) return;
  try {
    const t = audio.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.01); // short ramp: no click
    v.on = false;
    clearTimeout(v.timer);
    if (stop) {
      v.osc.stop(t + 0.1);
      voices.delete(el);
    }
  } catch {
    /* audio is best effort */
  }
}

function play(el: HTMLElement, on: boolean, frequency: number): void {
  const ac = audioContext();
  if (!ac) return;
  try {
    // The Start click is the user gesture that lets the context run.
    if (ac.state === 'suspended') void ac.resume().catch(() => {});
    if (!on && !voices.has(el)) return;
    const v = voiceFor(el, ac);
    const t = ac.currentTime;
    if (on) {
      v.osc.frequency.setTargetAtTime(frequency, t, 0.002);
      if (!v.on) {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(VOLUME, t, 0.005);
      }
      clearTimeout(v.timer);
      v.timer = setTimeout(() => silence(el, false), WATCHDOG_MS);
    } else if (v.on) {
      silence(el, false);
    }
    v.on = on;
  } catch {
    /* audio is best effort */
  }
}

const view: PartView = {
  create: () => document.createElement('wokwi-buzzer'),
  update(el, s) {
    const freq = Number(s.frequency) || 0;
    const on = !!s.on && freq > 0;
    const b = el as BuzzerElement;
    if (b.hasSignal !== on) b.hasSignal = on;
    el.title = on ? `${freq} Hz` : '';
    play(el, on, freq);
  },
  reset(el) {
    (el as BuzzerElement).hasSignal = false;
    el.title = '';
    silence(el, true);
  },
};

export default view;
