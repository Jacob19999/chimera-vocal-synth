//! Shared output-stage room acoustics for live playback and offline rendering.
//!
//! The shoebox images and inverse-Sabine absorption are adapted from pyroomacoustics
//! (MIT, pinned sources and notices in public/data/PYROOMACOUSTICS-LICENSE.txt).
//! Twenty-four first/second-order images supply stereo early reflections. A diffused,
//! damped eight-line feedback network approximates the later, dense reverberation.
//! This is a bounded hybrid effect, not pyroomacoustics' full ray-tracing simulator.
//!
//! All storage is reserved at construction. Changes fade the wet signal out before
//! rebuilding coefficients in place, then fade in; rendering and changes allocate nothing.

use crate::math::{TAU, exp, ln, pow, sqrt};
use serde::{Deserialize, Serialize};

const C: f64 = 343.0; // m/s
const N: usize = 8;
const TAPS: usize = 24;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[repr(u32)]
pub enum EnvironmentPreset {
    #[default]
    Dry,
    Studio,
    Room,
    Hall,
    Cathedral,
}

impl EnvironmentPreset {
    pub fn from_index(i: u32) -> Self {
        match i {
            1 => Self::Studio,
            2 => Self::Room,
            3 => Self::Hall,
            4 => Self::Cathedral,
            _ => Self::Dry,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        PRESETS.iter().find(|p| p.id == s).map(|p| p.preset)
    }

    pub fn info(self) -> &'static PresetInfo {
        &PRESETS[self as usize]
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct PresetInfo {
    pub id: &'static str,
    pub preset: EnvironmentPreset,
    pub label: &'static str,
    /// Width, depth, height in metres.
    pub dimensions: [f64; 3],
    pub decay: f64,
    pub damping: f64,
    pub mix: f64,
}

pub const PRESETS: [PresetInfo; 5] = [
    PresetInfo {
        id: "dry",
        preset: EnvironmentPreset::Dry,
        label: "Dry",
        dimensions: [5.0, 4.0, 2.8],
        decay: 0.25,
        damping: 0.65,
        mix: 0.0,
    },
    PresetInfo {
        id: "studio",
        preset: EnvironmentPreset::Studio,
        label: "Studio",
        dimensions: [5.0, 4.0, 2.8],
        decay: 0.25,
        damping: 0.75,
        mix: 0.18,
    },
    PresetInfo {
        id: "room",
        preset: EnvironmentPreset::Room,
        label: "Living room",
        dimensions: [7.0, 5.0, 3.0],
        decay: 0.6,
        damping: 0.6,
        mix: 0.25,
    },
    PresetInfo {
        id: "hall",
        preset: EnvironmentPreset::Hall,
        label: "Concert hall",
        dimensions: [30.0, 20.0, 12.0],
        decay: 2.2,
        damping: 0.35,
        mix: 0.32,
    },
    PresetInfo {
        id: "cathedral",
        preset: EnvironmentPreset::Cathedral,
        label: "Cathedral",
        dimensions: [50.0, 24.0, 18.0],
        decay: 5.0,
        damping: 0.2,
        mix: 0.4,
    },
];

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct EnvironmentSettings {
    pub preset: EnvironmentPreset,
    pub mix: f64,
    /// Low-frequency target RT60 in seconds, not an exact measured broadband decay.
    pub decay: f64,
    pub damping: f64,
}

impl Default for EnvironmentSettings {
    fn default() -> Self {
        Self::for_preset(EnvironmentPreset::Dry)
    }
}

impl EnvironmentSettings {
    pub fn for_preset(preset: EnvironmentPreset) -> Self {
        let p = preset.info();
        Self {
            preset,
            mix: p.mix,
            decay: p.decay,
            damping: p.damping,
        }
    }

    pub fn sanitized(self) -> Self {
        let p = Self::for_preset(self.preset);
        let finite = |v: f64, default: f64, lo: f64, hi: f64| {
            if v.is_finite() {
                v.clamp(lo, hi)
            } else {
                default
            }
        };
        Self {
            preset: self.preset,
            mix: finite(self.mix, p.mix, 0.0, 1.0),
            decay: finite(self.decay, p.decay, 0.1, 8.0),
            damping: finite(self.damping, p.damping, 0.0, 1.0),
        }
    }

    pub fn enabled(self) -> bool {
        self.preset != EnvironmentPreset::Dry && self.mix > 0.0
    }

    /// Enough zero-input time to include the geometric reflections and a quiet decay tail.
    pub fn tail_seconds(self) -> f64 {
        if self.enabled() {
            1.5 * self.decay + 0.75
        } else {
            0.0
        }
    }

    fn same_room(self, other: Self) -> bool {
        self.preset == other.preset && self.decay == other.decay && self.damping == other.damping
    }
}

/// Port of the 3D energy-absorption part of pyroomacoustics.acoustics.inverse_sabine.
/// Extreme creative settings saturate at almost complete absorption rather than failing.
pub fn sabine_absorption(dim: [f64; 3], decay: f64) -> f64 {
    let [w, d, h] = dim;
    let volume = w * d * h;
    let surface = 2.0 * (w * d + w * h + d * h);
    (24.0 * ln(10.0) * volume / (C * surface * decay)).clamp(0.001, 0.99)
}

#[derive(Clone, Copy, Default)]
struct Tap {
    delay: [f64; 2],
    gain: [f64; 2],
}

struct Delay {
    data: Vec<f64>,
    pos: usize,
    len: usize,
}

impl Delay {
    fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity.max(2)],
            pos: 0,
            len: 2,
        }
    }

    fn configure(&mut self, len: usize) {
        self.data.fill(0.0);
        self.pos = 0;
        self.len = len.clamp(2, self.data.len());
    }

    fn read(&self) -> f64 {
        self.data[self.pos]
    }

    fn write(&mut self, x: f64) {
        self.data[self.pos] = if x.abs() < 1e-24 { 0.0 } else { x };
        self.pos += 1;
        if self.pos == self.len {
            self.pos = 0;
        }
    }

    fn allpass(&mut self, x: f64) -> f64 {
        let y = self.read() - 0.6 * x;
        self.write(x + 0.6 * y);
        y
    }
}

