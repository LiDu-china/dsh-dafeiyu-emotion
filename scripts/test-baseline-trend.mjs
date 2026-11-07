import assert from 'node:assert/strict'

import { buildEmotionTrend, buildFallbackAnalysis } from '../src/index.js'

// A personal baseline makes an individually high pitch less extreme.
{
  const common = {
    duration: 2,
    voiced_ratio: 0.8,
    pause_ratio: 0.1,
    energy_n: 0.8,
    pitch_n: 0.9,
    var_n: 0.7,
    f0_median: 240,
    f0_std_st: 4,
  }
  const raw = buildFallbackAnalysis('今天有点累', common)
  const calibrated = buildFallbackAnalysis('今天有点累', {
    ...common,
    baseline: {
      f0_median: 200,
      energy_n: 0.5,
      pause_ratio: 0.2,
      f0_std_st: 2,
    },
  })
  assert.ok(
    calibrated.features.pitch_n < raw.features.pitch_n,
    'the calibrated pitch score must be lower than the absolute pitch score',
  )
  assert.equal(calibrated.features.baseline_used, true)
  assert.equal(raw.features.baseline_used, undefined)
  assert.equal(calibrated.calibration.energy_n, 0.8, 'calibration must expose the raw energy')
  assert.equal(calibrated.calibration.pause_ratio, 0.1, 'calibration must expose the raw pause ratio')
  assert.notEqual(
    calibrated.features.energy_n,
    calibrated.calibration.energy_n,
    'the displayed energy may be adjusted, but it must not be saved as the next baseline',
  )
}

// Trend labels combine valence and arousal direction.
{
  const history = [
    { valence: 0.2, arousal: 0.3 },
    { valence: 0.1, arousal: 0.4 },
    { valence: -0.3, arousal: 0.8 },
    { valence: -0.4, arousal: 0.85 },
    { valence: -0.5, arousal: 0.9 },
  ]
  const trend = buildEmotionTrend(history)
  assert.equal(trend.samples, 5)
  assert.match(trend.label, /低落|紧绷/)
  assert.ok(trend.valenceDelta < 0)
  assert.ok(trend.arousalDelta > 0)
}

// A single sample is not a trend yet.
{
  const trend = buildEmotionTrend([{ valence: 0, arousal: 0.5 }])
  assert.equal(trend.samples, 1)
  assert.match(trend.label, /更多/)
}

// Three samples still have no prior window to compare against; they must not
// be scored against zero.
{
  const trend = buildEmotionTrend([
    { valence: 0.1, arousal: 0.3 },
    { valence: 0.2, arousal: 0.4 },
    { valence: 0.3, arousal: 0.5 },
  ])
  assert.equal(trend.samples, 3)
  assert.match(trend.label, /更多/)
}

console.log('baseline and trend tests passed')
