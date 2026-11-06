# Windows (Gubernos in WSL): keep Windows from sleeping while it's plugged in, like `caffeinate -s` on a Mac. The screen
# still turns off. scripts/setup.sh awake on copies this to %LOCALAPPDATA%\Gubernos and starts it with Windows (hidden).
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Gubernos -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$CONTINUOUS = [uint32]'0x80000000'; $SYSTEM = [uint32]'0x00000001'
while ($true) {
  if ([System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus -ne 'Offline') {
    [void][Gubernos.Power]::SetThreadExecutionState($CONTINUOUS -bor $SYSTEM)   # plugged in (or no battery): stay awake
  } else {
    [void][Gubernos.Power]::SetThreadExecutionState($CONTINUOUS)                 # on battery: sleep as usual
  }
  Start-Sleep -Seconds 60
}
