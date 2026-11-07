# Mobile scroll rendering

## Change

At widths up to 900 CSS pixels, keep the ambient grain texture but use normal
compositing instead of multiply/screen backdrop blending. Give the landing and
reader headers an opaque theme-aware paper background without backdrop blur.
Desktop styling, decorative artwork, particles and animations remain unchanged.
No book content, encrypted data, gate logic or reader behavior was modified.

## Regression checklist

Serve the unmodified baseline and feature branch separately with `npm start`.
Use the existing authorized QA unlock flow against the real encrypted envelope;
never substitute story data, bypass the gate or put the passcode in reports.

- Confirm an incorrect passcode is denied and the existing fixture unlocks.
- On a 390 × 844 viewport, check both themes: grain blend is `normal`, header
  backdrop filters are `none`, and header backgrounds are opaque paper colors.
- At 900px these mobile rules still apply; at 901px desktop blending and blur
  return. Check desktop at 1440px in both themes too.
- Scroll the entire archive: 21 chapter cards and five act cards, all reveals
  visible, no horizontal overflow. Check sticky navigation and mobile menu.
- Open a chapter, turn pages, open/close chapter and settings drawers, return to
  the archive, then check browser Back/Forward.
- Repeat mobile checks with reduced motion. Inspect screenshots for legibility,
  retained decoration and correct theme colors.
- Run `npm test` and `git diff --check`.

## Performance method and limits

Compare three alternating before/after runs in sandbox-enabled headless Chromium
156, 390 × 844 at DPR 2, touch emulation, 4× CPU throttle, GPU disabled. Each run
has a 7.5-second top-to-bottom requestAnimationFrame-driven scroll followed by a
separate traced scroll of the same duration. Sum `DirectRenderer::DrawFrame`
durations in the trace and compare medians. Keep trace overhead out of frame
cadence measurements. Gate checks and archive integrity checks run every time.

This is software-rendered desktop emulation, not a physical phone or mobile
Safari measurement. Renderer CPU work is a diagnostic proxy, not a battery,
GPU, FPS or user-perceived smoothness benchmark. The unmodified baseline already
has smooth main-thread frame cadence here, so no FPS improvement is claimed.

## Recorded results (2026-11-07)

Baseline: `9a4fb58`; optimized: the mobile CSS rules in this change.

- Baseline DrawFrame totals: 1046.6, 1095.2, 1042.4 ms. Median: 1046.6 ms.
- Optimized DrawFrame totals: 694.0, 654.0, 659.1 ms. Median: 659.1 ms.
- Median renderer CPU time was about 37% lower in this emulation. Traced passes
  contained 450 baseline versus 451 optimized DrawFrame events.
- Both versions had zero frames over 40 ms and zero long tasks in all three
  untraced passes. Frame-delta p95 was 16.7–16.8 ms in both versions.
- All six runs denied the wrong passcode and unlocked with the existing fixture.
  All retained 21 chapters, five acts, no hidden reveals, no horizontal overflow
  and no uncaught page exceptions.
- `npm test`: all five unit tests, content validation (86,400 words) and all 795
  site validation checks passed. `git diff --check` passed.

The renderer totals do not measure individual reader/menu interactions. Use the
regression checklist above for those flows and verify on real mobile hardware
before making device-specific performance claims.
