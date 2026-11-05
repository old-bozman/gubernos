# Third-party notices

Gubernos includes:

| Software | Where | License |
|---|---|---|
| [yaml](https://github.com/eemeli/yaml) by Eemeli Aro | `node_modules/yaml` (npm dependency), bundled into the iPhone app | ISC |
| [QR Code Generator for JavaScript](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase | `public/vendor/qrcode.js` | MIT |

The full license texts, with Gubernos' own, are in [`public/licenses.txt`](public/licenses.txt); the app shows the same
file under Settings → About → Licenses. Add a row there and here when a new dependency is bundled.

Not bundled, installed on the user's Mac by `scripts/setup.sh` under their own licenses: Node.js, ffmpeg, whisper.cpp
and its models, the GitHub CLI, Tailscale, and the AI model CLIs (Claude Code, Codex).
