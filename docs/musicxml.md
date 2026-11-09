# Sing a MusicXML score

Render a single vocal line from a partwise `.musicxml`, `.xml`, or compressed `.mxl` file.

```sh
cargo run --release -p chimera-cli -- render musicxml aria.musicxml out/aria male
```

The importer picks the only part and voice with lyrics when it can. Use `--part P2` and
`--voice 1` to select by score ID if the choice is ambiguous. `--verse 2` chooses a lyric line.
Written rests, ties, and tempo changes carry through to the render. Use `--bpm 84` for a fixed
quarter-note tempo. Scores without a playback tempo or simple metronome marking default to
120 quarter notes per minute.

Export a monophonic vocal line or select one from a larger score. Unfold repeats and jumps
before export. Grace notes are skipped, so write essential ornaments as timed notes. Both
score and reference excerpts can be up to five minutes.

For English lyrics, CHIMERA uses the same dictionary and syllable planner as Sing mode.
A lyric extension holds the vowel on later notes. For Italian, German, or custom diction,
pass `--ipa syllables.txt` with one whitespace-separated IPA syllable per pitched note.
Count a tied chain once, skip rests, and use `~` to sustain the previous vowel across a pitch
change. Diction is limited to the phonemes the engine models.

## Follow a recording

Pass a PCM or 32-bit float WAV of the same passage in the same key. Trim away any
instrumental introduction and cut before the next phrase. A solo recording gives the
pitch tracker the clearest signal. An accompanied recording can work when the singer
dominates the excerpt.

```sh
cargo run --release -p chimera-cli -- render musicxml aria.musicxml out/aria-matched male \
  --ipa syllables.txt --reference aria-solo.wav --environment hall
```

The fitter uses the singer benchmark's YIN pitch estimator and aligns the detected pitches
to the notes in order. The note boundaries follow the performance and confident pitch
frames drive the synth's intonation and vibrato. At unvoiced or ambiguous frames the synth
falls back to its planned pitch. The CLI reports matching coverage and rejects a weak match.
The WAV timeline includes 300 ms of preroll for onset consonants. The selected CHIMERA
body supplies the timbre, breath, and diction. The reference supplies timing and pitch.

## Mozart example

[The opening phrase](../examples/don-giovanni/opening.musicxml) of “Deh, vieni alla finestra”
from *Don Giovanni* is transcribed from the public-domain Mutopia edition. The
[IPA file](../examples/don-giovanni/opening.ipa) supplies eight Italian syllable or vowel
continuation cues. [Mutopia score](https://ibiblio.org/mutopia/cgibin/piece-info.cgi?id=189)

Download the Antonio Scotti recording from the Library of Congress. The local validation
used 8.44–13.42 seconds of its downloadable MP3, decoded to 16-bit WAV at 16 kHz. The
recording includes accompaniment. [Library of Congress recording](https://www.loc.gov/item/jukebox-127906/)

```sh
mkdir -p out
ffmpeg -ss 8.44 -i scotti-1909.mp3 -t 4.98 -ar 16000 -c:a pcm_s16le out/scotti-opening.wav

cargo run --release -p chimera-cli -- render musicxml \
  examples/don-giovanni/opening.musicxml out/don-giovanni-score male \
  --ipa examples/don-giovanni/opening.ipa

cargo run --release -p chimera-cli -- render musicxml \
  examples/don-giovanni/opening.musicxml out/don-giovanni-matched male \
  --ipa examples/don-giovanni/opening.ipa --reference out/scotti-opening.wav
```
