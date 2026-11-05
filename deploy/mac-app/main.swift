// Gubernos.app: Gubernos for Mac without a Terminal. A small launcher, nothing runs inside it: the app lives where install.sh
// puts it (~/.gubernos/app, updated by scripts/update.sh) and runs as a launchd service. First time: it runs the bundled install.sh
// --wizard (Node, the app, then the setup page in the browser) and shows what's happening. After that: it opens the app.
import AppKit

final class Launcher: NSObject, NSApplicationDelegate {
  let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 120), styleMask: [.titled, .closable], backing: .buffered, defer: false)
  let line = NSTextField(wrappingLabelWithString: "Getting Gubernos…")
  let spinner = NSProgressIndicator()
  var proc: Process?

  var home: String { FileManager.default.homeDirectoryForCurrentUser.path }
  // the port of an install that is already set up
  func port() -> Int? {
    guard let d = FileManager.default.contents(atPath: "\(home)/.config/gubernos/config.json"),
          let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], j["vault"] != nil else { return nil }
    return j["port"] as? Int ?? 4747
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    if let p = port() { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:\(p)")!); NSApp.terminate(nil); return }
    window.title = "Gubernos"
    line.frame = NSRect(x: 20, y: 20, width: 380, height: 50)
    spinner.frame = NSRect(x: 20, y: 80, width: 380, height: 16)
    spinner.isIndeterminate = true; spinner.style = .bar; spinner.startAnimation(nil)
    window.contentView?.addSubview(line); window.contentView?.addSubview(spinner)
    window.center(); window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    run()
  }

  func run() {
    guard let script = Bundle.main.path(forResource: "install", ofType: "sh") else { return fail("The app is damaged: install.sh is missing.") }
    let p = Process(), out = Pipe()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = [script, "--wizard"]
    p.standardOutput = out; p.standardError = out
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "\(home)/.gubernos/node/bin:\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    p.environment = env
    var last = ""
    out.fileHandleForReading.readabilityHandler = { h in
      guard let s = String(data: h.availableData, encoding: .utf8), !s.isEmpty else { return }
      let text = s.split(separator: "\n").last.map(String.init) ?? ""
      if !text.isEmpty { last = text }
      DispatchQueue.main.async {
        self.line.stringValue = text.contains("first run:") ? "Continue in your browser. This window closes when you're done." : (text.isEmpty ? self.line.stringValue : text)
      }
    }
    p.terminationHandler = { t in
      DispatchQueue.main.async {
        out.fileHandleForReading.readabilityHandler = nil
        if t.terminationStatus == 0 { NSApp.terminate(nil) } else { self.fail("Setup stopped: \(last)") }
      }
    }
    do { try p.run(); proc = p } catch { fail(error.localizedDescription) }
  }

  func fail(_ text: String) {
    spinner.stopAnimation(nil); spinner.isHidden = true
    line.stringValue = text
    line.isSelectable = true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
  func applicationWillTerminate(_ note: Notification) { if proc?.isRunning == true { proc?.terminate() } }
}

let app = NSApplication.shared
let delegate = Launcher()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
