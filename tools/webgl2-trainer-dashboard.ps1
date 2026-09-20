#Requires -Version 5.1

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:ServerBaseUrl = 'http://127.0.0.1:8764'
$script:CurrentSessionId = ''
$script:EventCursor = 0
$script:IsBusy = $false
$script:NativeProcess = $null

$script:WebView2SmokeExe = Join-Path $PSScriptRoot 'webview2-smoke-test\bin\Debug\net8.0-windows\WebView2Smoke.exe'
$script:KuhulEsCli = Join-Path $script:RepoRoot 'bin\kuhul-es.js'
$script:PyTrainer   = Join-Path $script:RepoRoot 'tools\pi_kuhul_train.py'

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="KUHUL WebGL2 Trainer Dashboard"
        Height="860" Width="1200" MinHeight="700" MinWidth="980"
        WindowStartupLocation="CenterScreen"
        Background="#0D1117" FontFamily="Consolas">
  <Window.Resources>
    <Style x:Key="ExplicitComboBoxItemStyle" TargetType="{x:Type ComboBoxItem}">
      <Setter Property="Foreground" Value="#0D1117"/>
      <Setter Property="Background" Value="#E6EDF3"/>
      <Setter Property="Padding" Value="8,4"/>
      <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="{x:Type ComboBoxItem}">
            <Border x:Name="ItemBorder" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
              <ContentPresenter/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsHighlighted" Value="True">
                <Setter TargetName="ItemBorder" Property="Background" Value="#1F6FEB"/>
                <Setter Property="Foreground" Value="#FFFFFF"/>
              </Trigger>
              <Trigger Property="IsSelected" Value="True">
                <Setter TargetName="ItemBorder" Property="Background" Value="#39FF14"/>
                <Setter Property="Foreground" Value="#0D1117"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="ExplicitComboBoxStyle" TargetType="{x:Type ComboBox}">
      <Setter Property="Foreground" Value="#0D1117"/>
      <Setter Property="Background" Value="#E6EDF3"/>
      <Setter Property="BorderBrush" Value="#30363D"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="8,4"/>
      <Setter Property="ItemContainerStyle" Value="{StaticResource ExplicitComboBoxItemStyle}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="{x:Type ComboBox}">
            <Grid>
              <ToggleButton x:Name="ToggleButton" Focusable="False" IsChecked="{Binding IsDropDownOpen, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}">
                <Border x:Name="ComboBorder" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}">
                  <Grid>
                    <Grid.ColumnDefinitions>
                      <ColumnDefinition Width="*"/>
                      <ColumnDefinition Width="24"/>
                    </Grid.ColumnDefinitions>
                    <ContentPresenter Grid.Column="0"
                                      Margin="8,0,4,0"
                                      VerticalAlignment="Center"
                                      HorizontalAlignment="Left"
                                      Content="{TemplateBinding SelectionBoxItem}"
                                      ContentTemplate="{TemplateBinding SelectionBoxItemTemplate}"/>
                    <Border Grid.Column="1" Background="#D0D7DE" BorderBrush="#30363D" BorderThickness="1,0,0,0">
                      <Path Data="M 0 0 L 4 4 L 8 0 Z" Fill="#0D1117"
                            HorizontalAlignment="Center" VerticalAlignment="Center"/>
                    </Border>
                  </Grid>
                </Border>
              </ToggleButton>
              <Popup x:Name="Popup"
                     Placement="Bottom"
                     IsOpen="{TemplateBinding IsDropDownOpen}"
                     AllowsTransparency="True"
                     Focusable="False"
                     PopupAnimation="Fade">
                <Border Background="#E6EDF3" BorderBrush="#30363D" BorderThickness="1">
                  <ScrollViewer CanContentScroll="True" SnapsToDevicePixels="True">
                    <StackPanel IsItemsHost="True" KeyboardNavigation.DirectionalNavigation="Contained"/>
                  </ScrollViewer>
                </Border>
              </Popup>
            </Grid>
            <ControlTemplate.Triggers>
              <Trigger Property="IsKeyboardFocusWithin" Value="True">
                <Setter TargetName="ComboBorder" Property="BorderBrush" Value="#39FF14"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="ComboBorder" Property="Opacity" Value="0.55"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid Margin="12">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
    </Grid.RowDefinitions>

    <Border Grid.Row="0" Background="#161B22" BorderBrush="#30363D" BorderThickness="1" CornerRadius="8" Padding="10">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>

        <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
          <Image x:Name="LogoImage" Width="28" Height="28" Margin="0,0,8,0" VerticalAlignment="Center"
                 RenderOptions.BitmapScalingMode="HighQuality"/>
          <TextBlock Text="KUHUL WebGL2 Trainer" Foreground="#E6EDF3" FontSize="13" FontWeight="Bold"
                     VerticalAlignment="Center" Margin="0,0,20,0"/>
          <TextBlock Text="KUHUL Server:" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
          <TextBox x:Name="ServerUrlBox" Width="260" Height="30"
                   Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"
                   Text="http://127.0.0.1:8764"/>
          <Ellipse x:Name="ServerDot" Width="10" Height="10" Fill="#DA3633" Margin="12,0,6,0" VerticalAlignment="Center"/>
          <TextBlock x:Name="ServerStatusText" Text="Disconnected" Foreground="#39FF14" VerticalAlignment="Center"/>
        </StackPanel>

        <Button x:Name="CheckServerBtn" Grid.Column="1" Content="Check Server"
                Margin="8,0,0,0" Padding="12,6" Height="30"
                Background="#1F6FEB" Foreground="White" BorderThickness="0" Cursor="Hand"/>

        <Button x:Name="SmokeBtn" Grid.Column="2" Content="Run WebView2 Smoke"
                Margin="8,0,0,0" Padding="12,6" Height="30"
                Background="#238636" Foreground="White" BorderThickness="0" Cursor="Hand"/>
      </Grid>
    </Border>

    <Border Grid.Row="1" Margin="0,10,0,0" Background="#161B22" BorderBrush="#30363D" BorderThickness="1" CornerRadius="8" Padding="10">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="120"/>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="130"/>
          <ColumnDefinition Width="220"/>
        </Grid.ColumnDefinitions>
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <TextBlock Grid.Row="0" Grid.Column="0" Text="Input model" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="InputBox" Grid.Row="0" Grid.Column="1" Height="28" Margin="0,0,8,6"
                 Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
        <TextBlock Grid.Row="0" Grid.Column="2" Text="Browser" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <ComboBox x:Name="BrowserBox" Grid.Row="0" Grid.Column="3" Height="28" Margin="0,0,0,6"
                  Style="{StaticResource ExplicitComboBoxStyle}">
          <ComboBoxItem Content="auto" IsSelected="True"/>
          <ComboBoxItem Content="edge"/>
          <ComboBoxItem Content="chrome"/>
        </ComboBox>

        <TextBlock Grid.Row="1" Grid.Column="0" Text="Output model" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="OutputBox" Grid.Row="1" Grid.Column="1" Height="28" Margin="0,0,8,6"
                 Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
        <TextBlock Grid.Row="1" Grid.Column="2" Text="Tensor (optional)" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="TensorBox" Grid.Row="1" Grid.Column="3" Height="28" Margin="0,0,0,6"
                 Text="" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>

        <TextBlock Grid.Row="2" Grid.Column="0" Text="XJSL output" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="XjslOutBox" Grid.Row="2" Grid.Column="1" Height="28" Margin="0,0,8,6"
                 Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
        <TextBlock Grid.Row="2" Grid.Column="2" Text="Train dim" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="TrainDimBox" Grid.Row="2" Grid.Column="3" Height="28" Margin="0,0,0,6"
                 Text="1024" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>

        <TextBlock Grid.Row="3" Grid.Column="0" Text="Token bins" Foreground="#8B949E" VerticalAlignment="Top" Margin="0,0,8,0"/>
        <TextBox x:Name="TokenBinsBox" Grid.Row="3" Grid.Column="1" Grid.RowSpan="2" Height="62" Margin="0,0,8,6"
                 AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto"
                 Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
        <TextBlock Grid.Row="3" Grid.Column="2" Text="Batch" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="BatchBox" Grid.Row="3" Grid.Column="3" Height="28" Margin="0,0,0,6"
                 Text="16" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
        <TextBlock Grid.Row="4" Grid.Column="2" Text="Steps" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="StepsBox" Grid.Row="4" Grid.Column="3" Height="28" Margin="0,0,0,6"
                 Text="300" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>

        <TextBlock Grid.Row="5" Grid.Column="0" Text="Learning rate" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="LrBox" Grid.Row="5" Grid.Column="1" Height="28" Margin="0,0,8,6"
                 Text="0.00035" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
        <TextBlock Grid.Row="5" Grid.Column="2" Text="Seed" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="SeedBox" Grid.Row="5" Grid.Column="3" Height="28" Margin="0,0,0,6"
                 Text="1337" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>

        <TextBlock Grid.Row="6" Grid.Column="0" Text="Timeout ms" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="TimeoutBox" Grid.Row="6" Grid.Column="1" Height="28" Margin="0,0,8,0"
                 Text="600000" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
        <TextBlock Grid.Row="6" Grid.Column="2" Text="Progress interval" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <TextBox x:Name="ProgressIntervalBox" Grid.Row="6" Grid.Column="3" Height="28"
                 Text="4" Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D"/>
      </Grid>
    </Border>

    <Border Grid.Row="2" Margin="0,10,0,0" Background="#161B22" BorderBrush="#30363D" BorderThickness="1" CornerRadius="8" Padding="10">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
        </Grid.ColumnDefinitions>
        <Button x:Name="StartBtn" Grid.Column="0" Content="Start Training"
                Padding="12,6" Margin="0,0,8,0"
                Background="#1F6FEB" Foreground="White" BorderThickness="0" Cursor="Hand"/>
        <Button x:Name="StopBtn" Grid.Column="1" Content="Stop Session"
                Padding="12,6" Margin="0,0,8,0"
                Background="#DA3633" Foreground="White" BorderThickness="0" Cursor="Hand"/>
        <Button x:Name="NativeGpuBtn" Grid.Column="2" Content="Start Native GPU"
                Padding="12,6" Margin="0,0,8,0"
                Background="#8957E5" Foreground="White" BorderThickness="0" Cursor="Hand"/>
        <Button x:Name="XShardBtn" Grid.Column="3" Content="Start XSHARD"
                Padding="12,6" Margin="0,0,8,0"
                Background="#F0883E" Foreground="#0D1117" BorderThickness="0" Cursor="Hand"/>
        <Button x:Name="HfTensorsBtn" Grid.Column="4" Content="Start HF Tensors"
                Padding="12,6" Margin="0,0,8,0"
                Background="#2EA043" Foreground="White" BorderThickness="0" Cursor="Hand"/>
        <Button x:Name="PyTorchBtn" Grid.Column="5" Content="Start PyTorch"
                Padding="12,6" Margin="0,0,8,0"
                Background="#EE4B2B" Foreground="White" BorderThickness="0" Cursor="Hand"
                ToolTip="pi_kuhul_train.py — PyTorch sharded trainer. Best with a large GPU. Token bins[0] = training data JSONL. Output = shard dir."/>
        <Button x:Name="ClearLogBtn" Grid.Column="6" Content="Clear Log"
                Padding="12,6" Margin="0,0,8,0"
                Background="#30363D" Foreground="#E6EDF3" BorderThickness="0" Cursor="Hand"/>
        <TextBlock x:Name="SessionStatusText" Grid.Column="7" Foreground="#39FF14" VerticalAlignment="Center"
                   Text="Session: (none)"/>
      </Grid>
    </Border>

    <Border Grid.Row="3" Margin="0,10,0,0" Background="#0D1117" BorderBrush="#30363D" BorderThickness="1" CornerRadius="8">
      <Grid>
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="*"/>
        </Grid.RowDefinitions>
        <TextBlock Grid.Row="0" Text="Events" Foreground="#39FF14" FontWeight="Bold" Margin="10,8,0,8"/>
        <ListBox x:Name="EventsList" Grid.Row="1" Margin="10,0,10,10"
                 Background="#0D1117" Foreground="#39FF14" BorderBrush="#30363D"
                 FontSize="12"/>
      </Grid>
    </Border>
  </Grid>
