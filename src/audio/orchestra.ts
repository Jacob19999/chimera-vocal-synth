/** Instrument choices for MIDI playback and track overrides. */
export const INSTRUMENTS = [
  "Piano", "Harp", "Organ", "Guitar", "Bass", "Violin", "Viola", "Cello",
  "Contrabass", "Strings", "Trumpet", "Trombone", "French horn", "Tuba",
  "Oboe", "Bassoon", "Clarinet", "Flute", "Reed", "Mallets", "Timpani", "Percussion",
] as const;

export type Instrument = typeof INSTRUMENTS[number];

export interface OrchestraSample {
  root: number;
  pcm: Float32Array;
  loopStart: number;
}

export type OrchestraSamples = Partial<Record<Instrument, OrchestraSample[]>>;

/** General MIDI program to the closest instrument in the palette. */
export function midiInstrument(program: number, channel: number): Instrument {
  if (channel === 9) return "Percussion";
  if (program < 8) return "Piano";
  if (program < 16) return "Mallets";
  if (program < 24) return "Organ";
  if (program < 32) return "Guitar";
  if (program < 40) return "Bass";
  if (program < 48) return (["Violin", "Viola", "Cello", "Contrabass", "Strings", "Harp", "Harp", "Timpani"] as const)[program - 40];
  if (program < 56) return "Strings";
  if (program < 64) return (["Trumpet", "Trombone", "Tuba", "Trumpet", "French horn", "French horn", "Trumpet", "Trumpet"] as const)[program - 56];
  if (program < 72) return (["Reed", "Reed", "Reed", "Reed", "Oboe", "Oboe", "Bassoon", "Clarinet"] as const)[program - 64];
  if (program < 80) return "Flute";
  if (program < 104) return "Organ";
  if (program < 112) return "Guitar";
  if (program < 120) return "Percussion";
  return "Mallets";
}

export interface OrchestraNote {
  start: number;
  end: number;
  midi: number;
  velocity: number;
  instrument: Instrument;
  track: number;
}

export interface TrackMix {
  instrument: Instrument | null;
  gain: number;
  mute: boolean;
  solo: boolean;
}

export function trackGains(mix: readonly TrackMix[]): number[] {
  const soloed = mix.some((track) => track.solo);
  return mix.map((track) => track.mute || (soloed && !track.solo) ? 0 : track.gain);
}

export interface OrchestraPlan {
  notes: OrchestraNote[];
  end: number;
}

export interface OrchestraCue {
  notes: OrchestraNote[];
  mix: TrackMix[];
  /** Shared preroll in the vocal plan, in seconds. */
  delay: number;
}
