# =============================================================
#  온기커피 · 사진 줄이기 도구
#  -------------------------------------------------------------
#  '사진 줄이기.bat' 을 더블클릭하면 이 파일이 실행돼요.
#  images 폴더의 사진을 홈페이지에 알맞은 크기·용량으로 줄여 줍니다.
#    · 너무 큰 사진  → 권장 크기로 줄이고 500KB 이하로 압축
#    · 휴대폰 사진   → 옆으로 누운 사진을 바로 세우고, 위치정보(GPS) 삭제
#    · PNG/JPEG 파일 → 홈페이지가 쓰는 .jpg 로 변환
#    · hero.jpg 를 바꿨으면 → 휴대폰용 hero-mobile.jpg 자동 생성
#  바꾸기 전 원본은 '_사진원본백업' 폴더에 날짜별로 보관돼요.
#  이미 알맞은 사진은 건드리지 않으니 여러 번 실행해도 괜찮아요.
# =============================================================
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Drawing

$ImagesDir = Join-Path $Root 'images'
$BackupDir = Join-Path $Root ('_사진원본백업\' + (Get-Date -Format 'yyyy-MM-dd_HHmmss'))
$LimitBytes = 500KB

# 사진 종류별 규칙: 이름 패턴 / 최대 가로·세로 / 맞추는 방식(fit=비율 유지, cover=정확히 자르기)
$Rules = @(
  @{ Name = '배너(PC)';      Pattern = '^hero\.(jpe?g|png)$';            W = 1920; H = 1440; Mode = 'fit' },
  @{ Name = '배너(휴대폰)';  Pattern = '^hero-mobile\.(jpe?g|png)$';     W = 900;  H = 1200; Mode = 'fit' },
  @{ Name = '소개';          Pattern = '^about\.(jpe?g|png)$';           W = 1200; H = 1200; Mode = 'fit' },
  @{ Name = '공유 미리보기'; Pattern = '^og-image\.(jpe?g|png)$';        W = 1200; H = 630;  Mode = 'cover' },
  @{ Name = '메뉴';          Pattern = '^menu\\menu-\d+\.(jpe?g|png)$';  W = 800;  H = 800;  Mode = 'fit' },
  @{ Name = '갤러리';        Pattern = '^gallery\\gallery-\d+\.(jpe?g|png)$'; W = 1200; H = 1200; Mode = 'fit' }
)

$script:Changed = 0; $script:Warned = 0

function Write-Line($tag, $color, $text) {
  Write-Host ('  [' + $tag + '] ') -ForegroundColor $color -NoNewline
  Write-Host $text
}
function KB($bytes) { '{0:N0}KB' -f [Math]::Ceiling($bytes / 1KB) }

function Load-Image($path) {
  # 파일을 잠그지 않도록 메모리로 읽어서 열기
  $bytes = [IO.File]::ReadAllBytes($path)
  $ms = New-Object IO.MemoryStream (, $bytes)
  return [System.Drawing.Image]::FromStream($ms, $true, $true)
}

function Get-Orientation($img) {
  if ($img.PropertyIdList -contains 0x0112) { return [int]$img.GetPropertyItem(0x0112).Value[0] }
  return 1
}
function Has-Gps($img) {
  foreach ($id in $img.PropertyIdList) { if ($id -eq 0x8825 -or ($id -ge 0x0000 -and $id -le 0x001F)) { return $true } }
  return $false
}

function Fix-Orientation($img, [int]$o) {
  switch ($o) {
    2 { $img.RotateFlip('RotateNoneFlipX') }
    3 { $img.RotateFlip('Rotate180FlipNone') }
    4 { $img.RotateFlip('Rotate180FlipX') }
    5 { $img.RotateFlip('Rotate90FlipX') }
    6 { $img.RotateFlip('Rotate90FlipNone') }
    7 { $img.RotateFlip('Rotate270FlipX') }
    8 { $img.RotateFlip('Rotate270FlipNone') }
  }
}

# 새 그림으로 다시 그리기 (사진 정보·위치정보는 여기서 모두 빠져요)
function Render($img, [int]$w, [int]$h, $mode) {
  $sw = $img.Width; $sh = $img.Height
  $src = New-Object System.Drawing.Rectangle 0, 0, $sw, $sh
  if ($mode -eq 'cover') {
    $targetRatio = $w / $h
    if ($sw / $sh -gt $targetRatio) { $cw = [int]($sh * $targetRatio); $src = New-Object System.Drawing.Rectangle ([int](($sw - $cw) / 2)), 0, $cw, $sh }
    else { $ch = [int]($sw / $targetRatio); $src = New-Object System.Drawing.Rectangle 0, ([int](($sh - $ch) / 2)), $sw, $ch }
  }
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#FAF6F0'))   # 투명한 PNG 바탕은 크림색으로
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'
  $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode('TileFlipXY')
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $src.X, $src.Y, $src.Width, $src.Height, 'Pixel', $attr)
  $g.Dispose()
  return $bmp
}

