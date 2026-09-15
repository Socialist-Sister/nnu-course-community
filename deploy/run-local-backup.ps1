$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
& 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'local-backup.mjs')
exit $LASTEXITCODE
