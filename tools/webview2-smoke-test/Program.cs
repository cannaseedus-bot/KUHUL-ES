using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
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
        static void Main(string[] args)
        {
            var t = new Thread(() => Run(args).GetAwaiter().GetResult());
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
        }

        static async Task Run(string[] args)
        {
            bool headless = args.Contains("--headless");
            string[] filtered = args.Where(a => a != "--headless").ToArray();
            string root = filtered.Length > 0 ? filtered[0] : Directory.GetCurrentDirectory();
            int requestedPort = filtered.Length > 1 && int.TryParse(filtered[1], out var p) ? p : 8080;
            if (requestedPort < 1 || requestedPort > 65535) requestedPort = 8080;
            int port = FindAvailablePort(requestedPort, 32);
            if (port != requestedPort)
            {
                Console.WriteLine($"Requested port {requestedPort} is busy; using {port}.");
            }

            string userDataFolder = Path.Combine(root, ".wv2_data");
            Directory.CreateDirectory(userDataFolder);
            Console.WriteLine($"Serving root: {root} on http://localhost:{port}/");
            Console.WriteLine($"WebView2 userDataFolder: {userDataFolder}");

            using var cts = new CancellationTokenSource();
            var serverTask = Task.Run(() => RunStaticServer(root, port, cts.Token));
            await Task.Delay(150);
            if (serverTask.IsFaulted)
            {
                var startupError = serverTask.Exception?.GetBaseException().Message ?? "unknown startup failure";
                Console.WriteLine("Failed to start static server: " + startupError);
                Environment.ExitCode = 4;
                return;
            }

            if (headless)
            {
                await Task.Delay(500); // let server start
                using var client = new System.Net.Http.HttpClient();
                string url = $"http://localhost:{port}/index.html";
                try
                {
                    var response = await client.GetAsync(url, cts.Token);
                    Console.WriteLine($"HEADLESS status {url}: {(int)response.StatusCode} {response.StatusCode}");
                    var body = await response.Content.ReadAsStringAsync();
                    bool hasSw = body.Contains("navigator.serviceWorker") || body.Contains("sw.js");
                    bool hasManifest = body.Contains("manifest.webmanifest");
                    Console.WriteLine($"HEADLESS index.html checks: serviceWorker={hasSw}, manifest={hasManifest}");
                    if (!response.IsSuccessStatusCode)
                    {
                        Environment.ExitCode = 3;
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("HEADLESS request failed: " + ex.Message);
                    Environment.ExitCode = 3;
                }
                cts.Cancel();
                try
                {
                    await serverTask;
                }
                catch (Exception ex)
                {
                    Console.WriteLine("Static server failed: " + ex.GetBaseException().Message);
                    if (Environment.ExitCode == 0) Environment.ExitCode = 4;
                }
                return;
            }

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
                Environment.ExitCode = 2;
                return;
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
            try
            {
                await serverTask;
            }
            catch (Exception ex)
            {
                Console.WriteLine("Static server failed: " + ex.GetBaseException().Message);
                if (Environment.ExitCode == 0) Environment.ExitCode = 4;
            }
        }

        static void RunStaticServer(string root, int port, CancellationToken token)
        {
            var listener = new HttpListener();
            string prefix = $"http://localhost:{port}/";
            listener.Prefixes.Add(prefix);
            try
            {
                listener.Start();
            }
            catch (HttpListenerException ex)
            {
                throw new InvalidOperationException(
                    $"Unable to bind {prefix} ({ex.Message}).",
                    ex
                );
            }
            Console.WriteLine("Static server listening on " + prefix);
            using var stopRegistration = token.Register(() =>
            {
                try { listener.Stop(); } catch { }
            });
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

        static int FindAvailablePort(int startPort, int attempts)
        {
            int maxPort = Math.Min(65535, startPort + Math.Max(1, attempts) - 1);
            for (int port = startPort; port <= maxPort; port++)
            {
                if (CanBindTcpPort(port)) return port;
            }
            throw new InvalidOperationException(
                $"No available localhost port in range {startPort}-{maxPort}."
            );
        }

        static bool CanBindTcpPort(int port)
        {
            TcpListener? probe = null;
            try
            {
                probe = new TcpListener(IPAddress.Loopback, port);
                probe.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                try { probe?.Stop(); } catch { }
            }
        }

        static void HandleContext(HttpListenerContext ctx, string root)
        {
            try
            {
                HandleContextInner(ctx, root);
            }
            catch (ObjectDisposedException)
            {
                // Listener was closed while a queued request was in flight; ignore.
            }
            catch (Exception ex)
            {
                Console.WriteLine("Serve error: " + ex.Message);
            }
        }

        static void HandleContextInner(HttpListenerContext ctx, string root)
        {
            try
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
                byte[] data = File.ReadAllBytes(filePath);
                resp.ContentType = GetContentType(filePath);
                resp.ContentLength64 = data.Length;
                resp.OutputStream.Write(data, 0, data.Length);
                resp.OutputStream.Close();
            }
            catch (ObjectDisposedException) { /* listener closed mid-request */ }
            catch (HttpListenerException) { /* listener closed mid-request */ }
            catch (Exception ex)
            {
                Console.WriteLine("Serve error: " + ex.Message);
            }
            finally
            {
                try { ctx.Response.Close(); } catch { }
            }
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