</Window>
"@

$reader = [System.Xml.XmlNodeReader]::new($xaml)
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$logoImage = $window.FindName('LogoImage')
$logoPath = Join-Path $script:RepoRoot 'kuhulpi-micronaut.png'
if (Test-Path $logoPath) {
    try {
        $bmp = [System.Windows.Media.Imaging.BitmapImage]::new()
        $bmp.BeginInit()
        $bmp.UriSource = [Uri]::new($logoPath, [System.UriKind]::Absolute)
        $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bmp.EndInit()
        $logoImage.Source = $bmp
    } catch {}
}

$serverUrlBox = $window.FindName('ServerUrlBox')
$serverDot = $window.FindName('ServerDot')
$serverStatusText = $window.FindName('ServerStatusText')
$checkServerBtn = $window.FindName('CheckServerBtn')
$smokeBtn = $window.FindName('SmokeBtn')

$inputBox = $window.FindName('InputBox')
$outputBox = $window.FindName('OutputBox')
$xjslOutBox = $window.FindName('XjslOutBox')
$tokenBinsBox = $window.FindName('TokenBinsBox')
$tensorBox = $window.FindName('TensorBox')
$trainDimBox = $window.FindName('TrainDimBox')
$batchBox = $window.FindName('BatchBox')
$stepsBox = $window.FindName('StepsBox')
$lrBox = $window.FindName('LrBox')
$seedBox = $window.FindName('SeedBox')
$browserBox = $window.FindName('BrowserBox')
$timeoutBox = $window.FindName('TimeoutBox')
$progressIntervalBox = $window.FindName('ProgressIntervalBox')

