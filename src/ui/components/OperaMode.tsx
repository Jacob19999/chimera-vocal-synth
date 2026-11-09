import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { engine } from "../../audio/AudioEngine.ts";
import type { OrchestraPlan } from "../../audio/orchestra.ts";
import { NEUTRAL, type ScoreTrack } from "../../wasm/engine.ts";
import { PRESETS } from "../body.ts";
import { V } from "../colors.ts";
import { mouthWords } from "../mouthWords.ts";
import { planOrchestra } from "../orchestraMidi.ts";
import { sungNow, tickSinging, useSing, type DuetVoices, type VocalSettings } from "../singing.ts";
import { useStore } from "../store.ts";
import { getModel } from "../useModel.ts";
import { Screen } from "./Screen.tsx";
import { Slider } from "./Controls.tsx";
import { EnvironmentPanel } from "./EnvironmentPanel.tsx";
import { loadMozart, ScoreControls, TrackLyrics } from "./SingPanel.tsx";
import { OperaOrchestra, orchestraMix, useOrchestra } from "./OperaOrchestra.tsx";
import type { HeadFeed } from "./AnatomyView3D.tsx";

const AnatomyView3D = lazy(() => import("./AnatomyView3D.tsx").then((m) => ({ default: m.AnatomyView3D })));
const leadWords = mouthWords(() => sungNow(), V.green, 1);
const harmonyWords = mouthWords(() => sungNow(true), V.pink, -1);
const MIN_MIDI_WIDTH = 30;
const MAX_MIDI_WIDTH = 70;
const VOICE_PRESETS = {
  Classical: { gain: 1, vibrato: 35 },
  "Straight tone": { gain: 0.95, vibrato: 0 },
  Lyric: { gain: 0.85, vibrato: 24 },
  Dramatic: { gain: 1, vibrato: 58 },
} satisfies Record<string, VocalSettings>;

function OperaVoiceControls({ role, name, voice, onChange }: {
  role: "Male" | "Female"; name: string; voice: VocalSettings; onChange: (voice: VocalSettings) => void;
}) {
  const preset = Object.entries(VOICE_PRESETS).find(([, values]) => values.gain === voice.gain && values.vibrato === voice.vibrato)?.[0] ?? "";
  return (
    <fieldset className="opera-voice">
      <legend>{name}</legend>
      <label className="opera-voice-preset">
        Preset
        <select aria-label={`${role} voice preset`} value={preset} onChange={(e) => onChange(VOICE_PRESETS[e.target.value as keyof typeof VOICE_PRESETS])}>
          <option value="" disabled>Custom</option>
          {Object.keys(VOICE_PRESETS).map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      <Slider label={`${role} level`} value={voice.gain} min={0} max={1} step={0.01}
        onChange={(gain) => onChange({ ...voice, gain })} format={(gain) => `${Math.round(gain * 100)}%`} />
      <Slider label={`${role} vibrato`} value={voice.vibrato} min={0} max={80} step={1}
        onChange={(vibrato) => onChange({ ...voice, vibrato: Math.round(vibrato) })} format={(vibrato) => `${vibrato}¢`} />
    </fieldset>
  );
}

function OperaMix({ plan, error, scoreControls }: { plan?: OrchestraPlan; error?: string; scoreControls: ReactNode }) {
  const [split, setSplit] = useState(50);
  const midiId = useId();
  const grabOffset = useRef(0);
  const resize = (percent: number) => setSplit(Math.max(MIN_MIDI_WIDTH, Math.min(MAX_MIDI_WIDTH, Math.round(percent))));

  return (
    <div className="opera-mix" style={{ "--midi-width": `${split}fr`, "--environment-width": `${100 - split}fr` } as CSSProperties}>
      <div className="opera-midi" id={midiId}>
        <OperaOrchestra plan={plan} alignmentError={error} />
      </div>
      <div className="opera-divider" role="separator" tabIndex={0} aria-orientation="vertical"
        aria-label="Resize MIDI and Customization panels" aria-controls={midiId}
        aria-valuemin={MIN_MIDI_WIDTH} aria-valuemax={MAX_MIDI_WIDTH} aria-valuenow={split}
        aria-valuetext={`MIDI ${split}%, Customization ${100 - split}%`}
        title="Drag to resize. Double-click to reset to 50/50."
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return;
          const handle = e.currentTarget;
          const box = handle.getBoundingClientRect();
          grabOffset.current = e.clientX - box.left - box.width / 2;
          handle.setPointerCapture(e.pointerId);
          handle.focus({ preventScroll: true });
        }}
        onPointerMove={(e) => {
          const handle = e.currentTarget;
          if (!handle.hasPointerCapture(e.pointerId)) return;
          const { left, width } = handle.parentElement!.getBoundingClientRect();
          const gutter = handle.offsetWidth;
          resize(100 * (e.clientX - left - grabOffset.current - gutter / 2) / (width - gutter));
        }}
        onDoubleClick={() => resize(50)}
        onKeyDown={(e) => {
          switch (e.key) {
            case "ArrowLeft": resize(split - 5); break;
            case "ArrowRight": resize(split + 5); break;
            case "Home": resize(MIN_MIDI_WIDTH); break;
            case "End": resize(MAX_MIDI_WIDTH); break;
            case "Enter": resize(50); break;
            default: return;
          }
          e.preventDefault();
        }} />
      <EnvironmentPanel title="Customization" sub="Room, voices and transport">{scoreControls}</EnvironmentPanel>
    </div>
  );
}

