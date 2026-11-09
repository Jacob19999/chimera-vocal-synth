use chimera::analysis::pitch::{YinOpts, yin_pitch};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).join(name)
}

fn run(input: &Path, stem: &Path, options: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_chimera"))
        .args(["render", "musicxml"])
        .arg(input)
        .arg(stem)
        .args(options)
        .output()
        .unwrap()
}

fn success(output: Output) -> String {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn samples(path: &Path) -> Vec<f64> {
    std::fs::read(path.with_extension("wav")).unwrap()[44..]
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f64 / 32768.0)
        .collect()
}

fn hz_at(x: &[f64], t: f64) -> f64 {
    let mid = (t * 48000.0).round() as usize;
    let frame: Vec<_> = x[mid - 840..mid + 840].iter().step_by(4).copied().collect();
    yin_pitch(
        &frame,
        12000.0,
        YinOpts {
            min_f0: Some(175.0),
            max_f0: Some(340.0),
            threshold: Some(0.2),
        },
    )
    .f0
}

const SCORE: &str = r#"<?xml version="1.0"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
    <score-part id="P2"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <direction><direction-type><words>Andante</words></direction-type><sound tempo="120"/></direction>
      <forward><duration>8</duration></forward>
      <direction><direction-type><words>Slower</words></direction-type><sound tempo="60"/></direction>
      <forward><duration>4</duration></forward>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>12</duration><voice>1</voice></note>
      <backup><duration>12</duration></backup>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration><tie type="start"/><voice>2</voice>
        <lyric><syllabic>single</syllabic><text>Oh</text><extend type="start"/></lyric></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration><tie type="stop"/><voice>2</voice></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice>
        <lyric><extend type="stop"/></lyric></note>
      <note><rest/><duration>2</duration><voice>2</voice></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice>
        <lyric><syllabic>single</syllabic><text>see</text></lyric></note>
    </measure>
  </part>
</score-partwise>"#;

#[test]
fn imports_part_voice_tie_and_tempo_from_xml_and_mxl() {
    let xml = path("vocal.musicxml");
    std::fs::write(&xml, SCORE).unwrap();
    let mxl = path("vocal.mxl");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&mxl).unwrap());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("META-INF/container.xml", options).unwrap();
    zip.write_all(br#"<container><rootfiles><rootfile full-path="score/vocal.musicxml"/></rootfiles></container>"#).unwrap();
    zip.start_file("score/vocal.musicxml", options).unwrap();
    zip.write_all(SCORE.as_bytes()).unwrap();
    zip.finish().unwrap();

    let plain = path("vocal-xml");
    let packed = path("vocal-mxl");
    assert!(success(run(&xml, &plain, &[])).contains("2.70 s"));
    assert!(success(run(&mxl, &packed, &["--part", "P2", "--voice", "2"])).contains("3 notes"));
    let x = samples(&plain);
    assert_eq!(x, samples(&packed));
    assert!((hz_at(&x, 0.56) - 220.0).abs() < 5.0);
    assert!((hz_at(&x, 1.05) - 293.66).abs() < 7.0);
    assert!(
        x[69600..74400].iter().all(|v| v.abs() < 0.01),
        "the rest was lost"
    );
    assert!((hz_at(&x, 2.05) - 246.94).abs() < 6.0);
}

#[test]
fn rejects_polyphony_in_selected_voice() {
    let xml = path("vocal-chord.musicxml");
    let chord = SCORE.replace(
        "<note><rest/><duration>2</duration><voice>2</voice></note>",
        "<note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice></note>",
    );
    std::fs::write(&xml, chord).unwrap();
    let out = run(&xml, &path("vocal-chord"), &[]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("overlapping pitches"));
}

#[test]
fn reference_render_moves_the_timing_and_follows_vibrato() {
    let xml = path("fit-vocal.musicxml");
    let ipa = path("fit-vocal.ipa");
    let reference = path("fit-reference.wav");
    std::fs::write(&xml, SCORE).unwrap();
    std::fs::write(&ipa, "ɑ ~ i").unwrap();
    let fs = 16000u32;
    let mut audio = Vec::new();
    let mut phase = 0.0f64;
    let mut wrong = Vec::new();
    for i in 0..(fs * 3) {
        let t = i as f64 / fs as f64;
        let f0 = if (0.24..0.92).contains(&t) {
            220.0
        } else if (0.92..1.52).contains(&t) {
            293.66
        } else if (1.96..2.67).contains(&t) {
            246.94
        } else {
            0.0
        };
        if f0 == 0.0 {
            audio.push(0);
            wrong.push(0);
        } else {
            let cents = 55.0 + 34.0 * (std::f64::consts::TAU * 5.0 * t).sin();
            phase += std::f64::consts::TAU * f0 * 2f64.powf(cents / 1200.0) / fs as f64;
            audio.push((8000.0 * phase.sin()) as i16);
            wrong.push((8000.0 * (std::f64::consts::TAU * 266.0 * t).sin()) as i16);
        }
    }
    let write = |path: &Path, pcm: &[i16]| {
        let len = pcm.len() as u32 * 2;
        let mut wav = Vec::new();
        wav.extend(b"RIFF");
        wav.extend((36 + len).to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(fs.to_le_bytes());
        wav.extend((2 * fs).to_le_bytes());
        wav.extend(2u16.to_le_bytes());
        wav.extend(16u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(len.to_le_bytes());
        wav.extend(pcm.iter().flat_map(|s| s.to_le_bytes()));
        std::fs::write(path, wav).unwrap();
    };
    write(&reference, &audio);

    let stem = path("fit-vocal");
    let stdout = success(run(
        &xml,
        &stem,
        &[
            "--ipa",
            ipa.to_str().unwrap(),
            "--reference",
            reference.to_str().unwrap(),
        ],
    ));
    assert!(stdout.contains("3/3 notes"), "{stdout}");
    let x = samples(&stem);
    assert!(
        x[19000..23000].iter().all(|v| v.abs() < 0.01),
        "the reference's lead-in was lost"
    );
    assert!(
        x[96000..103000].iter().all(|v| v.abs() < 0.01),
        "the reference's rest was lost"
    );
    // Inspect the actual synthesized pitch at a vibrato crest and trough, after 300 ms preroll.
    let crest = hz_at(&x, 0.95);
    let trough = hz_at(&x, 1.05);
    assert!(
        crest > 227.0 && trough > 219.0 && crest > trough + 4.0,
        "crest {crest}, trough {trough}"
    );
    assert!((hz_at(&x, 2.53) - 255.0).abs() < 8.0);

    let wrong_path = path("fit-wrong.wav");
    write(&wrong_path, &wrong);
    let rejected = path("fit-rejected");
    let failure = run(
        &xml,
        &rejected,
        &["--reference", wrong_path.to_str().unwrap()],
    );
    assert!(!failure.status.success());
    assert!(String::from_utf8_lossy(&failure.stderr).contains("could not match the score pitches"));
    assert!(!rejected.with_extension("wav").exists());
}
