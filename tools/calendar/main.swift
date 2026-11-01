// gubernos-calendar: the Mac's own calendars (Calendar.app: iCloud, Google, Exchange… whatever is added there) for the
// app's server, through EventKit — no Google Cloud project, no OAuth. lib/maccal.js builds it (swiftc, into
// ~/.gubernos/bin) and calls it; every command prints one JSON value.
//
//   status                                   {"access": "full" | "notDetermined" | "denied" | "restricted" | "writeOnly"}
//   request                                  asks macOS for access (the system dialog), then prints status
//   calendars                                [{id, title, source, writable, default}]
//   events FROM TO [ID,ID…]                  events in local time FROM–TO ("YYYY-MM-DDTHH:MM"), in those calendars (none: all)
//   create CAL START END TITLE [NOTES] [URL] {id}  (CAL "" = the default calendar for new events)
//   move ID START END                        {id}
//   delete ID                                {ok: true}
//
// AICODE-NOTE: macOS asks for calendar access on behalf of the "responsible" process — the server (node under launchd) or
// the Terminal, neither of which can say why. So the helper first re-launches itself disclaiming that responsibility
// (responsibility_spawnattrs_setdisclaim): the dialog then names this helper, with the reason from its own Info.plist
// (embedded at build time), and the access belongs to it wherever it is started from.
import EventKit
import Foundation

func out(_ v: Any) {
  let d = (try? JSONSerialization.data(withJSONObject: v, options: [.sortedKeys])) ?? Data("null".utf8)
  FileHandle.standardOutput.write(d); FileHandle.standardOutput.write(Data("\n".utf8))
}
func fail(_ msg: String, _ code: Int32 = 1) -> Never {
  out(["error": msg]); exit(code)
}

// ---- run as our own responsible process ----
if ProcessInfo.processInfo.environment["GUBERNOS_CAL_CHILD"] == nil {
  typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") { // RTLD_DEFAULT
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    _ = unsafeBitCast(sym, to: Disclaim.self)(&attr, 1)
    var env = ProcessInfo.processInfo.environment; env["GUBERNOS_CAL_CHILD"] = "1"
    let argv = CommandLine.arguments.map { strdup($0) } + [nil]
    let envp = env.map { strdup("\($0)=\($1)") } + [nil]
    var pid: pid_t = 0
    if posix_spawn(&pid, CommandLine.arguments[0], nil, &attr, argv, envp) == 0 {
      var status: Int32 = 0
      waitpid(pid, &status, 0)
      exit((status & 0x7f) == 0 ? (status >> 8) & 0xff : 1)
    }
  }
  // no disclaim available: carry on in this process
}

let store = EKEventStore()
let args = Array(CommandLine.arguments.dropFirst())
let cmd = args.first ?? "status"

func access() -> String {
  switch EKEventStore.authorizationStatus(for: .event) {
  case .fullAccess: return "full"
  case .writeOnly: return "writeOnly"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "unknown"
  }
}
func needAccess() { if access() != "full" { fail("no access to calendars (\(access())): Gubernos → Settings → Calendar → Allow, or System Settings → Privacy & Security → Calendars", 2) } }

let localFmt: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .current; f.dateFormat = "yyyy-MM-dd'T'HH:mm"; return f }()
let dayFmt: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .current; f.dateFormat = "yyyy-MM-dd"; return f }()
func date(_ s: String) -> Date {
  guard let d = localFmt.date(from: String(s.prefix(16))) else { fail("bad time \(s): YYYY-MM-DDTHH:MM") }
  return d
}
func arg(_ i: Int) -> String {
  guard i < args.count else { fail("\(cmd): missing argument \(i)") }
  return args[i]
}

switch cmd {
case "status":
  out(["access": access()])

case "request":
  let done = DispatchSemaphore(value: 0)
  store.requestFullAccessToEvents { _, _ in done.signal() }
  done.wait()
  out(["access": access()])

case "calendars":
  needAccess()
  let def = store.defaultCalendarForNewEvents?.calendarIdentifier
  out(store.calendars(for: .event).map { c -> [String: Any] in
    ["id": c.calendarIdentifier, "title": c.title, "source": c.source?.title ?? "", "writable": c.allowsContentModifications, "default": c.calendarIdentifier == def]
  })

case "events":
  needAccess()
  let from = date(arg(1)), to = date(arg(2))
  let ids = args.count > 3 ? Set(args[3].split(separator: ",").map(String.init)) : []
  let cals = store.calendars(for: .event).filter { ids.isEmpty || ids.contains($0.calendarIdentifier) }
  if cals.isEmpty { out([]); break }
  let events = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: cals))
  out(events.map { e -> [String: Any] in
    let me = e.attendees?.first { $0.isCurrentUser }
    return [
      "id": e.eventIdentifier ?? "", "title": e.title ?? "(no title)", "allDay": e.isAllDay,
      "start": e.isAllDay ? dayFmt.string(from: e.startDate) : localFmt.string(from: e.startDate),
      "end": e.isAllDay ? dayFmt.string(from: e.endDate) : localFmt.string(from: e.endDate),
      "location": e.location ?? NSNull(), "calendar": e.calendar.title, "calendarId": e.calendar.calendarIdentifier,
      "free": e.availability == .free, "declined": me?.participantStatus == .declined,
      "attendees": (e.attendees ?? []).compactMap { $0.url.absoluteString.hasPrefix("mailto:") ? String($0.url.absoluteString.dropFirst(7)) : nil }.prefix(10).map { $0 },
      "url": e.url?.absoluteString ?? NSNull(), "notes": e.notes.map { String($0.prefix(500)) } ?? NSNull(),
    ]
  })

case "create":
  needAccess()
  let calId = arg(1)
  guard let cal = calId.isEmpty ? store.defaultCalendarForNewEvents : store.calendar(withIdentifier: calId) else { fail("no calendar \(calId)") }
  let e = EKEvent(eventStore: store)
  e.calendar = cal; e.startDate = date(arg(2)); e.endDate = date(arg(3)); e.title = arg(4)
  if args.count > 5, !args[5].isEmpty { e.notes = args[5] }
  if args.count > 6, !args[6].isEmpty { e.url = URL(string: args[6]) }
  do { try store.save(e, span: .thisEvent, commit: true) } catch { fail("couldn't save: \(error.localizedDescription)") }
  out(["id": e.eventIdentifier ?? ""])

case "move":
  needAccess()
  guard let e = store.event(withIdentifier: arg(1)) else { fail("not found", 4) }
  e.startDate = date(arg(2)); e.endDate = date(arg(3))
  do { try store.save(e, span: .thisEvent, commit: true) } catch { fail("couldn't save: \(error.localizedDescription)") }
  out(["id": e.eventIdentifier ?? arg(1)])

case "delete":
  needAccess()
  guard let e = store.event(withIdentifier: arg(1)) else { fail("not found", 4) }
  do { try store.remove(e, span: .thisEvent, commit: true) } catch { fail("couldn't delete: \(error.localizedDescription)") }
  out(["ok": true])

default:
  fail("unknown command \(cmd)")
}
