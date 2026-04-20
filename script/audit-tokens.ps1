# audit-tokens.ps1 - PowerShell 7
$ErrorActionPreference = "Continue"
$repo = "C:\Users\oweng\OneDrive\Documents\Projects\wvu-dining-tracker"
Set-Location $repo

function Approx-Tokens([string]$path) {
  if (!(Test-Path $path)) { return 0 }
  $bytes = (Get-Item $path).Length
  [math]::Round($bytes / 4.0)   # ~4 chars/token heuristic
}

Write-Host "`n=== CLAUDE.md ===" -ForegroundColor Cyan
"$(Approx-Tokens "$repo\CLAUDE.md") tokens  ($((Get-Item "$repo\CLAUDE.md").Length) bytes)"

Write-Host "`n=== AGENTS.md ===" -ForegroundColor Cyan
"$(Approx-Tokens "$repo\AGENTS.md") tokens"

Write-Host "`n=== .mcp.json (schema overhead proxy) ===" -ForegroundColor Cyan
Get-Content "$repo\.mcp.json" -Raw | Measure-Object -Character -Line | Format-List
"Approx: $(Approx-Tokens "$repo\.mcp.json") tokens (schema is injected per turn)"

Write-Host "`n=== .claude/ directory scan ===" -ForegroundColor Cyan
Get-ChildItem "$repo\.claude" -Recurse -File |
  Select-Object FullName, Length,
    @{n="Tokens";e={[math]::Round($_.Length/4.0)}} |
  Sort-Object Tokens -Descending | Format-Table -AutoSize

Write-Host "`n=== Directory tree Claude sees on startup ===" -ForegroundColor Cyan
$tracked = git -C $repo ls-files | Measure-Object -Line
"Tracked files: $($tracked.Lines)"
$untracked = Get-ChildItem -Recurse -File -Force |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\dist\\|\\build\\' }
"Non-ignored files on disk: $($untracked.Count)"

Write-Host "`n=== Largest files Claude might auto-read ===" -ForegroundColor Cyan
Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.js,*.json,*.md,*.sql |
  Where-Object { $_.FullName -notmatch 'node_modules|\.git|dist|build' } |
  Sort-Object Length -Descending | Select-Object -First 15 FullName,
    @{n="KB";e={[math]::Round($_.Length/1KB,1)}},
    @{n="~Tokens";e={[math]::Round($_.Length/4.0)}} | Format-Table -AutoSize

Write-Host "`n=== Hook output probe (pre-commit) ===" -ForegroundColor Cyan
if (Test-Path "$repo\.git\hooks\pre-commit") {
  "pre-commit size: $(Approx-Tokens "$repo\.git\hooks\pre-commit") tokens"
}

Write-Host "`n=== Settings ===" -ForegroundColor Cyan
if (Test-Path "$repo\.claude\settings.json") {
  Get-Content "$repo\.claude\settings.json" -Raw
}

Write-Host "`n=== package-lock.json bloat (should be ignored) ===" -ForegroundColor Yellow
"$(Approx-Tokens "$repo\package-lock.json") tokens - NEVER let Claude read this"
