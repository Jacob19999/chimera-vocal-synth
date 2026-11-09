import { trackGains, type Instrument, type OrchestraCue, type OrchestraNote, type OrchestraSample, type OrchestraSamples, type TrackMix } from "../audio/orchestra.ts";

const POLYPHONY = 96;
const TABLE_SIZE = 512;
const HARMONIC_LIMITS = [1, 2, 4, 8];
const RELEASE_LIMIT = 0.24;
// A track at unity should sit within reach of the dry vocal bus.
const NOTE_LEVEL = 0.32;
const RECORDING_LEVEL = 1.65; // Match the recorded accompaniment to the calibrated synth mix.

function patch(attack: number, release: number, decay: number, partials: number[], noise = 0) {
  const tables = HARMONIC_LIMITS.map((count) => {
    const harmonics = partials.slice(0, count);
    const peak = harmonics.reduce((sum, a) => sum + Math.abs(a), 0);
    return Float32Array.from({ length: TABLE_SIZE }, (_, i) => {
      const phase = i * 2 * Math.PI / TABLE_SIZE;
      return harmonics.reduce((sum, a, h) => sum + a * Math.sin((h + 1) * phase), 0) / peak;
    });
  });
  return { attack, release, decay, tables, noise };
}

const patches = {
  Piano: patch(0.004, 0.12, 1.9, [1, 0.45, 0.28, 0.14, 0.1]),
  Harp: patch(0.006, 0.24, 3, [1, 0.34, 0.12, 0.11]),
  Organ: patch(0.01, 0.08, 0, [1, 0.22, 0.26, 0.1]),
  Guitar: patch(0.005, 0.12, 2.4, [1, 0.51, 0.34, 0.18, 0.07]),
  Bass: patch(0.008, 0.09, 1.6, [1, 0.37, 0.13]),
  Violin: patch(0.045, 0.11, 0.06, [1, 0.57, 0.41, 0.26, 0.31, 0.13, 0.18, 0.06]),
  Viola: patch(0.052, 0.12, 0.05, [1, 0.59, 0.48, 0.17, 0.2]),
  Cello: patch(0.054, 0.13, 0.04, [1, 0.74, 0.42, 0.12, 0.14]),
  Contrabass: patch(0.06, 0.15, 0.08, [1, 0.51, 0.21, 0.1]),
  Strings: patch(0.075, 0.17, 0, [1, 0.5, 0.29, 0.22, 0.13, 0.08]),
  Trumpet: patch(0.024, 0.08, 0.04, [1, 0.85, 0.6, 0.5, 0.35, 0.17, 0.09]),
  Trombone: patch(0.035, 0.085, 0.05, [1, 0.68, 0.49, 0.21, 0.13]),
  "French horn": patch(0.048, 0.13, 0, [1, 0.56, 0.3, 0.12, 0.05]),
  Tuba: patch(0.05, 0.12, 0.02, [1, 0.36, 0.27, 0.1]),
  Oboe: patch(0.034, 0.09, 0.04, [1, 0.57, 0.8, 0.31, 0.14]),
  Bassoon: patch(0.048, 0.1, 0.04, [1, 0.7, 0.37, 0.07, 0.19]),
  Clarinet: patch(0.028, 0.09, 0.03, [1, 0.02, 0.62, 0.02, 0.18]),
  Flute: patch(0.045, 0.12, 0.04, [1, 0.11, 0.03], 0.025),
  Reed: patch(0.027, 0.1, 0.04, [1, 0.4, 0.65, 0.22, 0.28]),
  Mallets: patch(0.003, 0.18, 4.2, [1, 0.04, 0.08, 0.12]),
  Timpani: patch(0.006, 0.19, 4.6, [1, 0.44, 0.08], 0.13),
  Percussion: patch(0.002, 0.06, 12, [1, 0.1], 0.85),
} satisfies Record<Instrument, ReturnType<typeof patch>>;

interface Voice {
  start: number;
  end: number;
  done: number;
  track: number;
  amplitude: number;
  step: number;
  table: Float32Array;
  recording?: OrchestraSample;
  patch: ReturnType<typeof patch>;
  seed: number;
  noise: number;
}

/** Sample-timed, bounded-polyphony orchestra on the same audio thread as the singers. */
export class OrchestraSynth {
  private readonly voices: Voice[] = Array.from({ length: POLYPHONY }, () => ({
    start: 0, end: 0, done: 0, track: 0, amplitude: 0, step: 0,
    table: patches.Piano.tables[0], patch: patches.Piano, seed: 1, noise: 0,
  }));
  private frame = 0;
  private cursor = 0;
  private readonly lead: number;
  private mix: TrackMix[];
  private gains: number[];
  private readonly lastGains: number[];
  private readonly notes: OrchestraNote[];

