@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Run explicitly before starting the app. The app never invokes this build script.
set "YTRP_FRAMEWORK_DIR=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319"
if not exist "%YTRP_FRAMEWORK_DIR%\csc.exe" set "YTRP_FRAMEWORK_DIR=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319"
if not exist "%YTRP_FRAMEWORK_DIR%\csc.exe" (
    echo ERROR: The .NET Framework 4 C# compiler is not installed.
    exit /b 1
)

"%YTRP_FRAMEWORK_DIR%\csc.exe" /nologo /target:exe /platform:anycpu /optimize+ /warnaserror+ /reference:"%YTRP_FRAMEWORK_DIR%\System.Web.Extensions.dll" /out:"%~dp0WindowDiagnostics.exe" "%~dp0WindowDiagnostics.cs"
if errorlevel 1 (
    echo ERROR: Window diagnostics build failed. Close all app instances before rebuilding.
    exit /b 1
)

echo Built "%~dp0WindowDiagnostics.exe". Deploy it together with WindowDiagnostics.js.
exit /b 0
