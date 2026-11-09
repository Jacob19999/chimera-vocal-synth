//! Match a solo recording to a score by segmenting its pitch track in written note order.
use chimera_score::{MAX_SECONDS, Note};
use chimera::analysis::pitch::{YinOpts, yin_pitch};
use chimera::math::midi_to_hz;
use std::ops::Range;

const HOP: f64 = 0.02;
const MATCH_SEMITONES: f64 = 1.25;

pub(super) struct Reference {
    /// Zero marks a frame with no reliable match to the score pitch.
    hz: Vec<f64>,
    pub voiced_frames: usize,
    pub matched_frames: usize,
    pub matched_notes: usize,
}

impl Reference {
    /// Interpolate reference pitch at an audio timestamp. At gaps, fade to the planned pitch.
    pub fn pitch(&self, seconds: f64, planned_hz: f64) -> f64 {
        let frame = seconds / HOP - 0.5;
        let left = frame.floor() as isize;
        let at = |i: isize| {
            self.hz
                .get(i as usize)
                .copied()
                .filter(|hz| *hz > 0.0)
                .unwrap_or(planned_hz)
        };
        let fraction = frame - left as f64;
        at(left) * (1.0 - fraction) + at(left + 1) * fraction
    }
}

fn track(samples: &[f64], fs: f64, notes: &[Note]) -> Vec<f64> {
    // Average over the decimation window. YIN is quadratic in its period search, so work at
    // roughly 8 kHz instead of running the same analysis on every original WAV sample.
    let stride = (fs / 8000.0).floor().max(1.0) as usize;
    let audio: Vec<f64> = samples
        .chunks_exact(stride)
        .map(|s| s.iter().sum::<f64>() / stride as f64)
        .collect();
    let fs = fs / stride as f64;
    let (low, high) = notes.iter().fold((127.0f64, 1.0f64), |(low, high), note| {
        (low.min(note.midi), high.max(note.midi))
    });
    let min_f0 = midi_to_hz(low - 3.0).max(40.0);
    let max_f0 = midi_to_hz(high + 3.0).min(2000.0);
    let window = (fs * (2.5 / min_f0).max(0.035)).round() as usize;
    let gate = audio.iter().map(|x| x.abs()).fold(0.0, f64::max).max(0.001) * 0.008;
    let opts = YinOpts {
        min_f0: Some(min_f0),
        max_f0: Some(max_f0),
        threshold: Some(0.2),
    };
    let frames = (audio.len() as f64 / fs / HOP).floor() as usize;
    (0..frames)
        .map(|i| {
            let center = ((i as f64 + 0.5) * HOP * fs).round() as usize;
            let start = center.saturating_sub(window / 2);
            let frame = &audio[start..(start + window).min(audio.len())];
            let rms = (frame.iter().map(|x| x * x).sum::<f64>() / frame.len() as f64).sqrt();
            if rms < gate {
                0.0
            } else {
                yin_pitch(frame, fs, opts).f0
            }
        })
        .collect()
}

struct Span {
    end: f64,
    midi: Option<f64>,
}

fn error(hz: f64, midi: f64) -> f64 {
    (12.0 * (hz / midi_to_hz(midi)).log2()).abs()
}

fn frame_cost(hz: f64, midi: Option<f64>) -> f64 {
    match (hz > 0.0, midi) {
        (true, Some(midi)) => (error(hz, midi) / 0.8).min(3.0),
        (false, Some(_)) => 0.95,
        (true, None) => 2.0,
        (false, None) => 0.0,
    }
}

