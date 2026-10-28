# Esegui da PowerShell (non serve admin se le attività girano solo con il tuo utente loggato).
$root = (Resolve-Path "$PSScriptRoot\..").Path
$tz = (Get-TimeZone).Id
if ($tz -ne "W. Europe Standard Time") { Write-Warning "Fuso di Windows = '$tz'. L'Utilità di pianificazione usa l'ora locale di Windows: imposta 'W. Europe Standard Time' (Roma) per avere le 09:00 italiane con cambio ora legale automatico." }
$cmd = "$root\scripts\run-scan.cmd"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
# 1) scansione quotidiana alle 09:00 (StartWhenAvailable = se il PC era spento, parte appena possibile)
$a1 = New-ScheduledTaskAction -Execute $cmd -Argument "--scheduled" -WorkingDirectory $root
Register-ScheduledTask -TaskName "Monitor100Siti-0900" -Action $a1 -Trigger (New-ScheduledTaskTrigger -Daily -At 9:00AM) -Settings $settings -Description "Scansione siti WordPress" -Force | Out-Null
# 2) recupero all'accesso: parte solo se oggi, dopo le 09:00, non c'è ancora una run completata
$a2 = New-ScheduledTaskAction -Execute $cmd -Argument "--if-missed" -WorkingDirectory $root
Register-ScheduledTask -TaskName "Monitor100Siti-Recupero" -Action $a2 -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Settings $settings -Description "Recupero scansione mancata" -Force | Out-Null
Write-Host "Attività registrate. Verifica con: Get-ScheduledTask Monitor100Siti*"
