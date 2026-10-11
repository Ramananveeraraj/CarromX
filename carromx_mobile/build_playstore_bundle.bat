@echo off
echo ===================================================
echo   CarromX - Google Play Store Release Builder (.AAB)
echo ===================================================
echo.

set FLUTTER_BIN=C:\flutter\bin\flutter.bat

if not exist "%FLUTTER_BIN%" (
    echo [ERROR] Flutter not found at %FLUTTER_BIN%. Please check your Flutter path.
    pause
    exit /b 1
)

echo [1/3] Fetching project dependencies...
call "%FLUTTER_BIN%" pub get
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to fetch dependencies.
    pause
    exit /b 1
)

echo.
echo [2/3] Building signed Android App Bundle (.aab)...
call "%FLUTTER_BIN%" build appbundle --release
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build failed. Please check Gradle output above.
    pause
    exit /b 1
)

echo.
echo [3/3] Build Successful!
echo ===================================================
echo Your release bundle is ready for Google Play Store upload:
echo Location: build\app\outputs\bundle\release\app-release.aab
echo ===================================================
echo.
pause
