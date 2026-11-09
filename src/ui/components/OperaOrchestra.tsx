import { useEffect, useId, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { engine } from "../../audio/AudioEngine.ts";
import { INSTRUMENTS, trackGains, type OrchestraPlan, type TrackMix } from "../../audio/orchestra.ts";
import { ORCHESTRA_DEMO_NAME, orchestraDemoBytes } from "../../audio/orchestraDemo.ts";
import { MAX_MIDI_BYTES, readOrchestraMidi, type OrchestraMidi } from "../orchestraMidi.ts";
import { scoreTime, stopSinging, useSing } from "../singing.ts";
import { usePhosphor } from "../usePhosphor.ts";
import { Chip, Screen } from "./Screen.tsx";

export const useOrchestra = create<{
  file: OrchestraMidi | null;
  library: File[];
  activeMidi: string;
  offset: number;
  mix: TrackMix[];
}>(() => ({
  file: null, library: [], activeMidi: "", offset: 0, mix: [],
}));

export const orchestraMix = () => useOrchestra.getState().mix;

const midiPath = (file: File) => file.webkitRelativePath || file.name;
const midiKey = (file: File) => JSON.stringify([midiPath(file), file.size, file.lastModified]);
const DEMO_MIDI = "demo";

const COLORS = ["#56ccff", "#ffbd69", "#79e996", "#ff83c8", "#b4a2ff", "#ff897b", "#5be0ce", "#dfec89"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const PIANO_LOW = 21; // A0
const PIANO_HIGH = 108; // C8
const WHITE_KEY_HEIGHT = 38;
const BLACK_KEY_HEIGHT = 23;
const color = (track: number) => COLORS[track % COLORS.length];

/** Key centers and note lanes in units of one white key's width. */
function pianoLayout(low: number, high: number) {
  let whites = 0;
  const keys = Array.from({ length: high - low + 1 }, (_, i) => {
    const midi = low + i;
    const black = BLACK_KEYS.has(midi % 12);
    const center = whites + (black ? 0 : 0.5);
    if (!black) whites++;
    return { midi, black, center, left: 0, right: 0 };
  });
  for (const [i, key] of keys.entries()) {
    key.left = i > 0 ? (keys[i - 1].center + key.center) / 2 : 0;
    key.right = i + 1 < keys.length ? (key.center + keys[i + 1].center) / 2 : whites;
  }
  return { low, keys, whites };
}

const fullPiano = pianoLayout(PIANO_LOW, PIANO_HIGH);

function Waterfall({ plan, mix }: { plan: OrchestraPlan; mix: TrackMix[] }) {
  const range = useMemo(() => {
    let low = 60, high = 71, end = 0;
    const ends = plan.notes.map((note) => {
      low = Math.min(low, note.midi);
      high = Math.max(high, note.midi);
      end = Math.max(end, note.end);
      return end;
    });
    const compactPiano = pianoLayout(Math.floor(low / 12) * 12, Math.min(127, Math.floor(high / 12) * 12 + 11));
    return { compactPiano, ends };
  }, [plan]);
  const gains = useMemo(() => trackGains(mix), [mix]);
  const active = useRef(new Int16Array(128));
  const ref = usePhosphor(({ ctx, w, h }) => {
    const rail = 35, keys = h - WHITE_KEY_HEIGHT, window = 5;
    const piano = w >= 700 ? fullPiano : range.compactPiano;
    const whiteW = (w - rail) / piano.whites;
    if (whiteW <= 0 || keys <= 0) return;
    const x = (position: number) => rail + position * whiteW;
    const at = scoreTime();
    const time = Math.max(-0.35, at ?? 0);
    const y = (t: number) => keys * (1 - (t - time) / window);
    ctx.font = "10px system-ui";
    ctx.textBaseline = "middle";
    for (const key of piano.keys) {
      if (key.black) {
        ctx.fillStyle = "#08101a";
        ctx.fillRect(x(key.left), 0, (key.right - key.left) * whiteW, keys);
      }
      if (key.midi % 12 === 0) {
        ctx.fillStyle = "#173344";
        ctx.fillRect(x(key.left), 0, 1, keys);
      }
    }
    for (let s = Math.max(0, Math.ceil(time)); s < time + window; s++) {
      const row = y(s);
      ctx.fillStyle = "#193a4f";
      ctx.fillRect(rail, row, w - rail, 1);
      ctx.fillStyle = "#a9c7d9";
      ctx.fillText(`${s}s`, 5, Math.max(7, row - 7));
    }
    const pressed = active.current;
    pressed.fill(-1);
    let lo = 0, hi = range.ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (range.ends[mid] <= time) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < plan.notes.length; i++) {
      const note = plan.notes[i];
      if (note.start >= time + window) break;
      const key = piano.keys[note.midi - piano.low];
      if (note.end <= time || !key) continue;
      const top = Math.max(0, y(note.end));
      const bottom = Math.min(keys, y(note.start));
      const audible = gains[note.track] > 0 && note.velocity > 0;
      const barWidth = Math.max(1, whiteW * (key.black ? 0.28 : 0.68));
      ctx.globalAlpha = audible ? 0.9 : 0.2;
      ctx.fillStyle = color(note.track);
      ctx.fillRect(x(key.center) - barWidth / 2, top, barWidth, Math.min(keys - top, Math.max(1, bottom - top)));
      if (at !== null && audible && time >= note.start) pressed[note.midi] = note.track;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#79c5eb";
    ctx.fillRect(rail, keys - 1, w - rail, 1);
    ctx.textAlign = "center";
    for (const key of piano.keys) {
      if (key.black) continue;
      const track = pressed[key.midi];
      ctx.fillStyle = track >= 0 ? color(track) : "#d2e3ed";
      ctx.fillRect(x(key.center - 0.5) + 0.5, keys, Math.max(1, whiteW - 1), WHITE_KEY_HEIGHT);
      if (whiteW >= 11 && (key.midi === PIANO_LOW || key.midi % 12 === 0)) {
        ctx.fillStyle = "#142e3e";
        ctx.fillText(key.midi === PIANO_LOW ? "A0" : `C${Math.floor(key.midi / 12) - 1}`, x(key.center), keys + WHITE_KEY_HEIGHT - 9, whiteW - 2);
      }
    }
    for (const key of piano.keys) {
      if (!key.black) continue;
      const track = pressed[key.midi];
      ctx.fillStyle = track >= 0 ? color(track) : "#263b4a";
      ctx.fillRect(x(key.center - 0.3), keys, whiteW * 0.6, BLACK_KEY_HEIGHT);
    }
    ctx.fillStyle = "#b3d8eb";
    ctx.textAlign = "left";
    ctx.fillText("NOW", 5, keys + 10);
  }, { sigma: 1, alpha: 0.25 });
  return (
    <div className="orchestra-waterfall">
      <canvas ref={ref} role="img" aria-label="Orchestra MIDI falling notes and piano keyboard" />
    </div>
  );
}

export function OperaOrchestra({ plan, alignmentError }: { plan?: OrchestraPlan; alignmentError?: string }) {
  const libraryId = useId();
  const file = useOrchestra((s) => s.file);
  const library = useOrchestra((s) => s.library);
  const activeMidi = useOrchestra((s) => s.activeMidi);
  const offset = useOrchestra((s) => s.offset);
  const mix = useOrchestra((s) => s.mix);
  const playing = useSing((s) => s.demo !== null);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const offsetInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => () => { request.current++; }, []);

  const importFile = async (source: File, key = midiKey(source)) => {
    const token = ++request.current;
    setError("");
    setLoading(true);
    try {
      if (source.size > MAX_MIDI_BYTES) throw new Error("Choose a MIDI file of at most 2 MiB.");
      const bytes = await source.arrayBuffer();
      if (token !== request.current) return;
      const file = readOrchestraMidi(source.name, bytes);
      stopSinging();
      useOrchestra.setState({ file, activeMidi: key, offset: 0,
        mix: file.tracks.map(() => ({ instrument: null, gain: 0.8, mute: false, solo: false })) });
      if (offsetInput.current) offsetInput.current.value = "0";
    } catch (e) {
      if (token === request.current) setError(e instanceof Error ? e.message : "Could not read this Standard MIDI file.");
    } finally {
      if (token === request.current) setLoading(false);
    }
  };

  const addFiles = (input: HTMLInputElement, fromFolder: boolean) => {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    if (!selected.length) return;
    const midis = selected.filter((file) => /\.midi?$/i.test(file.name));
    if (!midis.length) {
      setError(fromFolder ? "This folder contains no .mid or .midi files." : "Choose .mid or .midi files.");
      return;
    }
    setError("");
    useOrchestra.setState(({ library }) => {
      const byKey = new Map(library.map((file) => [midiKey(file), file]));
      for (const midi of midis) byKey.set(midiKey(midi), midi);
      return { library: Array.from(byKey.values()).sort((a, b) => midiPath(a).localeCompare(midiPath(b), undefined, { numeric: true })) };
    });
    if (!fromFolder && midis.length === 1) void importFile(midis[0]);
  };

  const changeTrack = (index: number, patch: Partial<TrackMix>) => {
    const updated = orchestraMix().map((track, i) => i === index ? { ...track, ...patch } : track);
    useOrchestra.setState({ mix: updated });
    engine.setOrchestraMix(updated);
  };

  return (
    <Screen className="s-orchestra" title="Orchestra" sub="MIDI accompaniment · shared room"
      tools={<Chip toggle={false} onClick={() => input.current?.click()}>Import orchestra MIDI</Chip>}>
      <div className="orchestra-content">
        <input ref={input} hidden type="file" multiple accept=".mid,.midi,audio/midi,audio/x-midi" aria-label="Orchestra MIDI file"
          onChange={(e) => addFiles(e.currentTarget, false)} />
        <input ref={folderInput} hidden type="file" {...{ webkitdirectory: "" }} aria-label="Orchestra MIDI folder"
          onChange={(e) => addFiles(e.currentTarget, true)} />
        <div className="orchestra-library">
          <div className="orchestra-library-picker">
            <label htmlFor={libraryId}>MIDI library</label>
            <select id={libraryId} value={activeMidi} disabled={loading}
              onChange={(e) => {
                const key = e.target.value;
                if (key === DEMO_MIDI) {
                  void importFile(new File([orchestraDemoBytes()], ORCHESTRA_DEMO_NAME, { type: "audio/midi" }), key);
                  return;
                }
                const midi = library.find((file) => midiKey(file) === key);
                if (midi) void importFile(midi);
              }}>
              <option value="" disabled>Choose a MIDI</option>
              <optgroup label="Built-in Mozart accompaniment"><option value={DEMO_MIDI}>{ORCHESTRA_DEMO_NAME}</option></optgroup>
              {library.length > 0 && (
                <optgroup label="Local MIDI files">
                  {library.map((file) => <option key={midiKey(file)} value={midiKey(file)}>{midiPath(file)}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <Chip toggle={false} onClick={() => folderInput.current?.click()}>Browse MIDI folder</Chip>
        </div>
        {file ? (
          <>
            <div className="orchestra-file">
              <div>
                <strong>{file.name}</strong>
                <span>{file.tracks.length} {file.tracks.length === 1 ? "track" : "tracks"} · Follows the MusicXML tempo</span>
              </div>
              <label title="Adjust while stopped. Positive values delay the MIDI. One beat is one quarter note.">
                MIDI offset
                <input ref={offsetInput} type="number" min={-256} max={256} step={0.25} defaultValue={offset} disabled={playing}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  onBlur={(e) => {
                    const value = e.currentTarget.valueAsNumber;
                    const next = Number.isFinite(value) ? Math.max(-256, Math.min(256, value)) : offset;
                    e.currentTarget.value = String(next);
                    if (next === offset) return;
                    stopSinging();
                    useOrchestra.setState({ offset: next });
                  }} />
                beats
              </label>
              <Chip toggle={false} onClick={() => {
                request.current++;
                stopSinging();
                setError("");
                setLoading(false);
                useOrchestra.setState({ file: null, activeMidi: "", offset: 0, mix: [] });
              }}>Remove MIDI</Chip>
            </div>
            {plan ? <Waterfall plan={plan} mix={mix} /> : null}
            <div className="orchestra-mixer" aria-label="Orchestra track mixer">
              {file.tracks.map((track, i) => (
                <div className="orchestra-track" key={i}>
                  <strong><span className="orchestra-swatch" style={{ backgroundColor: color(i) }} />{track.name}</strong>
                  <label>
                    Instrument
                    <select aria-label={`Instrument for ${track.name}`} value={mix[i].instrument ?? ""}
                      title="Instrument changes apply from the next note."
                      onChange={(e) => changeTrack(i, { instrument: (e.target.value || null) as TrackMix["instrument"] })}>
                      <option value="">MIDI · {track.instrument}</option>
                      {INSTRUMENTS.map((instrument) => <option key={instrument}>{instrument}</option>)}
                    </select>
                  </label>
                  <label>
                    Level <span className="orchestra-level">{Math.round(mix[i].gain * 100)}%</span>
                    <input type="range" min="0" max="1" step="0.01" value={mix[i].gain} aria-label={`Level for ${track.name}`}
                      onChange={(e) => changeTrack(i, { gain: e.target.valueAsNumber })} />
                  </label>
                  <div className="orchestra-track-actions">
                    <Chip on={mix[i].mute} aria-label={`Mute ${track.name}`} onClick={() => changeTrack(i, { mute: !mix[i].mute })}>Mute</Chip>
                    <Chip on={mix[i].solo} aria-label={`Solo ${track.name}`} onClick={() => changeTrack(i, { solo: !mix[i].solo })}>Solo</Chip>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>Choose the built-in Mozart accompaniment or add your own .mid and .midi files.</p>
        )}
        {error ? <span role="alert">{error}</span> : null}
        {alignmentError ? <span role="alert">{alignmentError}</span> : null}
      </div>
    </Screen>
  );
}
