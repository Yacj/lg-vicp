param(
    [Parameter(Mandatory=$true)][string]$ViewPath,
    [Parameter(Mandatory=$true)][string]$PanelPath,
    [Parameter(Mandatory=$true)][string]$PanelClass
)

$ErrorActionPreference = 'Stop'
$content = Get-Content -Raw -Encoding UTF8 $ViewPath

# 1) 去掉 AppPage 导入
$content = $content -replace "import AppPage from '@/components/ui/AppPage\.vue'\r?\n", ""

# 2) 打开标签 <AppPage title=... description=...> -> <div class="...">
$content = $content -replace '<AppPage\s+title="[^"]*"(?:\s+description="[^"]*")?\s*>', ('<div class="' + $PanelClass + '">')

# 3) </AppPage> -> </div>
$content = $content -replace '</AppPage>', '</div>'

# 4) <template #search> ... </template> 内联（去掉包裹并整体左移 2 格）
$pattern = '(?s)[ \t]*<template #search>\r?\n(.*?)\r?\n([ \t]*)</template>'
$content = [regex]::Replace($content, $pattern, {
    param($m)
    $inner = $m.Groups[1].Value
    $lines = $inner -split "`r?`n"
    $dedented = ($lines | ForEach-Object { if ($_.Length -ge 2 -and $_.StartsWith('  ')) { $_.Substring(2) } else { $_ } }) -join "`n"
    $dedented
})

# 5) 面板根样式（若无则追加）
if ($content -notmatch ('\.' + $PanelClass + '\s*\{')) {
    $content = $content -replace '(<style scoped>\r?\n)', ('$1' + ".$PanelClass {`n  display: flex;`n  flex: 1 1 auto;`n  flex-direction: column;`n  gap: var(--vicp-page-gap);`n  min-height: 0;`n}`n")
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($PanelPath, $content, $utf8NoBom)
Write-Output "panel created: $PanelPath"
