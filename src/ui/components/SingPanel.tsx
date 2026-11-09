import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.ts";
import { useSing, playDemo, stopSinging, soundingSyllable, sungNow, DEMO_SONGS, loadScore, playScore, type LoadedScore } from "../singing.ts";
import { mouthWords } from "../mouthWords.ts";
import { V } from "../colors.ts";
import { PRESETS } from "../body.ts";
import { g2p } from "../speech.ts";
import { importScore, type ScoreTrack } from "../../wasm/engine.ts";
import mozart from "../../../examples/la-ci-darem/duet.musicxml?raw";
import mozartIpa from "../../../examples/la-ci-darem/duet.ipa?raw";
import { Keys } from "./Keys.tsx";
import { PianoRoll } from "./PianoRoll.tsx";
import { SpectrumView } from "./SpectrumView.tsx";
import { Chip, Screen } from "./Screen.tsx";
import { EncoderPages } from "./Encoder.tsx";
import { noteName } from "./VoiceControls.tsx";
import type { InfoFn } from "./AnatomyView.tsx";

/** epilarynx narrowing for the singer's ring (measured: +3 to +12 dB at 2.4–3.6 kHz, adult male) */
const RING = 0.85;

/** the syllable being sung now: the demo's, or the one the held key is singing */
function syllableNow(): string | null {
  const s = useSing.getState();
  if (s.demo) return s.score ? s.score.tracks[0].notes[s.demoAt]?.syl.text ?? null : s.syllables[s.demoAt]?.text ?? null;
  return soundingSyllable();
}

/** the syllable being sung, at the mouth */
export const singWords = mouthWords(() => sungNow(), V.green);

/** Sing mode's lines over the face: the note, the syllable, the ring */
export const singInfo: InfoFn = (_m, _f, tele) => {
  const out: string[] = [];
  if (tele && tele.t.voicing > 0.3) out.push(`Note ${noteName(tele.t.f0)} ${tele.t.f0.toFixed(0)} Hz`);
  const syl = syllableNow();
  if (syl) out.push(`Syllable ${syl}`);
  out.push(useStore.getState().artic.epilarynx >= RING - 0.05 ? "Ring on" : "Ring off");
  return out;
};

