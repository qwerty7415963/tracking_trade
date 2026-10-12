#Requires -Version 5.1
<#
.SYNOPSIS
  Pull the encrypted restic backup repo from the VPS to this machine.
.DESCRIPTION
  Read-only on the VPS side (scp copy). The repo stays encrypted;
  the restic password never leaves your password manager.
  Run manually or via Task Scheduler when this machine is online.
.EXAMPLE
  .\scripts\pull-backup.ps1 -VpsHost 1.2.3.4 -VpsUser admin
#>
param(
  [Parameter(Mandatory = $true)][string]$VpsHost,
  [Parameter(Mandatory = $true)][string]$VpsUser,
  [string]$SshKey = "$HOME\.ssh\id_ed25519",
  [string]$RemoteRepo = "/var/backups/restic-repo",
  [string]$LocalRoot = ".\backups"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $SshKey)) { throw "SSH key not found: $SshKey" }
$stamp = Get-Date -Format "yyyyMMdd"
$dest = Join-Path $LocalRoot "restic-repo-$stamp"

Write-Output "Testing SSH..."
ssh -i $SshKey -o BatchMode=yes -o ConnectTimeout=10 "$VpsUser@$VpsHost" "echo ok"
if ($LASTEXITCODE -ne 0) { throw "SSH failed" }

Write-Output "Copying repo to $dest ..."
New-Item -ItemType Directory -Path $dest -Force | Out-Null
scp -r -i $SshKey "$VpsUser@${VpsHost}:${RemoteRepo}/*" $dest
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

Write-Output "Pull complete: $dest"
Write-Output "To verify: restic -r $dest check  (needs RESTIC_PASSWORD, monthly drill)"
