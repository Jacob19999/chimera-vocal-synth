# Sing a MusicXML score

## Sing live in the browser

Choose **Opera → Play duet** for the complete vocal number “Là ci darem la mano”
from Act I, No. 7 of Mozart’s *Don Giovanni*. Both faces use live telemetry from
their own voice and the lyrics highlight as each singer enters. **Import MusicXML**
replaces the duet. The **Là ci darem la mano** button restores Mozart.

The included MusicXML transcribes both vocal staves through the final bars, with
Italian IPA, ties, lyric slurs, the 2/4 Andante, the fermata, and the 6/8 Allegro.
The printed edition gives verbal tempos. Playback uses a quarter note at 66 BPM
for Andante and a dotted quarter at 92 BPM for Allegro. The written fermata gets
a longer hold, and the cue notes and final trills use measured durations.
The instrumental staves are omitted, with their rests preserved in the vocal lines.
[Historical vocal score, pp. 64–68](https://s9.imslp.org/files/imglnks/usimg/1/1a/IMSLP68957-PMLP36804-Mozart_-_Don_Giovanni_it-eng_Vocal_Score.pdf)

In **Opera → MIDI library**, choose **accompaniment.mid** for the full duet.
The cello, strings, and winds form a chamber reduction of the same edition's
piano accompaniment and share the vocal score's bar grid and tempo changes.

The same score is available in **Sing → Lyrics**, where the piano roll shows both
parts. Both modes use the selected Environment.

**Import MusicXML** accepts a local partwise `.musicxml`, `.xml`, or `.mxl` score
with one or two monophonic vocal parts. A two-part import assigns the lower line
to the male body and the higher line to the female body. For custom or non-English
diction, select the score and a `.ipa` file together. Put one line of IPA per vocal
part in score order, using the same syllable rules as the CLI below.

## Render from the command line

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
  examples/don-giovanni/opening.musicxml out/musicxml/don-giovanni-matched male \
  --ipa examples/don-giovanni/opening.ipa --reference out/scotti-opening.wav
```
