# deploy.ps1 - one-shot deploy script for GitHub Pages
$ErrorActionPreference = 'Stop'

Write-Host "Building..." -ForegroundColor Cyan
npm run build

Write-Host "Deploying dist/ to gh-pages branch..." -ForegroundColor Cyan
Push-Location dist
try {
    if (Test-Path .git) { Remove-Item -Recurse -Force .git }
    git init -q
    git checkout -q -b gh-pages
    git add -A
    git commit -q -m "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    git remote add origin (git -C .. remote get-url origin)
    git push -fq origin gh-pages
    Write-Host "Deployed!" -ForegroundColor Green
} finally {
    Pop-Location
}
