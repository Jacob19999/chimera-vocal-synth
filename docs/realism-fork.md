# Voice realism fork

This fork of [jamesondh/chimera-vocal-synth](https://github.com/jamesondh/chimera-vocal-synth)
combines the available work toward more natural speech and singing. Its baseline is upstream
`main` at `e939cf733f7bbaed9e5698a242b1161dc9580679`. The assembly was made on 2026-11-08.

## What is included

The baseline already contains most of the relevant branch changes. Reapplying their older
commits would duplicate the changes or remove later fixes, so those implementations are retained.

| Source branch | Included behavior | Integration |
|---|---|---|
| `t3/vocal-quality-hill-climb` | Singer-calibrated jitter, smoother fold closure, a persistent posterior glottal gap, 6 Hz vibrato, and better breath and note timing | Already in the baseline; retained |
| `t3/tackle-issue-4` | Continuous blending of male, female, and child anatomy and phoneme targets | Already in the baseline; retained |
| `t3/cli-render-fast-singing` | Fast notes keep time and pitch transitions start on the consonant | Already in the baseline; retained |
| `t3/human-voice-benchmark-dataset` | Reference-singer comparison of timing, spectrum, voicing, vibrato, and noise | Equivalent implementation already in the baseline; retained |
| `main` | Later pronunciation and geometry fixes, pressure smoothing that removes a control-rate buzz, and a brightness control | Retained |
| `t3/real-voice-hill-climb` | Teeth-source noise follows the airflow and jet geometry instead of a fixed 5 kHz cutoff | Imported from upstream commit `9164d7ff333293de759b2ec39336706db0ad7a68` |

Natural irregularities include cycle-to-cycle pitch jitter and amplitude shimmer, slow pitch
drift, variable vibrato, roughness, and vocal fry. Airway pressure, aspiration, and turbulence
interact with the tract. Overlapping gestures and damped articulator motion provide gradual
changes in tongue, lips, jaw, and other articulators. These features predate this fork.

## Additional sound change

Upstream [experiment 21](https://github.com/jamesondh/chimera-vocal-synth/commit/9164d7ff333293de759b2ec39336706db0ad7a68)
changes only `crates/chimera/src/voice/human_airway.rs`. The teeth-noise bandwidth follows the
jet's speed, diameter, and travel to the teeth. Its gain compensates for the bandwidth change,
preserving the intended source power. This lets /s/ and /sh/ have different spectra according
to the modeled airflow, including during transitions.

The branch's batch-3 tuning rules and experiment log are also preserved in `docs/hill-climb/`,
including the corrections at upstream commits `8d63739` and `5372afb`.

The upstream branch reports the following results; they are historical measurements, not new
measurements made for this fork. Lower comparison scores are better.

| Measure | Baseline | Imported change |
|---|---:|---:|
| Real-speaker comparison, training | 1.583 | 1.409 |
| Real-speaker comparison, held-out | 1.706 | 1.536 |
| Singer comparison, training | 0.587 | 0.586 |
| Singer note spectral distance, dB | 8.614 | 8.620 |
| Speech recognition word error, training | 36.75% | 39.07% |
| Speech recognition word error, held-out | 44.33% | 44.67% |

The upstream speech-recognition verdict was NO CLEAR CHANGE and the singer guards passed.
The upstream log records a narrow pass margin for one affricate measurement and sensitivity
to phoneme alignment. It also states that nobody had listened to this change. These numbers
support evaluating the change, not a claim that the synth sounds indistinguishable from a person.

## Matching a particular voice

This is still a parametric physical-modeling synthesizer. It does not extract a speaker
embedding, fit a reusable singer profile from recordings, or clone a particular person's voice.
The singer comparison uses reference phonemes, note times, and score pitches to measure the
existing synth; it does not learn the singer's identity.

The human articulators use damped target-following dynamics, not individual muscle activation
or fatigue. Vocal-fold vibration is a parametric area waveform coupled to the airway. The
self-oscillating two-mass human vocal folds described in the architecture remain unimplemented.
No reference recordings, generated dataset audio, or new voice profiles are added by this fork.

## Local validation

Checked on 2026-11-08 on Apple Silicon with Rust 1.99.1 and Bun 1.4.4:

- Golden regeneration ran twice with `CHIMERA_BLESS=1 cargo test --workspace --no-fail-fast`.
  The first pass encountered the documented old beatbox-snapshot mismatch; the second passed.
  Six audio fixtures changed. No calibrated phoneme tables or comparison judges changed.
- `cargo test --workspace --no-fail-fast`: 112 passed, 0 failed, 2 existing tests ignored.
- `bun run test`: rebuilt WebAssembly, passed the Rust suite, and passed all 30 Bun tests
  across 9 files (724 assertions).
- `bun run typecheck` and `bun run build`: passed.
- The release benchmark was run against the baseline binary, alternating before/after for
  three pairs. Median load at `os=2` was 21.9% -> 21.8% of one core; at `os=1`, 9.8% -> 10.1%.
  There was no material slowdown in the normal `os=2` mode. Both versions used this checkout's
  own build directory; the baseline executable was saved before importing the sound change.

The full reference datasets, speech recognizer, browser end-to-end checks, and perceptual
listening evaluation were not run for this assembly. The historical scores above remain the
upstream branch's measurements.
