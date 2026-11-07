@echo off
REM git credential helper shim, copied to %TEMP% by upload.ps1 and deleted after use.
REM Answer both "Username" and "Password" prompts with the token: GitHub accepts it for both.
echo %DACHU_TOKEN%
