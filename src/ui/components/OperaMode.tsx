import { lazy, Suspense, useEffect, useMemo } from "react";
import { engine } from "../../audio/AudioEngine.ts";
import { NEUTRAL } from "../../wasm/engine.ts";
import { PRESETS } from "../body.ts";
import { V } from "../colors.ts";
import { mouthWords } from "../mouthWords.ts";
import { planOrchestra } from "../orchestraMidi.ts";
import { sungNow, tickSinging, useSing } from "../singing.ts";
import { useStore } from "../store.ts";
import { getModel } from "../useModel.ts";
import { Screen } from "./Screen.tsx";
import { loadMozart, ScoreControls } from "./SingPanel.tsx";
import { OperaOrchestra, orchestraMix, useOrchestra } from "./OperaOrchestra.tsx";
import type { HeadFeed } from "./AnatomyView3D.tsx";

const AnatomyView3D = lazy(() => import("./AnatomyView3D.tsx").then((m) => ({ default: m.AnatomyView3D })));
const leadWords = mouthWords(() => sungNow(), V.green, 1);
const harmonyWords = mouthWords(() => sungNow(true), V.pink, -1);

function OperaHead({ name, harmony }: { name: string; harmony: boolean }) {
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
    <Screen className="opera-head" title={name} sub={harmony ? "Female voice" : "Male voice"}>
      <AnatomyView3D feed={feed} readouts={false} overlay={harmony ? harmonyWords : leadWords} />
    </Screen>
  );
}

export function OperaMode() {
  const score = useSing((s) => s.score);
  const file = useOrchestra((s) => s.file);
  const offset = useOrchestra((s) => s.offset);
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
          <OperaHead name={score?.tracks[0]?.name ?? "Don Giovanni"} harmony={false} />
          <OperaHead name={score?.tracks[1]?.name ?? "Zerlina"} harmony />
        </Suspense>
      </div>
      <Screen className="s-opera" title="Duet score" sub="Live voices from MusicXML">
        <ScoreControls duetOnly orchestra={plan ? { plan, mix: orchestraMix } : undefined} orchestraError={error} />
      </Screen>
      <OperaOrchestra plan={plan} alignmentError={error} />
    </main>
  );
}
