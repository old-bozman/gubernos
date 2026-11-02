// gubernos-voice: speech to text with the Mac's own models (Speech framework, SpeechAnalyzer, macOS 26+), for lib/voice.js.
// Nothing to install: no Python, ffmpeg or model download by us (macOS fetches a language's model once, on first use).
// SpeechTranscriber is the better model but has fewer languages (no Russian in macOS 26/27); DictationTranscriber
// covers more. Both hear one language: mixed speech goes to Whisper (lib/stt.py). One JSON line on stdout:
//   locales                          → {"speech": ["en_US", …], "dictation": ["ru_RU", …]}
//   transcribe <locale> <words|-> <file>   → {"text", "engine": "speech|dictation", "ms"}   words: comma-separated hints
//   prepare <locale>                 → {"ok": true, "engine"}   downloads the language's model now (it can take a minute)
//   anything failing                 → {"error": "…"}
// The audio: anything AVAudioFile reads (the app sends 16 kHz mono WAV).
// Built into the repo by scripts/build-helpers.sh (universal, ad-hoc signed); lib/voice.js runs it from tools/voice/.
import AVFoundation
import Foundation
import Speech

func emit(_ obj: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"error\":\"json\"}".utf8)
  FileHandle.standardOutput.write(data + Data("\n".utf8))
}

// The module for a language, its locale, and which engine: the newer SpeechTranscriber where this Mac has it (isAvailable:
// not on every Mac, e.g. not in a virtual machine), else DictationTranscriber.
@available(macOS 26, *)
func module(for id: String) async -> (any SpeechModule, Locale, String, () -> AsyncThrowingStream<String, Error>)? {
  let loc = Locale(identifier: id)
  if SpeechTranscriber.isAvailable, let l = await SpeechTranscriber.supportedLocale(equivalentTo: loc) {
    let m = SpeechTranscriber(locale: l, preset: .transcription)
    return (m, l, "speech", { AsyncThrowingStream { c in Task { do { for try await r in m.results { c.yield(String(r.text.characters)) }; c.finish() } catch { c.finish(throwing: error) } } } })
  }
  if let l = await DictationTranscriber.supportedLocale(equivalentTo: loc) {
    let m = DictationTranscriber(locale: l, preset: .shortDictation)
    return (m, l, "dictation", { AsyncThrowingStream { c in Task { do { for try await r in m.results { c.yield(String(r.text.characters)) }; c.finish() } catch { c.finish(throwing: error) } } } })
  }
  return nil
}

// A language's model must be reserved before macOS downloads it ("not subscribed to transcription.en" otherwise); an app
// may reserve only a few, so the others go (Gubernos hears one language at a time)
@available(macOS 26, *)
func ensureModel(_ m: any SpeechModule, _ l: Locale) async throws {
  for r in await AssetInventory.reservedLocales where r.identifier != l.identifier { await AssetInventory.release(reservedLocale: r) }
  try await AssetInventory.reserve(locale: l)
  if let req = try await AssetInventory.assetInstallationRequest(supporting: [m]) { try await req.downloadAndInstall() }
}

@available(macOS 26, *)
func run(_ a: [String]) async throws {
  switch a.first {
  case "locales":
    let speech = SpeechTranscriber.isAvailable ? await SpeechTranscriber.supportedLocales.map(\.identifier).sorted() : []
    let dictation = await DictationTranscriber.supportedLocales.map(\.identifier).sorted()
    emit(["speech": speech, "dictation": dictation])
  case "prepare" where a.count >= 2:
    guard let (m, l, engine, _) = await module(for: a[1]) else { return emit(["error": "no speech model for \(a[1]) on this Mac"]) }
    try await ensureModel(m, l)
    emit(["ok": true, "engine": engine])
  case "transcribe" where a.count >= 4:
    let t0 = Date()
    guard let (m, l, engine, results) = await module(for: a[1]) else { return emit(["error": "no speech model for \(a[1]) on this Mac"]) }
    try await ensureModel(m, l)
    let analyzer = SpeechAnalyzer(modules: [m])
    let words = a[2] == "-" ? [] : a[2].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    if !words.isEmpty { let ctx = AnalysisContext(); ctx.contextualStrings = [.general: words]; try await analyzer.setContext(ctx) }
    let stream = results()
    let collect = Task { var s = ""; for try await t in stream { s += t }; return s }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: a[3]))
    if let end = try await analyzer.analyzeSequence(from: file) { try await analyzer.finalizeAndFinish(through: end) } else { await analyzer.cancelAndFinishNow() }
    let text = try await collect.value.trimmingCharacters(in: .whitespacesAndNewlines)
    emit(["text": text, "engine": engine, "ms": Int(Date().timeIntervalSince(t0) * 1000)])
  default:
    emit(["error": "usage: gubernos-voice locales | prepare <locale> | transcribe <locale> <words|-> <file>"])
  }
}

let args = Array(CommandLine.arguments.dropFirst())
let done = DispatchSemaphore(value: 0)
Task {
  if #available(macOS 26, *) {
    do { try await run(args) } catch { emit(["error": error.localizedDescription]) }
  } else {
    emit(["error": "the Mac's own speech models need macOS 26 or later"])
  }
  done.signal()
}
done.wait()
