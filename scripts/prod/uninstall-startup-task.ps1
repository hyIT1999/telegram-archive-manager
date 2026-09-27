# Removes the scheduled task "TAM Archive Manager" (see install-startup-task.ps1). The pm2 apps
# keep running until they are stopped (npm run prod:stop).
#   powershell -ExecutionPolicy Bypass -File scripts\prod\uninstall-startup-task.ps1
$ErrorActionPreference = 'Stop'

$taskName = 'TAM Archive Manager'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Removed the scheduled task '$taskName'."
} else {
  Write-Output "There is no scheduled task '$taskName'."
}
