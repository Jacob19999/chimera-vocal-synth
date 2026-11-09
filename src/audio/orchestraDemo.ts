import { writeMidi, type MidiEvent } from "midi-file";

export const ORCHESTRA_DEMO_NAME = "accompaniment.mid";

/** A short two-track accompaniment for trying Opera's MIDI controls. */
export function orchestraDemoBytes(): Uint8Array<ArrayBuffer> {
  const track = (text: string, channel: number, programNumber: number, noteNumber: number): MidiEvent[] => [
    { type: "trackName", deltaTime: 0, text },
    { type: "programChange", deltaTime: 0, channel, programNumber },
    { type: "noteOn", deltaTime: 0, channel, noteNumber, velocity: 105 },
    { type: "noteOff", deltaTime: 1920, channel, noteNumber, velocity: 0 },
    { type: "noteOn", deltaTime: 240, channel, noteNumber: noteNumber + 5, velocity: 100 },
    { type: "noteOff", deltaTime: 960, channel, noteNumber: noteNumber + 5, velocity: 0 },
    { type: "endOfTrack", deltaTime: 0 },
  ];
  return Uint8Array.from(writeMidi({
    header: { format: 1, numTracks: 2, ticksPerBeat: 480 },
    tracks: [track("Strings", 0, 40, 69), track("Winds", 1, 73, 77)],
  }));
}
