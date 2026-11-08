# Environments

The **Environment** screen below the instrument applies one stereo listening space to live
Play, Speak, Sing, Bestiary, and Beatbox audio. It can be set before starting audio and changed
while playing. Dry is the default. The separate Duet page replays existing recordings and is
not routed through the live instrument's room.

| Space | Width × depth × height | Default decay | Default mix | Default damping |
|---|---|---:|---:|---:|
| Studio | 5 × 4 × 2.8 m | 0.25 s | 18% | 75% |
| Living room | 7 × 5 × 3 m | 0.60 s | 25% | 60% |
| Concert hall | 30 × 20 × 12 m | 2.20 s | 32% | 35% |
| Cathedral | 50 × 24 × 18 m | 5.00 s | 40% | 20% |

- **Room mix** blends the direct voice and the room response. Zero is the original dry signal;
  100% contains only the reflected sound.
- **Decay** sets the late network's low-frequency RT60 target (0.1–8 seconds). Broadband decay
  also depends on damping; it is not a measurement of a particular real venue.
- **Damping** absorbs more high-frequency energy on successive trips through the late network.
  Higher settings make the tail softer and darker.

The geometry stays with the selected preset. Changing decay changes the inferred uniform wall
absorption as well as the late reverberation. Physically impossible short-decay/large-room
combinations saturate at 99% energy absorption for the early reflections.

## CLI renders

The same Rust room processor runs after every `render` command:

```sh
cargo run --release -p chimera-cli -- render text out/studio "Hello world." --environment studio
cargo run --release -p chimera-cli -- render notes melody.json out/hall female \
  --environment hall --room-mix 0.4 --room-decay 2.8 --room-damping 0.35
cargo run --release -p chimera-cli -- render speech out/cathedral "ˈhɛloʊ" \
  --environment cathedral --float
```

Room renders are interleaved stereo WAVs. They include `1.5 × decay + 0.75` seconds of zero-input
tail after the source render, and their duration summaries include that tail. Existing pitch,
level, performance, articulator and telemetry diagnostics still describe the dry source;
articulator/telemetry tracks do not grow silent frames to cover the room tail.

Without `--environment`, or with `--environment dry` or zero room mix, output remains the
original mono WAV with the original duration and samples. Room options are rejected for
comparison, diagnosis and calibration commands, keeping the acoustic judges on dry voices.

## Model and reused code

`crates/chimera/src/environment.rs` is the shared implementation. The live engine uses
`Engine::render_stereo`; `Engine::render` remains the dry mono instrument for analysis and
existing fixtures. No room processing is added inside `HumanVoice`.

Selected routines are adapted from [LCAV/pyroomacoustics](https://github.com/LCAV/pyroomacoustics)
at revision `08d16968f8db414affaf84771a650358a7961446`:

- [`acoustics.py`, `inverse_sabine`](https://github.com/LCAV/pyroomacoustics/blob/08d16968f8db414affaf84771a650358a7961446/pyroomacoustics/acoustics.py):
  the 3D inverse-Sabine energy-absorption calculation. Pressure reflection coefficients are
  the square root of the remaining energy fraction.
- [`room.cpp`, `Room<3>::image_source_shoebox`](https://github.com/LCAV/pyroomacoustics/blob/08d16968f8db414affaf84771a650358a7961446/pyroomacoustics/libroom_src/room.cpp):
  enumeration of the image-index L1 ball and parity-reflected source coordinates, bounded here
  to the 24 first- and second-order wall images.

Fractional stereo delay taps implement the early arrivals. The source is at
`[0.35 × width, 0.30 × depth, 1.6 m]`; the receiver centre is at
`[0.61 × width, 0.58 × depth, 1.6 m]`, with receivers 18 cm apart. Direct propagation time is
subtracted from the reflected paths so playing a note adds no direct-sound latency. This is
stereo microphone spacing, not a binaural head or HRTF model.

Four all-pass diffusers and an eight-line orthogonal feedback delay network provide the later,
dense tail. Its delay lengths follow the room's mean free path; round-trip attenuation follows
the decay setting, and low-pass feedback implements damping. This late model is CHIMERA code,
not a port of pyroomacoustics' ray tracer.

This is a bounded hybrid room effect, not a full wave, scattering, or arbitrary-geometry
simulation, and it does not identify a named studio or concert hall. It requires no Python,
downloaded impulse responses, reference recordings, or network access at runtime. Adapted code
is MIT-licensed; the original notices and exact scope of reuse are preserved in
[public/data/PYROOMACOUSTICS-LICENSE.txt](../public/data/PYROOMACOUSTICS-LICENSE.txt).

All delay storage is allocated when the engine is created. Mix changes are ramped; changes to
room parameters fade the wet path out over 25 ms, rebuild in place, then fade in over 25 ms.
Rapid edits coalesce while fading. Room changes and rendering allocate nothing, and the
transition timing is independent of the host block size.

## Checks

`crates/chimera/tests/environment.rs` covers dry/zero-mix bit preservation, the inverse-Sabine
reference, geometric arrival times at multiple sample rates, stereo tails, decay/damping,
rapid changes, finite output, stability, and block-size independence. The existing audio-thread
allocation test also exercises room changes. CLI tests cover stereo headers, tail content,
zero-mix WAV identity, and invalid options. `tests/environment.test.ts` compares live wasm and
native CLI stereo samples bit for bit. Browser smoke and layout checks include the controls.
