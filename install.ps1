# Gubernos for Windows in one line, in PowerShell:
#   irm https://gubernos.app/install.ps1 | iex
# Gubernos runs in WSL (Windows' own Linux). This gets WSL and Ubuntu when they're missing (Windows asks for an
# administrator's OK, then a restart and a Linux user name), then runs the Linux install (install.sh --wizard) inside
# Ubuntu: the setup page opens in the Windows browser. Safe to run again: each time it does the next step that's missing.
# GUBERNOS_DRY=1: say what it would run, run nothing (for checking it on a machine).
$ErrorActionPreference = 'Continue' # 'Stop' turns a native program's stderr into an error in Windows PowerShell 5.1
$env:WSL_UTF8 = '1' # wsl.exe answers in UTF-16 otherwise
$dry = $env:GUBERNOS_DRY -eq '1'
$line = 'curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash -s -- --wizard'

function Say($text) { Write-Host $text -ForegroundColor Cyan }
function Stop-With($text) { Write-Host ''; Write-Host $text -ForegroundColor Yellow; Write-Host ''; return }

Write-Host ''
Write-Host 'Gubernos for Windows' -ForegroundColor White

# WSL needs Windows 10 version 2004 (build 19041) or later
if ([Environment]::OSVersion.Version.Build -lt 19041) {
  Stop-With 'This Windows is too old for WSL. Update Windows (Settings > Windows Update), then run this again.'; return
}

# a Ubuntu in WSL, if there is one (the Microsoft Store's is "Ubuntu"; also "Ubuntu-24.04" and such)
function Find-Ubuntu {
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return $null }
  $names = & wsl.exe --list --quiet 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $names) { return $null }
  $names | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ -like 'Ubuntu*' } | Select-Object -First 1
}
$distro = Find-Ubuntu

if (-not $distro) {
  Say '  WSL with Ubuntu is not here yet: installing it. Windows asks for an administrator''s OK.'
  if ($dry) { Write-Host '  [dry] Start-Process wsl.exe --install -d Ubuntu -Verb RunAs -Wait'; return }
  try { Start-Process wsl.exe -ArgumentList '--install', '-d', 'Ubuntu' -Verb RunAs -Wait }
  catch { Stop-With 'Windows didn''t get the OK to install WSL. Run this again and choose Yes.'; return }
  Stop-With @'
Next:
  1. Restart the computer (if Windows asked for it).
  2. A Ubuntu window opens (or open Ubuntu from the Start menu): choose a user name and a password for Linux.
     The password doesn't show while you type. Remember it.
  3. Then run the same command here again:  irm https://gubernos.app/install.ps1 | iex
'@
  return
}
Say "  Ubuntu in WSL: $distro"

# a Ubuntu whose first start wasn't finished has no user yet (it would install as root)
$uid = (& wsl.exe -d $distro -e id -u 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $uid -eq '') {
  Stop-With "Ubuntu doesn't start yet. Restart the computer, open Ubuntu from the Start menu once, then run this again."; return
}
if ($uid -eq '0') {
  Stop-With 'Ubuntu has no user of its own yet. Open Ubuntu from the Start menu, choose a user name and a password, then run this again.'; return
}

Say '  Installing Gubernos in Ubuntu. The setup page opens in your browser.'
if ($dry) { Write-Host "  [dry] wsl.exe -d $distro -- bash -lc `"$line`""; return }
& wsl.exe -d $distro -- bash -lc $line
