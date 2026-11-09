import { parseMidi } from "midi-file";
import { midiInstrument, type Instrument, type OrchestraNote, type OrchestraPlan } from "../audio/orchestra.ts";
import type { ScoreTempoMark } from "../wasm/engine.ts";

type MidiNote = Omit<OrchestraNote, "track">;
export interface MidiTrack { name: string; instrument: Instrument; notes: MidiNote[] }
export interface OrchestraMidi { name: string; tracks: MidiTrack[] }

export const MAX_MIDI_BYTES = 2 * 1024 * 1024;
const MAX_TRACKS = 128;
const MAX_NOTES = 60_000;
const MAX_SECONDS = 300;

/** midi-file reads chunks and variable-length payloads through slice. Reject bad lengths
 * before its reader can step backward or accept a truncated payload. */
class MidiBytes extends Uint8Array {
  override slice(start = 0, end = this.length): Uint8Array<ArrayBuffer> {
    if (end < start || end > this.length) throw new Error("Invalid MIDI chunk or event length.");
    return super.slice(start, end);
  }
}

export function readOrchestraMidi(name: string, buffer: ArrayBuffer): OrchestraMidi {
  if (buffer.byteLength > MAX_MIDI_BYTES) throw new Error("Choose a MIDI file of at most 2 MiB.");
  const { header, tracks } = parseMidi(new MidiBytes(buffer));
  const ppq = header.ticksPerBeat;
  if ((header.format !== 0 && header.format !== 1) || !ppq) {
    throw new Error("Use a beat-based Standard MIDI file (format 0 or 1).");
  }
  if (tracks.length !== header.numTracks || tracks.some((events) => events.at(-1)?.type !== "endOfTrack")) {
    throw new Error("The MIDI file contains an incomplete track.");
  }

  const result: MidiTrack[] = [];
  let noteCount = 0;
  for (const [index, events] of tracks.entries()) {
    const nameEvent = events.find((event) => event.type === "trackName" && event.text.trim())
      ?? events.find((event) => event.type === "instrumentName" && event.text.trim());
    const name = nameEvent && "text" in nameEvent ? nameEvent.text.trim().slice(0, 100) : undefined;
    const channels = new Map<number, {
      program: number;
      volume: number;
      expression: number;
      pedal: boolean;
      held: Map<number, MidiNote[]>;
      sustained: MidiNote[];
      notes: MidiNote[];
    }>();
    let ticks = 0;
    for (const event of events) {
      if (event.deltaTime < 0 || event.deltaTime > 0x0fffffff) throw new Error("Invalid MIDI event time.");
      ticks += event.deltaTime;
      const beat = ticks / ppq;
      if (!("channel" in event)) continue;
      const ch = event.channel;
      if (!channels.has(ch)) {
        channels.set(ch, { program: 0, volume: 1, expression: 1, pedal: false, held: new Map(), sustained: [], notes: [] });
      }
      const part = channels.get(ch)!;
      if (event.type === "programChange" && event.programNumber >= 0 && event.programNumber <= 127) {
        part.program = event.programNumber;
      } else if (event.type === "controller") {
        const value = Math.min(127, event.value) / 127;
        if (event.controllerType === 7) part.volume = value;
        if (event.controllerType === 11) part.expression = value;
        if (event.controllerType === 64) {
          part.pedal = value >= 64 / 127;
          if (!part.pedal) {
            for (const note of part.sustained) note.end = beat;
            part.sustained.length = 0;
          }
        }
      } else if ((event.type === "noteOn" || event.type === "noteOff") && event.noteNumber >= 0 && event.noteNumber <= 127) {
        const pitch = event.noteNumber;
        const held = part.held.get(pitch) ?? [];
        if (event.type === "noteOn" && event.velocity > 0) {
          if (++noteCount > MAX_NOTES) throw new Error("Choose a MIDI file with at most 60,000 notes.");
          const note: MidiNote = {
            midi: pitch, start: beat, end: beat,
            velocity: Math.min(127, event.velocity) / 127 * part.volume * part.expression,
            instrument: midiInstrument(part.program, ch),
          };
          part.notes.push(note);
          held.push(note);
          part.held.set(pitch, held);
        } else {
          const note = held.shift();
          if (!held.length) part.held.delete(pitch);
          if (!note) continue;
          if (part.pedal && ch !== 9) part.sustained.push(note);
          else note.end = beat;
        }
      }
    }

    const parts = [...channels].filter(([, part]) => part.notes.length > 0);
    for (const [ch, part] of parts) {
      for (const held of part.held.values()) for (const note of held) note.end = ticks / ppq;
      for (const note of part.sustained) note.end = ticks / ppq;
      const notes = part.notes.filter((note) => note.end > note.start);
      if (!notes.length) continue;
      const instrument = notes[0].instrument;
      const label = name ?? `Track ${index + 1} · ${instrument}`;
      result.push({ name: parts.length === 1 ? label : `${label} · Ch ${ch + 1}`, instrument, notes });
      if (result.length > MAX_TRACKS) throw new Error("Choose a MIDI file with at most 128 instrument tracks.");
    }
  }
  if (!result.length) throw new Error("The MIDI file has no playable notes.");
  return { name, tracks: result };
}

function secondsAt(beat: number, tempo: ScoreTempoMark[]): number {
  let lo = 0, hi = tempo.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tempo[mid][0] <= beat) lo = mid + 1;
    else hi = mid;
  }
  const [mark, seconds, rate] = tempo[Math.max(0, lo - 1)];
  return seconds + (beat - mark) * rate;
}

/** Align MIDI quarter notes to the written score, including every tempo change. */
export function planOrchestra(file: OrchestraMidi, tempo: ScoreTempoMark[], offset: number): OrchestraPlan {
  const notes: OrchestraNote[] = [];
  let end = 0;
  for (const [track, part] of file.tracks.entries()) {
    for (const note of part.notes) {
      if (note.end + offset <= 0) continue;
      const t0 = secondsAt(Math.max(0, note.start + offset), tempo);
      const t1 = secondsAt(note.end + offset, tempo);
      if (t1 > MAX_SECONDS) throw new Error("The aligned MIDI exceeds the five-minute live score limit.");
      if (t1 <= t0) continue;
      notes.push({ ...note, track, start: t0, end: t1 });
      end = Math.max(end, t1);
    }
  }
  notes.sort((a, b) => a.start - b.start);
  return { notes, end };
}
