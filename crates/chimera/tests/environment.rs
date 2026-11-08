//! Acoustic behavior, bypass, and host-block independence of the shared room stage.
use chimera::environment::{
    Environment, EnvironmentPreset as Preset, EnvironmentSettings, sabine_absorption,
};

fn impulse(
    preset: Preset,
    fs: f64,
    seconds: f64,
    decay: Option<f64>,
    damping: Option<f64>,
) -> (Vec<f32>, Vec<f32>) {
    let mut room = Environment::new(fs);
    let mut s = EnvironmentSettings::for_preset(preset);
    s.mix = 1.0;
    s.decay = decay.unwrap_or(s.decay);
    s.damping = damping.unwrap_or(s.damping);
    room.set(s);
    let mut silence = vec![0.0; (fs * 0.1) as usize];
    let mut right = silence.clone();
    room.process(&mut silence, &mut right); // settle the control fade before the impulse
    let mut left = vec![0.0; (fs * seconds) as usize];
    left[0] = 1.0;
    let mut right = vec![0.0; left.len()];
    room.process(&mut left, &mut right);
    (left, right)
}

fn energy(x: &[f32]) -> f64 {
    x.iter().map(|v| (*v as f64) * (*v as f64)).sum()
}

#[test]
fn dry_and_zero_mix_preserve_the_source_bits() {
    let source = [0.0f32, -0.0, 0.1, -0.7, 1.0, f32::MIN_POSITIVE];
    for fs in [44100.0, 48000.0, 96000.0] {
        for preset in [Preset::Dry, Preset::Hall] {
            let mut room = Environment::new(fs);
            let mut s = EnvironmentSettings::for_preset(preset);
            s.mix = 0.0;
            room.set(s);
            let mut l = source;
            let mut r = [0.0; 6];
            room.process(&mut l, &mut r);
            assert_eq!(l.map(f32::to_bits), source.map(f32::to_bits));
            assert_eq!(r.map(f32::to_bits), source.map(f32::to_bits));
        }
    }
}

#[test]
fn absorption_matches_the_pyroomacoustics_3d_reference() {
    // The documented 9 x 7.5 x 3.5 m / 0.5 s shoebox, c=343 m/s.
    let expected = 24.0 * chimera::math::ln(10.0) * 236.25 / (343.0 * 250.5 * 0.5);
    assert!((sabine_absorption([9.0, 7.5, 3.5], 0.5) - expected).abs() < 1e-14);
}

#[test]
fn first_reflection_arrives_at_the_ceiling_path_time_in_seconds() {
    // Studio: source [1.75,1.2,1.6], left receiver [2.96,2.32,1.6].
    // Nearest image is the ceiling at z=4.0. Delays are relative to the centre's
    // direct path, removing latency from the dry signal, not advancing the echoes.
    let direct = ((3.05f64 - 1.75).powi(2) + (2.32f64 - 1.2).powi(2)).sqrt();
    let reflected = ((2.96f64 - 1.75).powi(2) + (2.32f64 - 1.2).powi(2) + 2.4f64.powi(2)).sqrt();
    let expected = (reflected - direct) / 343.0;
    for fs in [44100.0, 48000.0, 96000.0] {
        let (l, _) = impulse(Preset::Studio, fs, 0.1, None, None);
        let first = l
            .iter()
            .position(|v| v.abs() > 1e-8)
            .expect("a wall reflection");
        assert!(
            (first as f64 / fs - expected).abs() < 2.0 / fs,
            "{fs}: {first}, expected {expected}"
        );
    }
}

