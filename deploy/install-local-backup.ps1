$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backupFolder = Join-Path $projectRoot 'local-backups'
if (!(Test-Path -LiteralPath $backupFolder)) { New-Item -ItemType Directory -Path $backupFolder | Out-Null }
if ((Get-Item -LiteralPath $backupFolder).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Backup directory cannot be a junction or link.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$acl = Get-Acl -LiteralPath $backupFolder
$acl.SetAccessRuleProtection($true,$false)
foreach ($existingRule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existingRule) }
foreach ($sid in @($identity.User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')), (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
$accessOnly = New-Object Security.AccessControl.DirectorySecurity
$accessOnly.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access),[Security.AccessControl.AccessControlSections]::Access)
$directory = New-Object IO.DirectoryInfo($backupFolder)
if ($PSVersionTable.PSVersion.Major -ge 6) {
  [IO.FileSystemAclExtensions]::SetAccessControl($directory,$accessOnly)
} else {
  $directory.SetAccessControl($accessOnly)
}
$config = @{
  target='azureuser@20.2.136.131'
  keyPath=('D:\'+[char]0x6587+[char]0x4ef6+'\'+[char]0x5907+[char]0x4efd+'\NNU_key.pem')
  knownHostsPath=[IO.Path]::GetFullPath((Join-Path $projectRoot '..\.azure-known-hosts'))
  sshPath=(Get-Command ssh.exe).Source
  powershellPath=(Get-Command powershell.exe).Source
}
[IO.File]::WriteAllText((Join-Path $backupFolder 'config.json'),($config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
$taskName='NNUCR-LocalBackup'
$runner = Join-Path $projectRoot 'deploy\run-local-backup.vbs'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') -Argument ('//B //Nologo "'+$runner+'"') -WorkingDirectory $projectRoot
$triggers = @((New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours 1)), (New-ScheduledTaskTrigger -AtLogOn -User $identity.Name))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Download and validate one encrypted NNU database backup per day; retain 30, retry hourly while logged in.' -Force | Select-Object TaskName,State