struct Room {
    fs: f64,
    history: Vec<f64>,
    pos: usize,
    taps: [Tap; TAPS],
    lines: [Delay; N],
    diffusers: [Delay; 4],
    feedback: [f64; N],
    low: [f64; N],
    pole: f64,
    pre_delay: f64,
    hp_x: f64,
    hp_y: f64,
    hp_pole: f64,
}

impl Room {
    fn new(fs: f64) -> Self {
        Self {
            fs,
            history: vec![0.0; (fs * 0.75).ceil() as usize + 4],
            pos: 0,
            taps: [Tap::default(); TAPS],
            lines: std::array::from_fn(|_| Delay::new((fs * 0.2).ceil() as usize)),
            diffusers: std::array::from_fn(|_| Delay::new((fs * 0.04).ceil() as usize)),
            feedback: [0.0; N],
            low: [0.0; N],
            pole: 0.0,
            pre_delay: 1.0,
            hp_x: 0.0,
            hp_y: 0.0,
            hp_pole: exp(-TAU * 30.0 / fs),
        }
    }

    fn configure(&mut self, settings: EnvironmentSettings) {
        self.history.fill(0.0);
        self.pos = 0;
        self.low.fill(0.0);
        self.hp_x = 0.0;
        self.hp_y = 0.0;
        let dim = settings.preset.info().dimensions;
        let source = [0.35 * dim[0], 0.3 * dim[1], 1.6];
        let listener = [0.61 * dim[0], 0.58 * dim[1], 1.6];
        let distance = |a: [f64; 3], b: [f64; 3]| {
            sqrt(
                (a[0] - b[0]) * (a[0] - b[0])
                    + (a[1] - b[1]) * (a[1] - b[1])
                    + (a[2] - b[2]) * (a[2] - b[2]),
            )
        };
        let direct = distance(source, listener);
        let reflect = sqrt(1.0 - sabine_absorption(dim, settings.decay));
        let mut count = 0;
        let mut gain_sum = [0.0; 2];
        // Adapted from Room<3>::image_source_shoebox: L1 ball of image indices,
        // parity-reflected source coordinates, sqrt(1 - energy absorption) per bounce.
        for z in -2i32..=2 {
            for y in -2i32..=2 {
                for x in -2i32..=2 {
                    let point = [x, y, z];
                    let order = x.abs() + y.abs() + z.abs();
                    if order == 0 || order > 2 {
                        continue;
                    }
                    let image = std::array::from_fn(|i| {
                        point[i] as f64 * dim[i]
                            + if point[i].abs() % 2 == 1 {
                                dim[i] - source[i]
                            } else {
                                source[i]
                            }
                    });
                    let mut tap = Tap::default();
                    for ch in 0..2 {
                        let mut ear = listener;
                        ear[0] += if ch == 0 { -0.09 } else { 0.09 };
                        let path = distance(image, ear);
                        // Remove direct propagation latency: the dry voice remains immediate.
                        tap.delay[ch] = ((path - direct).max(0.0) / C * self.fs).max(1.0);
                        tap.gain[ch] = pow(reflect, order as f64) * direct / path;
                        gain_sum[ch] += direct / path;
                    }
                    self.taps[count] = tap;
                    count += 1;
                }
            }
        }
        for tap in &mut self.taps {
            for ch in 0..2 {
                tap.gain[ch] *= 0.7 / gain_sum[ch];
            }
        }
        let [w, d, h] = dim;
        let mean_path = 4.0 * w * d * h / (2.0 * (w * d + w * h + d * h));
        let time = (mean_path / C).clamp(0.012, 0.095);
        self.pre_delay = ((0.008 + time * 0.6) * self.fs).round();
        let ratios = [0.73, 0.83, 0.97, 1.09, 1.23, 1.37, 1.53, 1.71];
        for (i, ratio) in ratios.into_iter().enumerate() {
            // Odd, unequal lengths reduce coincident modes. RT60 sets loss per round trip.
            let len = ((time * ratio * self.fs).round() as usize) | 1;
            self.lines[i].configure(len);
            self.feedback[i] = pow(
                10.0,
                -3.0 * self.lines[i].len as f64 / (self.fs * settings.decay),
            );
        }
        let scale = (mean_path / 3.0).clamp(0.6, 2.0);
        for (i, seconds) in [0.0047, 0.0067, 0.0093, 0.0137].into_iter().enumerate() {
            self.diffusers[i].configure((seconds * scale * self.fs).round() as usize | 1);
        }
        let cutoff = (1500.0 + 17000.0 * (1.0 - settings.damping) * (1.0 - settings.damping))
            .min(self.fs * 0.45);
        self.pole = exp(-TAU * cutoff / self.fs);
    }

