// gubernos-reminders: Apple Reminders for the task import (scripts/import-tasks.mjs reminders), through EventKit. Read
// only. Every command prints one JSON value.
//
//   status            {"access": "full" | "notDetermined" | "denied" | "restricted" | "writeOnly"}
//   export [--done]   {"lists": [{name, source, items: [{title, notes, due, time, priority, url, created, completed,
//                     repeat: {freq, interval, days, monthDays}}]}]} — open reminders (--done: completed ones too); asks for
//                     access first if macOS hasn't yet
//
// EventKit has no subtasks, tags, sections or flags: subtasks come as reminders of their own.
// Its own responsible process, like gubernos-calendar (tools/calendar/main.swift): the dialog names this helper.
import EventKit
import Foundation

func out(_ v: Any) {
  let d = (try? JSONSerialization.data(withJSONObject: v, options: [.sortedKeys])) ?? Data("null".utf8)
  FileHandle.standardOutput.write(d); FileHandle.standardOutput.write(Data("\n".utf8))
}
func fail(_ msg: String, _ code: Int32 = 1) -> Never { out(["error": msg]); exit(code) }

if ProcessInfo.processInfo.environment["GUBERNOS_REM_CHILD"] == nil {
  typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") { // RTLD_DEFAULT
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    _ = unsafeBitCast(sym, to: Disclaim.self)(&attr, 1)
    var env = ProcessInfo.processInfo.environment; env["GUBERNOS_REM_CHILD"] = "1"
    let argv = CommandLine.arguments.map { strdup($0) } + [nil]
    let envp = env.map { strdup("\($0)=\($1)") } + [nil]
    var pid: pid_t = 0
    if posix_spawn(&pid, CommandLine.arguments[0], nil, &attr, argv, envp) == 0 {
      var status: Int32 = 0
      waitpid(pid, &status, 0)
      exit((status & 0x7f) == 0 ? (status >> 8) & 0xff : 1)
    }
  }
}

let store = EKEventStore()
let args = Array(CommandLine.arguments.dropFirst())

func access() -> String {
  switch EKEventStore.authorizationStatus(for: .reminder) {
  case .fullAccess: return "full"
  case .writeOnly: return "writeOnly"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "unknown"
  }
}

let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
func day(_ c: DateComponents) -> String? {
  guard let y = c.year, let m = c.month, let d = c.day else { return nil }
  return String(format: "%04d-%02d-%02d", y, m, d)
}
func repeatOf(_ r: EKReminder) -> [String: Any]? {
  guard let rule = r.recurrenceRules?.first else { return nil }
  let freq = ["daily", "weekly", "monthly", "yearly"][min(rule.frequency.rawValue, 3)]
  var o: [String: Any] = ["freq": freq, "interval": rule.interval]
  if let days = rule.daysOfTheWeek, !days.isEmpty { o["days"] = days.map { $0.dayOfTheWeek.rawValue - 1 } } // 0 = Sunday
  if let md = rule.daysOfTheMonth, !md.isEmpty { o["monthDays"] = md.map(\.intValue) }
  return o
}

switch args.first ?? "status" {
case "status":
  out(["access": access()])

case "export":
  if access() == "notDetermined" {
    let done = DispatchSemaphore(value: 0)
    store.requestFullAccessToReminders { _, _ in done.signal() }
    done.wait()
  }
  guard access() == "full" else { fail("no access to Reminders (\(access())): System Settings → Privacy & Security → Reminders → Gubernos Reminders", 2) }
  let all = args.contains("--done")
  let pred = all ? store.predicateForReminders(in: nil) : store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
  let done = DispatchSemaphore(value: 0)
  var found: [EKReminder] = []
  store.fetchReminders(matching: pred) { r in found = r ?? []; done.signal() }
  done.wait()
  var lists: [String: [String: Any]] = [:], order: [String] = []
  for cal in store.calendars(for: .reminder) { lists[cal.calendarIdentifier] = ["name": cal.title, "source": cal.source.title, "items": [[String: Any]]()]; order.append(cal.calendarIdentifier) }
  for r in found.sorted(by: { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }) {
    guard let id = r.calendar?.calendarIdentifier, lists[id] != nil else { continue }
    var o: [String: Any] = ["title": r.title ?? "", "priority": r.priority, "completed": r.isCompleted]
    if let n = r.notes, !n.isEmpty { o["notes"] = n }
    if let c = r.dueDateComponents, let d = day(c) {
      o["due"] = d
      if let h = c.hour { o["time"] = String(format: "%02d:%02d", h, c.minute ?? 0) }
    }
    if let u = r.url { o["url"] = u.absoluteString }
    if let c = r.creationDate { o["created"] = iso.string(from: c) }
    if let rep = repeatOf(r) { o["repeat"] = rep }
    var items = lists[id]!["items"] as! [[String: Any]]; items.append(o); lists[id]!["items"] = items
  }
  out(["lists": order.compactMap { lists[$0] }])

default:
  fail("usage: gubernos-reminders status | export [--done]")
}
