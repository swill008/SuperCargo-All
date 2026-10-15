# Gold pictures: Orison hangar, 2026-10-15

Real WHERE AM I pictures from the user's game, kept as gold standards for OCR tests (user, 2026-10-15: "keep these
images as gold standard, for future tests"). Checked for personal data before committing: they show place names,
coordinates, server and performance numbers and the overlay, no player, org or mission names.

Source: diagnostics export 20261015-0437 from R1 1.0.1 (commit 316fbb8), game 4.x, 5120x2160 capture, player in a
hangar at Orison (Crusader, Stanton).

| File | What | Format |
|---|---|---|
| `zone1.png` | Zone 1 crop as the app kept it (the map's bottom line), unscaled, 1799x134 | original PNG |
| `zone2.webp` | Zone 2 crop (r_DisplayInfo 3 panel), unscaled | WEBP: converted by the chat upload, slightly lossy |
| `zone2-prepped.webp` | Zone 2 after `prepForOcr` (what the OCR saw) | WEBP: converted by the chat upload, slightly lossy |
| `overlay.png` | The overlay after the read | original PNG |
| `all.webp` | All pictures in one (from the export) | WEBP: converted by the chat upload |
| `zone1-read-1.0.1.txt` | Zone 1 text read by R1 1.0.1 (identical to the export's WHERE AM I HISTORY) | text |
| `zone2-prepped-read-1.0.1.txt` | Zone 2 text from `zone2-prepped.webp` with the 1.0.1 zone 2 settings (page mode 6, Sauvola) | text |

## True content (what a perfect read gives)

- Zone 1: `STANTON > CRUSADER > ORISON > 0.01° -172.01° 19.15GM`
- Zone 2 key lines: `Current player location : Stanton2_Orison  (LZ : Stanton2_Orison)`;
  `Planet:OOC_Stanton_2_Crusader (working) (Load Complete)`;
  `CamPos Planet Zone: 5296080.321068 -874417.567942 5280898.342495`;
  `Radius: 7450010.000000 ElevationUnderCam: 1.500000 Altitude 79992.494295`;
  `Zone: Hangar_XLTop_Orison_866260671985 Pos: -13.27m -177.82m -110.28m`.
- Overlay result: FROM Orison General · 11.1 km (display info), ACC 10, ✓ exact.

## Known 1.0.1 read (baseline)

Zone 1 read as `JA STANTON > CRUSADER: > ORISON > 001° -1/2.01° 19.156GM` (+ `€or`): stray `JA`, `-1/2.01°` for
`-172.01°`, `19.156GM` for `19.15GM`. Batch 14 (zone 1 on the WHERE AM I reader) gives the identical text
(proof 2026-10-15). A future OCR change should match or beat this baseline, never lose a field.
