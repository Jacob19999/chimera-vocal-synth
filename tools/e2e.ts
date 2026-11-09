/**
 * Headless-Chromium smoke test: loads the app, starts audio, interacts, collects console errors,
 * measures worklet load, and saves screenshots.
 * Usage: bun tools/e2e.ts [url] [outdir]
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { ORCHESTRA_DEMO_NAME, orchestraDemoBytes } from "../src/audio/orchestraDemo.ts";

const url = process.argv[2] ?? "http://127.0.0.1:5318/";
const outDir = process.argv[3] ?? "out/e2e";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
});
const errors: string[] = [];
const logs: string[] = [];
async function run(viewport: { width: number; height: number }, tag: string) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    const t = `${m.type()}: ${m.text()}`;
    if (m.type() === "error") errors.push(`[${tag}] ${t}`);
    else logs.push(`[${tag}] ${t}`);
  });
  page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${tag}-0-idle.png` });
  const startBtn = page.getByRole("button", { name: /breathe in and start/i });
  await startBtn.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/${tag}-1-running.png` });
  // drag the tongue body handle via the canvas: find it by probing (center-ish of viewport)
  const box = await page.locator(".anatomy canvas").boundingBox();
  if (box) {
    // move over likely tongue area and drag up/forward
    const sx = box.x + box.width * 0.47, sy = box.y + box.height * 0.42;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy - 30, { steps: 10 });
    await page.mouse.up();
  }
  // vowel map drag
  const vm = await page.locator(".vowel-map").boundingBox();
  if (vm) {
    await page.mouse.move(vm.x + vm.width * 0.2, vm.y + vm.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(vm.x + vm.width * 0.8, vm.y + vm.height * 0.8, { steps: 20 });
    await page.mouse.up();
  }
  await page.keyboard.down("d");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${tag}-2-played.png` });
  await page.keyboard.up("d");
  const loadText = await page.locator(".load").textContent().catch(() => null);
  logs.push(`[${tag}] load: ${loadText}`);
  // speak mode
  await page.getByRole("radio", { name: "Speak" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Speak$/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${tag}-3-speak.png`, fullPage: true });
  const trans = await page.locator(".transcription").textContent();
  logs.push(`[${tag}] transcription: ${trans}`);
  // speech breathes by itself: Play's held breath must not drone on once the phrase is over
  const speechRms: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    speechRms.push(
      await page.evaluate(() => {
        // @ts-expect-error debug handle
        return window.__chimeraEngine?.latest?.t?.outRms ?? -1;
      }),
    );
  }
  logs.push(`[${tag}] speech rms then silence ${speechRms.map((r) => r.toFixed(4)).join(",")}`);
  if (!(Math.max(...speechRms.slice(-3)) < 1e-3)) errors.push(`[${tag}] voice still sounding after the phrase: ${speechRms.slice(-3).join(",")}`);
  await page.locator("button.ipa", { hasText: "ʃ" }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${tag}-4-pad.png` });
  // sing mode: a key sings the marked syllable and moves the cursor; legato; a demo song
  await page.getByRole("radio", { name: "Sing" }).click();
  await page.waitForTimeout(600);
  const rms = () =>
    page.evaluate(() => {
      // @ts-expect-error debug handle
      return window.__chimeraEngine?.latest?.t?.outRms ?? -1;
    });
  const nextSyl = () => page.locator(".syl.next").textContent().catch(() => null);
  const sylBefore = await nextSyl();
  await page.keyboard.down("d");
  await page.waitForTimeout(450);
  const singing = await rms();
  await page.keyboard.down("g"); // legato into the next syllable
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await page.waitForTimeout(250);
  await page.keyboard.up("g");
  await page.waitForTimeout(900);
  const after = await rms();
  const sylAfter = await nextSyl();
  logs.push(`[${tag}] sing: next syllable ${sylBefore} -> ${sylAfter}, rms while held ${singing.toFixed(4)}, then silence ${after.toFixed(4)}`);
  if (!(singing > 0.01)) errors.push(`[${tag}] a sung key made no sound (${singing})`);
  if (!(after < 1e-3)) errors.push(`[${tag}] voice still sounding after the sung notes: ${after}`);
  if (sylBefore === sylAfter) errors.push(`[${tag}] the syllable cursor did not move (${sylBefore})`);
  await page.getByRole("button", { name: "Made of air" }).click();
  await page.waitForTimeout(2200);
  const demoRms = await rms();
  const demoNow = await page.locator(".syl.now").textContent().catch(() => null);
  await page.screenshot({ path: `${outDir}/${tag}-5-sing.png`, fullPage: tag !== "desktop" });
  await page.getByRole("button", { name: /^Stop “Made of air”$/ }).click();
  await page.waitForTimeout(700);
  const demoStopped = await rms();
  logs.push(`[${tag}] sing demo: rms ${demoRms.toFixed(4)} on "${demoNow}", after stop ${demoStopped.toFixed(4)}`);
  if (!(demoRms > 0.01) || !demoNow) errors.push(`[${tag}] demo song not singing (rms ${demoRms}, syllable ${demoNow})`);
  if (!(demoStopped < 1e-3)) errors.push(`[${tag}] demo still sounding after stop: ${demoStopped}`);
  // bestiary: every creature, its first call, a key in held-voice mode, and the sustain toggle
  await page.getByRole("radio", { name: "Bestiary" }).click();
  await page.waitForTimeout(300);
  const names = await page.locator(".specimen-name").allTextContents();
  for (const [i, name] of names.entries()) {
    await page.locator(".specimen").nth(i).click();
    await page.waitForTimeout(250);
    await page.locator(".call").first().click();
    await page.waitForTimeout(1300);
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
    if (tag === "desktop" || i === 0) await page.screenshot({ path: `${outDir}/${tag}-5-${slug}.png`, fullPage: tag !== "desktop" });
    const state = await page.evaluate(() => {
      // @ts-expect-error debug handle
      const e = window.__chimeraEngine;
      const t = e?.latestCreature?.t;
      return t ? { id: t.id, rms: t.outRms, call: t.call, load: e.load } : null;
    });
    logs.push(`[${tag}] creature ${name}: ${JSON.stringify(state)}`);
  }
  await page.keyboard.down("g");
  await page.waitForTimeout(600);
  const held = await page.evaluate(() => {
    // @ts-expect-error debug handle
    const t = window.__chimeraEngine?.latestCreature?.t;
    return t ? { gate: t.gate, rms: t.outRms } : null;
  });
  await page.keyboard.up("g");
  logs.push(`[${tag}] held key: ${JSON.stringify(held)}`);
  // beatbox: preset, play, playhead + level from telemetry, a pad, stop
  await page.getByRole("radio", { name: "Beatbox" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Breakbeat" }).click();
  await page.getByRole("button", { name: "Play beat" }).click();
  const beatSamples: { step: number; rms: number }[] = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250);
    beatSamples.push(
      await page.evaluate(() => {
        // @ts-expect-error debug handle
        const t = window.__chimeraEngine?.latest;
        return { step: t?.beatStep ?? -2, rms: t?.t?.outRms ?? -1 };
      }),
    );
  }
  await page.screenshot({ path: `${outDir}/${tag}-6-beatbox.png`, fullPage: tag !== "desktop" });
  logs.push(`[${tag}] beatbox steps ${beatSamples.map((b) => b.step).join(",")} rms ${beatSamples.map((b) => b.rms.toFixed(3)).join(",")}`);
  await page.locator(".pad").first().dispatchEvent("pointerdown");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Stop" }).click();
  await page.waitForTimeout(300);
  // back to the human voice
  await page.getByRole("radio", { name: "Play" }).click();
  await page.waitForTimeout(600);
  const human = await page.evaluate(() => {
    // @ts-expect-error debug handle
    const e = window.__chimeraEngine;
    return { human: !!e?.latest, creature: !!e?.latestCreature };
  });
  logs.push(`[${tag}] back to play: ${JSON.stringify(human)}`);
  await page.close();
}

// the very first key in Sing mode, before audio has started, still sings once audio is up
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(`[first-key] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Sing" }).click();
  await page.keyboard.down("d");
  await page.waitForTimeout(1200);
  const level = await page.evaluate(() => {
    // @ts-expect-error debug handle
    return window.__chimeraEngine?.latest?.t?.outRms ?? -1;
  });
  await page.keyboard.up("d");
  logs.push(`[first-key] sing before start: rms ${level.toFixed(4)}`);
  if (!(level > 0.01)) errors.push(`[first-key] the first sung key, pressed before audio started, made no sound (${level})`);
  await page.close();
}

await run({ width: 1440, height: 980 }, "desktop");
await run({ width: 390, height: 844 }, "mobile");

// A room selected before audio starts survives startup, rings after the voice stops,
// and can be bypassed live. Measure the output analyser, not the dry voice telemetry.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(`[environment] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByLabel("Space", { exact: true }).selectOption("hall");
  await page.getByRole("button", { name: /breathe in and start/i }).click();
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    // @ts-expect-error debug handle
    window.__chimeraEngine.gate(0);
  });
  await page.waitForTimeout(500);
  const rms = () => page.evaluate(() => {
    // @ts-expect-error debug handle
    const analyser = window.__chimeraEngine.analyserFast as AnalyserNode;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
  });
  const wet = await rms();
  await page.screenshot({ path: `${outDir}/environment-hall.png`, fullPage: true });
  await page.getByLabel("Space", { exact: true }).selectOption("dry");
  await page.waitForTimeout(180);
  const dry = await rms();
  logs.push(`[environment] room tail rms ${wet.toFixed(6)}, bypass ${dry.toFixed(6)}`);
  if (!(wet > 1e-5 && dry < wet * 0.1)) errors.push(`[environment] missing tail or bypass: wet ${wet}, dry ${dry}`);
  await page.close();
}

// Import the same generated accompaniment on desktop and mobile. The MIDI mixer and canvas
// should stay in the Opera layout while the duet and orchestra share a running transport.
type PianoDraw = Window & { __pianoDraw?: {
  white: number; black: number; whiteHeight: number; blackHeight: number;
  bars: { center: number; width: number }[]; whiteBar: number; blackBar: number;
} };
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const banks = new Set<string>();
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.includes("/orchestra/") && path.endsWith(".wav") && response.ok()) banks.add(path.split("/").at(-1)!);
  });
  page.on("pageerror", (e) => errors.push(`[orchestra-${width}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[orchestra-${width}] ${m.text()}`);
  });
  if (width === 1280) {
    await page.addInitScript(() => {
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
        if (this.canvas.matches(".orchestra-waterfall canvas")) {
          const page = window as PianoDraw;
          if (x === 0 && y === 0 && this.fillStyle === "#000000") {
            page.__pianoDraw = { white: 0, black: 0, whiteHeight: 0, blackHeight: 0, bars: [], whiteBar: 0, blackBar: 0 };
          }
          const draw = page.__pianoDraw;
          if (draw && this.fillStyle === "#ffbd69") draw.bars.push({ center: x + w / 2, width: w });
          if (draw && this.fillStyle === "#d2e3ed") {
            draw.white++;
            draw.whiteHeight = h;
            draw.whiteBar = draw.bars.find((bar) => Math.abs(bar.center - x - w / 2) < 0.1)?.width ?? draw.whiteBar;
          }
          if (draw && this.fillStyle === "#263b4a") {
            draw.black++;
            draw.blackHeight = h;
            draw.blackBar = draw.bars.find((bar) => Math.abs(bar.center - x - w / 2) < 0.1)?.width ?? draw.blackBar;
          }
        }
        fill.call(this, x, y, w, h);
      };
    });
  }
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Opera", exact: true }).click();
  const don = page.getByRole("region", { name: "Don Giovanni", exact: true });
  const zerlina = page.getByRole("region", { name: "Zerlina", exact: true });
  await don.getByLabel("Don Giovanni lyrics").waitFor();
  await zerlina.getByLabel("Zerlina lyrics").waitFor();
  const roomPanel = page.getByRole("region", { name: "Customization", exact: true });
  await roomPanel.getByRole("button", { name: "Import MusicXML" }).waitFor();
  await roomPanel.getByRole("button", { name: "Là ci darem la mano", exact: true }).waitFor();
  await roomPanel.getByLabel("Male voice preset", { exact: true }).selectOption("Lyric");
  await roomPanel.getByLabel("Female voice preset", { exact: true }).selectOption("Dramatic");
  await roomPanel.getByRole("slider", { name: /^Male vibrato/ }).press("ArrowRight");
  if (await page.getByRole("region", { name: "Duet score", exact: true }).count()) {
    errors.push(`[orchestra-${width}] the singer panels should contain the score without a separate section`);
  }
  const library = page.getByRole("combobox", { name: "MIDI library", exact: true });
  await library.selectOption({ label: ORCHESTRA_DEMO_NAME });
  const waterfall = page.getByRole("img", { name: "Orchestra MIDI falling notes and piano keyboard" });
  await waterfall.waitFor();
  const bytes = Buffer.from(orchestraDemoBytes());
  await page.getByLabel("Orchestra MIDI file").setInputFiles({ name: "local.mid", mimeType: "audio/midi", buffer: bytes });
  await page.locator(".orchestra-file strong").filter({ hasText: "local.mid" }).waitFor();
  const folder = `${outDir}/midi-library`;
  mkdirSync(`${folder}/alternate`, { recursive: true });
  writeFileSync(`${folder}/alternate/rehearsal.MIDI`, bytes);
  writeFileSync(`${folder}/notes.txt`, "Filter out non-MIDI files.");
  const [folderPicker] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Browse MIDI folder" }).click(),
  ]);
  await folderPicker.setFiles(folder);
  await library.locator("option").filter({ hasText: "rehearsal.MIDI" }).waitFor({ state: "attached" });
  const options = await library.locator("option").allTextContents();
  if (options.join("|") !== `Choose a MIDI|${ORCHESTRA_DEMO_NAME}|local.mid|midi-library/alternate/rehearsal.MIDI`) {
    errors.push(`[orchestra-${width}] unexpected MIDI library options: ${options.join(", ")}`);
  }
  await library.selectOption({ label: "midi-library/alternate/rehearsal.MIDI" });
  await page.getByText("rehearsal.MIDI", { exact: true }).waitFor();
  const midiPanel = page.getByRole("region", { name: "Orchestra", exact: true });
  const divider = page.getByRole("separator", { name: "Resize MIDI and Customization panels" });
  const [midiBox, roomBox] = await Promise.all([midiPanel.boundingBox(), roomPanel.boundingBox()]);
  if (!midiBox || !roomBox) throw new Error("Opera is missing its MIDI or Environment panel.");
  if (width === 1280) {
    if (Math.abs(midiBox.width - roomBox.width) > 1 || midiBox.x >= roomBox.x || Math.abs(midiBox.y - roomBox.y) > 1) {
      errors.push("[orchestra-1280] MIDI and Environment should start side by side at equal widths");
    }
    await divider.scrollIntoViewIfNeeded();
    const handle = await divider.boundingBox();
    if (!handle) throw new Error("Opera is missing its desktop resize handle.");
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y, { steps: 5 });
    await page.mouse.up();
    const wider = await midiPanel.boundingBox();
    if (!wider || Math.abs(wider.width - midiBox.width - 120) > 10) {
      errors.push("[orchestra-1280] dragging the divider should widen the MIDI panel");
    }
    await divider.press("ArrowLeft");
    const narrower = await midiPanel.boundingBox();
    if (!narrower || !wider || narrower.width >= wider.width) errors.push("[orchestra-1280] the divider should respond to arrow keys");
    await roomPanel.getByLabel("Space", { exact: true }).selectOption("hall");
    await divider.press("Home");
    await divider.press("End");
    await roomPanel.getByRole("slider", { name: /Room mix/ }).press("ArrowRight");
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
      errors.push("[orchestra-1280] a narrow Environment panel should keep its controls in the page");
    }
    await divider.press("Enter");
    await roomPanel.getByLabel("Space", { exact: true }).selectOption("dry");
    if (await divider.getAttribute("aria-valuenow") !== "50") errors.push("[orchestra-1280] the divider should reset to 50/50");
    await page.waitForFunction(() => {
      const draw = (window as PianoDraw).__pianoDraw;
      return draw?.white === 52 && draw.black === 36 && draw.whiteHeight > 30 && draw.blackHeight > 17
        && draw.blackBar > 0 && draw.blackBar < draw.whiteBar;
    }, undefined, { timeout: 5000 });
  } else if (roomBox.y < midiBox.y + midiBox.height - 1 || await divider.isVisible()) {
    errors.push("[orchestra-390] MIDI and Environment should stack on narrow screens");
  }
  await page.getByLabel("Instrument for Winds").selectOption("Oboe");
  await page.getByLabel("Level for Strings").press("Home");
  await page.getByLabel("Level for Strings").press("ArrowRight");
  await page.getByLabel(/MIDI offset/).fill("0.25");
  await page.getByLabel(/MIDI offset/).press("Enter");
  if (width === 1280) {
    await page.evaluate(() => scrollTo(0, 0));
    const roll = await waterfall.boundingBox();
    if (!roll || roll.y + roll.height > 900) errors.push("[orchestra-1280] the MIDI keyboard should fit in the initial viewport");
  }
  await page.screenshot({ path: `${outDir}/orchestra-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Play duet + orchestra", exact: true }).click();
  await page.getByRole("button", { name: "Stop score", exact: true }).waitFor();
  if ([...banks].sort().join(",") !== "cello.wav,flute.wav,oboe.wav,strings.wav") {
    errors.push(`[orchestra-${width}] missing recorded instrument banks: ${[...banks].join(", ")}`);
  }
  await page.waitForFunction(() => {
    // @ts-expect-error debug handle
    return !!(window.__chimeraEngine?.latest?.harmony || window.__chimeraEngine?.error);
  }, undefined, { timeout: 10000 });
  await roomPanel.getByRole("slider", { name: /Female level/ }).press("Home");
  await roomPanel.getByRole("slider", { name: /Female level/ }).press("End");
  await page.getByRole("button", { name: "Solo Winds", exact: true }).click();
  if (await page.getByRole("button", { name: "Solo Winds", exact: true }).getAttribute("aria-pressed") !== "true") {
    errors.push(`[orchestra-${width}] solo did not latch`);
  }
  const stage = page.getByLabel("Live duet stage");
  if (await stage.getByRole("region").count() !== 2) errors.push(`[orchestra-${width}] missing a duet face`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
    errors.push(`[orchestra-${width}] page overflows horizontally`);
  }
  await page.getByRole("button", { name: "Stop score", exact: true }).click();
  await page.getByRole("button", { name: "Remove MIDI", exact: true }).click();
  await page.getByRole("button", { name: "Play duet", exact: true }).waitFor();
  await library.selectOption({ label: ORCHESTRA_DEMO_NAME });
  await page.locator(".orchestra-file strong").filter({ hasText: ORCHESTRA_DEMO_NAME }).waitFor();
  logs.push(`[orchestra-${width}] browsed and switched MIDI files, then played and mixed the duet`);
  await page.close();
}
await browser.close();
console.log("console errors:", errors.length ? "\n" + errors.join("\n") : "none");
console.log(logs.filter((l) => /load|warn|transcription|creature|held|back to|beatbox|silence|sing|environment|orchestra/i.test(l)).slice(0, 40).join("\n"));
// a run that collected errors fails, so CI and agents can't read it as a pass
if (errors.length) process.exit(1);
