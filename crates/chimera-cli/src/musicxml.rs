//! Import a MusicXML vocal line and sing it, optionally on a recording's timeline.
mod reference;
mod score;

use self::reference::Reference;
use self::score::{Note, Score, Selection};
use crate::{Ctx, FS, peak, render, wav_name};
use chimera::anatomy::human::BodyMix;
use chimera::control::score::{ControlKey, GestureScore};
use chimera::math::midi_to_hz;
use chimera::phonetics::ipa::tokenize_ipa;
use chimera::phonetics::sing::{SongOptions, SungNote, plan_song};
use chimera::phonetics::syllables::{lyrics_to_syllables, syllabify_segments};
use chimera::phonetics::{Segment, Syllable};
use chimera::voice::human_voice::SourcePatch;

const LEAD: f64 = 0.3;
const GAP_EPSILON: f64 = 1e-6;

#[derive(Default)]
struct Options<'a> {
    selection: Selection<'a>,
    ipa: Option<&'a str>,
    reference: Option<&'a str>,
}

fn arguments(args: &[String]) -> Result<(&str, &str, &str, Options<'_>), String> {
    let mut options = Options::default();
    let mut positional = Vec::new();
    let mut args = args.iter().map(String::as_str);
    while let Some(key) = args.next() {
        let slot = match key {
            "--part" => &mut options.selection.part,
            "--voice" => &mut options.selection.voice,
            "--verse" => &mut options.selection.verse,
            "--ipa" => &mut options.ipa,
            "--reference" => &mut options.reference,
            "--bpm" => {
                options.selection.bpm = Some(
                    args.next()
                        .and_then(|s| s.parse::<f64>().ok())
                        .filter(|x| x.is_finite() && *x > 0.0)
                        .ok_or("--bpm needs a positive tempo")?,
                );
                continue;
            }
            _ if key.starts_with("--") => return Err(format!("unknown MusicXML option {key}")),
            _ => {
                positional.push(key);
                continue;
            }
        };
        *slot = Some(
            args.next()
                .filter(|s| !s.starts_with("--"))
                .ok_or_else(|| format!("{key} needs a value"))?,
        );
    }
    let (input, output, body) = match positional.as_slice() {
        &[input, output, body] => (input, output, body),
        &[input, output] => (input, output, "male"),
        _ => return Err("render musicxml <score.musicxml|score.mxl> <out> [male|female|child]; see chimera help".into()),
    };
    Ok((input, output, body, options))
}

fn extend(previous: &Syllable) -> Syllable {
    Syllable {
        text: "~".into(),
        onset: Vec::new(),
        nucleus: previous.nucleus.clone(),
        coda: Vec::new(),
        melisma: Some(true),
        word_end: previous.word_end,
        phrase_end: false,
    }
}

fn connected(previous: &Note, next: &Note) -> bool {
    next.start <= previous.end + GAP_EPSILON
}

fn ipa_syllables(notes: &[Note], path: &str) -> Result<Vec<Syllable>, String> {
    let ipa = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let tokens: Vec<_> = ipa.split_whitespace().collect();
    if tokens.len() != notes.len() {
        return Err(format!(
            "{path}: {} IPA syllables for {} sounding notes (ties count once)",
            tokens.len(),
            notes.len()
        ));
    }
    let mut out = Vec::new();
    for (i, token) in tokens.into_iter().enumerate() {
        let syl = if token == "~" {
            let prev = out
                .last()
                .filter(|_| connected(&notes[i - 1], &notes[i]))
                .ok_or_else(|| {
                    format!(
                        "{path}: melisma on note {} needs a preceding syllable in the same phrase",
                        i + 1
                    )
                })?;
            extend(prev)
        } else {
            let mut parts = syllabify_segments(&tokenize_ipa(token));
            if parts.len() != 1 {
                return Err(format!(
                    "{path}: note {} needs exactly one IPA syllable, got {token:?}",
                    i + 1
                ));
            }
            let part = parts.pop().unwrap();
            Syllable {
                text: notes[i].lyric.clone(),
                onset: part.onset,
                nucleus: part.nucleus,
                coda: part.coda,
                melisma: None,
                word_end: true,
                phrase_end: false,
            }
        };
        out.push(syl);
    }
    Ok(out)
}

