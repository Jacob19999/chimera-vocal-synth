import { expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { initEngine, wasmModule } from "./harness.ts";
import { writeGestures } from "../src/wasm/wire.ts";

await initEngine();
const { ENVIRONMENTS, planUtterance, tokenizeIpa } = await import("../src/wasm/engine.ts");
type Exports = { memory: WebAssembly.Memory } & Record<string, (...args: number[]) => number>;

test("environment catalogue has shared geometry and distinct studio/hall decays", () => {
  expect(ENVIRONMENTS.map((p) => p.id)).toEqual(["dry", "studio", "room", "hall", "cathedral"]);
  const studio = ENVIRONMENTS.find((p) => p.id === "studio")!;
  const hall = ENVIRONMENTS.find((p) => p.id === "hall")!;
  expect(hall.decay).toBeGreaterThan(studio.decay * 5);
  expect(hall.dimensions[0]).toBeGreaterThan(studio.dimensions[0]);
});

test("room playback matches the native CLI's stereo samples bit for bit", () => {
  mkdirSync("out/environment/test", { recursive: true });
  const stem = "out/environment/test/native-hall";
  const run = Bun.spawnSync(["cargo", "run", "--quiet", "-p", "chimera-cli", "--", "render", "speech", stem, "ˈhɛloʊ", "--environment", "hall", "--room-mix", "0.5", "--float"]);
  expect(run.exitCode, new TextDecoder().decode(run.stderr)).toBe(0);
  const wav = readFileSync(`${stem}.wav`);
  expect(wav.readUInt16LE(22)).toBe(2);
  const plan = planUtterance(tokenizeIpa("ˈhɛloʊ"), { body: { female: 0, child: 0 }, t0: 0.05, f0: 110 });
  const frames = Math.round(48000 * (plan.end + 0.35 + 0.2));
  const output = new Float32Array(frames * 2);
  const x = new WebAssembly.Instance(wasmModule, {}).exports as unknown as Exports;
  const h = x.engine_new(48000);
  try {
    x.engine_set_environment(h, 3, 0.5, 2.2, 0.35);
    const count = writeGestures(x.memory.buffer, x.engine_records(h), plan.gestures, 4000);
    x.engine_schedule(h, count, 0, 0);
    for (let i = 0; i < frames; i += 128) {
      const n = Math.min(128, frames - i);
      const p = x.engine_render(h, n);
      const left = new Float32Array(x.memory.buffer, p, n);
      const right = new Float32Array(x.memory.buffer, x.engine_output_right(h), n);
      for (let j = 0; j < n; j++) {
        output[2 * (i + j)] = left[j];
        output[2 * (i + j) + 1] = right[j];
      }
    }
    expect(new Uint8Array(output.buffer)).toEqual(new Uint8Array(wav.buffer, wav.byteOffset + 44, output.byteLength));
  } finally {
    x.engine_free(h);
  }
}, 30000);
