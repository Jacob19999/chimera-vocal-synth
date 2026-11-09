import { writeMidi, type MidiEvent } from "midi-file";
import { accompanimentMeasures } from "../../examples/la-ci-darem/accompaniment.ts";

export const ORCHESTRA_DEMO_NAME = "accompaniment.mid";

const TICKS_PER_BEAT = 480;
const SIXTEENTH = TICKS_PER_BEAT / 4;
const PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;
const PARTS = [
  { name: "Cello", program: 42, velocity: 75 },
  { name: "Strings", program: 48, velocity: 69 },
  { name: "Winds", program: 73, velocity: 83 },
];

function noteNumber(pitch: string): number {
  const step = pitch[0] as keyof typeof PITCH_CLASSES;
  const accidental = pitch[1] === "#" ? 1 : 0;
  return (Number(pitch.slice(1 + accidental)) + 1) * 12 + PITCH_CLASSES[step] + accidental;
}

/** Encode the full accompaniment on the same bar grid as the vocal score. */
export function orchestraDemoBytes(): Uint8Array<ArrayBuffer> {
  const measures = accompanimentMeasures.map((row) => row.split("|").map((part) => part.trim().split(/\s+/)));
  const starts = [0];
  for (const [bass] of measures) {
    const length = bass.reduce((sum, token) => sum + Number(token.split("/")[1]) * SIXTEENTH, 0);
    starts.push(starts.at(-1)! + length);
  }
  const end = starts.at(-1)!;
  const conductor: MidiEvent[] = [
    { type: "trackName", deltaTime: 0, text: "Là ci darem la mano" },
    { type: "timeSignature", deltaTime: 0, numerator: 2, denominator: 4, metronome: 24, thirtyseconds: 8 },
    { type: "setTempo", deltaTime: 0, microsecondsPerBeat: Math.round(60e6 / 66) },
    { type: "setTempo", deltaTime: starts[48], microsecondsPerBeat: Math.round(60e6 / 46) },
    { type: "timeSignature", deltaTime: starts[49] - starts[48], numerator: 6, denominator: 8, metronome: 36, thirtyseconds: 8 },
    { type: "setTempo", deltaTime: 0, microsecondsPerBeat: Math.round(60e6 / 138) },
    { type: "endOfTrack", deltaTime: end - starts[49] },
  ];
  const tracks = PARTS.map(({ name, program, velocity }, channel) => {
    const timed: { tick: number; event: MidiEvent }[] = [];
    measures.forEach((measure, i) => {
      let tick = starts[i];
      for (const token of measure[channel] ?? []) {
        const [pitches, units] = token.split("/");
        const length = Number(units) * SIXTEENTH;
        if (pitches !== "r") {
          for (const pitch of pitches.split("+")) {
            const midi = noteNumber(pitch);
            timed.push({ tick, event: { type: "noteOn", deltaTime: 0, channel, noteNumber: midi, velocity } });
            timed.push({ tick: tick + length, event: { type: "noteOff", deltaTime: 0, channel, noteNumber: midi, velocity: 0 } });
          }
        }
        tick += length;
      }
    });
    timed.sort((a, b) => a.tick - b.tick);
    const events: MidiEvent[] = [
      { type: "trackName", deltaTime: 0, text: name },
      { type: "programChange", deltaTime: 0, channel, programNumber: program },
    ];
    let previous = 0;
    for (const { tick, event } of timed) {
      event.deltaTime = tick - previous;
      events.push(event);
      previous = tick;
    }
    events.push({ type: "endOfTrack", deltaTime: end - previous });
    return events;
  });
  return Uint8Array.from(writeMidi({
    header: { format: 1, numTracks: tracks.length + 1, ticksPerBeat: TICKS_PER_BEAT },
    tracks: [conductor, ...tracks],
  }));
}
