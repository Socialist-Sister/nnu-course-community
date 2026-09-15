param(
  [Parameter(Mandatory=$true)][ValidateSet('Encrypt','Decrypt')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$source = [IO.Path]::GetFullPath($InputPath)
$target = [IO.Path]::GetFullPath($OutputPath)
if ($source -eq $target -or [IO.File]::Exists($target)) { throw 'Output must be a new file; existing data will not be overwritten.' }
$prefix = [Text.Encoding]::ASCII.GetBytes("NNUCR-DPAPI-1`n")
$bytes = [IO.File]::ReadAllBytes($source)
if ($Mode -eq 'Encrypt') {
  $payload = [Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $result = New-Object byte[] ($prefix.Length + $payload.Length)
  [Array]::Copy($prefix,0,$result,0,$prefix.Length)
  [Array]::Copy($payload,0,$result,$prefix.Length,$payload.Length)
} else {
  if ($bytes.Length -le $prefix.Length) { throw 'Invalid encrypted backup.' }
  for ($i=0; $i -lt $prefix.Length; $i++) { if ($bytes[$i] -ne $prefix[$i]) { throw 'Unknown backup format.' } }
  $payload = New-Object byte[] ($bytes.Length - $prefix.Length)
  [Array]::Copy($bytes,$prefix.Length,$payload,0,$payload.Length)
  $result = [Security.Cryptography.ProtectedData]::Unprotect($payload,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
}
$stream = [IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $stream.Write($result,0,$result.Length) } finally { $stream.Dispose() }
Write-Output "$Mode completed."
