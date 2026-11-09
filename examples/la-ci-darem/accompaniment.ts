/**
 * Chamber reduction of the accompaniment in the historical vocal score,
 * IMSLP68957, pp. 64–68. The piano bass and harmony are voiced for cello and
 * strings, and the upper instrumental figures for winds. The two sung lines
 * come from duet.musicxml.
 *
 * One row per measure, in the same order as duet.musicxml. Columns are cello,
 * strings, and optional winds. Each token is pitches/duration in sixteenths,
 * with + for a chord and r for a rest. The reduction simplifies inner voices
 * and ornaments.
 */
export const accompanimentMeasures = `
A2/2 r/2 A2/2 r/2 | r/2 C#4+E4+A4/2 r/2 C#4+E4+A4/2
D3/2 r/2 D#3/2 r/2 | r/2 D4+F#4+B4/2 r/2 B3+F#4+A4/2
E3/2 r/2 B2/2 r/2 | r/2 B3+E4+G#4/2 r/2 A#3+C#4+F#4/2
E2/2 E3/2 G#3/2 B3/2 | G#3+B3+E4/2 r/6 | r/2 B4+D5/2 A4+C#5/2 G#4+B4/2
A3/2 r/2 A2/2 r/2 | A4/2 C#4+E4+A4/2 r/2 C#4+E4+A4/2
D3/2 r/2 D3/2 r/2 | r/2 D4+F#4+B4/2 r/2 D4+F#4+A4/2
E3/2 r/2 E3/2 r/2 | r/2 B3+D4+G#4/2 r/2 B3+D4+G#4/2
A2/2 C#4/2 B3/2 E3/2 | A3+C#4+E4+A4/2 E4+A4+E5/2 F#4+D5/2 D4+G#4+B4/2
A3/2 r/2 A2/2 r/2 | C#4+E4+A4/2 C#4+E4+A4/2 r/2 C#4+E4+A4/2
D3/2 r/2 D#3/2 r/2 | r/2 D4+F#4+B4/2 r/2 B3+F#4+A4/2
E3/2 r/2 B2/2 r/2 | r/2 B3+E4+G#4/2 r/2 A#3+C#4+F#4/2
E2/2 E3/2 G#3/2 B3/2 | G#3+B3+E4/2 r/6 | r/2 B4+D5/2 A4+C#5/2 G#4+B4/2
A3/2 r/2 A2/2 r/2 | A4/2 C#4+E4+A4/2 r/2 C#4+E4+A4/2
D3/2 r/2 D3/2 r/2 | r/2 D4+F#4+B4/2 r/2 B3+F#4+A4/2
E3/2 r/2 E3/2 r/2 | r/2 B3+D4+G#4/2 r/2 B3+D4+G#4/2
A2/2 r/2 G#2/2 r/2 | r/2 A3+E4+A4/2 r/2 E4+G#4+B4/2
A2/2 r/2 E3/2 r/2 | r/2 E4+A4+C#5/2 r/2 D4+G#4+B4/2
A2/2 A3/2 A2/2 r/2 | C#4+A4/2 E4+C#5/2 C#4+A4/2 r/2
E3+B3/4 B3+E4/4 | r/2 G#4+B4/2 r/2 A4+C#5/2
E3+G#3+B3/2 E3/2 E3/2 r/2 | G#4+B4/2 G#4+B4+E5/2 B4+E5+G#5/2 E5+G#5+B5/2
D#3+B3/8 | F#4+B4/6 F#4+A4/2
E3+B3/2 E3+B3/2 E3+B3/2 r/2 | E4+G#4/2 E5+G#5/1 F#5+B5/1 G#5+C#6/1 F#5+B5/1 E5+G#5/2
E3+B3/4 B3+E4/4 | r/2 G#4+B4/2 r/2 A4+C#5/2
E3+G#3+B3/2 E3/2 E3/2 r/2 | G#4+B4/2 G#4+B4+E5/2 B4+E5+G#5/2 E5+G#5+B5/2
D#3+B3/8 | F#4+B4/6 F#4+A4/2
E3+B3/4 D#3+B3/4 | E4+G#4/4 F#4+A4/4
E3+B3/4 D#3+B3/4 | E4+G#4/4 F#4+A4/4
E3+B3/2 r/2 E3/2 r/2 | E4+G#4/2 E4+G#4/2 r/2 E4+G#4+B4/2
E3+G#3/2 B3/2 E3+E4/2 r/2 | B4+D5/2 C#5+E5/1 B4+D5/1 A4+C#5/1 G#4+B4/1 F#4+A4/1 E4+G#4/1
A2/2 r/2 A2/2 r/2 | C#4+E4+A4/2 C#4+E4+A4/2 r/2 C#4+E4+A4/2
D3/2 r/2 D#3/2 r/2 | r/2 B3+F#4+B4/2 r/2 B3+F#4+A4/2
E3/2 r/2 B2/2 r/2 | r/2 B3+E4+G#4/2 r/2 A#3+C#4+F#4/2
E2/2 E3/2 G#3/2 B3/2 | G#3+B3+E4/2 r/6 | r/2 B4+D5/2 A4+C#5/2 G#4+B4/2
A3+C#4/2 r/2 A3/2 r/2 | A4/2 C#4+E4+A4/2 r/2 C#4+E4+A4/2
F#3/4 r/4 | D4+A4+D5/4 r/4
E3+B3/8 | D4+G#4/8
A2+A3/2 r/2 A3/2 r/2 | C#4+A4/2 C#4+A4/2 r/2 C#4+E4+A4/2
F#3/4 r/4 | D4+A4+D5/2 r/2 D4+B4/2 C#4+A4/2
E2+E3/8 | B3+D4+E4+G#4/8
A2/1 E2/1 C#3/1 E2/1 B2/1 E2/1 D3/1 E2/1 | C#4+A4/1 C#4+A4/1 r/1 E4+A4/1 D4+G#4/1 D4+G#4/1 r/1 E4+G#4+B4/1
C#3/2 r/2 G#2/2 r/2 | E4+A4/2 E4+A4+E5/2 r/2 E4+B4+D5/2
A2/1 E2/1 C#3/1 E2/1 B2/1 E2/1 D3/1 E2/1 | E4+A4+C#5/1 E4+A4+C#5/1 r/1 E4+A4/1 D4+G#4/1 D4+G#4/1 r/1 E4+G#4+B4/1
C#3/2 r/2 G#3+E4/4 | E4+A4/2 r/2 B4+D5/4
A3+E4/2 r/2 C#3+C#4/4 | A4+C#5/2 r/2 G#4+B4/4
F#3+C#4/2 r/2 C#3+A3/4 | F#4+A4/2 r/2 E4+G4/4
D3+A3/2 D3+A3/2 B2+B3/2 r/2 | D4+F#4/2 D4+F#4/2 F#4+D5/2 r/2
r/2 E3+B3/2 C#3+C#4/2 r/2 | r/2 E4+G#4/2 G#4+C#5/2 r/2
r/2 F#3+C#4/2 D3+D4/2 r/2 | r/2 F#4+A4/2 A4+F#5/2 r/2
E2+E3/6 | B3+D4/6
r/2 | G#4+B4/2

A2+A3/12 | A4+C#5/2 E4/2 G#4+B4/2 A4+C#5/2 E4/2 B4+D5/2
A2+A3/12 | G#4+B4/2 E4+G#4/2 F#4+A4/2 G#4+B4/2 A4+C#5/2 B4+D5/2
A2+A3/12 | A4+C#5/2 E4/2 G#4+B4/2 A4+C#5/2 E4/2 B4+D5/2
A2+A3/12 | G#4+B4/2 E4+G#4/2 F#4+A4/2 G#4+B4/2 A4+C#5/2 B4+D5/2
A2/6 D3/6 | A4+C#5/2 C#5+E5/2 A4+C#5/2 B4+D5/2 D5+F#5/2 B4+D5/2
E3/6 E2/6 | A4+C#5/2 C#5+E5/2 A4+C#5/2 G#4+B4/2 B4+D5/2 G#4+B4/2
A2+A3/12 | A4/2 C#5/2 D#5/2 E5/2 B4/2 C#5/2 | r/2 B5/6 A5/2 A#5/2
A2+A3/12 | C#5/2 B4/2 A4/2 G#4/2 B4/2 E4/2 | F#5/2 E5/2 F#5/2 E5/2 D5/2 B4/2
A2+A3/12 | A4+C#5/2 E4/2 G#4+B4/2 A4+C#5/2 E4/2 B4+D5/2
A2+A3/12 | G#4+B4/2 E4+G#4/2 F#4+A4/2 G#4+B4/2 A4+C#5/2 B4+D5/2
A2+A3/12 | A4+C#5/2 E4/2 G#4+B4/2 A4+C#5/2 E4/2 B4+D5/2
A2+A3/12 | G#4+B4/2 E4+G#4/2 F#4+A4/2 G#4+B4/2 A4+C#5/2 B4+D5/2
A2/6 D3/6 | A4+C#5/2 C#5+E5/2 A4+C#5/2 B4+D5/2 D5+F#5/2 B4+D5/2
E3/6 E2/6 | A4+C#5/2 C#5+E5/2 A4+C#5/2 G#4+B4/2 B4+D5/2 G#4+B4/2
A2/4 r/8 | A4/2 r/10 | r/4 A5/2 A5/3 G#5/1 A5/2
r/12 | D4+F#4/2 r/2 D4+F#4/2 A3+E4+G4/2 r/2 A3+E4+G4/2 | B5/3 C#6/1 B5/2 A5/3 G#5/1 A5/2
r/12 | D4+F#4/2 r/10 | B5/2 r/3 B5/1 A5/1 G#5/1 F#5/4
E3+C#4/6 E3+B3+E4/6 | r/12 | A5/3 B5/1 A5/2 G#5/3 F#5/1 G#5/2
A3+C#4/2 r/10 | r/6 A3+E4+G4/2 r/2 A3+E4+G4/2 | A5/2 r/2 C#6/2 C#6/3 B5/1 C#6/2
r/12 | D4+F#4/2 r/2 D4+F#4/2 A3+E4+G4/2 r/2 A3+E4+G4/2 | D6/3 E6/1 D6/2 C#6/3 B5/1 C#6/2
r/12 | D4+F#4/2 r/10 | D6/2 r/3 D6/1 C#6/1 B5/1 A5/4
E3/12 | E4+C#5/6 G#4+B4/6 | A5/3 B5/1 A5/2 G#5/3 F#5/1 G#5/2
A3+C#4/2 r/10 | r/12 | A5/2 r/3 D6/1 C#6/1 B5/1 A5/4
E3/12 | E4+C#5/6 G#4+B4/6 | A5/3 B5/1 A5/2 G#5/3 F#5/1 G#5/2
A3+C#4/2 r/10 | r/12 | A5/2 r/3 D6/1 C#6/1 B5/1 A5/4
E3/12 | E4+C#5/6 G#4+B4/6 | A5/3 B5/1 A5/2 G#5/3 F#5/1 G#5/2
A3+C#4/2 r/10 | r/12 | A5/2 r/3 D6/1 C#6/1 B5/1 A5/4
E3+C#4/3 E3+C#4/1 E3+D4+F#4/4 E3+D4+F#4/4 | r/12 | A5/3 B5/1 A5/2 G#5/3 F#5/1 G#5/2
A3+C#4/2 r/2 E3/4 r/4 | A5/4 r/2 D4+F#4/3 C#4+E4/1 D4+F#4/2
A3/2 r/4 E3/2 r/4 | E4+G#4/3 F#4+A4/1 E4+G#4/2 D4+F#4/3 C#4+E4/1 D4+F#4/2
A2/2 r/2 E3+E4/3 E3+E4/1 E3+E4/4 | A4/2 r/2 C#5+E5/3 B4+D5/1 C#5+E5/4
A3+E4/3 A3+E4/1 E3+D4/4 E3+D4/4 | E5+G#5/3 F#5+A5/1 E5+G#5/2 D5+F#5/3 C#5+E5/1 D5+F#5/2
A3+C#4/2 r/10 | A4+C#5+A5/2 r/10
`.trim().split("\n").filter(Boolean);
