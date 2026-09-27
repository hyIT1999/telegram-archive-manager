# Registers the scheduled task "TAM Archive Manager" (Windows, run as Administrator):
# one minute after the machine starts, and every 5 minutes after that, it runs
# scripts/prod/ensure-running.mjs, which starts tam-api and tam-worker in pm2 when they are
# missing (after a reboot) or errored. It runs as the current user whether or not anyone is
# signed in (S4U: no password is stored), so the apps start without an RDP session.
#   powershell -ExecutionPolicy Bypass -File scripts\prod\install-startup-task.ps1
# Remove it with scripts\prod\uninstall-startup-task.ps1; pause it with npm run prod:disable.
$ErrorActionPreference = 'Stop'

$taskName = 'TAM Archive Manager'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root 'scripts\prod\ensure-running.mjs'

$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $script) -WorkingDirectory $root

$atStartup = New-ScheduledTaskTrigger -AtStartup
# PostgreSQL and Redis are Windows services that start with the machine; give them a minute.
$atStartup.Delay = 'PT1M'
# Without -RepetitionDuration the repetition never ends.
$everyFiveMinutes = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)

$user = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName `
  -Description 'Starts the Unofficial Telegram Archive Manager (pm2 apps tam-api and tam-worker) and keeps them running.' `
  -Action $action -Trigger @($atStartup, $everyFiveMinutes) -Principal $principal -Settings $settings `
  -Force | Out-Null

Write-Output "Registered the scheduled task '$taskName' for $user."
Write-Output "Run it now with: Start-ScheduledTask -TaskName '$taskName'"