    fn past(&self, delay: f64) -> f64 {
        let delay = delay.min((self.history.len() - 2) as f64);
        let n = delay.floor() as usize;
        let frac = delay - n as f64;
        let a = (self.pos + self.history.len() - n) % self.history.len();
        let b = (a + self.history.len() - 1) % self.history.len();
        self.history[a] * (1.0 - frac) + self.history[b] * frac
    }

    fn step(&mut self, input: f64) -> [f64; 2] {
        // Remove subsonic energy from the wet path only.
        let x = input - self.hp_x + self.hp_pole * self.hp_y;
        self.hp_x = input;
        self.hp_y = x;
        self.history[self.pos] = x;
        let mut early = [0.0; 2];
        for tap in &self.taps {
            for (ch, sum) in early.iter_mut().enumerate() {
                *sum += self.past(tap.delay[ch]) * tap.gain[ch];
            }
        }
        let mut diffuse = self.past(self.pre_delay);
        for ap in &mut self.diffusers {
            diffuse = ap.allpass(diffuse);
        }
        let mut values = [0.0; N];
        for (i, value) in values.iter_mut().enumerate() {
            let v = self.lines[i].read() * self.feedback[i];
            self.low[i] = (1.0 - self.pole) * v + self.pole * self.low[i];
            *value = self.low[i];
        }
        // Orthogonal Householder feedback: 2/N * sum - value, with N=8.
        let sum = values.iter().sum::<f64>() * 0.25;
        let inject = [1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0];
        let left = [1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0];
        let right = [1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0];
        let mut late = [0.0; 2];
        for i in 0..N {
            self.lines[i].write(sum - values[i] + diffuse * 0.18 * inject[i]);
            late[0] += values[i] * left[i] * 0.3535533905932738;
            late[1] += values[i] * right[i] * 0.3535533905932738;
        }
        self.pos += 1;
        if self.pos == self.history.len() {
            self.pos = 0;
        }
        [early[0] + late[0], early[1] + late[1]]
    }
}

