//! `chimera`: offline renders to WAV, speech diagnostics and table calibration over the CHIMERA
//! engine. Ports of the TypeScript tools (`tools/render-*.ts`, `speech-diagnostics.ts`,
//! `calibrate-*.ts`) with their arguments, defaults and printed summaries. Spectrograms of the
//! WAVs: `bun tools/spectrogram.ts in.wav out.png [title] [maxFreq] [windowMs]`.

mod calibrate;
mod compare;
mod diagnose;
mod js;
mod render;
mod wav;

use chimera::anatomy::human::{BODY_CHILD, BODY_FEMALE, BODY_MALE, BodyMix, HumanBody};
use chimera::environment::{Environment, EnvironmentPreset, EnvironmentSettings};
use std::process::ExitCode;

const USAGE: &str = "\
usage: chimera <command> [args] [--float]

  render speech  <out> [\"ipa / ipa\"] [male|female|child]
  render text    <out> [\"English text.\"] [male|female|child]
  render song    [outdir] [male|female|child]
  render notes   <in.json> <out> [male|female|child] [--artic tracks.json] [--tele voice.tele]
                 (melody file; midi <= 0 is a rest; --artic also writes the articulators at 100 Hz)
  render beatbox [outdir] [preset name | pattern] [male|female|child] [bpm] [bars]
  render creature [creatureId] [outdir]
  render vowels  [male|female|child] [out]
  diagnose       [outdir]
  compare csd    [csd-dir] [outdir] [--songs a|b|all|en001a,…] [--body female] [--jobs n]
                 [--against earlier/score.json]  (score.json: distance to the singer, and the verdict)
  compare tsp    [tsp-dir] [outdir] [--speakers FA,MA,…] [--jobs n] [--dump]
                 [--against earlier/score.json]  (distance to 23 real speakers, phone by phone)
  calibrate vowels     [male|female|child|all] [--out file]
  calibrate consonants [--out file]

Output names are stems (<out>.wav). --float writes 32-bit float WAVs instead of 16-bit PCM.
Render options: --environment dry|studio|room|hall|cathedral
                --room-mix 0..1 --room-decay 0.1..8 --room-damping 0..1
Room renders are stereo and include the decay tail. Dry is the default (original mono).
Calibration writes the tables the engine embeds, in crates/chimera/src/phonetics/.";

/// The output rate of every render.
pub const FS: f64 = 48000.0;

/// The repository root (data files and the generated tables are found from here).
pub fn repo_path(rel: &str) -> String {
    format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"))
}

/// Options shared by every command.
pub struct Ctx {
    /// write 32-bit float WAVs
    pub float: bool,
    pub environment: EnvironmentSettings,
}

impl Ctx {
    pub fn write_wav(&self, path: &str, x: &[f32]) -> Result<(), String> {
        if !self.environment.enabled() {
            return wav::write(path, x, FS as u32, self.float).map_err(|e| format!("{path}: {e}"));
        }
        let frames = x.len() + self.tail_frames();
        let mut left = vec![0.0; frames];
        left[..x.len()].copy_from_slice(x);
        let mut right = vec![0.0; frames];
        let mut room = Environment::new(FS);
        room.set(self.environment);
        for (l, r) in left.chunks_mut(128).zip(right.chunks_mut(128)) { room.process(l, r); }
        let mut stereo = Vec::with_capacity(2 * frames);
        for (l, r) in left.into_iter().zip(right) { stereo.extend_from_slice(&[l, r]); }
        wav::write_channels(path, &stereo, FS as u32, self.float, 2).map_err(|e| format!("{path}: {e}"))
    }

    fn tail_frames(&self) -> usize { (self.environment.tail_seconds() * FS).ceil() as usize }

    pub fn output_seconds(&self, dry_frames: usize) -> f64 { (dry_frames + self.tail_frames()) as f64 / FS }
}

/// Only render commands accept environments, so acoustic judges always measure the dry source.
fn environment_options(args: &mut Vec<String>) -> Result<EnvironmentSettings, String> {
    let mut preset = EnvironmentPreset::Dry;
    let mut options = [None; 3];
    let mut i = 0;
    while i < args.len() {
        let key = args[i].as_str();
        let slot = match key { "--room-mix" => Some(0), "--room-decay" => Some(1), "--room-damping" => Some(2), _ => None };
        if key != "--environment" && slot.is_none() { i += 1; continue; }
        if args.first().map(String::as_str) != Some("render") { return Err("environment options are only supported by render commands".into()); }
        let value = args.get(i + 1).ok_or_else(|| format!("{key} needs a value"))?;
        if key == "--environment" {
            preset = EnvironmentPreset::parse(value).ok_or_else(|| format!("unknown environment {value:?}; have dry, studio, room, hall, cathedral"))?;
        } else if let Some(slot) = slot {
            let v: f64 = value.parse().map_err(|_| format!("{key} needs a finite number"))?;
            let (lo, hi) = if slot == 1 { (0.1, 8.0) } else { (0.0, 1.0) };
            if !v.is_finite() || v < lo || v > hi { return Err(format!("{key} must be between {lo} and {hi}")); }
            options[slot] = Some(v);
        }
        args.drain(i..i + 2);
    }
    if preset == EnvironmentPreset::Dry && options.iter().any(Option::is_some) { return Err("--room-* controls require a non-dry --environment".into()); }
    let mut settings = EnvironmentSettings::for_preset(preset);
    if let Some(v) = options[0] { settings.mix = v; }
    if let Some(v) = options[1] { settings.decay = v; }
    if let Some(v) = options[2] { settings.damping = v; }
    Ok(settings)
}

/// The body for a name (`male`, `female`, `child`).
pub fn body(name: &str) -> Result<HumanBody, String> {
    match name {
        "male" => Ok(BODY_MALE),
        "female" => Ok(BODY_FEMALE),
        "child" => Ok(BODY_CHILD),
        _ => Err(format!("unknown body {name:?}; have male, female, child")),
    }
}

/// The app's body mix for a body preset (female 0..1, child 0..1), as `src/ui/body.ts` PRESETS.
pub fn body_mix(name: &str) -> Result<BodyMix, String> {
    match name {
        "male" => Ok(BodyMix::new(0.0, 0.0)),
        "female" => Ok(BodyMix::new(1.0, 0.0)),
        "child" => Ok(BodyMix::new(0.0, 1.0)),
        _ => Err(format!("unknown body {name:?}; have male, female, child")),
    }
}

/// `<out>.wav` for an output stem (a trailing `.wav` is accepted too).
pub fn wav_name(stem: &str) -> String {
    format!("{}.wav", stem.strip_suffix(".wav").unwrap_or(stem))
}

pub fn peak(x: &[f32]) -> f64 {
    x.iter()
        .fold(0.0f64, |p, &v| chimera::math::js_max(p, (v as f64).abs()))
}

/// Positional argument `i`, or a default.
pub fn arg<'a>(a: &'a [String], i: usize, default: &'a str) -> &'a str {
    a.get(i).map(String::as_str).unwrap_or(default)
}

fn run(args: Vec<String>) -> Result<(), String> {
    let float = args.iter().any(|a| a == "--float");
    let mut args: Vec<String> = args.into_iter().filter(|a| a != "--float").collect();
    let environment = environment_options(&mut args)?;
    let ctx = Ctx { float, environment };
    let cmd: Vec<&str> = args.iter().take(2).map(String::as_str).collect();
    match cmd.as_slice() {
        ["render", kind, ..] => {
            let rest = &args[2..];
            match *kind {
                "speech" => render::speech(&ctx, rest),
                "text" => render::text(&ctx, rest),
                "song" => render::song(&ctx, rest),
                "notes" => render::notes(&ctx, rest),
                "beatbox" => render::beatbox(&ctx, rest),
                "creature" => render::creature(&ctx, rest),
                "vowels" => render::vowels(&ctx, rest),
                _ => Err(format!("unknown render kind {kind:?}\n\n{USAGE}")),
            }
        }
        ["compare", "csd", ..] => compare::csd(&ctx, &args[2..]),
        ["compare", "tsp", ..] => compare::tsp::run(&ctx, &args[2..]),
        ["diagnose", ..] => diagnose::run(&ctx, &args[1..]),
        ["calibrate", "vowels", ..] => calibrate::vowels(&args[2..]),
        ["calibrate", "consonants", ..] => calibrate::consonants(&args[2..]),
        ["help" | "--help" | "-h", ..] => {
            println!("{USAGE}");
            Ok(())
        }
        _ => Err(USAGE.to_string()),
    }
}

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
