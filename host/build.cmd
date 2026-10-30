@echo off
setlocal
rem ================================================================
rem  Arch Canvas WebView2 single-file portable build
rem  - needs: ..\dist\index.html (npm run build 먼저)
rem  - compiler: Roslyn csc from VS 2022 Build Tools (fallback: .NET Framework csc)
rem  - target  : .NET Framework 4.8 / x64 / WinExe
rem  - output  : ..\release\Arch_Canvas_v%VER%\Arch Canvas.exe  (everything embedded)
rem ================================================================
set "VER=0.9.15"
set "SRC=%~dp0"
set "OBJ=%SRC%obj"
set "OUT=%SRC%..\release\Arch_Canvas_v%VER%"

set "CSC=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"
if not exist "%CSC%" set "CSC=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe"
if not exist "%CSC%" set "CSC=%ProgramFiles%\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" ( echo csc.exe not found & exit /b 1 )
echo [csc] %CSC%

set "FX=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319"
if not exist "%SRC%..\dist\index.html" ( echo dist\index.html not found - run "npm run build" first & exit /b 1 )

rem keep OUT: data next to the exe holds user templates and keys
if exist "%OBJ%" rmdir /s /q "%OBJ%"
if not exist "%OUT%" mkdir "%OUT%"
mkdir "%OBJ%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%build_res.ps1" -Src "%SRC%." -Obj "%OBJ%" -Out "%OUT%" -Ver "%VER%"
if errorlevel 1 ( echo RESOURCE STEP FAILED & exit /b 1 )

"%CSC%" /nologo /target:winexe /platform:x64 /optimize+ /langversion:latest ^
  /out:"%OUT%\Arch Canvas.exe" ^
  /win32manifest:"%SRC%app.manifest" ^
  /win32icon:"%SRC%app.ico" ^
  /r:"%FX%\System.dll" /r:"%FX%\System.Core.dll" /r:"%FX%\System.Drawing.dll" /r:"%FX%\System.Windows.Forms.dll" ^
  /r:"%FX%\Microsoft.CSharp.dll" /r:"%FX%\System.IO.Compression.dll" /r:"%FX%\System.Web.Extensions.dll" /r:"%FX%\System.Security.dll" /r:"%FX%\System.Management.dll" ^
  /r:"%SRC%lib\Microsoft.Web.WebView2.Core.dll" /r:"%SRC%lib\Microsoft.Web.WebView2.WinForms.dll" ^
  @"%OBJ%\resources.rsp" ^
  "%SRC%Program.cs"
if errorlevel 1 ( echo BUILD FAILED & exit /b 1 )

rmdir /s /q "%OBJ%"
echo.
echo DONE: %OUT%
endlocal