$startBtn = $window.FindName('StartBtn')
$stopBtn = $window.FindName('StopBtn')
$nativeGpuBtn = $window.FindName('NativeGpuBtn')
$xShardBtn = $window.FindName('XShardBtn')
$hfTensorsBtn = $window.FindName('HfTensorsBtn')
$pyTorchBtn = $window.FindName('PyTorchBtn')
$clearLogBtn = $window.FindName('ClearLogBtn')
$sessionStatusText = $window.FindName('SessionStatusText')
$eventsList = $window.FindName('EventsList')

$script:NeonGreenBrush = [System.Windows.Media.Brushes]::Lime

function Set-ServerStatus([string]$text, [string]$color) {
    $serverStatusText.Text = $text
    $serverStatusText.Foreground = $script:NeonGreenBrush
    $safeColor = if ([string]::IsNullOrWhiteSpace($color)) { '#DA3633' } else { $color.Trim() }
    try {
        $brush = [System.Windows.Media.BrushConverter]::new().ConvertFromString($safeColor)
        if ($brush -is [System.Windows.Media.Brush]) {
            $serverDot.Fill = $brush
            return
        }
    } catch {}
    $serverDot.Fill = [System.Windows.Media.Brushes]::OrangeRed
}

function Add-EventLog([string]$line) {
    $item = [System.Windows.Controls.ListBoxItem]::new()
    $item.Content = $line
    $item.Foreground = $script:NeonGreenBrush
    $eventsList.Items.Add($item) | Out-Null
    $eventsList.ScrollIntoView($item)
}

function Get-SelectedBrowser {
    if ($browserBox.SelectedItem -and $browserBox.SelectedItem.Content) {
        return $browserBox.SelectedItem.Content.ToString().Trim().ToLower()
    }
    return 'auto'
}

function Split-TokenBins([string]$raw) {
    if (-not $raw) { return @() }
    $parts = $raw -split "[`r`n;,]"
    $out = @()
    foreach ($part in $parts) {
        $p = $part.Trim()
        if ($p) { $out += $p }
    }
    return $out | Select-Object -Unique
}

