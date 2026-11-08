import { useId } from "react";
import { ENVIRONMENTS, type EnvironmentId } from "../../wasm/engine.ts";
import { useStore } from "../store.ts";
import { Slider } from "./Controls.tsx";
import { Screen } from "./Screen.tsx";

/** One shared listening space for every live mode, including creatures and beatbox. */
export function EnvironmentPanel() {
  const spaceId = useId();
  const settings = useStore((s) => s.environment);
  const set = useStore((s) => s.setEnvironment);
  const preset = ENVIRONMENTS.find((p) => p.id === settings.preset)!;
  const dry = settings.preset === "dry";
  const percent = (v: number) => `${Math.round(v * 100)} %`;
  return (
    <Screen title="Environment" sub="The space around the voice" className="s-environment">
      <div className="environment-controls">
        <div className="environment-choice">
          <label htmlFor={spaceId}>Space</label>
          <select id={spaceId} value={settings.preset} onChange={(e) => set({ preset: e.target.value as EnvironmentId })}>
            {ENVIRONMENTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        {dry ? <p className="environment-description">The voice alone, without room reflections.</p> : <>
          <div className="environment-dimensions">
            <span>{preset.dimensions.join(" × ")} m</span>
            <span>Stereo reflections</span>
          </div>
          <Slider label="Room mix" min={0} max={1} value={settings.mix} onChange={(mix) => set({ mix })} format={percent} />
          <Slider label="Decay" min={0.1} max={8} log value={settings.decay} onChange={(decay) => set({ decay })} format={(v) => `${v.toFixed(2)} s`} />
          <Slider label="Damping" min={0} max={1} value={settings.damping} onChange={(damping) => set({ damping })} format={percent} />
          <p className="environment-description">More damping softens the high frequencies in the room tail.</p>
        </>}
      </div>
    </Screen>
  );
}