/// Stereo room effect fed by a mono source. Dry bypass preserves the input bit for bit.
pub struct Environment {
    room: Room,
    active: EnvironmentSettings,
    requested: EnvironmentSettings,
    pending: Option<EnvironmentSettings>,
    mix: f64,
    goal: f64,
    ramp: usize,
    ramp_length: usize,
}

impl Environment {
    pub fn new(sample_rate: f64) -> Self {
        let s = EnvironmentSettings::for_preset(EnvironmentPreset::Dry);
        Self {
            room: Room::new(sample_rate),
            active: s,
            requested: s,
            pending: None,
            mix: 0.0,
            goal: 0.0,
            ramp: 0,
            ramp_length: (sample_rate * 0.025).round().max(1.0) as usize,
        }
    }

    pub fn settings(&self) -> EnvironmentSettings {
        self.requested
    }

    fn ramp_to(&mut self, goal: f64) {
        self.goal = goal;
        self.ramp = self.ramp_length;
    }

    pub fn set(&mut self, settings: EnvironmentSettings) {
        let settings = settings.sanitized();
        if settings == self.requested {
            return;
        }
        self.requested = settings;
        if settings.same_room(self.active) && self.pending.is_none() {
            self.ramp_to(if settings.preset == EnvironmentPreset::Dry {
                0.0
            } else {
                settings.mix
            });
        } else if self.mix == 0.0 {
            self.room.configure(settings);
            self.active = settings;
            self.pending = None;
            self.ramp_to(if settings.preset == EnvironmentPreset::Dry {
                0.0
            } else {
                settings.mix
            });
        } else {
            if self.pending.is_none() {
                self.ramp_to(0.0);
            }
            self.pending = Some(settings);
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        assert_eq!(left.len(), right.len());
        if self.active.preset == EnvironmentPreset::Dry && self.pending.is_none() && self.ramp == 0
        {
            right.copy_from_slice(left);
            return;
        }
        for (l, r) in left.iter_mut().zip(right) {
            if self.ramp > 0 {
                self.mix += (self.goal - self.mix) / self.ramp as f64;
                self.ramp -= 1;
                if self.ramp == 0 {
                    self.mix = self.goal;
                    if let Some(s) = self.pending.take() {
                        self.room.configure(s);
                        self.active = s;
                        self.ramp_to(if s.preset == EnvironmentPreset::Dry {
                            0.0
                        } else {
                            s.mix
                        });
                    }
                }
            }
            let dry = *l;
            let wet = if self.active.preset == EnvironmentPreset::Dry {
                [0.0; 2]
            } else {
                self.room.step(dry as f64)
            };
            if self.mix == 0.0 {
                *r = dry;
            } else {
                *l = ((1.0 - self.mix) * dry as f64 + self.mix * wet[0]) as f32;
                *r = ((1.0 - self.mix) * dry as f64 + self.mix * wet[1]) as f32;
            }
        }
    }
}