  constructor(cue: OrchestraCue, private readonly rate: number, lead: number, private readonly samples: OrchestraSamples = {}) {
    this.lead = cue.delay + lead;
    this.notes = cue.notes;
    this.mix = cue.mix;
    this.gains = trackGains(cue.mix);
    this.lastGains = this.gains.slice();
  }

  setMix(mix: TrackMix[]) {
    if (mix.length !== this.mix.length) return;
    this.mix = mix;
    this.gains = trackGains(mix);
  }

  addTo(out: Float32Array): boolean {
    const until = this.frame + out.length;
    while (this.cursor < this.notes.length) {
      const note = this.notes[this.cursor];
      const start = Math.round((note.start + this.lead) * this.rate);
      if (start >= until) break;
      this.startVoice(note, start, ++this.cursor);
    }

    let active = false;
    for (const v of this.voices) {
      if (v.done <= this.frame) continue;
      active ||= v.done > until;
      const gain = this.gains[v.track];
      const previous = this.lastGains[v.track];
      if (gain === 0 && previous === 0) continue;
      const dg = (gain - previous) / out.length;
      const recording = v.recording;
      const attack = (recording ? 0.008 : v.patch.attack) * this.rate;
      const release = v.done - v.end;
      const decay = v.patch.decay / this.rate;
      for (let i = Math.max(0, v.start - this.frame); i < out.length && this.frame + i < v.done; i++) {
        const age = this.frame + i - v.start;
        const tail = Math.min(1, (v.done - this.frame - i) / release);
        const env = Math.min(1, age / attack) * tail / (1 + age * decay);
        const phase = age * v.step;
        let sample: number;
        if (recording) {
          const { pcm, loopStart } = recording;
          const position = phase < pcm.length ? phase : loopStart + (phase - loopStart) % (pcm.length - loopStart);
          const index = Math.floor(position);
          const a = pcm[index], b = pcm[index + 1] ?? pcm[loopStart];
          sample = a + (b - a) * (position - index);
        } else {
          const index = Math.floor(phase);
          const a = v.table[index & (TABLE_SIZE - 1)], b = v.table[(index + 1) & (TABLE_SIZE - 1)];
          sample = a + (b - a) * (phase - index);
          if (v.noise) {
            v.seed = (Math.imul(1664525, v.seed) + 1013904223) | 0;
            sample = sample * (1 - v.noise) + v.seed / 2147483648 * v.noise;
          }
        }
        out[i] += sample * env * v.amplitude * (previous + i * dg);
      }
    }
    for (let i = 0; i < this.gains.length; i++) this.lastGains[i] = this.gains[i];
    this.frame = until;
    return active || this.cursor < this.notes.length;
  }

  private startVoice(note: OrchestraNote, start: number, seed: number) {
    let v = this.voices[0];
    for (const candidate of this.voices) {
      if (candidate.done <= this.frame) { v = candidate; break; }
      if (candidate.done < v.done) v = candidate;
    }
    const instrument = this.mix[note.track].instrument ?? note.instrument;
    const shape = patches[instrument];
    let recording: OrchestraSample | undefined;
    let distance = 9;
    for (const sample of this.samples[instrument] ?? []) {
      const steps = Math.abs(note.midi - sample.root);
      if (steps >= distance) continue;
      recording = sample;
      distance = steps;
    }
    const midi = instrument === "Percussion" ? (note.midi < 37 ? 28 : Math.min(note.midi, 60)) : note.midi;
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const maxHarmonic = this.rate * 0.45 / hz;
    const band = maxHarmonic >= 8 ? 3 : maxHarmonic >= 4 ? 2 : maxHarmonic >= 2 ? 1 : 0;
    v.start = start;
    v.end = Math.max(start + 1, Math.round((note.end + this.lead) * this.rate));
    if (instrument === "Percussion") v.end = Math.min(v.end, start + Math.round(0.18 * this.rate));
    v.done = v.end + Math.round(Math.min(RELEASE_LIMIT, shape.release) * this.rate);
    v.track = note.track;
    v.amplitude = NOTE_LEVEL * note.velocity ** 1.4 * (recording ? RECORDING_LEVEL : 1);
    v.step = recording ? 2 ** ((midi - recording.root) / 12) : hz * TABLE_SIZE / this.rate;
    v.recording = recording;
    v.table = shape.tables[band];
    v.patch = shape;
    v.seed = seed;
    v.noise = instrument === "Percussion" && note.midi < 37 ? 0.18 : shape.noise;
  }
}
