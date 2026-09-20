#Requires -Version 5.1
# -------------------------------------------------------------------
# micronaut-ui-chat-app.ps1 – AI Chat UI for MX-2 Shard AI Models
# Updated to read bootstrap.json for runtime configuration and to use
# the generic JSON‑Runtime "run" endpoint that the Supernaut orchestrator
# provides.  It also adds the missing Windows Forms assembly import.
# -------------------------------------------------------------------
# micronaut-ui-chat-app.ps1 — AI Chat UI for MX-2 Shard AI Models
# Connects to JSON Runtime API for model inference
# Launch: pwsh -STA -File .\micronaut-ui-chat-app.ps1

# Load Windows‑Forms (required for FolderBrowserDialog)
Add-Type -AssemblyName System.Windows.Forms

# -------------------------------------------------------------------
$DefaultModel = "scx-expert-8"  # fallback if no UI selection yet
# -------------------------------------------------------------------
$bootstrapPath = Join-Path $PSScriptRoot 'bootstrap.json'
if (Test-Path $bootstrapPath) {
    try {
        $bootstrap = Get-Content $bootstrapPath -Raw | ConvertFrom-Json
        $port = $bootstrap.runtime_mods.port
        $apiPrefix = $bootstrap.interface_mods.api_prefix.TrimEnd('/')
        $script:JsonRuntimeUrl = "http://127.0.0.1:$port$apiPrefix"
        Write-Verbose "[Bootstrap] Runtime URL resolved to $script:JsonRuntimeUrl"
    } catch {
        Write-Warning "Failed to parse bootstrap.json – falling back to defaults. $_"
    }
}


# ── JSON Runtime API Configuration ─────────────────────────────────────────────
# If the bootstrap parsing did not set a URL, fall back to the classic default
if (-not $script:JsonRuntimeUrl) {
    $script:JsonRuntimeUrl = "http://127.0.0.1:9000/api"
}
# Default model – can be overridden later via UI selections
$script:ActiveModel = $DefaultModel
$script:WorkFolder = $PSScriptRoot  # Default to script directory
$script:ThinkingMode = "balanced"  # Options: fast, deep, balanced

# ── Model Configuration ────────────────────────────────────────────────────────
$script:AvailableModels = @(
    @{ Id = "scx-expert-8"; Name = "SCX-EXPERT-8 MoE"; Type = "moe_gguf"; Description = "Mixture-of-experts with 8 experts" }
)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# ── XAML UI ────────────────────────────────────────────────────────────────────
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="MX-2 AI Chat — Model-Powered Assistant"
        Height="720" Width="1000" MinWidth="600" MinHeight="400"
        WindowStartupLocation="CenterScreen"
        Background="#0D1117" FontFamily="Consolas">
  <Grid>
    <Grid.RowDefinitions>
      <RowDefinition Height="50"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="60"/>
    </Grid.RowDefinitions>

    <!-- Header with Model & Settings -->
    <Border Background="#161B22" BorderBrush="#21262D" BorderThickness="0,0,0,1">
      <DockPanel Margin="14,0">
        <StackPanel Orientation="Horizontal" DockPanel.Dock="Right">
          <!-- Thinking Mode -->
          <TextBlock Text="Thinking:" Foreground="#8B949E" VerticalAlignment="Center" Margin="0,0,8,0"/>
          <ComboBox x:Name="ThinkingModeCombo" Width="80" Margin="0,0,12,0"
                    Background="#0D1117" Foreground="#E6EDF3" BorderBrush="#30363D">
            <ComboBoxItem Content="Fast" IsSelected="False"/>
            <ComboBoxItem Content="Balanced" IsSelected="True"/>
            <ComboBoxItem Content="Deep" IsSelected="False"/>
          </ComboBox>

          <!-- Work Folder -->
          <Button x:Name="SetWorkFolderBtn" Content="📁 Set Folder"
                  Background="#238636" Foreground="White" BorderThickness="0"
                  FontSize="11" Padding="10,4" Margin="0,0,8,0" Cursor="Hand"/>
          <TextBlock x:Name="WorkFolderDisplay" Text="Current: Script Directory"
                     Foreground="#8B949E" FontSize="10" VerticalAlignment="Center" MaxWidth="200"/>
        </StackPanel>

        <Ellipse x:Name="StatusDot" Width="9" Height="9" Fill="#3FB950"
                 VerticalAlignment="Center" Margin="0,0,9,0"/>
        <TextBlock x:Name="ModelDisplay" Text="Model: SCX-EXPERT-8"
                   Foreground="#E6EDF3" FontSize="13" FontWeight="Bold"
                   VerticalAlignment="Center"/>
      </DockPanel>
    </Border>

    <!-- Chat Feed -->
    <ScrollViewer Grid.Row="1" x:Name="FeedScroll"
                  VerticalScrollBarVisibility="Auto" Background="#0D1117">
      <StackPanel x:Name="Feed" Margin="14,8,14,8"/>
    </ScrollViewer>

    <!-- Input Bar -->
    <Border Grid.Row="2" Background="#161B22" BorderBrush="#21262D" BorderThickness="0,1,0,0">
      <Grid Margin="10,10">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <TextBox x:Name="InputBox"
                 Background="#0D1117" Foreground="#E6EDF3" CaretBrush="#58A6FF"
                 BorderBrush="#30363D" BorderThickness="1"
                 FontSize="13" Padding="10,6" Height="38" VerticalContentAlignment="Center"
                 ToolTip="Type your message to the AI assistant"/>
        <Button x:Name="SendBtn" Grid.Column="1" Content="  Send  "
                Background="#238636" Foreground="White" BorderThickness="0"
                FontSize="13" FontWeight="SemiBold" Height="38"
                Margin="8,0,0,0" Cursor="Hand"/>
      </Grid>
    </Border>
  </Grid>