function Encode-Jpeg($bmp, [long]$quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $quality
  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, $codec, $ep)
  return , $ms.ToArray()
}

# 목표 크기 계산 → 500KB 이하가 될 때까지 화질을 조금씩 낮추고, 그래도 크면 크기를 줄여요
function Make-Jpeg($img, $rule) {
  $sw = $img.Width; $sh = $img.Height
  if ($rule.Mode -eq 'cover') { $w = $rule.W; $h = $rule.H }
  else {
    $scale = [Math]::Min(1.0, [Math]::Min($rule.W / $sw, $rule.H / $sh))
    $w = [Math]::Max(1, [int][Math]::Round($sw * $scale)); $h = [Math]::Max(1, [int][Math]::Round($sh * $scale))
  }
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    $bmp = Render $img $w $h $rule.Mode
    foreach ($q in 85, 80, 75, 70, 65, 60) {
      $bytes = Encode-Jpeg $bmp $q
      if ($bytes.Length -le $LimitBytes) { $bmp.Dispose(); return @{ Bytes = $bytes; W = $w; H = $h; Q = $q } }
    }
    $bmp.Dispose()
    $w = [int]($w * 0.85); $h = [int]($h * 0.85)
  }
  return @{ Bytes = $bytes; W = $w; H = $h; Q = 60 }
}

function Backup-File($path) {
  $rel = $path.Substring($Root.Length + 1)
  $dest = Join-Path $BackupDir $rel
  New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
  Copy-Item -LiteralPath $path -Destination $dest -Force
}

Write-Host ''
Write-Host '  온기커피 · 사진 줄이기' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------------------'

if (-not (Test-Path $ImagesDir)) { Write-Line '오류' Red "images 폴더를 찾을 수 없어요: $ImagesDir"; exit 1 }

