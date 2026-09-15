Option Explicit
Dim shell, files, runner, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
runner = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "run-local-backup.ps1")
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") & """ -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & runner & """"
result = shell.Run(command, 0, True)
WScript.Quit result
