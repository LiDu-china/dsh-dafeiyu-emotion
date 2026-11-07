import assert from 'node:assert/strict'

import { Config, buildPrompt, plainConfig, resolveOptions } from '../src/index.js'

// The DSH settings service parses the schema with its defaults before a plugin
// row can become configurable. A default that violates its own step/min/max
// makes the whole plugin fail to activate, not just the settings card.
assert.doesNotThrow(() => Config({}), 'empty config must validate')
assert.doesNotThrow(
  () => Config({ maxAudioBytes: 12 * 1024 * 1024 }),
  'the shipped 12 MiB default must validate',
)
assert.doesNotThrow(
  () => Config({ startupTimeoutMs: 12000, requestTimeoutMs: 12000 }),
  'non-five-second timeouts must validate',
)
assert.doesNotThrow(
  () => Config({
    enabled: false,
    backendRoot: 'D:/voice-sense',
    pythonPath: 'D:/voice-sense/.venv-ser/Scripts/python.exe',
    language: 'auto',
    empathyStyle: 'direct',
    ttsEnabled: true,
    ttsEmotionAdapt: true,
    petReactionEnabled: true,
    petSayEnabled: true,
    ttsOnlyAfterVoice: true,
    ttsEngine: 'edge',
    ttsVoice: 'zh-CN-XiaoyiNeural',
    ttsRate: '+6%',
    ttsPitch: '+12Hz',
    ttsPiperModel: 'D:/piper/zh_CN-huayan-medium.onnx',
    ttsPiperCommand: 'C:/Python313/Scripts/piper.exe',
    maxAudioBytes: 8 * 1024 * 1024,
    startupTimeoutMs: 180000,
    requestTimeoutMs: 180000,
  }),
  'a full settings payload must validate',
)

for (const key of [
  'enabled',
  'backendRoot',
  'pythonPath',
  'language',
  'empathyStyle',
  'ttsEnabled',
  'ttsEmotionAdapt',
  'petReactionEnabled',
  'petSayEnabled',
  'ttsOnlyAfterVoice',
  'ttsEngine',
  'ttsVoice',
  'ttsRate',
  'ttsPitch',
  'ttsCommand',
  'ttsPiperModel',
  'ttsPiperCommand',
  'maxAudioBytes',
  'startupTimeoutMs',
  'requestTimeoutMs',
]) {
  assert.equal(Config.dict[key]?.meta?.volatile, true, `${key} must be volatile`)
}

assert.throws(
  () => Config({ maxAudioBytes: 1 }),
  /maxAudioBytes/,
  'below-min values must be rejected by the schema',
)
assert.throws(
  () => Config({ language: 'fr' }),
  /language/,
  'unknown languages must be rejected by the schema',
)
assert.throws(
  () => Config({ empathyStyle: 'sarcastic' }),
  /empathyStyle/,
  'unknown empathy styles must be rejected by the schema',
)

// DSH projects volatile fields as { get() } refs. They must be unwrapped
// before path resolution; otherwise backendRoot becomes "[object Object]".
{
  const ref = (value) => ({ get: () => value })
  assert.deepEqual(
    plainConfig({
      backendRoot: ref('D:/voice-sense'),
      nested: { language: ref('auto') },
    }),
    {
      backendRoot: 'D:/voice-sense',
      nested: { language: 'auto' },
    },
  )
  const options = resolveOptions({
    backendRoot: ref('D:/voice-sense'),
    pythonPath: ref(''),
    language: ref('auto'),
    maxAudioBytes: ref(8 * 1024 * 1024),
  })
  assert.equal(options.backendRoot.includes('[object Object]'), false)
  assert.ok(options.backendRoot.endsWith('voice-sense'))
  assert.equal(options.language, 'auto')
  assert.equal(options.maxAudioBytes, 8 * 1024 * 1024)
  assert.equal(options.empathyStyle, 'gentle')
  assert.equal(options.ttsEnabled, true, 'a partial config must keep the schema default')
  assert.equal(options.ttsEmotionAdapt, true, 'emotion-adaptive TTS must default on')
  assert.equal(options.petReactionEnabled, true, 'pet reaction must default on')
  assert.equal(options.petSayEnabled, true, 'pet bubble text must default on')
  assert.equal(resolveOptions({ ttsEnabled: false }).ttsEnabled, false)
  assert.equal(resolveOptions({ ttsEmotionAdapt: false }).ttsEmotionAdapt, false)
  assert.equal(resolveOptions({ petReactionEnabled: false }).petReactionEnabled, false)
  assert.equal(resolveOptions({ petSayEnabled: false }).petSayEnabled, false)

  const shared = { x: 1 }
  assert.deepEqual(
    plainConfig({ a: shared, b: shared }),
    { a: { x: 1 }, b: { x: 1 } },
    'a shared object must survive in both branches',
  )
  assert.deepEqual(
    plainConfig({ a: [shared, shared] }),
    { a: [{ x: 1 }, { x: 1 }] },
    'a shared array element must survive twice',
  )
  const cycle = {}
  cycle.self = cycle
  assert.deepEqual(plainConfig(cycle), { self: undefined }, 'a real cycle must be cut')
}

// Each empathy style must produce a distinguishable reply instruction.
{
  const analysis = {
    transcript: '今天有点累',
    emotion: 'sad',
    confidence: 0.72,
    toneSummary: '低落，语速偏慢',
    segments: [{ text: '今天有点累', start: 0, end: 2, emotion: 'sad', confidence: 0.72 }],
  }
  assert.match(buildPrompt(analysis, 'gentle'), /承接/)
  assert.match(buildPrompt(analysis, 'direct'), /清晰结论/)
  assert.match(buildPrompt(analysis, 'humorous'), /幽默/)
  assert.match(buildPrompt(analysis, 'concise'), /简短/)
}

// Low confidence must ask before asserting an emotion; high confidence must not.
{
  const base = {
    transcript: '今天有点累',
    emotion: 'sad',
    toneSummary: '低落，语速偏慢',
  }
  assert.match(
    buildPrompt({ ...base, confidence: 0.25 }, 'gentle'),
    /不要断言|先.*确认/,
    'low confidence must ask before asserting',
  )
  assert.doesNotMatch(
    buildPrompt({ ...base, confidence: 0.8 }, 'gentle'),
    /不要断言/,
    'high confidence should not add the ask-first clause',
  )
}

console.log('config schema tests passed')
