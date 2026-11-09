import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { engine } from "../../audio/AudioEngine.ts";
import { INSTRUMENTS, trackGains, type OrchestraPlan, type TrackMix } from "../../audio/orchestra.ts";
import { MAX_MIDI_BYTES, readOrchestraMidi, type OrchestraMidi } from "../orchestraMidi.ts";
import { scoreTime, stopSinging, useSing } from "../singing.ts";
import { usePhosphor } from "../usePhosphor.ts";
import { Chip, Screen } from "./Screen.tsx";

export const useOrchestra = create<{ file: OrchestraMidi | null; offset: number; mix: TrackMix[] }>(() => ({
  file: null, offset: 0, mix: [],
}));

export const orchestraMix = () => useOrchestra.getState().mix;

const COLORS = ["#56ccff", "#ffbd69", "#79e996", "#ff83c8", "#b4a2ff", "#ff897b", "#5be0ce", "#dfec89"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const color = (track: number) => COLORS[track % COLORS.length];

function Waterfall({ plan, mix }: { plan: OrchestraPlan; mix: TrackMix[] }) {
  const range = useMemo(() => {
    let low = 60, high = 71, end = 0;
    const ends = plan.notes.map((note) => {
      low = Math.min(low, note.midi);
      high = Math.max(high, note.midi);
      end = Math.max(end, note.end);
      return end;
    });
    return { low: Math.floor(low / 12) * 12, high: Math.min(127, Math.floor(high / 12) * 12 + 11), ends };
  }, [plan]);
  const gains = useMemo(() => trackGains(mix), [mix]);
  const active = useRef(new Int16Array(128));
  const ref = usePhosphor(({ ctx, w, h }) => {
    const rail = 35, keys = h - 30, window = 5;
    const pitchW = Math.max(0, (w - rail) / (range.high - range.low + 1));
    if (pitchW === 0 || keys <= 0) return;
    const x = (midi: number) => rail + (midi - range.low) * pitchW;
    const at = scoreTime();
    const time = Math.max(-0.35, at ?? 0);
    const y = (t: number) => keys * (1 - (t - time) / window);
    ctx.font = "10px system-ui";
    ctx.textBaseline = "middle";
    for (let midi = range.low; midi <= range.high; midi++) {
      if (BLACK_KEYS.has(midi % 12)) {
        ctx.fillStyle = "#08101a";
        ctx.fillRect(x(midi), 0, pitchW, keys);
      }
      if (midi % 12 === 0) {
        ctx.fillStyle = "#173344";
        ctx.fillRect(x(midi), 0, 1, keys);
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
      if (note.end <= time) continue;
      const top = Math.max(0, y(note.end));
      const bottom = Math.min(keys, y(note.start));
      const audible = gains[note.track] > 0 && note.velocity > 0;
      ctx.globalAlpha = audible ? 0.9 : 0.2;
      ctx.fillStyle = color(note.track);
      ctx.fillRect(x(note.midi) + 0.5, top, Math.max(1, pitchW - 1), Math.min(keys - top, Math.max(1, bottom - top)));
      if (at !== null && audible && time >= note.start) pressed[note.midi] = note.track;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#79c5eb";
    ctx.fillRect(rail, keys - 1, w - rail, 1);
    for (let midi = range.low; midi <= range.high; midi++) {
      if (BLACK_KEYS.has(midi % 12)) continue;
      const track = pressed[midi];
      const left = BLACK_KEYS.has((midi - 1) % 12) ? pitchW / 2 : 0;
      const right = BLACK_KEYS.has((midi + 1) % 12) ? pitchW / 2 : 0;
      ctx.fillStyle = track >= 0 ? color(track) : "#d2e3ed";
      ctx.fillRect(x(midi) - left + 0.5, keys, Math.max(1, pitchW + left + right - 1), 30);
      if (midi % 12 === 0 && pitchW >= 11) {
        ctx.fillStyle = "#142e3e";
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, x(midi) + 1, keys + 22);
      }
    }
    for (let midi = range.low; midi <= range.high; midi++) {
      if (!BLACK_KEYS.has(midi % 12)) continue;
      const track = pressed[midi];
      ctx.fillStyle = track >= 0 ? color(track) : "#263b4a";
      ctx.fillRect(x(midi) + 0.5, keys, Math.max(1, pitchW - 1), 17);
    }
    ctx.fillStyle = "#b3d8eb";
    ctx.fillText("NOW", 5, keys + 10);
  }, { sigma: 1, alpha: 0.25 });
  return (
    <div className="orchestra-waterfall">
      <canvas ref={ref} role="img" aria-label="Orchestra MIDI falling notes and piano keyboard" />
    </div>
  );
}

export function OperaOrchestra({ plan, alignmentError }: { plan?: OrchestraPlan; alignmentError?: string }) {
  const file = useOrchestra((s) => s.file);
  const offset = useOrchestra((s) => s.offset);
  const mix = useOrchestra((s) => s.mix);
  const playing = useSing((s) => s.demo !== null);
  const input = useRef<HTMLInputElement>(null);
  const offsetInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [error, setError] = useState("");
  useEffect(() => () => { request.current++; }, []);

  const importFile = async (source: File) => {
    const token = ++request.current;
    setError("");
    try {
      if (source.size > MAX_MIDI_BYTES) throw new Error("Choose a MIDI file of at most 2 MiB.");
      const bytes = await source.arrayBuffer();
      if (token !== request.current) return;
      const file = readOrchestraMidi(source.name, bytes);
      stopSinging();
      useOrchestra.setState({ file, offset: 0, mix: file.tracks.map(() => ({ instrument: null, gain: 0.8, mute: false, solo: false })) });
      if (offsetInput.current) offsetInput.current.value = "0";
    } catch (e) {
      if (token === request.current) setError(e instanceof Error ? e.message : "Could not read this Standard MIDI file.");
    }
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
        <input ref={input} hidden type="file" accept=".mid,.midi,audio/midi,audio/x-midi" aria-label="Orchestra MIDI file"
          onChange={(e) => {
            const selected = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (selected) void importFile(selected);
          }} />
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
                useOrchestra.setState({ file: null, offset: 0, mix: [] });
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
          <p>Import an accompaniment .mid or .midi file to play its instruments alongside the duet.</p>
        )}
        {error ? <span role="alert">{error}</span> : null}
        {alignmentError ? <span role="alert">{alignmentError}</span> : null}
      </div>
    </Screen>
  );
}
