import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseMidi, writeMidi, type MidiEvent } from "midi-file";
import type { OrchestraCue, TrackMix } from "../src/audio/orchestra.ts";
import { ORCHESTRA_DEMO_NAME, orchestraDemoBytes } from "../src/audio/orchestraDemo.ts";
import { planOrchestra, readOrchestraMidi } from "../src/ui/orchestraMidi.ts";
import type { ToWorklet } from "../src/worklet/protocol.ts";
import { initEngine, wasmModule } from "./harness.ts";

const midi = (tracks: MidiEvent[][]) => Uint8Array.from(writeMidi({
  header: { format: tracks.length === 1 ? 0 : 1, numTracks: tracks.length, ticksPerBeat: 480 },
  tracks,
})).buffer;

test("MIDI splits channels, pairs velocity-zero offs, and uses the duet's written tempo", async () => {
  const file = readOrchestraMidi("duet.mid", midi([[
    { type: "trackName", deltaTime: 0, text: "Orchestra" },
    { type: "setTempo", deltaTime: 0, microsecondsPerBeat: 250000 },
    { type: "programChange", deltaTime: 0, channel: 0, programNumber: 40 },
    { type: "programChange", deltaTime: 0, channel: 1, programNumber: 60 },
    { type: "noteOn", deltaTime: 240, channel: 0, noteNumber: 67, velocity: 127 },
    { type: "noteOn", deltaTime: 0, channel: 1, noteNumber: 48, velocity: 80 },
    { type: "controller", deltaTime: 120, channel: 0, controllerType: 64, value: 127 },
    { type: "noteOn", deltaTime: 120, channel: 0, noteNumber: 67, velocity: 0 },
    { type: "noteOff", deltaTime: 0, channel: 1, noteNumber: 48, velocity: 0 },
    { type: "controller", deltaTime: 480, channel: 0, controllerType: 64, value: 0 },
    { type: "endOfTrack", deltaTime: 0 },
  ]]));
  expect(file.tracks.map(({ name, instrument }) => [name, instrument])).toEqual([
    ["Orchestra · Ch 1", "Violin"], ["Orchestra · Ch 2", "French horn"],
  ]);
  expect(planOrchestra(file, [[0, 0, 0.5], [1, 0.5, 1]], 0.25).notes.map(({ start, end }) => [start, end])).toEqual([
    [0.375, 1.75], [0.375, 0.75],
  ]);
  expect(planOrchestra(file, [[0, 0, 0.5]], -1).notes.map(({ start, end }) => [start, end])).toEqual([[0, 0.5]]);

  await initEngine();
  const { importScore } = await import("../src/wasm/engine.ts");
  const [lead, harmony] = importScore({ xml: readFileSync("examples/la-ci-darem/duet.musicxml", "utf8") },
    readFileSync("examples/la-ci-darem/duet.ipa", "utf8"));
  expect(lead.tempo).toEqual(harmony.tempo);
  const [beat, seconds] = lead.tempo.at(-1)!;
  const shifted = planOrchestra(file, lead.tempo, beat - 0.5);
  expect(beat).toBeGreaterThan(0);
  expect(shifted.notes[0].start).toBeCloseTo(seconds, 9);
});

test("a MIDI track with an invalid variable-length event cannot move the reader backward", () => {
  const bad = new Uint8Array(midi([[{ type: "endOfTrack", deltaTime: 0 }]]));
  const bytes = Uint8Array.from([...bad.slice(0, 21), 12, 0, 255, 1, 255, 255, 255, 255, 127, 0, 255, 47, 0]);
  expect(() => readOrchestraMidi("bad.mid", bytes.buffer)).toThrow("Invalid MIDI chunk or event length.");
});

test("the built-in Mozart accompaniment reaches the final instrumental bar", async () => {
  const bytes = orchestraDemoBytes();
  const file = readOrchestraMidi(ORCHESTRA_DEMO_NAME, bytes.buffer);
  expect(file.tracks.map(({ name, instrument }) => [name, instrument])).toEqual([
    ["Cello", "Cello"], ["Strings", "Strings"], ["Winds", "Flute"],
  ]);

  await initEngine();
  const { importScore } = await import("../src/wasm/engine.ts");
  const [lead, harmony] = importScore({ xml: readFileSync("examples/la-ci-darem/duet.musicxml", "utf8") },
    readFileSync("examples/la-ci-darem/duet.ipa", "utf8"));
  const { header, tracks } = parseMidi(bytes);
  let ticks = 0;
  const tempos = tracks[0].flatMap((event) => {
    ticks += event.deltaTime;
    return event.type === "setTempo" ? [[ticks / header.ticksPerBeat!, event.microsecondsPerBeat]] : [];
  });
  expect(tempos).toEqual(lead.tempo.map(([beat, , rate]) => [beat, Math.round(rate * 1e6)]));
  const [lastBeat, lastTime, lastRate] = lead.tempo.at(-1)!;
  expect(ticks / header.ticksPerBeat!).toBeCloseTo(lastBeat + (lead.end - lastTime) / lastRate);

  const plan = planOrchestra(file, lead.tempo, 0);
  let end = 0, longestRest = 0;
  for (const note of plan.notes) {
    longestRest = Math.max(longestRest, note.start - end);
    end = Math.max(end, note.end);
  }
  expect(longestRest).toBeLessThan(1);
  expect(plan.end).toBeGreaterThan(Math.max(lead.notes.at(-1)!.end, harmony.notes.at(-1)!.end));
  expect(lead.end - plan.end).toBeCloseTo(2.5 * lastRate);
});