#[test]
fn a_hall_has_a_longer_stereo_tail_than_a_studio() {
    let fs = 48000.0;
    let (studio, _) = impulse(Preset::Studio, fs, 4.0, None, None);
    let (hall, right) = impulse(Preset::Hall, fs, 4.0, None, None);
    let a = (0.6 * fs) as usize;
    let b = (1.2 * fs) as usize;
    assert!(energy(&hall[a..b]) > energy(&studio[a..b]) * 100.0);
    assert!(energy(&hall[a..b]) > 1e-8, "hall tail must remain audible");
    assert!(
        hall.iter().zip(&right).any(|(l, r)| (l - r).abs() > 1e-4),
        "the stereo reflections must differ"
    );
    assert!(
        energy(&hall[(3.0 * fs) as usize..]) < energy(&hall[a..b]) * 0.01,
        "the feedback network must decay"
    );
}

#[test]
fn decay_and_damping_change_the_late_room_sound() {
    let fs = 24000.0;
    let (short, _) = impulse(Preset::Hall, fs, 3.0, Some(0.6), Some(0.3));
    let (long, _) = impulse(Preset::Hall, fs, 3.0, Some(3.0), Some(0.3));
    let a = (0.8 * fs) as usize;
    let b = (1.5 * fs) as usize;
    assert!(energy(&long[a..b]) > 50.0 * energy(&short[a..b]));
    let (bright, _) = impulse(Preset::Hall, fs, 2.0, None, Some(0.0));
    let (soft, _) = impulse(Preset::Hall, fs, 2.0, None, Some(1.0));
    let roughness = |x: &[f32]| {
        x.windows(2)
            .map(|s| ((s[1] - s[0]) as f64).powi(2))
            .sum::<f64>()
            / energy(x)
    };
    let a = (0.4 * fs) as usize;
    assert!(
        roughness(&soft[a..]) < roughness(&bright[a..]) * 0.3,
        "damping must absorb high frequencies"
    );
}

fn switching_render(block: usize) -> (Vec<f32>, Vec<f32>) {
    let mut room = Environment::new(48000.0);
    let mut l: Vec<f32> = (0..24000)
        .map(|i| (chimera::math::sin(i as f64 * 0.04) * 0.2) as f32)
        .collect();
    let mut r = vec![0.0; l.len()];
    let events = [
        (0, Preset::Hall),
        (2000, Preset::Studio),
        (2300, Preset::Cathedral),
        (2500, Preset::Room),
        (8000, Preset::Dry),
        (12000, Preset::Hall),
    ];
    let mut ei = 0;
    let mut pos = 0;
    while pos < l.len() {
        if ei < events.len() && events[ei].0 == pos {
            room.set(EnvironmentSettings::for_preset(events[ei].1));
            ei += 1;
        }
        let end = (pos + block)
            .min(l.len())
            .min(events.get(ei).map_or(l.len(), |e| e.0));
        room.process(&mut l[pos..end], &mut r[pos..end]);
        pos = end;
    }
    (l, r)
}

#[test]
fn rapid_changes_are_finite_and_independent_of_host_block_size() {
    let reference = switching_render(128);
    for block in [1, 63, 509, 4096] {
        assert_eq!(switching_render(block), reference, "block={block}");
    }
    assert!(
        reference
            .0
            .iter()
            .chain(&reference.1)
            .all(|v| v.is_finite() && v.abs() < 1.0)
    );
    let max_step = reference
        .0
        .windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .fold(0.0f32, f32::max);
    assert!(max_step < 0.05, "a room change clicked: {max_step}");
}

#[test]
fn non_finite_settings_are_sanitized_and_extreme_rooms_remain_stable() {
    let mut room = Environment::new(48000.0);
    room.set(EnvironmentSettings {
        preset: Preset::Hall,
        mix: f64::NAN,
        decay: f64::INFINITY,
        damping: f64::NEG_INFINITY,
    });
    assert_eq!(
        room.settings(),
        EnvironmentSettings::for_preset(Preset::Hall)
    );
    let (l, r) = impulse(Preset::Cathedral, 48000.0, 13.0, Some(8.0), Some(0.0));
    assert!(l.iter().chain(&r).all(|v| v.is_finite() && v.abs() < 1.0));
    assert!(energy(&l[12 * 48000..]) < energy(&l[48000..96000]) * 0.001);
}
