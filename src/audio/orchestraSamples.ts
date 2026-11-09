import type { Instrument, OrchestraSample, OrchestraSamples } from "./orchestra.ts";

// Versilian Studios Chamber Orchestra 2 Community Edition. See public/orchestra/README.md.
// Each bank contains successive 1.2-second mono samples, with a crossfaded loop at 0.4 seconds.
const BANKS: { instrument: Instrument; file: string; roots: number[] }[] = [
  { instrument: "Cello", file: "cello", roots: [36, 47, 53, 60, 67, 74] },
  { instrument: "Strings", file: "strings", roots: [55, 62, 69, 76, 83, 86] },
  { instrument: "Flute", file: "flute", roots: [60, 72, 81, 88, 93] },
  { instrument: "Oboe", file: "oboe", roots: [58, 65, 74, 82, 89] },
];

export async function loadOrchestraSamples(context: AudioContext): Promise<OrchestraSamples> {
  const banks = await Promise.allSettled(BANKS.map(async ({ instrument, file, roots }) => {
    const response = await fetch(`${import.meta.env.BASE_URL}orchestra/${file}.wav`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Unable to load the ${instrument} recordings.`);
    const decoded = await context.decodeAudioData(await response.arrayBuffer());
    const data = decoded.getChannelData(0);
    const frames = 1.2 * decoded.sampleRate;
    if (data.length < Math.floor(frames * roots.length)) throw new Error(`The ${instrument} recordings are incomplete.`);
    const samples = roots.map<OrchestraSample>((root, index) => ({
      root,
      pcm: data.subarray(Math.round(index * frames), Math.round((index + 1) * frames)),
      loopStart: Math.round(0.4 * decoded.sampleRate),
    }));
    return [instrument, samples] as const;
  }));
  return Object.fromEntries(banks.flatMap((bank) => bank.status === "fulfilled" ? [bank.value] : []));
}
