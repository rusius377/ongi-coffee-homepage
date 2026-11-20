# =============================================================
#  온기커피 · 사이트 주소 바꾸기 도구
#  '주소 바꾸기.bat' 을 더블클릭하면 실행돼요.
#  index.html, robots.txt, sitemap.xml 에 들어 있는 사이트 주소를
#  새 주소로 한 번에 바꿉니다. (여러 번 실행해도 괜찮아요)
# =============================================================
param([string]$Root = (Split-Path -Parent $PSScriptRoot), [string]$NewUrl = '')

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$utf8 = New-Object Text.UTF8Encoding $false
$files = 'index.html', 'robots.txt', 'sitemap.xml'

Write-Host ''
Write-Host '  온기커피 · 사이트 주소 바꾸기' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------------------'

# 지금 들어 있는 주소 찾기 (index.html 의 canonical 태그 기준)
$index = [IO.File]::ReadAllText((Join-Path $Root 'index.html'), $utf8)
$m = [regex]::Match($index, '<link rel="canonical" href="(https?://[^/"]+)')
if (-not $m.Success) { Write-Host '  [오류] index.html 에서 지금 주소를 찾지 못했어요.' -ForegroundColor Red; exit 1 }
$old = $m.Groups[1].Value
Write-Host "  지금 주소: $old"

if (-not $NewUrl) {
  Write-Host '  새 주소를 입력하고 Enter 를 누르세요. (예: https://ongi-coffee.vercel.app)'
  $NewUrl = Read-Host '  새 주소'
}
$new = $NewUrl.Trim().TrimEnd('/')
if ($new -notmatch '^https://[a-z0-9-]+(\.[a-z0-9-]+)+$') {
  Write-Host "  [오류] '$NewUrl' 은(는) 올바른 주소가 아니에요." -ForegroundColor Red
  Write-Host '         https:// 로 시작하고, 뒤에 / 나 다른 경로가 없는 주소로 입력해 주세요.'
  Write-Host '         예) https://ongi-coffee.vercel.app   https://www.ongicoffee.com'
  exit 1
}
if ($new -eq $old) { Write-Host '  이미 이 주소로 되어 있어요. 바꿀 것이 없어요.' -ForegroundColor Green; Write-Host ''; exit 0 }

$total = 0
foreach ($name in $files) {
  $path = Join-Path $Root $name
  if (-not (Test-Path $path)) { Write-Host "  [주의] $name 파일이 없어요." -ForegroundColor Yellow; continue }
  $text = [IO.File]::ReadAllText($path, $utf8)
  $count = ([regex]::Matches($text, [regex]::Escape($old))).Count
  if ($count -gt 0) {
    [IO.File]::WriteAllText($path, $text.Replace($old, $new), $utf8)
  }
  Write-Host ("  [바꿈] {0,-12} {1}곳" -f $name, $count) -ForegroundColor Green
  $total += $count
}
Write-Host '  ------------------------------------------------------------'
Write-Host "  완료: $old → $new  (모두 $total 곳)" -ForegroundColor Green
Write-Host '  이제 바뀐 파일을 다시 배포(업로드)해 주세요.'
Write-Host ''
