WebView2 Smoke Test

This is a small WinForms WebView2-based smoke-test that:

- Serves the repository root as a local HTTP server on localhost
- Launches a minimal WebView2 control pointing to http://localhost:8080/index.html
- Injects a script that forwards service-worker messages to the host
- Waits for a PCRE2_STATUS message (from sw.js) and prints the payload

Prerequisites

- .NET 7.0 SDK (or newer) installed
- Microsoft.Web.WebView2 NuGet package (the project does not auto-add it)
- WebView2 Runtime installed on the machine (normal Edge runtime)

Build & run

From this repository root (`C:\Users\canna\_khanary_inspect`):

```powershell
dotnet run --project .\dist\kuhul-es\tools\webview2-smoke-test -- .\dist\kuhul-es 8080
```

Or in `--headless` mode:

```powershell
dotnet run --project .\dist\kuhul-es\tools\webview2-smoke-test -- --headless .\dist\kuhul-es 8080
```

The app will print PCRE2_STATUS JSON to the console and exit after reporting the result.
If the requested port is already in use, it automatically falls forward to the next available localhost port.

Dashboard integration

- `dist\kuhul-es\tools\webgl2-trainer-dashboard.ps1` includes a **Run WebView2 Smoke** button that launches:
  `dist\kuhul-es\tools\webview2-smoke-test\bin\Debug\net8.0-windows\WebView2Smoke.exe`
- Headless smoke mode now terminates cleanly after checks complete and uses a free dynamic port when launched from the dashboard.

**Troubleshooting**
- "The provided file path does not exist" means the supplied root directory argument is wrong.
- If WebView2 initialization fails, verify the Edge WebView2 Runtime is installed.