</Window>
"@

# ── Build Window ───────────────────────────────────────────────────────────────
$reader = [System.Xml.XmlNodeReader]::new($xaml)
$window = [System.Windows.Markup.XamlReader]::Load($reader)
$feed = $window.FindName('Feed')
$scroll = $window.FindName('FeedScroll')
$inputBox = $window.FindName('InputBox')
$sendBtn = $window.FindName('SendBtn')
$statusDot = $window.FindName('StatusDot')
$modelDisplay = $window.FindName('ModelDisplay')
$thinkingModeCombo = $window.FindName('ThinkingModeCombo')
$setWorkFolderBtn = $window.FindName('SetWorkFolderBtn')
$workFolderDisplay = $window.FindName('WorkFolderDisplay')

# ── Helper Functions ───────────────────────────────────────────────────────────
function Set-Status([string]$color) {
    $script:window.Dispatcher.Invoke({
        $statusDot.Fill = [System.Windows.Media.SolidColorBrush]::new(
            [System.Windows.Media.ColorConverter]::ConvertFromString($color))
    })
}

function Update-ModelDisplay {
    $model = $script:AvailableModels | Where-Object { $_.Id -eq $script:ActiveModel }
    if ($model) {
        $script:window.Dispatcher.Invoke({
            $modelDisplay.Text = "Model: $($model.Name)"
        })
    }
}

function Update-WorkFolderDisplay {
    $folderName = if ($script:WorkFolder -eq $PSScriptRoot) { "Script Directory" } else { Split-Path $script:WorkFolder -Leaf }
    $script:window.Dispatcher.Invoke({
        $workFolderDisplay.Text = "Current: $folderName"
    })
}

function Add-UserMessage([string]$text) {
    $script:window.Dispatcher.Invoke({
        $bubble = New-ChatBubble $text '#1F6FEB' '#FFFFFF' $false
        $feed.Children.Add($bubble)
        $scroll.ScrollToBottom()
    })
}

function Add-AIMessage([string]$text) {
    $script:window.Dispatcher.Invoke({
        $bubble = New-ChatBubble $text '#21262D' '#E6EDF3' $true
        $feed.Children.Add($bubble)
        $scroll.ScrollToBottom()
    })
}