/// Monotone note boundaries. Each score span can stretch or compress locally, with a
/// duration penalty that also places ambiguous boundaries between repeated pitches.
fn boundaries(track: &[f64], spans: &[Span]) -> Option<Vec<Range<usize>>> {
    let len = track.len();
    let scale = len as f64 / spans.last()?.end;
    let band = (len as f64 * 0.16).clamp(25.0, 250.0) as usize;
    let mut previous = vec![f64::INFINITY; len + 1];
    previous[0] = 0.0;
    let mut prev_bounds = 0..1;
    let mut trace = Vec::new();
    let mut last = 0.0;
    for (i, span) in spans.iter().enumerate() {
        let expect = ((span.end - last) * scale).max(1.0);
        let center = (span.end * scale).round() as usize;
        let (lo, hi) = if i == spans.len() - 1 {
            (len, len)
        } else {
            (
                center.saturating_sub(band).max(i + 1),
                (center + band).min(len - (spans.len() - i - 1)),
            )
        };
        if hi < lo {
            return None;
        }
        let mut prefix = vec![0.0; len + 1];
        for (j, &hz) in track.iter().enumerate().take(hi).skip(prev_bounds.start) {
            prefix[j + 1] = prefix[j] + frame_cost(hz, span.midi);
        }
        let mut costs = vec![f64::INFINITY; len + 1];
        let mut from = vec![0; hi + 1 - lo];
        let min_dur = (expect * 0.32).floor().max(1.0) as usize;
        let max_dur = (expect * 3.0).ceil() as usize + 3;
        for end in lo..=hi {
            if end < min_dur {
                continue;
            }
            let earliest = end.saturating_sub(max_dur).max(prev_bounds.start);
            let latest = (end - min_dur + 1).min(prev_bounds.end);
            for start in earliest..latest {
                let deviation = (end - start) as f64 - expect;
                let cost = previous[start] + prefix[end] - prefix[start]
                    + 0.3 * deviation.powi(2) / expect;
                if cost < costs[end] {
                    costs[end] = cost;
                    from[end - lo] = start;
                }
            }
        }
        trace.push((lo, from));
        previous = costs;
        prev_bounds = lo..hi + 1;
        last = span.end;
    }
    if !previous[len].is_finite() {
        return None;
    }
    let mut end = len;
    let mut aligned = Vec::new();
    for (lo, from) in trace.into_iter().rev() {
        let start = from[end - lo];
        aligned.push(start..end);
        end = start;
    }
    aligned.reverse();
    Some(aligned)
}

pub(super) fn fit(path: &str, notes: &mut [Note]) -> Result<Reference, String> {
    let (samples, fs) = crate::compare::read_wav(path)?;
    if !(8000.0..=192000.0).contains(&fs)
        || samples.is_empty()
        || samples.len() as f64 / fs > MAX_SECONDS
        || samples.iter().any(|x| !x.is_finite())
    {
        return Err("reference needs a finite WAV excerpt up to 300 s at 8–192 kHz".into());
    }
    let hz = track(&samples, fs, notes);
    align(hz, notes)
}

fn align(mut hz: Vec<f64>, notes: &mut [Note]) -> Result<Reference, String> {
    let err = "could not match the score pitches to the recording; use the same passage, in the same key, with one clear lead voice";
    let first = hz.iter().position(|&f| f > 0.0).ok_or(err)?;
    let end = hz.iter().rposition(|&f| f > 0.0).unwrap() + 1;
    let origin = notes[0].start;
    let mut spans = Vec::new();
    let mut previous = origin;
    for note in notes.iter() {
        if note.start - previous >= HOP {
            spans.push(Span {
                end: note.start - origin,
                midi: None,
            });
        }
        spans.push(Span {
            end: note.end - origin,
            midi: Some(note.midi),
        });
        previous = note.end;
    }
    let duration_ratio = (end - first) as f64 * HOP / (previous - origin);
    if !(0.4..=2.5).contains(&duration_ratio) || spans.len() > end - first {
        return Err(err.into());
    }
    let ranges = boundaries(&hz[first..end], &spans).ok_or(err)?;
    let (mut matched_frames, mut matched_notes, mut pitched_frames) = (0, 0, 0);
    let voiced_frames = hz.iter().filter(|&&f| f > 0.0).count();
    let mut note = 0;
    for (span, range) in spans.iter().zip(ranges) {
        let (a, b) = (first + range.start, first + range.end);
        if let Some(midi) = span.midi {
            pitched_frames += b - a;
            let mut good = 0;
            for f in &mut hz[a..b] {
                if *f > 0.0 && error(*f, midi) <= MATCH_SEMITONES {
                    good += 1;
                } else {
                    *f = 0.0;
                }
            }
            matched_frames += good;
            if good * 2 >= b - a {
                matched_notes += 1;
            }
            notes[note].start = a as f64 * HOP;
            notes[note].end = b as f64 * HOP;
            note += 1;
        } else {
            hz[a..b].fill(0.0);
        }
    }
    if matched_frames * 2 < pitched_frames
        || matched_frames * 2 < voiced_frames
        || matched_notes * 5 < notes.len() * 3
    {
        return Err(format!(
            "{err} ({matched_notes}/{} notes matched)",
            notes.len()
        ));
    }
    Ok(Reference {
        hz,
        voiced_frames,
        matched_frames,
        matched_notes,
    })
}
