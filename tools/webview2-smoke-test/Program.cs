using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

// NOTE: This program requires the Microsoft.Web.WebView2 NuGet package.
// Install it with:
//   dotnet add package Microsoft.Web.WebView2

// Usage:
//   dotnet run --project tools/webview2-smoke-test -- [rootDir] [port]

namespace WebView2SmokeTest
{
    static class Program
    {
        [STAThread]
        static async Task<int> Main(string[] args)
        {
            string root = args.Length > 0 ? args[0] : Directory.GetCurrentDirectory();
            int port = args.Length > 1 && int.TryParse(args[1], out var p) ? p : 8080;

            string userDataFolder = @"C:\Users\canna\\.NNC-K\\bin\\wv2_data"; // default provided path
            Console.WriteLine($"Serving root: {root} on http://localhost:{port}/");
            Console.WriteLine($"WebView2 userDataFolder: {userDataFolder}");

            using var cts = new CancellationTokenSource();
            var serverTask = Task.Run(() => RunStaticServer(root, port, cts.Token));

            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var tcs = new TaskCompletionSource<string?>();

            var form = new Form() { Width = 1200, Height = 800, Text = "KUHUL-ES SW Smoke Test" };

            // Create WebView2 control dynamically to avoid designer artifacts
            var webView = new Microsoft.Web.WebView2.WinForms.WebView2()
            {
                Dock = DockStyle.Fill
            };
            form.Controls.Add(webView);

            webView.CoreWebView2InitializationCompleted += async (s, e) =>
            {
                if (e.IsSuccess)
                {
                    Console.WriteLine("WebView2 initialized.");
                    // Inject a script to forward service worker messages to host
                    string injection = @"
(function() {
  function forward(data) {
    try { window.chrome.webview.postMessage(JSON.stringify(data)); } catch(e) {}
  }
  if (navigator && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function(e) { forward(e.data); });
  }
  window.addEventListener('message', function(e){ if (e && e.data) forward(e.data); }, false);
})();
";
                    await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(injection);

                    webView.CoreWebView2.WebMessageReceived += (sender, ev) =>
                    {
                        try
                        {
                            var json = ev.TryGetWebMessageAsString();
                            if (string.IsNullOrEmpty(json)) return;
                            using var doc = JsonDocument.Parse(json);
                            var rootElem = doc.RootElement;
                            if (rootElem.ValueKind == JsonValueKind.Object && rootElem.TryGetProperty("type", out var t))
                            {
                                if (t.GetString() == "PCRE2_STATUS")
                                {
                                    Console.WriteLine("PCRE2_STATUS from SW: " + json);
                                    tcs.TrySetResult(json);
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine("Failed to parse message: " + ex.Message);
                        }
                    };

                    // Navigate
                    var url = $"http://localhost:{port}/index.html";
                    Console.WriteLine("Navigating to " + url);
                    webView.CoreWebView2.Navigate(url);
                }
                else
                {
                    Console.WriteLine("WebView2 initialization failed: " + e.InitializationException?.Message);
                    tcs.TrySetResult(null);
                }
            };

            // Create environment with userDataFolder
            try
            {
                var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Failed to create WebView2 environment: " + ex.Message);
                return 2;
            }

            // Run the form in a separate task so we can await the tcs
            var uiTask = Task.Run(() => Application.Run(form));

            // Wait for PCRE2_STATUS or timeout
            var completed = await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(40)));
            if (completed == tcs.Task)
            {
                var payload = await tcs.Task;
                Console.WriteLine("Result: " + payload);
            }
            else
            {
                Console.WriteLine("Timeout waiting for PCRE2_STATUS");
            }

            // Close form and stop server
            try { form.BeginInvoke((Action)(() => form.Close())); } catch { }
            cts.Cancel();
            await serverTask;
            return 0;
        }

        static void RunStaticServer(string root, int port, CancellationToken token)
        {
            var listener = new HttpListener();
            string prefix = $"http://localhost:{port}/";
            listener.Prefixes.Add(prefix);
            listener.Start();
            Console.WriteLine("Static server listening on " + prefix);
            while (!token.IsCancellationRequested)
            {
                try
                {
                    var ctx = listener.GetContext();
                    Task.Run(() => HandleContext(ctx, root));
                }
                catch (HttpListenerException) { break; }
                catch (Exception ex)
                {
                    Console.WriteLine("Server error: " + ex.Message);
                }
            }
            listener.Close();
            Console.WriteLine("Static server stopped.");
        }

        static void HandleContext(HttpListenerContext ctx, string root)
        {
            var req = ctx.Request;
            var resp = ctx.Response;
            string urlPath = WebUtility.UrlDecode(req.Url.AbsolutePath.TrimStart('/'));
            if (string.IsNullOrEmpty(urlPath)) urlPath = "index.html";
            var filePath = Path.Combine(root, urlPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(filePath))
            {
                resp.StatusCode = 404;
                var buf = Encoding.UTF8.GetBytes("Not found");
                resp.OutputStream.Write(buf, 0, buf.Length);
                resp.Close();
                return;
            }
            try
            {
                byte[] data = File.ReadAllBytes(filePath);
                resp.ContentType = GetContentType(filePath);
                resp.ContentLength64 = data.Length;
                resp.OutputStream.Write(data, 0, data.Length);
                resp.OutputStream.Close();
            }
            catch (Exception ex)
            {
                Console.WriteLine("Serve error: " + ex.Message);
            }
            finally { resp.Close(); }
        }

        static string GetContentType(string path)
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            return ext switch
            {
                ".html" => "text/html",
                ".js" => "application/javascript",
                ".mjs" => "application/javascript",
                ".wasm" => "application/wasm",
                ".json" => "application/json",
                ".css" => "text/css",
                ".png" => "image/png",
                ".jpg" => "image/jpeg",
                _ => "application/octet-stream",
            };
        }
    }
}
