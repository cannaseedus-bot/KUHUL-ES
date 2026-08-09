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

From the repository root:

1. Add the WebView2 package (if you haven't already):
   dotnet add tools/webview2-smoke-test package Microsoft.Web.WebView2

2. Build and run the smoke test:
   dotnet run --project tools/webview2-smoke-test -- "$(pwd)" 8080

   - First arg: root directory to serve (defaults to current directory)
   - Second arg: port (defaults to 8080)

Example

  dotnet add tools/webview2-smoke-test package Microsoft.Web.WebView2
  dotnet run --project tools/webview2-smoke-test -- . 8080

The app will print PCRE2_STATUS JSON to the console and exit after reporting the result.