function OperaLyrics({ track, title, harmony }: { track: ScoreTrack; title: string; harmony: boolean }) {
  const at = useSing((s) => s.demo === title ? (harmony ? s.harmonyAt : s.demoAt) : -1);
  return (
    <div className={`opera-lyrics${harmony ? " opera-lyrics-harmony" : ""}`}>
      <span className="opera-score-label">Vocal score</span>
      <TrackLyrics track={track} at={at} showName={false} />
    </div>
  );
}

function OperaHead({ track, scoreTitle, harmony }: {
  track?: ScoreTrack; scoreTitle?: string; harmony: boolean;
}) {
  const started = useStore((s) => s.started);
  const rate = started ? engine.sampleRate : 48000;
  const body = harmony ? PRESETS.female : PRESETS.male;
  const feed = useMemo<HeadFeed>(() => ({
    model: getModel(body, rate),
    maxDpr: 1.25,
    facing: harmony ? -1 : 1,
    view: { pressure: true, particles: true, calipers: false, grid: false },
    frame: () => {
      const playing = useSing.getState().demo !== null;
      const snapshot = harmony ? engine.latest?.harmony : engine.latest;
      return { tele: playing ? snapshot ?? null : null, artic: NEUTRAL, epoch: engine.lastPlan?.id ?? 0 };
    },
  }), [body, harmony, rate]);
  return (
    <Screen className="opera-head" title={track?.name ?? (harmony ? "Zerlina" : "Don Giovanni")} sub={harmony ? "Female voice" : "Male voice"}>
      <div className="opera-portrait">
        <AnatomyView3D feed={feed} readouts={false} overlay={harmony ? harmonyWords : leadWords} />
      </div>
      <div className="opera-vocal-score">
        {track && scoreTitle && <OperaLyrics track={track} title={scoreTitle} harmony={harmony} />}
      </div>
    </Screen>
  );
}

export function OperaMode() {
  const score = useSing((s) => s.score);
  const file = useOrchestra((s) => s.file);
  const offset = useOrchestra((s) => s.offset);
  const [voices, setVoices] = useState<DuetVoices>([VOICE_PRESETS.Classical, VOICE_PRESETS.Classical]);
  const voicesRef = useRef(voices);
  const updateVoice = (index: 0 | 1, voice: VocalSettings) => {
    const next: DuetVoices = [...voicesRef.current];
    next[index] = voice;
    voicesRef.current = next;
    setVoices(next);
    engine.setDuetLevels([next[0].gain, next[1].gain]);
  };
  const { plan, error } = useMemo(() => {
    if (!score || !file) return {};
    try {
      const plan = planOrchestra(file, score.tracks[0].tempo, offset);
      if (!plan.notes.length) return { error: "The offset moves all MIDI notes before the score." };
      return { plan };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [score, file, offset]);
  useEffect(() => {
    if (useSing.getState().score?.tracks.length !== 2) loadMozart();
    let frame = 0;
    const update = () => {
      tickSinging();
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="opera-mode">
      <div className="opera-stage" aria-label="Live duet stage">
        <Suspense fallback={null}>
          <OperaHead track={score?.tracks[0]} scoreTitle={score?.title} harmony={false} />
          <OperaHead track={score?.tracks[1]} scoreTitle={score?.title} harmony />
        </Suspense>
      </div>
      <OperaMix plan={plan} error={error} scoreControls={
        <>
          <div className="opera-transport">
            <span className="opera-score-label">Duet transport</span>
            <ScoreControls duetOnly showLyrics={false} orchestra={plan ? { plan, mix: orchestraMix } : undefined}
              orchestraError={error} duetVoices={() => voicesRef.current} />
          </div>
          <div className="opera-transport">
            <span className="opera-score-label">Voices</span>
            <div className="opera-voices">
              <OperaVoiceControls role="Male" name={score?.tracks[0]?.name ?? "Don Giovanni"} voice={voices[0]} onChange={(voice) => updateVoice(0, voice)} />
              <OperaVoiceControls role="Female" name={score?.tracks[1]?.name ?? "Zerlina"} voice={voices[1]} onChange={(voice) => updateVoice(1, voice)} />
            </div>
            <p className="environment-description">Level changes live. Vibrato changes apply on the next play.</p>
          </div>
        </>
      } />
    </main>
  );
}