function Lyrics() {
  const lyrics = useSing((s) => s.lyrics);
  const syllables = useSing((s) => s.syllables);
  const cursor = useSing((s) => s.cursor);
  const demo = useSing((s) => s.score ? null : s.demo);
  const demoAt = useSing((s) => s.demoAt);
  const imported = useSing((s) => s.score !== null);
  const setLyrics = useSing((s) => s.setLyrics);
  const setCursor = useSing((s) => s.setCursor);
  const at = demo ? demoAt : -1;
  const done = demo ? demoAt : cursor;
  return (
    <div className="lyrics">
      {imported ? <span>Keyboard lyrics</span> : null}
      <textarea
        value={lyrics}
        onChange={(e) => setLyrics(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        rows={1}
        aria-label="Lyrics to sing"
        placeholder="Type the words to sing"
        title="Each note sings the next syllable. Hold a key while you press the next one to sing legato. A lone “-” between words holds a vowel over several notes; hyphens split a word your way (“ti-ger”)."
      />
      <div className="syllables" role="group" aria-label="Syllables. Each note sings the marked one; choose another to start there.">
        {syllables.map((s, i) => (
          <span key={i} className={`syl-wrap${s.wordEnd ? " word-end" : ""}`}>
            <button
              className={`syl${!demo && i === cursor ? " next" : ""}${i === at ? " now" : ""}${i < done ? " sung" : ""}${s.melisma ? " held" : ""}`}
              onClick={() => setCursor(i)}
              aria-current={!demo && i === cursor ? "step" : undefined}
              title={s.melisma ? "Held vowel: carries the previous syllable onto this note" : `Sing from “${s.text}”`}
            >
              {s.text}
            </button>
            {s.phraseEnd && (
              <span className="breath-mark" aria-label="breath">
                ’
              </span>
            )}
          </span>
        ))}
        {!syllables.length && <span className="dim">No words: the keys sing “ah”.</span>}
        <Chip toggle={false} className="from-start" onClick={() => setCursor(0)} disabled={cursor === 0 && !demo}>
          From the start
        </Chip>
      </div>
    </div>
  );
}

function SongControls() {
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const epilarynx = useStore((s) => s.artic.epilarynx);
  const setArtic = useStore((s) => s.setArtic);
  const vibrato = useSing((s) => s.vibrato);
  const setVibrato = useSing((s) => s.setVibrato);
  return (
    <EncoderPages
      label="Song voice"
      pages={[
        {
          name: "Song",
          encoders: [
            { label: "Vibrato", value: vibrato, min: 0, max: 80, onChange: (v) => setVibrato(Math.round(v)), format: (v) => ({ value: String(Math.round(v)), unit: "cents" }) },
            { label: "Rate", value: source.vibratoRate, min: 3.5, max: 7.5, onChange: (v) => setSource({ vibratoRate: v }), format: (v) => ({ value: v.toFixed(1), unit: "Hz" }) },
            { label: "Breathy", value: source.breathiness, min: 0, max: 1, onChange: (v) => setSource({ breathiness: v }), format: (v) => ({ value: String(Math.round(v * 100)), unit: "%" }) },
            // the singer's ring narrows the tube just above the folds, adding the bright band near 3 kHz
            { label: "Ring", value: epilarynx, min: 0, max: 1, onChange: (v) => setArtic({ epilarynx: v }), format: (v) => ({ value: String(Math.round(v * 100)), unit: "%" }) },
          ],
        },
        {
          name: "Tone",
          encoders: [{ label: "Bright", value: source.brightness, min: 0, max: 1, onChange: (v) => setSource({ brightness: v }), format: (v) => ({ value: String(Math.round(v * 100)), unit: "%" }) }],
        },
      ]}
    />
  );
}

function DemoSongs() {
  const body = useStore((s) => s.body);
  const start = useStore((s) => s.start);
  const demo = useSing((s) => s.demo);
  return (
    <div className="demo-songs" role="group" aria-label="Demo songs">
      {DEMO_SONGS.map((s) => (
        <Chip
          key={s.name}
          on={demo === s.name}
          onClick={async () => {
            if (demo === s.name) {
              stopSinging();
              return;
            }
            await playDemo(s.name, body, start);
          }}
        >
          {demo === s.name ? `Stop “${s.name}”` : s.name}
        </Chip>
      ))}
    </div>
  );
}

const MOZART = "Là ci darem la mano";
const MAX_SCORE_BYTES = 16 * 1024 * 1024;

async function readScoreFiles(files: File[]): Promise<LoadedScore> {
  const score = files.find((f) => /\.(musicxml|xml|mxl)$/i.test(f.name));
  const ipa = files.find((f) => /\.ipa$/i.test(f.name));
  if (!score || files.length !== (ipa ? 2 : 1)) throw new Error("Choose one MusicXML score and, optionally, one IPA file.");
  if (files.some((f) => f.size > MAX_SCORE_BYTES)) throw new Error("The score or IPA file is larger than 16 MiB.");
  const cues = await ipa?.text();
  if (!cues) await g2p.load().catch(() => {});
  let tracks: ScoreTrack[];
  if (/\.mxl$/i.test(score.name)) {
    const bytes = new Uint8Array(await score.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    tracks = importScore({ mxl: btoa(binary) }, cues);
  } else {
    tracks = importScore({ xml: await score.text() }, cues);
  }
  // The lower track takes the male body. IPA lines were already applied in file order.
  const mean = (track: ScoreTrack) => track.notes.reduce((sum, n) => sum + n.midi, 0) / track.notes.length;
  tracks.sort((a, b) => mean(a) - mean(b));
  return { title: score.name.replace(/\.(musicxml|xml|mxl)$/i, ""), tracks };
}

function TrackLyrics({ track, at }: { track: ScoreTrack; at: number }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = list.current;
    const note = box?.querySelector<HTMLElement>(".current");
    if (!box || !note) return;
    if (note.offsetTop < box.scrollTop || note.offsetTop + note.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = note.offsetTop;
    }
  }, [at]);
  return (
    <div>
      <strong>{track.name}</strong>
      <div ref={list} className="score-syllables" aria-label={`${track.name} lyrics`}>
        {track.notes.map(({ syl }, k) => (
          <span key={k} className={k === at ? "current" : undefined} aria-current={k === at || undefined}>
            {syl.text || "♪"}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScoreLyrics({ score }: { score: LoadedScore }) {
  const playing = useSing((s) => s.demo === score.title);
  const leadAt = useSing((s) => s.demoAt);
  const harmonyAt = useSing((s) => s.harmonyAt);
  return (
    <div className="score-lyrics">
      {score.tracks.map((track, i) => (
        <TrackLyrics key={i} track={track} at={playing ? (i === 0 ? leadAt : harmonyAt) : -1} />
      ))}
    </div>
  );
}

export function loadMozart(): void {
  loadScore({ title: MOZART, tracks: importScore({ xml: mozart }, mozartIpa) });
}

export function ScoreControls({ duetOnly = false }: { duetOnly?: boolean }) {
  const score = useSing((s) => s.score);
  const demo = useSing((s) => s.demo);
  const starting = useStore((s) => s.starting);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { request.current++; }, []);
  const playing = score !== null && demo === score.title;

  const importFiles = async (files: File[]) => {
    const token = ++request.current;
    setBusy(true);
    setError("");
    try {
      const imported = await readScoreFiles(files);
      if (duetOnly && imported.tracks.length !== 2) throw new Error("Opera mode needs a score with two vocal parts.");
      if (token === request.current) loadScore(imported);
    } catch (e) {
      if (token === request.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === request.current) setBusy(false);
    }
  };

  return (
    <div className="score-import">
      <div className="score-actions">
        <Chip toggle={false} disabled={busy} onClick={() => input.current?.click()}>Import MusicXML</Chip>
        <input ref={input} type="file" hidden multiple accept=".musicxml,.xml,.mxl,.ipa" aria-label="MusicXML score and optional IPA file"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            if (files.length) void importFiles(files);
          }} />
        <Chip toggle={false} disabled={busy} onClick={() => {
          setError("");
          try {
            loadMozart();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}>{MOZART}</Chip>
        {score && !duetOnly ? <Chip toggle={false} disabled={busy} onClick={() => {
          setError("");
          loadScore(null);
        }}>Clear score</Chip> : null}
      </div>
      {score ? (
        <>
          <div className="score-heading">
            <strong>{score.title}</strong>
            <Chip toggle={false} disabled={starting || busy} onClick={async () => {
              if (playing) return stopSinging();
              setError("");
              const state = useStore.getState();
              const body = score.tracks.length === 2 ? PRESETS.male : state.body;
              if (score.tracks.length === 2) state.setBody(body);
              try {
                await playScore(score, body, async () => {
                  await state.start();
                  if (!useStore.getState().started) throw new Error(useStore.getState().startError ?? "Audio could not start.");
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}>{playing ? "Stop score" : score.tracks.length === 2 ? "Play duet" : "Play score"}</Chip>
          </div>
          <ScoreLyrics score={score} />
        </>
      ) : null}
      {busy ? <span role="status">Importing score…</span> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}

/** Sing mode's right column: the piano roll, the lyrics, the spectrum with the ring, the song voice, the keys. */
export function SingRight() {
  const ring = useStore((s) => s.artic.epilarynx >= RING - 0.05);
  const next = useSing((s) => (s.demo ? null : (s.syllables[s.cursor]?.text ?? null)));
  return (
    <div className="right right-sing">
      <Screen className="s-roll" title="Piano roll" sub="Notes and the pitch sung">
        <PianoRoll />
      </Screen>
      <Screen className="s-lyrics" title="Lyrics" sub="Each note sings the next syllable" tools={<DemoSongs />}>
        <ScoreControls />
        <Lyrics />
      </Screen>
      <Screen className="s-spec" title="Spectrum" sub={ring ? "Ring on" : ""}>
        <SpectrumView ring={ring} />
      </Screen>
      <Screen className="s-voice" title="Voice">
        <SongControls />
      </Screen>
      <Screen className="s-keys" title="Keys" sub={next ? `Next: ${next}` : ""}>
        <Keys />
      </Screen>
    </div>
  );
}
