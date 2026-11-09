//! The selected monophonic line, on the score's written timeline.
use roxmltree::{Document, Node, ParsingOptions};
use std::collections::BTreeSet;
use std::io::Read;

pub(super) const MAX_SECONDS: f64 = 300.0;
const MAX_XML_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Default)]
pub(super) struct Selection<'a> {
    pub part: Option<&'a str>,
    pub voice: Option<&'a str>,
    pub verse: Option<&'a str>,
    pub bpm: Option<f64>,
}

#[derive(Clone, Debug)]
pub(super) struct Note {
    pub midi: f64,
    pub start: f64,
    pub end: f64,
    pub lyric: String,
    pub syllabic: String,
    pub language: Option<String>,
}

pub(super) struct Score {
    pub notes: Vec<Note>,
    pub end: f64,
}

type Xml<'a, 'i> = Node<'a, 'i>;

fn child<'a, 'i>(n: Xml<'a, 'i>, name: &str) -> Option<Xml<'a, 'i>> {
    n.children().find(|c| c.has_tag_name(name))
}

fn value<'a>(n: Xml<'a, '_>, name: &str) -> Option<&'a str> {
    child(n, name)?.text().map(str::trim)
}

fn number(text: Option<&str>, name: &str) -> Result<f64, String> {
    text.and_then(|s| s.parse::<f64>().ok())
        .filter(|x| x.is_finite())
        .ok_or_else(|| format!("missing or invalid {name}"))
}

fn positive(text: Option<&str>, name: &str) -> Result<f64, String> {
    let x = number(text, name)?;
    if x <= 0.0 {
        return Err(format!("{name} must be positive"));
    }
    Ok(x)
}

fn bounded_text(reader: impl Read) -> Result<String, String> {
    let mut xml = String::new();
    reader
        .take(MAX_XML_BYTES + 1)
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;
    if xml.len() as u64 > MAX_XML_BYTES {
        return Err("MusicXML document exceeds 16 MiB".into());
    }
    Ok(xml)
}

fn document(xml: &str) -> Result<Document<'_>, String> {
    // Most notation editors emit a public DOCTYPE. The parser has no external entity resolver.
    Document::parse_with_options(
        xml,
        ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())
}

pub(super) fn load(path: &str, select: &Selection<'_>) -> Result<Score, String> {
    let read = || -> Result<Score, String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let xml = if path.to_ascii_lowercase().ends_with(".mxl") {
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            let container = bounded_text(
                archive
                    .by_name("META-INF/container.xml")
                    .map_err(|e| e.to_string())?,
            )?;
            let container = document(&container)?;
            let root = child(container.root_element(), "rootfiles")
                .and_then(|n| child(n, "rootfile"))
                .and_then(|n| n.attribute("full-path"))
                .ok_or("MXL container has no score path")?;
            bounded_text(archive.by_name(root).map_err(|e| e.to_string())?)?
        } else {
            bounded_text(file)?
        };
        parse(&xml, select)
    };
    read().map_err(|e| format!("{path}: {e}"))
}

fn notes<'a, 'i>(part: Xml<'a, 'i>) -> impl Iterator<Item = Xml<'a, 'i>> {
    part.children()
        .filter(|n| n.has_tag_name("measure"))
        .flat_map(|n| n.children())
        .filter(|n| {
            n.has_tag_name("note") && child(*n, "pitch").is_some() && child(*n, "grace").is_none()
        })
}

fn voice<'a>(n: Xml<'a, '_>) -> &'a str {
    value(n, "voice").unwrap_or("1")
}

fn verse<'a>(n: Xml<'a, '_>) -> &'a str {
    n.attribute("number")
        .or_else(|| n.attribute("name"))
        .unwrap_or("1")
}