function Add-SystemMessage([string]$text) {
    $script:window.Dispatcher.Invoke({
        $msg = [System.Windows.Controls.TextBlock]::new()
        $msg.Text = "⚡ $text"
        $msg.Foreground = [System.Windows.Media.SolidColorBrush]::new(
            [System.Windows.Media.ColorConverter]::ConvertFromString('#58A6FF'))
        $msg.FontSize = 11
        $msg.Margin = [System.Windows.Thickness]::new(4, 6, 0, 2)
        $feed.Children.Add($msg)
        $scroll.ScrollToBottom()
    })
}

function New-ChatBubble([string]$text, [string]$bgColor, [string]$fgColor, [bool]$isAI) {
    $border = [System.Windows.Controls.Border]::new()
    $border.CornerRadius = [System.Windows.CornerRadius]::new(15)
    $border.Margin = [System.Windows.Thickness]::new(0, 4, 0, 0)
    $border.Padding = [System.Windows.Thickness]::new(14, 10, 14, 10)
    $border.MaxWidth = 700
    $border.Background = [System.Windows.Media.SolidColorBrush]::new(
        [System.Windows.Media.ColorConverter]::ConvertFromString($bgColor))
    $border.HorizontalAlignment = if ($isAI) { 'Left' } else { 'Right' }

    $textBlock = [System.Windows.Controls.TextBlock]::new()
    $textBlock.Text = $text
    $textBlock.Foreground = [System.Windows.Media.SolidColorBrush]::new(
        [System.Windows.Media.ColorConverter]::ConvertFromString($fgColor))
    $textBlock.FontSize = 13
    $textBlock.TextWrapping = 'Wrap'

    $border.Child = $textBlock
    return $border
}

# ── JSON Runtime API Functions ─────────────────────────────────────────────────
function Test-JsonRuntimeConnection {
    try {
        # $script:JsonRuntimeUrl already includes the API prefix (/api)
        $response = Invoke-RestMethod -Uri "$($script:JsonRuntimeUrl)/health" -Method Get -TimeoutSec 5
        return $true
    } catch {
        return $false
    }
}

function Send-ChatMessage([string]$message) {
    if (-not (Test-JsonRuntimeConnection)) {
        Add-SystemMessage "JSON Runtime not available. Please start the SUPERNAUT orchestrator."
        return
    }

    Set-Status '#F0883E'  # Thinking/processing color

    # Prepare request based on thinking mode
    $maxTokens = switch ($script:ThinkingMode) {
        "fast" { 256 }
        "balanced" { 512 }
        "deep" { 1024 }
        default { 512 }
    }

    $temperature = switch ($script:ThinkingMode) {
        "fast" { 0.9 }
        "balanced" { 0.7 }
        "deep" { 0.3 }
        default { 0.7 }
    }

    $requestBody = @{
        "@program" = "scx_expert_inference.kuhul"
        "request" = @{
            "prompt" = $message
            "max_tokens" = $maxTokens
            "temperature" = $temperature
            "model_config" = @{
                "expert_count" = 8
                "routing_strategy" = "dynamic"
                "work_folder" = $script:WorkFolder
            }
        }
    }

    try {
        $response = Invoke-RestMethod -Uri "$($script:JsonRuntimeUrl)/api/run" `
            -Method Post `
            -Body ($requestBody | ConvertTo-Json -Depth 10) `
            -ContentType "application/json" `
            -TimeoutSec 120

        if ($response -and $response.response) {
            Add-AIMessage $response.response

            # Show metadata if available
            if ($response.expert_used) {
                Add-SystemMessage "Used expert: $($response.expert_used) | Phase: $($response.phase_angle)"
            }
        } else {
            Add-AIMessage "Sorry, I received an empty response. Please try again."
        }
    } catch {
        Add-SystemMessage "Error communicating with AI model: $($_.Exception.Message)"
        Add-AIMessage "I apologize, but I'm having trouble connecting to the AI model right now. Please check that the JSON runtime is running."
    }

    Set-Status '#3FB950'  # Ready color
}