fn score_syllables(notes: &[Note]) -> Result<Vec<Syllable>, String> {
    if let Some(lang) = notes
        .iter()
        .filter_map(|n| n.language.as_deref())
        .find(|lang| {
            !lang.is_empty() && !lang.split('-').next().unwrap().eq_ignore_ascii_case("en")
        })
    {
        return Err(format!(
            "MusicXML lyrics are marked {lang:?}; supply --ipa for non-English pronunciation"
        ));
    }
    let g2p = render::g2p()?;
    let mut out = vec![None::<Syllable>; notes.len()];
    let mut word = String::new();
    let mut positions = Vec::new();
    for (i, note) in notes
        .iter()
        .enumerate()
        .filter(|(_, n)| !n.lyric.is_empty())
    {
        word.push_str(&note.lyric);
        positions.push(i);
        if matches!(note.syllabic.as_str(), "begin" | "middle") {
            continue;
        }
        let syllables = lyrics_to_syllables(&word, &g2p);
        if syllables.len() != positions.len() {
            return Err(format!(
                "MusicXML lyric {word:?} has {} written syllables but English pronunciation yields {}; supply --ipa",
                positions.len(),
                syllables.len()
            ));
        }
        for (pos, mut syl) in positions.drain(..).zip(syllables) {
            syl.text.clone_from(&notes[pos].lyric);
            out[pos] = Some(syl);
        }
        word.clear();
    }
    if !positions.is_empty() {
        return Err(format!(
            "MusicXML ends in an unfinished lyric {word:?}; supply --ipa"
        ));
    }
    let mut syllables = Vec::with_capacity(notes.len());
    for (i, syl) in out.into_iter().enumerate() {
        let syl = syl.unwrap_or_else(|| {
            syllables
                .last()
                .filter(|_| connected(&notes[i - 1], &notes[i]))
                .map_or_else(
                    || Syllable {
                        text: "ɑ".into(),
                        onset: Vec::new(),
                        nucleus: Segment {
                            ipa: "ɑ".into(),
                            ..Default::default()
                        },
                        coda: Vec::new(),
                        melisma: None,
                        word_end: true,
                        phrase_end: false,
                    },
                    extend,
                )
        });
        syllables.push(syl);
    }
    Ok(syllables)
}

fn synthesize(
    score: Score,
    syllables: Vec<Syllable>,
    body: &str,
    reference: Option<&Reference>,
) -> Result<Vec<f32>, String> {
    let notes = score.notes;
    let first_hz = midi_to_hz(notes[0].midi);
    let mut voice = render::singing_voice(body, notes[0].midi)?;
    let mut pitch = GestureScore::new();
    let mut end = score.end + LEAD;
    let mut phrase = Vec::new();
    let mut start = notes[0].start;
    let body: BodyMix = body.into();
    for (i, (note, syl)) in notes.iter().zip(syllables).enumerate() {
        let next = notes.get(i + 1).filter(|next| connected(note, next));
        phrase.push(SungNote {
            midi: note.midi,
            beats: next.map_or(note.end, |n| n.start) - note.start,
            syl,
        });
        if next.is_some() {
            continue;
        }
        let plan = plan_song(
            &phrase,
            &SongOptions {
                body,
                bpm: 60.0,
                t0: start + LEAD,
                vibrato: if reference.is_some() { 0.0 } else { 35.0 },
            },
        );
        for mut gesture in plan.gestures {
            if reference.is_some() && gesture.targets.has(ControlKey::F0) {
                pitch.add(gesture);
                gesture.targets.remove(ControlKey::F0);
            }
            if !gesture.targets.is_empty() {
                voice.score.add(gesture);
            }
        }
        end = end.max(plan.end);
        phrase.clear();
        if let Some(next) = notes.get(i + 1) {
            start = next.start;
        }
    }
    if voice.score.dropped > 0 || pitch.dropped > 0 {
        return Err("vocal line exceeds the gesture limit; render a shorter excerpt".into());
    }

    let mut out = vec![0.0; ((end + 0.4) * FS).round() as usize];
    if let Some(reference) = reference {
        voice.set_source(&SourcePatch {
            glide: Some(0.006),
            drift: Some(0.0),
            ..Default::default()
        });
        // Keep the planner's consonant and breath gestures. Drive f0 at the render block cadence
        // so the engine's ordinary 30 ms score glide does not flatten the measured vibrato.
        for (i, block) in out.chunks_mut(128).enumerate() {
            let t = (i * 128) as f64 / FS;
            pitch.prune(t - 0.01);
            let base = pitch.blend(ControlKey::F0, t);
            let planned_hz = (first_hz * 0.02 + base.value * base.weight) / (0.02 + base.weight);
            voice.source.f0 = reference.pitch(t - LEAD, planned_hz);
            voice.render(block);
        }
    } else {
        render::render_blocks(&mut voice, &mut out);
    }
    Ok(out)
}

pub(crate) fn run(ctx: &Ctx, args: &[String]) -> Result<(), String> {
    let (input, output, body, options) = arguments(args)?;
    crate::body(body)?;
    let output = wav_name(output);
    if let Ok(existing) = std::fs::canonicalize(&output)
        && [Some(input), options.ipa, options.reference]
            .into_iter()
            .flatten()
            .any(|p| std::fs::canonicalize(p).is_ok_and(|path| path == existing))
    {
        return Err("output WAV would overwrite an input".into());
    }
    let mut score = score::load(input, &options.selection)?;
    let syllables = match options.ipa {
        Some(path) => ipa_syllables(&score.notes, path)?,
        None => score_syllables(&score.notes)?,
    };
    let note_count = score.notes.len();
    let reference = if let Some(path) = options.reference {
        let reference = reference::fit(path, &mut score.notes)?;
        score.end = score.notes.last().unwrap().end;
        println!(
            "reference: {}/{} notes, {}/{} voiced frames matched",
            reference.matched_notes, note_count, reference.matched_frames, reference.voiced_frames
        );
        Some(reference)
    } else {
        None
    };
    let out = synthesize(score, syllables, body, reference.as_ref())?;
    ctx.write_wav(&output, &out)?;
    println!(
        "{output}: {:.2} s, peak {:.3}, {note_count} notes",
        ctx.output_seconds(out.len()),
        peak(&out)
    );
    Ok(())
}