# 휴대폰용 배너 자동 생성 기록 (hero.jpg 와 자동으로 만든 hero-mobile.jpg 의 '지문')
$StateFile = Join-Path $PSScriptRoot 'hero-mobile.state'
function Get-Fingerprint($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

$files = Get-ChildItem $ImagesDir -Recurse -File | Where-Object { $_.Name -notlike 'favicon*' } | Sort-Object FullName
foreach ($f in $files) {
  if (-not (Test-Path -LiteralPath $f.FullName)) { continue }   # 앞에서 이미 정리된 파일
  $f = Get-Item -LiteralPath $f.FullName                         # 앞 단계에서 바뀌었을 수 있으니 다시 읽기
  $rel = $f.FullName.Substring($ImagesDir.Length + 1)
  $ext = $f.Extension.ToLower()

  if ($ext -in '.heic', '.heif', '.webp', '.gif', '.bmp', '.tif', '.tiff') {
    Write-Line '주의' Yellow "$rel → 이 형식($ext)은 바꿀 수 없어요. JPG로 저장해서 다시 넣어 주세요."
    if ($ext -in '.heic', '.heif') { Write-Host '         (아이폰: 설정 > 카메라 > 포맷 > "높은 호환성" 으로 찍으면 JPG로 저장돼요)' }
    $script:Warned++; continue
  }
  if ($ext -notin '.jpg', '.jpeg', '.png') { continue }

  $rule = $null
  foreach ($r in $Rules) { if ($rel -match $r.Pattern) { $rule = $r; break } }
  if (-not $rule) {
    Write-Line '주의' Yellow "$rel → 홈페이지에서 쓰지 않는 이름이에요. (예: menu\menu-01.jpg 처럼 정해진 이름으로 바꿔 주세요)"
    $script:Warned++; continue
  }

  # 서버(Vercel)는 대소문자를 구분하므로 파일 이름은 항상 소문자 + .jpg 로 맞춰요
  $target = Join-Path $f.DirectoryName ($f.BaseName.ToLower() + '.jpg')
  $wrongName = $f.Name -cne [IO.Path]::GetFileName($target)
  try { $img = Load-Image $f.FullName } catch { Write-Line '오류' Red "$rel → 사진을 열 수 없어요. 파일이 손상됐을 수 있어요."; $script:Warned++; continue }

  $orient = Get-Orientation $img
  $gps = Has-Gps $img
  $tooBig = ($rule.Mode -eq 'fit' -and ($img.Width -gt $rule.W -or $img.Height -gt $rule.H)) -or
            ($rule.Mode -eq 'cover' -and ($img.Width -ne $rule.W -or $img.Height -ne $rule.H))
  $tooHeavy = $f.Length -gt $LimitBytes
  $isPng = $ext -eq '.png'

  if (-not ($tooBig -or $tooHeavy -or $isPng -or $orient -ne 1 -or $gps)) {
    if ($wrongName) {
      # 사진은 괜찮고 이름만 다를 때(예: MENU-01.JPG, menu-01.jpeg) → 다시 압축하지 않고 이름만 바꾸기
      $img.Dispose()
      # 윈도우는 대소문자를 구분하지 않아서, 대소문자만 다른 이름은 같은 파일이에요
      if ((Test-Path -LiteralPath $target) -and ($target -ine $f.FullName)) { Backup-File $target; Remove-Item -LiteralPath $target -Force }
      $tmp = $f.FullName + '.rename-tmp'
      Move-Item -LiteralPath $f.FullName -Destination $tmp -Force
      Move-Item -LiteralPath $tmp -Destination $target -Force
      Write-Line '이름' Green ("$rel → " + $target.Substring($ImagesDir.Length + 1) + '  (파일 이름만 정리)')
      $script:Changed++; continue
    }
    Write-Line '그대로' DarkGray ("$rel  " + (KB $f.Length) + "  $($img.Width)×$($img.Height)")
    $img.Dispose(); continue
  }

  $before = (KB $f.Length) + " $($img.Width)×$($img.Height)"
  $notes = @()
  if ($orient -ne 1) { Fix-Orientation $img $orient; $notes += '방향 바로잡음' }
  if ($gps) { $notes += '위치정보 삭제' }
  if ($wrongName) { $notes += ($f.Name + ' → ' + [IO.Path]::GetFileName($target)) }

  $out = Make-Jpeg $img $rule
  $img.Dispose()

  $origTime = $f.LastWriteTime
  Backup-File $f.FullName
  if ((Test-Path -LiteralPath $target) -and ($target -ine $f.FullName)) { Backup-File $target }
  Remove-Item -LiteralPath $f.FullName -Force          # 원본은 이미 백업됨
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  [IO.File]::WriteAllBytes($target, $out.Bytes)       # 소문자 이름으로 새로 저장
  # 원래 수정 시각 유지 (다음 실행 때 '새로 넣은 사진' 판단이 틀리지 않도록)
  (Get-Item -LiteralPath $target).LastWriteTime = $origTime

  $relT = $target.Substring($ImagesDir.Length + 1)
  $noteText = ''; if ($notes.Count) { $noteText = '  (' + ($notes -join ', ') + ')' }
  Write-Line '줄임' Green ("$relT  $before → " + (KB $out.Bytes.Length) + " $($out.W)×$($out.H)$noteText")
  $script:Changed++
}

# hero.jpg 가 바뀌었으면 → 휴대폰용 세로 사진(900×1200)을 가운데에서 잘라 자동으로 만들기
#   · hero-mobile.jpg 가 '자동으로 만든 것(또는 처음 임시 사진)'일 때만 새로 만들어요
#   · 사장님이 직접 넣은 hero-mobile.jpg 는 절대 덮어쓰지 않아요
$heroJpg = Join-Path $ImagesDir 'hero.jpg'
$mobileJpg = Join-Path $ImagesDir 'hero-mobile.jpg'
if (Test-Path $heroJpg) {
  $state = @{}
  if (Test-Path $StateFile) { Get-Content $StateFile | ForEach-Object { $k, $v = $_ -split '=', 2; if ($v) { $state[$k] = $v } } }
  $heroFp = Get-Fingerprint $heroJpg
  $mobileExists = Test-Path $mobileJpg
  $mobileIsAuto = $mobileExists -and $state['mobile'] -and ((Get-Fingerprint $mobileJpg) -eq $state['mobile'])

  if ((-not $mobileExists) -or ($mobileIsAuto -and $heroFp -ne $state['source'])) {
    $img = Load-Image $heroJpg
    $out = Make-Jpeg $img @{ W = 900; H = 1200; Mode = 'cover' }
    $img.Dispose()
    if ($mobileExists) { Backup-File $mobileJpg }
    [IO.File]::WriteAllBytes($mobileJpg, $out.Bytes)
    Set-Content -LiteralPath $StateFile -Encoding ASCII -Value @("source=$heroFp", ('mobile=' + (Get-Fingerprint $mobileJpg)))
    Write-Line '새로' Cyan ("hero-mobile.jpg  hero.jpg 가운데를 세로로 잘라 휴대폰용 생성 → " + (KB $out.Bytes.Length) + " 900×1200")
    Write-Host '         (휴대폰에서 보이는 부분을 직접 고르고 싶으면 hero-mobile.jpg 를 직접 넣고 다시 실행하세요)'
    $script:Changed++
  }
  elseif ($mobileExists -and -not $mobileIsAuto -and $state['source'] -and $heroFp -ne $state['source']) {
    Write-Line '안내' Cyan 'hero.jpg 가 바뀌었지만, 직접 넣은 hero-mobile.jpg 가 있어서 그대로 뒀어요.'
    Write-Host '         (휴대폰용도 hero.jpg 에서 자동으로 만들려면 hero-mobile.jpg 를 지우고 다시 실행하세요)'
    $state['source'] = $heroFp
    Set-Content -LiteralPath $StateFile -Encoding ASCII -Value @("source=$heroFp", ('mobile=' + $state['mobile']))
  }
}

Write-Host '  ------------------------------------------------------------'
if ($script:Changed -gt 0) {
  Write-Host ("  완료: 사진 $($script:Changed)장을 정리했어요. 원본은 여기에 있어요:") -ForegroundColor Green
  Write-Host ("  $BackupDir")
} else {
  Write-Host '  완료: 바꿀 사진이 없어요. 모두 알맞은 크기예요.' -ForegroundColor Green
}
if ($script:Warned -gt 0) { Write-Host ("  확인이 필요한 파일이 $($script:Warned)개 있어요. 위의 [주의] 줄을 봐 주세요.") -ForegroundColor Yellow }
Write-Host ''