test("worklet starts MIDI on the vocal preroll, mixes live tracks, and sends MIDI into the room", async () => {
  type Processor = {
    port: { onmessage: (e: { data: ToWorklet }) => void };
    process: (inputs: unknown[], output: Float32Array[][]) => void;
  };
  let Worklet: new (options: unknown) => Processor;
  const errors: unknown[] = [];
  const globals = globalThis as Record<string, unknown>;
  globals.sampleRate = 48000;
  globals.AudioWorkletProcessor = class {
    port = { onmessage: null, postMessage: (m: { type: string }) => { if (m.type === "error") errors.push(m); } };
  };
  globals.registerProcessor = (_name: string, ctor: typeof Worklet) => { Worklet = ctor; };
  // @ts-expect-error Re-register the worklet for this port.
  await import("../src/worklet/processor.ts?orchestra");
  const dry = new Worklet!({ processorOptions: { module: wasmModule } });
  const wet = new Worklet!({ processorOptions: { module: wasmModule } });
  const send = (worklet: Processor, data: ToWorklet) => worklet.port.onmessage({ data });
  const render = (worklet: Processor) => {
    const output = [new Float32Array(128), new Float32Array(128)];
    worklet.process([], [output]);
    return output;
  };
  const level = (samples: Float32Array) => samples.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0);
  const mix: TrackMix[] = [
    { instrument: null, gain: 1, mute: false, solo: false },
    { instrument: null, gain: 1, mute: false, solo: false },
  ];
  const orchestra: OrchestraCue = {
    delay: 0.35, mix, notes: [
      { start: 0, end: 0.6, midi: 69, velocity: 1, track: 0, instrument: "Flute" },
      { start: 0, end: 0.6, midi: 48, velocity: 1, track: 1, instrument: "Cello" },
    ],
  };
  send(wet, { type: "environment", settings: { preset: "hall", mix: 0.8, decay: 1.5, damping: 0.4 } });
  for (const p of [dry, wet]) {
    send(p, { type: "schedule", id: 1, replace: true, gestures: [], segments: [], end: 0.95, orchestra });
  }

  // 0.35 s score preroll + the common 0.03 s schedule lead = 18,240 frames.
  for (let i = 0; i < 142; i++) {
    expect(level(render(dry)[0])).toBeLessThan(1e-7);
    render(wet);
  }
  const [first] = render(dry);
  render(wet);
  expect(level(first.slice(0, 64))).toBeLessThan(1e-7);
  expect(level(first.slice(65))).toBeGreaterThan(1e-4);

  let stereo = 0;
  for (let i = 0; i < 90; i++) {
    render(dry);
    const [l, r] = render(wet);
    stereo = Math.max(stereo, ...l.map((v, j) => Math.abs(v - r[j])));
  }
  expect(stereo).toBeGreaterThan(0.001);
  send(dry, { type: "orchestraMix", mix: [{ ...mix[0], mute: true }, { ...mix[1], solo: true }] });
  render(dry);
  expect(level(render(dry)[0])).toBeGreaterThan(0.1);
  send(dry, { type: "orchestraMix", mix: [{ ...mix[0], mute: true }, { ...mix[1], solo: true, mute: true }] });
  render(dry);
  expect(level(render(dry)[0])).toBeLessThan(1e-7);
  send(wet, { type: "stopSpeech" });
  expect(level(render(wet)[0])).toBeGreaterThan(0.0001);

  const denseChord: OrchestraCue = { delay: 0, mix, notes: Array.from({ length: 32 }, () => ({
    start: 0, end: 0.2, midi: 69, velocity: 1, track: 0, instrument: "Organ",
  })) };
  send(dry, { type: "schedule", id: 2, lead: 0, replace: true, gestures: [], segments: [], end: 0.2, orchestra: denseChord });
  let loudPeak = 0;
  for (let i = 0; i < 30; i++) loudPeak = Math.max(loudPeak, level(render(dry)[0]));
  expect(loudPeak).toBeGreaterThan(0.5);
  expect(loudPeak).toBeLessThan(0.65);
  expect(errors).toEqual([]);
});