fn select_id<'a, T: Copy>(
    all: &[(T, &'a str)],
    lyrics: &[(T, &'a str)],
    explicit: Option<&str>,
    flag: &str,
) -> Result<T, String> {
    if let Some(id) = explicit {
        return all
            .iter()
            .find(|&&(_, name)| name == id)
            .map(|&(item, _)| item)
            .ok_or_else(|| format!("unknown {flag} {id:?}"));
    }
    let candidates = if lyrics.is_empty() { all } else { lyrics };
    if let [(item, _)] = candidates {
        return Ok(*item);
    }
    let names = candidates
        .iter()
        .map(|&(_, id)| id)
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "select a vocal line with {flag}; available IDs: {names}"
    ))
}

fn parse(xml: &str, select: &Selection<'_>) -> Result<Score, String> {
    let doc = document(xml)?;
    let root = doc.root_element();
    if !root.has_tag_name("score-partwise") {
        return Err("expected a score-partwise MusicXML document".into());
    }
    let parts: Vec<_> = root
        .children()
        .filter(|n| n.has_tag_name("part"))
        .filter_map(|n| Some((n, n.attribute("id")?)))
        .collect();
    if parts.is_empty() {
        return Err("score has no parts".into());
    }
    let sung_parts: Vec<_> = parts
        .iter()
        .copied()
        .filter(|(p, _)| notes(*p).any(|n| child(n, "lyric").is_some()))
        .collect();
    let part = select_id(&parts, &sung_parts, select.part, "--part")?;
    let voices: BTreeSet<_> = notes(part).map(voice).collect();
    let sung_voices: BTreeSet<_> = notes(part)
        .filter(|&n| child(n, "lyric").is_some())
        .map(voice)
        .collect();
    if voices.is_empty() {
        return Err("the selected part has no pitched notes".into());
    }
    let ids = |ids: BTreeSet<_>| ids.into_iter().map(|id| (id, id)).collect::<Vec<_>>();
    let voice_id = select_id(&ids(voices), &ids(sung_voices), select.voice, "--voice")?;
    let mut verses = notes(part)
        .filter(|&n| voice(n) == voice_id)
        .flat_map(|n| n.children().filter(|c| c.has_tag_name("lyric")).map(verse));
    let verse_id = match select.verse {
        Some(id) if !verses.any(|v| v == id) => return Err(format!("unknown --verse {id:?}")),
        Some(id) => id,
        None => verses.next().unwrap_or("1"),
    };
    let (mut notes, mut tempos, end) =
        read_part(part, Some((voice_id, verse_id)), select.bpm.is_some())?;
    if select.bpm.is_none() && part != parts[0].0 {
        let (_, mut conductor, _) = read_part(parts[0].0, None, false)?;
        conductor.append(&mut tempos);
        tempos = conductor;
    }
    if notes.is_empty() {
        return Err("the selected voice has no pitched notes".into());
    }
    let seconds = tempo_clock(tempos, select.bpm.unwrap_or(120.0));
    let end = seconds(end);
    if !end.is_finite() || end > MAX_SECONDS {
        return Err(format!(
            "select an excerpt of at most {MAX_SECONDS} seconds"
        ));
    }
    for note in &mut notes {
        note.start = seconds(note.start);
        note.end = seconds(note.end);
        if !note.start.is_finite() || !note.end.is_finite() || note.end - note.start < 0.02 {
            return Err("a pitched note has an invalid duration or lasts less than 20 ms".into());
        }
    }
    Ok(Score { notes, end })
}

fn pitch(n: Xml<'_, '_>) -> Result<f64, String> {
    let step = match value(n, "step") {
        Some("C") => 0,
        Some("D") => 2,
        Some("E") => 4,
        Some("F") => 5,
        Some("G") => 7,
        Some("A") => 9,
        Some("B") => 11,
        _ => return Err("invalid pitch step".into()),
    };
    let octave = number(value(n, "octave"), "octave")?;
    let alter = number(Some(value(n, "alter").unwrap_or("0")), "alter")?;
    let midi = 12.0 * (octave + 1.0) + f64::from(step) + alter;
    if !(1.0..=127.0).contains(&midi) {
        return Err("pitch outside the MIDI note range 1–127".into());
    }
    Ok(midi)
}

type Tempo = (f64, f64);

fn tempo<'a, 'i>(n: Xml<'a, 'i>) -> Result<Option<(Xml<'a, 'i>, f64)>, String> {
    let sound = if n.has_tag_name("sound") {
        Some(n)
    } else {
        child(n, "sound")
    };
    if let Some(sound) = sound
        && let Some(bpm) = sound.attribute("tempo")
    {
        return Ok(Some((sound, positive(Some(bpm), "sound tempo")?)));
    }
    let mark = n
        .children()
        .filter(|c| c.has_tag_name("direction-type"))
        .find_map(|c| child(c, "metronome"));
    if let Some(mark) = mark
        && let Some(rate) = value(mark, "per-minute")
    {
        let unit = match value(mark, "beat-unit") {
            Some("whole") => 4.0,
            Some("half") => 2.0,
            Some("quarter") => 1.0,
            Some("eighth") => 0.5,
            Some("16th") => 0.25,
            _ => return Err("unsupported metronome beat unit; set --bpm".into()),
        };
        let dots = mark
            .children()
            .filter(|c| c.has_tag_name("beat-unit-dot"))
            .count();
        return Ok(Some((
            n,
            positive(Some(rate), "metronome tempo")? * unit * (2.0 - 0.5f64.powi(dots as i32)),
        )));
    }
    Ok(None)
}

fn read_part(
    part: Xml<'_, '_>,
    line: Option<(&str, &str)>,
    override_tempo: bool,
) -> Result<(Vec<Note>, Vec<Tempo>, f64), String> {
    let mut notes: Vec<Note> = Vec::new();
    let mut tempos = Vec::new();
    let (mut divisions, mut measure_start) = (1.0, 0.0f64);
    let mut open_tie = false;
    for measure in part.children().filter(|n| n.has_tag_name("measure")) {
        let (mut beat, mut measure_end) = (measure_start, measure_start);
        for n in measure.children().filter(Node::is_element) {
            match n.tag_name().name() {
                "attributes" => {
                    if let Some(d) = value(n, "divisions") {
                        divisions = positive(Some(d), "divisions")?;
                    }
                }
                "backup" | "forward" => {
                    let dur = positive(value(n, "duration"), "cursor duration")? / divisions;
                    beat += if n.has_tag_name("backup") { -dur } else { dur };
                    if beat < measure_start - 1e-7 {
                        return Err("backup moves before its measure".into());
                    }
                }
                "barline"
                    if line.is_some()
                        && (child(n, "repeat").is_some() || child(n, "ending").is_some()) =>
                {
                    return Err(
                        "unfold repeats and endings before exporting the vocal excerpt".into(),
                    );
                }
                "direction" | "sound" => {
                    let sound = if n.has_tag_name("sound") {
                        Some(n)
                    } else {
                        child(n, "sound")
                    };
                    if let Some(s) = sound
                        && ["dacapo", "dalsegno", "tocoda"]
                            .iter()
                            .any(|&a| s.attribute(a).is_some())
                    {
                        return Err("unfold score jumps before exporting the vocal excerpt".into());
                    }
                    if !override_tempo && let Some((mark, bpm)) = tempo(n)? {
                        let offset = value(mark, "offset").or_else(|| {
                            child(n, "offset")
                                .filter(|c| c.attribute("sound") == Some("yes") || mark == n)
                                .and_then(|c| c.text())
                        });
                        let pos = (beat
                            + number(Some(offset.unwrap_or("0")), "tempo offset")? / divisions)
                            .max(0.0);
                        if !bpm.is_finite() || !pos.is_finite() {
                            return Err("tempo or its position is too large".into());
                        }
                        tempos.push((pos, bpm));
                    }
                }
                "note" if child(n, "grace").is_none() => {
                    let chord = child(n, "chord").is_some();
                    let start = beat;
                    if !chord {
                        beat += positive(value(n, "duration"), "note duration")? / divisions;
                    }
                    if let Some((voice_id, verse_id)) = line
                        && voice(n) == voice_id
                        && let Some(p) = child(n, "pitch")
                    {
                        if chord || notes.last().is_some_and(|last| last.end > start + 1e-7) {
                            return Err("the selected voice contains overlapping pitches".into());
                        }
                        let midi = pitch(p)?;
                        let lyric = n
                            .children()
                            .find(|c| c.has_tag_name("lyric") && verse(*c) == verse_id);
                        let language = lyric.and_then(|l| child(l, "text")).and_then(|t| {
                            t.ancestors().find_map(|n| {
                                n.attribute(("http://www.w3.org/XML/1998/namespace", "lang"))
                            })
                        });
                        let text = lyric
                            .into_iter()
                            .flat_map(|l| l.children())
                            .filter(|c| c.has_tag_name("text"))
                            .filter_map(|c| c.text())
                            .map(str::trim)
                            .collect::<Vec<_>>()
                            .join(" ");
                        let tie = |kind| {
                            n.children()
                                .chain(child(n, "notations").into_iter().flat_map(|c| c.children()))
                                .any(|c| {
                                    (c.has_tag_name("tie") || c.has_tag_name("tied"))
                                        && c.attribute("type") == Some(kind)
                                })
                        };
                        if tie("stop") {
                            let prev = notes
                                .last_mut()
                                .filter(|p| {
                                    open_tie && p.midi == midi && (p.end - start).abs() < 1e-7
                                })
                                .ok_or("tie stop has no contiguous start at the same pitch")?;
                            if !text.is_empty() && text != prev.lyric {
                                return Err("tied note changes lyric mid-syllable".into());
                            }
                            prev.end = beat;
                        } else {
                            if open_tie {
                                return Err("tie start has no matching stop".into());
                            }
                            let syllabic =
                                lyric.and_then(|l| value(l, "syllabic")).unwrap_or("single");
                            notes.push(Note {
                                midi,
                                start,
                                end: beat,
                                lyric: text,
                                syllabic: syllabic.into(),
                                language: language.map(str::to_owned),
                            });
                        }
                        open_tie = tie("start");
                    }
                }
                _ => {}
            }
            if !beat.is_finite() {
                return Err("measure duration is too large".into());
            }
            measure_end = measure_end.max(beat);
        }
        measure_start = measure_end;
    }
    if open_tie {
        return Err("tie start has no matching stop".into());
    }
    Ok((notes, tempos, measure_start))
}

fn tempo_clock(mut tempos: Vec<Tempo>, default_bpm: f64) -> impl Fn(f64) -> f64 {
    tempos.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut marks = vec![(0.0, 0.0, 60.0 / default_bpm)];
    for (beat, bpm) in tempos {
        let &(last, at, rate) = marks.last().unwrap();
        marks.push((beat, at + (beat - last) * rate, 60.0 / bpm));
    }
    move |beat| {
        let (last, at, rate) = marks[marks.partition_point(|mark| mark.0 <= beat) - 1];
        at + (beat - last) * rate
    }
}
