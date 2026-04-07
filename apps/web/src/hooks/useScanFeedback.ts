"use client";

/**
 * Audio and haptic feedback for equipment scanning.
 * Uses Web Audio API for tones and navigator.vibrate for haptics.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function playTone(frequency: number, durationMs: number) {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume if suspended (browsers require user gesture first)
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + durationMs / 1000);

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + durationMs / 1000);
}

export function useScanFeedback() {
  return {
    /** Short high-pitched chime for success */
    playSuccess: () => playTone(440, 100),

    /** Lower tone for errors */
    playError: () => playTone(220, 200),

    /** Brief vibration (mobile only, no-op on desktop) */
    vibrate: () => {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(100);
      }
    },
  };
}