# ── Event Handlers ─────────────────────────────────────────────────────────────
$sendBtn.Add_Click({
    $message = $inputBox.Text.Trim()
    if ($message) {
        Add-UserMessage $message
        $inputBox.Text = ""
        Invoke-ModelChat $message
    }
})

$inputBox.Add_KeyDown({
    if ($_.Key -eq 'Enter' -and -not $_.KeyboardDevice.Modifiers) {
        $sendBtn.RaiseEvent([System.Windows.RoutedEventArgs]::new([System.Windows.Controls.Button]::ClickEvent, $sendBtn))
        $_.Handled = $true
    }
})

$thinkingModeCombo.Add_SelectionChanged({
    $selectedItem = $thinkingModeCombo.SelectedItem
    if ($selectedItem) {
        $script:ThinkingMode = $selectedItem.Content.ToString().ToLower()
        Add-SystemMessage "Thinking mode set to: $($script:ThinkingMode)"
    }
})

$setWorkFolderBtn.Add_Click({
    $dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
    $dialog.Description = "Select working folder for AI assistant"
    $dialog.SelectedPath = $script:WorkFolder

    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $script:WorkFolder = $dialog.SelectedPath
        Update-WorkFolderDisplay
        Add-SystemMessage "Working folder set to: $($script:WorkFolder)"
    }
})

# ── Initialization ─────────────────────────────────────────────────────────────
Update-ModelDisplay
Update-WorkFolderDisplay

# Test connection on startup
if (Test-JsonRuntimeConnection) {
    Add-SystemMessage "Connected to JSON Runtime API - AI assistant ready!"
    Set-Status '#3FB950'
} else {
    Add-SystemMessage "JSON Runtime not available. Please start the SUPERNAUT orchestrator first."
    Set-Status '#DA3633'
}

# Welcome message
Add-AIMessage "Hello! I'm your AI assistant powered by the SCX-EXPERT-8 model. I can help you with coding, analysis, creative tasks, and more. What would you like to work on today?"

# -------------------------------------------------------------------
# Helper that uses GPT‑2 model via the JSON Runtime (load‑once + infer)
# -------------------------------------------------------------------
function Invoke-ModelChat([string]$message) {
    # Ensure runtime is reachable
    if (-not (Test-JsonRuntimeConnection)) {
        Add-SystemMessage "JSON Runtime not available. Please start the orchestrator."
        return
    }

    Set-Status '#F0883E'  # processing

    # Load model once
    if (-not $script:ModelLoaded) {
        Add-SystemMessage "Loading GPT‑2 model …"
        $loadPayload = @{ program = "load_gpt2.json" }
        try {
            $loadResp = Invoke-RestMethod -Uri "$($script:JsonRuntimeUrl)/run" -Method Post -Body ($loadPayload | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 60
            $script:ModelLoaded = $true
            Add-SystemMessage "Model loaded."
        } catch {
            Add-SystemMessage "Failed to load model: $($_.Exception.Message)"
            Set-Status '#DA3633'
            return
        }
    }

    # Run inference
    $requestBody = @{ program = "gpt2_infer.json"; variables = @{ prompt = $message } }
    try {
        $resp = Invoke-RestMethod -Uri "$($script:JsonRuntimeUrl)/run" -Method Post -Body ($requestBody | ConvertTo-Json -Depth 6) -ContentType "application/json" -TimeoutSec 120
        if ($resp -and $resp.result -and $resp.result.output) {
            $log = $resp.result.output | Where-Object { $_.type -eq 'log' } | Select-Object -First 1
            if ($log) { Add-AIMessage $log.msg } else { Add-AIMessage "(no output)" }
        } else {
            Add-AIMessage "(empty response)"
        }
    } catch {
        Add-SystemMessage "Inference error: $($_.Exception.Message)"
        Add-AIMessage "Sorry, I couldn't get a response."
    }

    Set-Status '#3FB950'  # ready
}

# ── Show Window ────────────────────────────────────────────────────────────────
$window.ShowDialog() | Out-Null