function Quote-NativeArg([string]$value) {
    if ($null -eq $value) { return '""' }
    return '"' + ($value -replace '\\(?=\\*")', '$0' -replace '"', '\"') + '"'
}

function Get-NativeOutputPath([string]$inputPath, [string]$outputPath) {
    if ($outputPath -and $outputPath -notlike '*.webgl2.dashboard.safetensors') {
        return $outputPath
    }
    $dir = [System.IO.Path]::GetDirectoryName($inputPath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($inputPath)
    return [System.IO.Path]::Combine($dir, "$name.native_gpu.dashboard.safetensors")
}

function Get-XShardOutputPath([string]$inputPath, [string]$outputPath) {
    if ($outputPath -and $outputPath -like '*.xshard') {
        return $outputPath
    }
    $dir = [System.IO.Path]::GetDirectoryName($inputPath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($inputPath)
    return [System.IO.Path]::Combine($dir, "$name.dashboard.trained.xshard")
}

function Get-HfTensorOutputPath([string]$inputPath, [string]$outputPath) {
    if ($outputPath -and $outputPath -like '*.safetensors') {
        return $outputPath
    }
    $dir = [System.IO.Path]::GetDirectoryName($inputPath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($inputPath)
    return [System.IO.Path]::Combine($dir, "$name.hf_tensors.dashboard.safetensors")
}

function Start-NativeGpuTraining {
    $inputPath = $inputBox.Text.Trim()
    if (-not $inputPath) { throw 'Input model path is required.' }
    if (-not (Test-Path $inputPath)) { throw "Input model not found: $inputPath" }
    if (-not (Test-Path $script:KuhulEsCli)) { throw "kuhul-es CLI not found: $script:KuhulEsCli" }

    $tokenBins = @(Split-TokenBins $tokenBinsBox.Text)
    if ($tokenBins.Count -lt 1) { throw 'At least one token bin is required for native training.' }
    $dataPath = $tokenBins[0]
    if (-not (Test-Path $dataPath)) { throw "Token bin not found: $dataPath" }

    $nativeOut = Get-NativeOutputPath $inputPath $outputBox.Text.Trim()
    $steps = [int]$stepsBox.Text.Trim()
    $lr = [double]$lrBox.Text.Trim()
    $args = @(
        (Quote-NativeArg $script:KuhulEsCli)
        'train-native'
        '--model', (Quote-NativeArg $inputPath)
        '--data', (Quote-NativeArg $dataPath)
        '--out', (Quote-NativeArg $nativeOut)
        '--steps', ([string]$steps)
        '--batch', '1'
        '--block', '128'
        '--lr', ([string]$lr)
        '--save-every', ([string][Math]::Max(1, [Math]::Min($steps, 200)))
        '--gpu-fwd'
        '--fullseq'
        '--think-bias'
        '--gravity-sync'
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'node.exe'
    $psi.Arguments = ($args -join ' ')
    $psi.WorkingDirectory = $script:RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] native {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] native-error {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName Exited -Action {
        $code = $Event.Sender.ExitCode
        $window.Dispatcher.BeginInvoke([Action[int]]{
            param($exitCode)
            $script:NativeProcess = $null
            Update-SessionStatusText -status "native-exit-$exitCode" -sessionId 'native-gpu' -progressText 'ASX trainer finished'
            Add-EventLog ("[{0}] native session_exit code={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $exitCode)
        }, $code) | Out-Null
    } | Out-Null

    if (-not $proc.Start()) { throw 'Failed to start native trainer process.' }
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $script:NativeProcess = $proc
    Update-SessionStatusText -status 'running' -sessionId 'native-gpu' -progressText "PID=$($proc.Id) output=$nativeOut"
    Add-EventLog ("[{0}] native session_started pid={1} data={2} output={3}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $proc.Id, $dataPath, $nativeOut)
}

function Start-XShardTraining {
    $inputPath = $inputBox.Text.Trim()
    if (-not $inputPath) { throw 'Input .xshard path is required.' }
    if (-not (Test-Path $inputPath)) { throw "Input .xshard not found: $inputPath" }
    if (-not (Test-Path $script:KuhulEsCli)) { throw "kuhul-es CLI not found: $script:KuhulEsCli" }

    $tokenBins = @(Split-TokenBins $tokenBinsBox.Text)
    if ($tokenBins.Count -lt 1) { throw 'At least one token/data bin is required for XSHARD training.' }
    $dataPath = $tokenBins[0]
    if (-not (Test-Path $dataPath)) { throw "Token/data bin not found: $dataPath" }

    $xshardOut = Get-XShardOutputPath $inputPath $outputBox.Text.Trim()
    $steps = [int]$stepsBox.Text.Trim()
    $lr = [double]$lrBox.Text.Trim()
    $workDir = [System.IO.Path]::GetDirectoryName($xshardOut)
    if (-not $workDir) { $workDir = $script:RepoRoot }

    $args = @(
        (Quote-NativeArg $script:KuhulEsCli)
        'train-xshard'
        '--input', (Quote-NativeArg $inputPath)
        '--token-bin', (Quote-NativeArg $dataPath)
        '--output', (Quote-NativeArg $xshardOut)
        '--steps', ([string]$steps)
        '--max-shards', '1'
        '--lr', ([string]$lr)
        '--work-dir', (Quote-NativeArg $workDir)
    )
    $fold = $tensorBox.Text.Trim()
    if ($fold) {
        $args += @('--fold', (Quote-NativeArg $fold))
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'node.exe'
    $psi.Arguments = ($args -join ' ')
    $psi.WorkingDirectory = $script:RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] xshard {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] xshard-error {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName Exited -Action {
        $code = $Event.Sender.ExitCode
        $window.Dispatcher.BeginInvoke([Action[int]]{
            param($exitCode)
            $script:NativeProcess = $null
            Update-SessionStatusText -status "xshard-exit-$exitCode" -sessionId 'xshard' -progressText 'Shard scheduler finished'
            Add-EventLog ("[{0}] xshard session_exit code={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $exitCode)
        }, $code) | Out-Null
    } | Out-Null

    if (-not $proc.Start()) { throw 'Failed to start XSHARD trainer process.' }
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $script:NativeProcess = $proc
    Update-SessionStatusText -status 'running' -sessionId 'xshard' -progressText "PID=$($proc.Id) output=$xshardOut"
    Add-EventLog ("[{0}] xshard session_started pid={1} data={2} output={3} max_shards=1" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $proc.Id, $dataPath, $xshardOut)
}

function Start-HfTensorSweep {
    $inputPath = $inputBox.Text.Trim()
    if (-not $inputPath) { throw 'Input HuggingFace safetensors path is required.' }
    if (-not (Test-Path $inputPath)) { throw "Input safetensors not found: $inputPath" }
    if (-not (Test-Path $script:KuhulEsCli)) { throw "kuhul-es CLI not found: $script:KuhulEsCli" }

    $tokenBins = @(Split-TokenBins $tokenBinsBox.Text)
    if ($tokenBins.Count -lt 1) { throw 'At least one token bin is required for HF tensor sweep.' }
    $dataPath = $tokenBins[0]
    if (-not (Test-Path $dataPath)) { throw "Token bin not found: $dataPath" }

    $hfOut = Get-HfTensorOutputPath $inputPath $outputBox.Text.Trim()
    $filter = $tensorBox.Text.Trim()
    if (-not $filter) { $filter = '\.weight$' }
    $trainDim = [int]$trainDimBox.Text.Trim()
    $batch = [int]$batchBox.Text.Trim()
    $steps = [int]$stepsBox.Text.Trim()
    $lr = [double]$lrBox.Text.Trim()
    $seed = [int]$seedBox.Text.Trim()
    $timeoutMs = [int]$timeoutBox.Text.Trim()
    $progressInterval = [int]$progressIntervalBox.Text.Trim()

    $args = @(
        (Quote-NativeArg $script:KuhulEsCli)
        'train-webgl2-sweep'
        '--input', (Quote-NativeArg $inputPath)
        '--output', (Quote-NativeArg $hfOut)
        '--token-bin', (Quote-NativeArg $dataPath)
        '--tensor-filter', (Quote-NativeArg $filter)
        '--all-tensors'
        '--train-dim', ([string]$trainDim)
        '--steps-per-tensor', ([string]$steps)
        '--batch', ([string]$batch)
        '--lr', ([string]$lr)
        '--seed', ([string]$seed)
        '--browser', (Get-SelectedBrowser)
        '--timeout-ms', ([string]$timeoutMs)
        '--progress-interval', ([string]$progressInterval)
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'node.exe'
    $psi.Arguments = ($args -join ' ')
    $psi.WorkingDirectory = $script:RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] hf-tensors {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] hf-tensors-error {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName Exited -Action {
        $code = $Event.Sender.ExitCode
        $window.Dispatcher.BeginInvoke([Action[int]]{
            param($exitCode)
            $script:NativeProcess = $null
            Update-SessionStatusText -status "hf-tensors-exit-$exitCode" -sessionId 'hf-tensors' -progressText 'HF tensor sweep finished'
            Add-EventLog ("[{0}] hf-tensors session_exit code={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $exitCode)
        }, $code) | Out-Null
    } | Out-Null

    if (-not $proc.Start()) { throw 'Failed to start HF tensor sweep process.' }
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $script:NativeProcess = $proc
    Update-SessionStatusText -status 'running' -sessionId 'hf-tensors' -progressText "PID=$($proc.Id) output=$hfOut"
    Add-EventLog ("[{0}] hf-tensors session_started pid={1} data={2} output={3} filter={4}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $proc.Id, $dataPath, $hfOut, $filter)
}

function Start-PyTorchTraining {
    if (-not (Test-Path $script:PyTrainer)) { throw "PyTorch trainer not found: $script:PyTrainer" }

    $tokenBins = @(Split-TokenBins $tokenBinsBox.Text)
    if ($tokenBins.Count -lt 1) { throw 'Token bins[0] must be the training data JSONL path.' }
    $dataPath = $tokenBins[0]
    if (-not (Test-Path $dataPath)) { throw "Training data not found: $dataPath" }

    $shardDir = $outputBox.Text.Trim()
    if (-not $shardDir) {
        $shardDir = Join-Path $script:RepoRoot 'models\from_zero\pi_kuhul_shards'
    }
    $ckptDir = Join-Path ([System.IO.Path]::GetDirectoryName($shardDir)) 'pi_kuhul_checkpoints'

    $steps   = [int]$stepsBox.Text.Trim()
    $batch   = [int]$batchBox.Text.Trim()
    $lr      = [double]$lrBox.Text.Trim()
    $resume  = $inputBox.Text.Trim()

    $pyArgs = @(
        (Quote-NativeArg $script:PyTrainer)
        '--data',      (Quote-NativeArg $dataPath)
        '--shard-dir', (Quote-NativeArg $shardDir)
        '--ckpt-dir',  (Quote-NativeArg $ckptDir)
        '--steps',     ([string]$steps)
        '--batch',     ([string]$batch)
        '--lr',        ([string]$lr)
    )
    if ($resume -and $resume -like '*.pt' -and (Test-Path $resume)) {
        $pyArgs += @('--resume', (Quote-NativeArg $resume))
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName  = 'python.exe'
    $psi.Arguments = ($pyArgs -join ' ')
    $psi.WorkingDirectory = Join-Path $script:RepoRoot 'tools'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] pytorch {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
        if ($EventArgs.Data) {
            $window.Dispatcher.BeginInvoke([Action[string]]{
                param($line)
                Add-EventLog ("[{0}] pytorch-err {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $line)
            }, $EventArgs.Data) | Out-Null
        }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName Exited -Action {
        $code = $Event.Sender.ExitCode
        $window.Dispatcher.BeginInvoke([Action[int]]{
            param($exitCode)
            $script:NativeProcess = $null
            Update-SessionStatusText -status "pytorch-exit-$exitCode" -sessionId 'pytorch' -progressText 'PyTorch trainer finished'
            Add-EventLog ("[{0}] pytorch session_exit code={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $exitCode)
        }, $code) | Out-Null
    } | Out-Null

    if (-not $proc.Start()) { throw 'Failed to start PyTorch trainer process.' }
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $script:NativeProcess = $proc
    Update-SessionStatusText -status 'running' -sessionId 'pytorch' -progressText "PID=$($proc.Id) data=$dataPath shards=$shardDir"
    Add-EventLog ("[{0}] pytorch session_started pid={1} data={2} shards={3} steps={4} batch={5} lr={6}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $proc.Id, $dataPath, $shardDir, $steps, $batch, $lr)
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        try { $listener.Stop() } catch {}
    }
}

function Invoke-JsonApi {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Url,
        [object]$Body = $null,
        [int]$TimeoutSec = 30
    )
    if ($Body -ne $null) {
        return Invoke-RestMethod -Method $Method -Uri $Url -Body ($Body | ConvertTo-Json -Depth 12) -ContentType 'application/json' -TimeoutSec $TimeoutSec
    }
    return Invoke-RestMethod -Method $Method -Uri $Url -TimeoutSec $TimeoutSec
}

function Update-SessionStatusText([string]$status, [string]$sessionId, [string]$progressText) {
    $sessionStatusText.Text = "Session: $sessionId | Status: $status | $progressText"
}

function Test-KuhulServer {
    $baseUrl = $serverUrlBox.Text.Trim().TrimEnd('/')
    if (-not $baseUrl) {
        Set-ServerStatus 'Missing server URL' '#DA3633'
        return $false
    }
    try {
        $health = Invoke-JsonApi -Method 'GET' -Url "$baseUrl/health" -TimeoutSec 5
        if ($health.status -eq 'ok') {
            Set-ServerStatus "Connected (pid=$($health.pid))" '#3FB950'
        } else {
            Set-ServerStatus 'Reachable (unexpected health payload)' '#F0883E'
        }
        return $true
    } catch {
        Set-ServerStatus "Disconnected: $($_.Exception.Message)" '#DA3633'
        return $false
    }
}

function Build-StartPayload {
    $inputPath = $inputBox.Text.Trim()
    $outputPath = $outputBox.Text.Trim()
    if (-not $inputPath) { throw 'Input model path is required.' }
    if (-not $outputPath) { throw 'Output model path is required.' }

    $payload = @{
        input = $inputPath
        output = $outputPath
        tensor = $tensorBox.Text.Trim()
        xjsl_out = $xjslOutBox.Text.Trim()
        train_dim = [int]$trainDimBox.Text.Trim()
        batch = [int]$batchBox.Text.Trim()
        steps = [int]$stepsBox.Text.Trim()
        lr = [double]$lrBox.Text.Trim()
        seed = [int]$seedBox.Text.Trim()
        browser = Get-SelectedBrowser
        timeout_ms = [int]$timeoutBox.Text.Trim()
        progress_interval = [int]$progressIntervalBox.Text.Trim()
    }

    $tokenBins = Split-TokenBins $tokenBinsBox.Text
    if ($tokenBins.Count -gt 0) {
        $payload.token_bins = $tokenBins
    }
    if (-not $payload.tensor) {
        $null = $payload.Remove('tensor')
    }
    if (-not $payload.xjsl_out) {
        $null = $payload.Remove('xjsl_out')
    }
    return $payload
}

function Format-EventStamp([object]$stampRaw) {
    if ($null -eq $stampRaw) {
        return (Get-Date).ToString('MM/dd/yyyy HH:mm:ss.fff')
    }
    if ($stampRaw -is [datetime]) {
        return $stampRaw.ToString('MM/dd/yyyy HH:mm:ss.fff')
    }
    $text = [string]$stampRaw
    try {
        return ([datetime]$text).ToString('MM/dd/yyyy HH:mm:ss.fff')
    } catch {
        return $text
    }
}

function Format-EventLine([object]$evt) {
    $stamp = Format-EventStamp $evt.timestamp
    $name = if ($evt.event) { [string]$evt.event } else { 'event' }
    switch ($name) {
        'progress' {
            return "[$stamp] progress step=$($evt.step)/$($evt.steps) percent=$($evt.percent)%"
        }
        'browser_launch' {
            return "[$stamp] browser_launch requested=$($evt.requested_browser) actual=$($evt.browser)"
        }
        'result' {
            $gpuMs = if ($null -ne $evt.gpu_ms) { [string]$evt.gpu_ms } else { 'n/a' }
            $wallMs = if ($null -ne $evt.wall_ms) { [string]$evt.wall_ms } else { 'n/a' }
            return "[$stamp] result loss=$($evt.loss_before) -> $($evt.loss_after) gpu_ms=$gpuMs wall_ms=$wallMs output=$($evt.output)"
        }
        'finalizing' {
            $mb = if ($evt.output_bytes) { [math]::Round(([double]$evt.output_bytes / 1MB), 2) } else { 0 }
            return "[$stamp] finalizing write output=$($evt.output) size_mb=$mb"
        }
        'error' {
            $msg = [string]$evt.message
            if ($msg -like 'Tensor not found in safetensors header:*') {
                return "[$stamp] error $msg | hint: clear Tensor so trainer auto-selects first F32 tensor"
            }
            return "[$stamp] error $msg"
        }
        'session_started' {
            return "[$stamp] session_started pid=$($evt.pid)"
        }
        'session_exit' {
            return "[$stamp] session_exit code=$($evt.exit_code)"
        }
        default {
            return "[$stamp] $name"
        }
    }
}

$pollTimer = [System.Windows.Threading.DispatcherTimer]::new()
$pollTimer.Interval = [TimeSpan]::FromSeconds(1)
$pollTimer.Add_Tick({
    if ($script:IsBusy) { return }
    if (-not $script:CurrentSessionId) { return }
    $script:IsBusy = $true
    try {
        $baseUrl = $serverUrlBox.Text.Trim().TrimEnd('/')
        $sid = $script:CurrentSessionId
        $statusResp = Invoke-JsonApi -Method 'GET' -Url "$baseUrl/v1/train/webgl2/status/$sid" -TimeoutSec 10
        $session = $statusResp.session
        if ($session) {
            $p = $session.progress
            $progressText = if ($p) { "Progress: $($p.step)/$($p.steps) ($($p.percent)%)" } else { 'Progress: n/a' }
            if ($session.status -eq 'running' -and $p -and [double]$p.percent -ge 100) {
                $progressText += ' | Finalizing output write'
            }
            Update-SessionStatusText -status $session.status -sessionId $sid -progressText $progressText
        }

        $eventsResp = Invoke-JsonApi -Method 'GET' -Url "$baseUrl/v1/train/webgl2/events/$sid" -TimeoutSec 10
        $events = @($eventsResp.events)
        if ($events.Count -gt $script:EventCursor) {
            for ($i = $script:EventCursor; $i -lt $events.Count; $i++) {
                Add-EventLog (Format-EventLine $events[$i])
            }
            $script:EventCursor = $events.Count
        }

        if ($session -and $session.status -ne 'running') {
            $pollTimer.Stop()
            Add-EventLog ("[{0}] session finalized: {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $session.status)
        }
    } catch {
        Add-EventLog ("[{0}] poll error: {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $_.Exception.Message)
    } finally {
        $script:IsBusy = $false
    }
})

$checkServerBtn.Add_Click({
    [void](Test-KuhulServer)
})

$smokeBtn.Add_Click({
    if (-not (Test-Path $script:WebView2SmokeExe)) {
        Add-EventLog ("[{0}] smoke exe missing: {1}" -f (Get-Date -Format s), $script:WebView2SmokeExe)
        return
    }
    $smokePort = Get-FreeTcpPort
    $args = @('--headless', $script:RepoRoot, [string]$smokePort)
    Add-EventLog ("[{0}] launching WebView2 smoke on port {1}: {2} {3}" -f (Get-Date -Format s), $smokePort, $script:WebView2SmokeExe, ($args -join ' '))
    Start-Process -FilePath $script:WebView2SmokeExe -ArgumentList $args -WorkingDirectory $script:RepoRoot | Out-Null
})

$startBtn.Add_Click({
    try {
        if (-not (Test-KuhulServer)) { return }
        $baseUrl = $serverUrlBox.Text.Trim().TrimEnd('/')
        $payload = Build-StartPayload
        $resp = Invoke-JsonApi -Method 'POST' -Url "$baseUrl/v1/train/webgl2/start" -Body $payload -TimeoutSec 30
        $session = $resp.session
        if (-not $session -or -not $session.id) {
            throw 'Server did not return a session id.'
        }
        $script:CurrentSessionId = $session.id
        $script:EventCursor = 0
        $eventsList.Items.Clear()
        Add-EventLog ("[{0}] session started id={1}" -f (Get-Date -Format s), $script:CurrentSessionId)
        Update-SessionStatusText -status $session.status -sessionId $script:CurrentSessionId -progressText 'Progress: 0%'
        if (-not $pollTimer.IsEnabled) { $pollTimer.Start() }
    } catch {
        Add-EventLog ("[{0}] start error: {1}" -f (Get-Date -Format s), $_.Exception.Message)
    }
})

$nativeGpuBtn.Add_Click({
    try {
        if ($script:NativeProcess -and -not $script:NativeProcess.HasExited) {
            Add-EventLog ("[{0}] native trainer already running pid={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $script:NativeProcess.Id)
            return
        }
        Start-NativeGpuTraining
    } catch {
        Add-EventLog ("[{0}] native start error: {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $_.Exception.Message)
    }
})

$xShardBtn.Add_Click({
    try {
        if ($script:NativeProcess -and -not $script:NativeProcess.HasExited) {
            Add-EventLog ("[{0}] trainer already running pid={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $script:NativeProcess.Id)
            return
        }
        Start-XShardTraining
    } catch {
        Add-EventLog ("[{0}] xshard start error: {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $_.Exception.Message)
    }
})

$hfTensorsBtn.Add_Click({
    try {
        if ($script:NativeProcess -and -not $script:NativeProcess.HasExited) {
            Add-EventLog ("[{0}] trainer already running pid={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $script:NativeProcess.Id)
            return
        }
        Start-HfTensorSweep
    } catch {
        Add-EventLog ("[{0}] hf-tensors start error: {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $_.Exception.Message)
    }
})

$pyTorchBtn.Add_Click({
    try {
        if ($script:NativeProcess -and -not $script:NativeProcess.HasExited) {
            Add-EventLog ("[{0}] trainer already running pid={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $script:NativeProcess.Id)
            return
        }
        Start-PyTorchTraining
    } catch {
        Add-EventLog ("[{0}] pytorch start error: {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $_.Exception.Message)
    }
})

$stopBtn.Add_Click({
    if ($script:NativeProcess -and -not $script:NativeProcess.HasExited) {
        try {
            $pid = $script:NativeProcess.Id
            $script:NativeProcess.Kill()
            Add-EventLog ("[{0}] trainer stop requested pid={1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $pid)
        } catch {
            Add-EventLog ("[{0}] trainer stop error: {1}" -f (Get-Date -Format 'MM/dd/yyyy HH:mm:ss.fff'), $_.Exception.Message)
        }
        return
    }
    if (-not $script:CurrentSessionId) {
        Add-EventLog ("[{0}] no active session id" -f (Get-Date -Format s))
        return
    }
    try {
        $baseUrl = $serverUrlBox.Text.Trim().TrimEnd('/')
        $sid = $script:CurrentSessionId
        $null = Invoke-JsonApi -Method 'POST' -Url "$baseUrl/v1/train/webgl2/stop/$sid" -Body @{} -TimeoutSec 20
        Add-EventLog ("[{0}] stop requested for session {1}" -f (Get-Date -Format s), $sid)
    } catch {
        Add-EventLog ("[{0}] stop error: {1}" -f (Get-Date -Format s), $_.Exception.Message)
    }
})

$clearLogBtn.Add_Click({
    $eventsList.Items.Clear()
})

$window.Add_Closed({
    if ($pollTimer.IsEnabled) { $pollTimer.Stop() }
    if ($script:NativeProcess -and -not $script:NativeProcess.HasExited) {
        try { $script:NativeProcess.Kill() } catch {}
    }
})

# Initial defaults for provided coder_micronaut lane
$inputBox.Text = 'E:\models\GPT2\coder_micronaut\ultrachat_coder_slerp_0p35.safetensors'
$outputBox.Text = 'E:\models\GPT2\coder_micronaut\ultrachat_coder_slerp_0p35.webgl2.dashboard.safetensors'
$xjslOutBox.Text = 'E:\models\GPT2\coder_micronaut\ultrachat_coder_slerp_0p35.webgl2.dashboard.xjsl.json'
$tokenBinsBox.Text = @(
    'E:\models\GPT2\coder_micronaut\tokens_coder_gpu.bin'
    'E:\models\GPT2\coder_micronaut\tokens_coder_v2.bin'
    'E:\models\GPT2\coder_micronaut\tokens_coder.bin'
) -join [Environment]::NewLine
$trainDimBox.Text = '1024'
$batchBox.Text = '16'
$stepsBox.Text = '300'
$lrBox.Text = '0.00035'
$timeoutBox.Text = '600000'
$progressIntervalBox.Text = '4'

[void](Test-KuhulServer)
Add-EventLog ("[{0}] tip: leave Tensor empty to auto-select first F32 tensor in the model" -f (Get-Date -Format s))
Add-EventLog ("[{0}] tip: Start XSHARD uses Input/Output + first Token bin, keeps max_shards=1, and treats Tensor as optional fold" -f (Get-Date -Format s))
Add-EventLog ("[{0}] tip: Start HF Tensors sweeps HuggingFace safetensors weights; Tensor is an optional regex filter (default \.weight$)" -f (Get-Date -Format s))
Add-EventLog ("[{0}] profile: real-pass defaults loaded (train_dim=1024, steps=300, lr=0.00035, timeout_ms=600000)" -f (Get-Date -Format s))
Add-EventLog ("[{0}] tip: Start PyTorch runs tools/pi_kuhul_train.py — requires torch. Token bins[0]=training JSONL, Output=shard dir. Best with a large GPU (CUDA). See tools/requirements.txt." -f (Get-Date -Format s))
$window.ShowDialog() | Out-Null
