# Cleanup orphaned comments
$filePath = 'c:\dev\finance-analyzer_2\src\js\app.ts'
$lines = Get-Content $filePath
$newLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $idx = $i + 1  # 1-based
    # Skip line 48: /** Агент Director для чата */ (orphaned comment)
    if ($idx -eq 48) { continue }
    # Skip line 120: empty line after Director comment block
    if ($idx -eq 120) { continue }
    $newLines += $lines[$i]
}
$newLines | Set-Content $filePath -Encoding UTF8
Write-Host "Done. New line count: $($newLines.Count)"
