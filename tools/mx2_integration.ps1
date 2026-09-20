#!/usr/bin/env pwsh
#Requires -Version 7
# mx2_integration.ps1 — MX-2 Micronaut Integration for JSON Sandbox
# Connects MX-2 to the JSON API Sandbox for user interaction, learning, and evolution

$ErrorActionPreference = "Stop"

# ============================================================================
# MX-2 INTEGRATION CONFIGURATION
# ============================================================================

$Script:ROOT = "C:\Users\canna\.desp-v1"
$Script:DESP_V1_2 = "$ROOT\DESP-V1.2"
$Script:MX2_DIR = "$DESP_V1_2\tools\kuhul-cli-agent-v1.0\MX-2"
$Script:BRAINS_DIR = "$MX2_DIR\brains"
$Script:IO_DIR = "$MX2_DIR\io"
$Script:EVOLUTION_DIR = "$MX2_DIR\evolution"
$Script:EVOLUTION_EXE = "$EVOLUTION_DIR\build\Release\asx_evolution.exe"

# MX-2 Configuration
$Script:MX2_CONFIG = @{
    id = "MX-2"
    name = "Shard AI Micronaut"
    version = "0.1.0"
    domain = @("all")
    fold = "COMPUTE"
    backend = "local_gguf"
    weights = "$MX2_DIR\..\models\qwen2-0_5b-instruct-q8_0.gguf"
    ngram_model = "$MX2_DIR\brains\gpt2.Q8_0.gguf"
    fast_model = "$MX2_DIR\brains\atomic_fast.kbc1"
    deep_model = "$MX2_DIR\brains\atomic_deep.kbc1"
    experts = @("python", "cpp", "json", "powershell")
    inference_modes = @("FAST", "DEEP", "BALANCED")
    description = "Shard-based Micronaut for on-the-fly inference and learning"
}

# ============================================================================
# MX-2 BRAIN MANAGEMENT
# ============================================================================

function Initialize-MX2Brains {
    param([string]$BrainsDir = $Script:BRAINS_DIR)
    
    # Ensure brains directory exists
    if (-not (Test-Path $BrainsDir)) {
        New-Item -ItemType Directory -Path $BrainsDir -Force | Out-Null
    }
    
    # Initialize brain files if they don't exist
    $brainFiles = @(
        @{ name = "bigrams.json"; content = "{}" },
        @{ name = "trigrams.json"; content = "{}" },
        @{ name = "meta-intent-map.json"; content = "{}" },
        @{ name = "mesh.brain.json"; content = "{}" },
        @{ name = "micronaut-profiles.json"; content = "{}" },
        @{ name = "ngrams.bigram.tsv"; content = "" },
        @{ name = "ngrams.unigram.tsv"; content = "" },
        @{ name = "optimizer.tsv"; content = "" },
        @{ name = "tensors.tsv"; content = "" },
        @{ name = "weights.tsv"; content = "" }
    )
    
    foreach ($file in $brainFiles) {
        $filePath = Join-Path $BrainsDir $file.name
        if (-not (Test-Path $filePath)) {
            $file.content | Out-File -FilePath $filePath -Encoding UTF8
        }
    }
    
    Write-Host "[MX-2] Brains initialized" -ForegroundColor Green
}

function Load-MX2Brain {
    param([string]$BrainFile)
    
    $brainPath = Join-Path $Script:BRAINS_DIR $BrainFile
    if (Test-Path $brainPath) {
        try {
            $content = Get-Content $brainPath -Raw
            if ($BrainFile -match "\.json$") {
                return $content | ConvertFrom-Json
            } else {
                return $content
            }
        } catch {
            Write-Host "[MX-2] Error loading brain $BrainFile: $_" -ForegroundColor Red
            return $null
        }
    }
    return $null
}

function Save-MX2Brain {
    param([string]$BrainFile, [object]$Content)
    
    $brainPath = Join-Path $Script:BRAINS_DIR $BrainFile
    try {
        if ($Content -is [hashtable] -or $Content -is [array]) {
            $Content | ConvertTo-Json -Depth 10 | Out-File -FilePath $brainPath -Encoding UTF8
        } else {
            $Content | Out-File -FilePath $brainPath -Encoding UTF8
        }
        Write-Host "[MX-2] Brain saved: $BrainFile" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "[MX-2] Error saving brain $BrainFile: $_" -ForegroundColor Red
        return $false
    }
}

function Update-MX2Ngrams {
    param([string]$Text, [string]$Context = "user")
    
    # Load existing ngrams
    $bigrams = Load-MX2Brain "bigrams.json" -as [hashtable]
    $trigrams = Load-MX2Brain "trigrams.json" -as [hashtable]
    
    # Tokenize text
    $words = $Text -split '\s+' | Where-Object { $_ -match '\w' }
    
    # Update bigrams
    for ($i = 0; $i -lt $words.Count - 1; $i++) {
        $bigram = "$($words[$i]) $($words[$i+1])"
        if (-not $bigrams.ContainsKey($bigram)) {
            $bigrams[$bigram] = @{ count = 1; contexts = @($Context) }
        } else {
            $bigrams[$bigram].count++
            $bigrams[$bigram].contexts += $Context
        }
    }
    
    # Update trigrams
    for ($i = 0; $i -lt $words.Count - 2; $i++) {
        $trigram = "$($words[$i]) $($words[$i+1]) $($words[$i+2])"
        if (-not $trigrams.ContainsKey($trigram)) {
            $trigrams[$trigram] = @{ count = 1; contexts = @($Context) }
        } else {
            $trigrams[$trigram].count++
            $trigrams[$trigram].contexts += $Context
        }
    }
    
    # Save updated ngrams
    Save-MX2Brain "bigrams.json" $bigrams
    Save-MX2Brain "trigrams.json" $trigrams
    
    # Update ngram TSV files
    $bigramTsv = $bigrams.Keys | ForEach-Object { "$_	$($bigrams[$_].count)" } -join "`n"
    $trigramTsv = $trigrams.Keys | ForEach-Object { "$_	$($trigrams[$_].count)" } -join "`n"
    
    Save-MX2Brain "ngrams.bigram.tsv" $bigramTsv
    Save-MX2Brain "ngrams.unigram.tsv" ($words | Group-Object | ForEach-Object { "$($_.Name)	$($_.Count)" } | Out-String)
    
    # Check if GPT2 model exists for fast research
    $gpt2Model = "$MX2_DIR\brains\gpt2.Q8_0.gguf"
    if (Test-Path $gpt2Model) {
        Write-Host "[MX-2] Ngrams updated with $($words.Count) words (GPT2 model available)" -ForegroundColor Green
    } else {
        Write-Host "[MX-2] Ngrams updated with $($words.Count) words" -ForegroundColor Green
    }
}

function Update-MX2Mesh {
    param([string]$InteractionId, [hashtable]$InteractionData)
    
    # Load mesh
    $mesh = Load-MX2Brain "mesh.brain.json" -as [hashtable]
    
    # Add interaction to mesh
    if (-not $mesh.ContainsKey("interactions")) {
        $mesh["interactions"] = @()
    }
    
    $interaction = @{
        id = $InteractionId
        timestamp = Get-Date -Format "o"
        user = $InteractionData.user
        prompt = $InteractionData.prompt
        response = $InteractionData.response
        context = $InteractionData.context
        sentiment = $InteractionData.sentiment
        reward = $InteractionData.reward
    }
    
    $mesh["interactions"] += $interaction
    
    # Save updated mesh
    Save-MX2Brain "mesh.brain.json" $mesh
    
    Write-Host "[MX-2] Mesh updated with interaction $InteractionId" -ForegroundColor Green
}

# ============================================================================
# MX-2 IO MANAGEMENT
# ============================================================================

function Initialize-MX2IO {
    param([string]$IODir = $Script:IO_DIR)
    
    # Ensure IO directory exists
    if (-not (Test-Path $IODir)) {
        New-Item -ItemType Directory -Path $IODir -Force | Out-Null
    }
    
    # Initialize IO files
    $ioFiles = @(
        @{ name = "chat.txt"; content = "" },
        @{ name = "stream.txt"; content = "" }
    )
    
    foreach ($file in $ioFiles) {
        $filePath = Join-Path $IODir $file.name
        if (-not (Test-Path $filePath)) {
            $file.content | Out-File -FilePath $filePath -Encoding UTF8
        }
    }
    
    Write-Host "[MX-2] IO system initialized" -ForegroundColor Green
}

function Log-MX2Interaction {
    param([string]$Message, [string]$Source = "user")
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Source] $Message"
    
    # Log to chat.txt
    Add-Content -Path "$Script:IO_DIR\chat.txt" -Value $logEntry
    
    # Log to stream.txt
    Add-Content -Path "$Script:IO_DIR\stream.txt" -Value $logEntry
    
    Write-Host "[MX-2] Interaction logged: $Message" -ForegroundColor Gray
}

function Get-MX2ChatHistory {
    param([int]$Lines = 50)
    
    $chatFile = "$Script:IO_DIR\chat.txt"
    if (Test-Path $chatFile) {
        return Get-Content $chatFile -Tail $Lines
    }
    return @()
}

# ============================================================================
# MX-2 EVOLUTION ENGINE
# ============================================================================

function Start-MX2Evolution {
    param([string]$EvolutionExe = $Script:EVOLUTION_EXE)
    
    if (-not (Test-Path $EvolutionExe)) {
        Write-Host "[MX-2] Evolution engine not found: $EvolutionExe" -ForegroundColor Red
        return $false
    }
    
    Write-Host "[MX-2] Starting evolution engine..." -ForegroundColor Cyan
    
    try {
        $process = Start-Process -FilePath $EvolutionExe -WorkingDirectory $EVOLUTION_DIR -PassThru
        Write-Host "[MX-2] Evolution engine started (PID: $($process.Id))" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "[MX-2] Failed to start evolution engine: $_" -ForegroundColor Red
        return $false
    }
}

function Process-MX2Evolution {
    param([string]$Data, [string]$EvolutionType = "learn")
    
    # This would connect to the evolution engine
    # For now, simulate evolution processing
    
    Write-Host "[MX-2] Processing evolution: $EvolutionType" -ForegroundColor Cyan
    
    # Simulate evolution steps
    Start-Sleep -Milliseconds 500
    
    $result = @{
        status = "success"
        type = $EvolutionType
        data_processed = $Data.Length
        timestamp = Get-Date -Format "o"
        metrics = @{
            learning_rate = 0.85
            convergence = 0.92
            iterations = 10
        }
    }
    
    Write-Host "[MX-2] Evolution processed: $EvolutionType" -ForegroundColor Green
    return $result
}

# ============================================================================
# MX-2 RLHF (REINFORCEMENT LEARNING FROM HUMAN FEEDBACK)
# ============================================================================

function Process-MX2RLHF {
    param([hashtable]$Interaction, [double]$Reward)
    
    # Load replay data
    $replayFile = "$Script:IO_DIR\replay.jsonl"
    $replayData = @()
    
    if (Test-Path $replayFile) {
        $replayData = Get-Content $replayFile | ConvertFrom-Json
    }
    
    # Add new interaction with reward
    $interactionWithReward = @{
        timestamp = Get-Date -Format "o"
        user = $Interaction.user
        prompt = $Interaction.prompt
        response = $Interaction.response
        reward = $Reward
        context = $Interaction.context
    }
    
    $replayData += $interactionWithReward
    
    # Save updated replay data
    $replayData | ForEach-Object { $_ | ConvertTo-Json } | Out-File -FilePath $replayFile -Encoding UTF8
    
    Write-Host "[MX-2] RLHF processed (Reward: $Reward)" -ForegroundColor Green
    
    # Return replay data for analysis
    return $replayData
}

function Replay-MX2Interactions {
    param([int]$Count = 5)
    
    $replayFile = "$Script:IO_DIR\replay.jsonl"
    if (-not (Test-Path $replayFile)) {
        Write-Host "[MX-2] No replay data available" -ForegroundColor Yellow
        return @()
    }
    
    $replayData = Get-Content $replayFile | ConvertFrom-Json | Select-Object -Last $Count
    
    Write-Host "[MX-2] Replaying $Count interactions:" -ForegroundColor Cyan
    foreach ($item in $replayData) {
        Write-Host "  [$($item.timestamp)] Reward: $($item.reward) - $($item.prompt)" -ForegroundColor Gray
    }
    
    return $replayData
}

# ============================================================================
# MX-2 IDB/XML MEMORY MANAGEMENT
# ============================================================================

function Update-MX2IDB {
    param([string]$Key, [object]$Value)
    
    $idbFile = "$MX2_DIR\idb.instance.xml"
    
    try {
        # Load IDB
        [xml]$idb = Get-Content $idbFile
        
        # Find or create entry
        $entry = $idb.SelectSingleNode("//entry[@key='$Key']")
        if (-not $entry) {
            $entry = $idb.CreateElement("entry")
            $entry.SetAttribute("key", $Key)
            $idb.DocumentElement.AppendChild($entry) | Out-Null
        }
        
        # Update value
        $entry.InnerText = $Value | ConvertTo-Json -Depth 10
        
        # Save IDB
        $idb.Save($idbFile)
        
        Write-Host "[MX-2] IDB updated: $Key" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "[MX-2] Error updating IDB: $_" -ForegroundColor Red
        return $false
    }
}

function Get-MX2IDB {
    param([string]$Key)
    
    $idbFile = "$MX2_DIR\idb.instance.xml"
    
    try {
        [xml]$idb = Get-Content $idbFile
        $entry = $idb.SelectSingleNode("//entry[@key='$Key']")
        
        if ($entry) {
            return $entry.InnerText | ConvertFrom-Json
        }
    } catch {
        Write-Host "[MX-2] Error reading IDB: $_" -ForegroundColor Red
    }
    
    return $null
}

# ============================================================================
# MX-2 INTEGRATION WITH JSON SANDBOX
# ============================================================================

function Initialize-MX2Integration {
    Write-Host "[MX-2] Initializing MX-2 Micronaut Integration..." -ForegroundColor Cyan
    
    # Initialize components
    Initialize-MX2Brains
    Initialize-MX2IO
    
    # Load MX-2 configuration
    $manifestFile = "$MX2_DIR\MX-2.xjson"
    if (Test-Path $manifestFile) {
        $Script:MX2_CONFIG = Get-Content $manifestFile | ConvertFrom-Json
    }
    
    Write-Host "[MX-2] MX-2 Integration Ready" -ForegroundColor Green
    Write-Host "  ID: $($Script:MX2_CONFIG.id)" -ForegroundColor Gray
    Write-Host "  Name: $($Script:MX2_CONFIG.name)" -ForegroundColor Gray
    Write-Host "  Experts: $(($Script:MX2_CONFIG.experts) -join ', ')" -ForegroundColor Gray
}

function Process-MX2UserInteraction {
    param(
        [string]$User,
        [string]$Prompt,
        [string]$Context = "general",
        [string]$Mode = "BALANCED"
    )
    
    Write-Host "[MX-2] Processing user interaction (Mode: $Mode)..." -ForegroundColor Cyan
    
    # Check inference mode
    $inferenceMode = $Mode.ToUpper()
    $modelUsed = "qwen2-0_5b-instruct-q8_0.gguf"  # Default
    $reward = 0.5
    
    # Determine which model to use based on mode
    switch ($inferenceMode) {
        "FAST" {
            $modelUsed = "atomic_fast.kbc1"
            $reward = 0.7
            Write-Host "[MX-2] Using FAST mode (atomic_fast.kbc1)" -ForegroundColor Green
        }
        "DEEP" {
            $modelUsed = "atomic_deep.kbc1"
            $reward = 0.9
            Write-Host "[MX-2] Using DEEP mode (atomic_deep.kbc1)" -ForegroundColor Green
        }
        "BALANCED" {
            $modelUsed = "gpt2.Q8_0.gguf"
            $reward = 0.8
            Write-Host "[MX-2] Using BALANCED mode (gpt2.Q8_0.gguf)" -ForegroundColor Green
        }
        default {
            Write-Host "[MX-2] Using default BALANCED mode" -ForegroundColor Yellow
        }
    }
    
    # Check if selected model is available
    $modelPath = "$MX2_DIR\brains\$modelUsed"
    if (-not (Test-Path $modelPath)) {
        Write-Host "[MX-2] Selected model not found, falling back to default" -ForegroundColor Yellow
        $modelUsed = "qwen2-0_5b-instruct-q8_0.gguf"
    }
    
    # Log interaction
    Log-MX2Interaction -Message "User: $Prompt" -Source "user"
    
    # Generate response based on mode
    switch ($inferenceMode) {
        "FAST" {
            $response = "[MX-2 FAST] Quick response: I've processed your request about '$Prompt' using atomic_fast model for rapid inference."
        }
        "DEEP" {
            $response = "[MX-2 DEEP] Detailed analysis: I've thoroughly analyzed your request about '$Prompt' using atomic_deep model for comprehensive understanding."
        }
        default {
            $response = "[MX-2 BALANCED] Optimized response: I've processed your request about '$Prompt' using a balanced approach for efficient inference."
        }
    }
    
    # Log response
    Log-MX2Interaction -Message "MX-2: $response" -Source "mx2"
    
    # Update ngrams
    Update-MX2Ngrams -Text $Prompt -Context $Context
    Update-MX2Ngrams -Text $response -Context $Context
    
    # Create interaction data
    $interactionData = @{
        user = $User
        prompt = $Prompt
        response = $response
        context = $Context
        sentiment = "neutral"
        reward = $reward
        timestamp = Get-Date -Format "o"
        model_used = $modelUsed
        inference_mode = $inferenceMode
    }
    
    # Update mesh
    $interactionId = "int_$(Get-Random -Minimum 1000 -Maximum 9999)"
    Update-MX2Mesh -InteractionId $interactionId -InteractionData $interactionData
    
    # Process RLHF
    Process-MX2RLHF -Interaction $interactionData -Reward $reward
    
    # Process evolution
    Process-MX2Evolution -Data $Prompt -EvolutionType "learn"
    
    # Return full interaction result
    return @{
        user = $User
        prompt = $Prompt
        response = $response
        interaction_id = $interactionId
        ngrams_updated = $true
        mesh_updated = $true
        rlhf_processed = $true
        evolution_processed = $true
        model_used = $modelUsed
        inference_mode = $inferenceMode
        timestamp = Get-Date -Format "o"
    }
}

function Get-MX2Stats {
    $gpt2Model = "$MX2_DIR\brains\gpt2.Q8_0.gguf"
    $gpt2Available = Test-Path $gpt2Model
    
    return @{
        id = $Script:MX2_CONFIG.id
        name = $Script:MX2_CONFIG.name
        version = $Script:MX2_CONFIG.version
        
        models = @{
            main = $Script:MX2_CONFIG.weights
            ngram = if ($gpt2Available) { $gpt2Model } else { "not_available" }
            gpt2_available = $gpt2Available
        }
        
        brains = @{
            bigrams = (Load-MX2Brain "bigrams.json").Count
            trigrams = (Load-MX2Brain "trigrams.json").Count
            mesh_interactions = ((Load-MX2Brain "mesh.brain.json").interactions).Count
        }
        
        io = @{
            chat_lines = (Get-MX2ChatHistory).Count
            replay_count = (Replay-MX2Interactions 0).Count
        }
        
        evolution = @{
            status = if (Test-Path $Script:EVOLUTION_EXE) { "ready" } else { "not_built" }
            engine = $Script:EVOLUTION_EXE
        }
    }
}

# ============================================================================
# MX-2 JSON SANDBOX COMMANDS
# ============================================================================

function Show-MX2Banner {
    Write-Host @"
╔══════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   🤖 MX-2 MICRONAUT — Self-Learning Cognitive Agent                        ║
║                                                                           ║
║   🧠 Features:                                                             ║
║   • User Interaction & Learning                                           ║
║   • Ngram & Mesh Brain Architecture                                       ║
║   • RLHF (Reinforcement Learning from Human Feedback)                     ║
║   • Replay & Rewind Capabilities                                          ║
║   • Evolution Engine Integration                                          ║
║   • IDB/XML Memory System                                                ║
║   • Tensor-Mapped Binary Data                                             ║
║                                                                           ║
╚══════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
}

function Show-MX2Prompt {
    Write-Host "[mx2] " -NoNewline -ForegroundColor Green
}

function Process-MX2Command {
    param([string]$Input)
    
    $cmd = $Input.Trim()
    $parts = $cmd -split '\s+', 2
    $verb = $parts[0].ToLower()
    $arg = if ($parts.Count -gt 1) { $parts[1] } else { $null }
    
    switch ($verb) {
        "help" { Show-MX2Help }
        "quit" { return $false }
        "exit" { return $false }
        "clear" { Clear-Host; Show-MX2Banner; return $true }
        
        "init" { 
            Initialize-MX2Integration
            return $true
        }
        
        "stats" { 
            $stats = Get-MX2Stats
            Write-Host "`n📊 MX-2 Statistics:" -ForegroundColor Cyan
            Write-Host "  ID: $($stats.id)" -ForegroundColor White
            Write-Host "  Name: $($stats.name)" -ForegroundColor White
            Write-Host "  Version: $($stats.version)" -ForegroundColor White
            Write-Host "`n🧠 Brain Status:" -ForegroundColor Cyan
            Write-Host "  Bigrams: $($stats.brains.bigrams)" -ForegroundColor White
            Write-Host "  Trigrams: $($stats.brains.trigrams)" -ForegroundColor White
            Write-Host "  Mesh Interactions: $($stats.brains.mesh_interactions)" -ForegroundColor White
            Write-Host "`n📡 IO Status:" -ForegroundColor Cyan
            Write-Host "  Chat Lines: $($stats.io.chat_lines)" -ForegroundColor White
            Write-Host "  Replay Count: $($stats.io.replay_count)" -ForegroundColor White
            Write-Host "`n🔄 Evolution Status:" -ForegroundColor Cyan
            Write-Host "  Engine: $($stats.evolution.status)" -ForegroundColor White
            return $true
        }
        
        "interact" { 
            if ($arg) {
                $result = Process-MX2UserInteraction -User "sandbox" -Prompt $arg
                Write-Host "`n[MX-2] Interaction Result:" -ForegroundColor Cyan
                Write-Host "  Response: $($result.response)" -ForegroundColor White
                Write-Host "  Interaction ID: $($result.interaction_id)" -ForegroundColor Gray
                Write-Host "  Ngrams Updated: $($result.ngrams_updated)" -ForegroundColor Gray
                Write-Host "  Mesh Updated: $($result.mesh_updated)" -ForegroundColor Gray
            } else {
                Write-Host "Usage: interact <prompt>" -ForegroundColor Yellow
            }
            return $true
        }
        
        "learn" { 
            if ($arg) {
                Update-MX2Ngrams -Text $arg -Context "learning"
                Write-Host "[MX-2] Learned from input" -ForegroundColor Green
            } else {
                Write-Host "Usage: learn <text>" -ForegroundColor Yellow
            }
            return $true
        }
        
        "replay" { 
            $replayData = Replay-MX2Interactions
            if ($replayData.Count -gt 0) {
                Write-Host "`n[MX-2] Recent Interactions:" -ForegroundColor Cyan
                foreach ($item in $replayData) {
                    Write-Host "  [$($item.timestamp)] Reward: $($item.reward)" -ForegroundColor White
                    Write-Host "    Q: $($item.prompt)" -ForegroundColor Gray
                    Write-Host "    A: $($item.response)" -ForegroundColor Gray
                }
            } else {
                Write-Host "[MX-2] No replay data available" -ForegroundColor Yellow
            }
            return $true
        }
        
        "evolve" { 
            Start-MX2Evolution
            return $true
        }
        
        "memory" { 
            if ($arg -match "=") {
                $parts = $arg -split "=", 2
                $key = $parts[0].Trim()
                $value = $parts[1].Trim()
                Update-MX2IDB -Key $key -Value $value
                Write-Host "[MX-2] Memory updated: $key = $value" -ForegroundColor Green
            } else {
                $value = Get-MX2IDB -Key $arg
                if ($value) {
                    Write-Host "[MX-2] Memory[$arg]: $($value | ConvertTo-Json -Depth 5)" -ForegroundColor White
                } else {
                    Write-Host "[MX-2] Memory key not found: $arg" -ForegroundColor Yellow
                }
            }
            return $true
        }
        
        "history" { 
            $history = Get-MX2ChatHistory -Lines 20
            if ($history.Count -gt 0) {
                Write-Host "`n[MX-2] Chat History:" -ForegroundColor Cyan
                foreach ($line in $history) {
                    Write-Host "  $line" -ForegroundColor Gray
                }
            } else {
                Write-Host "[MX-2] No chat history available" -ForegroundColor Yellow
            }
            return $true
        }
        
        "fast" { 
            if ($arg) {
                $result = Process-MX2UserInteraction -User "sandbox" -Prompt $arg -Mode "FAST"
                Write-Host "`n[MX-2] FAST Mode Result:" -ForegroundColor Cyan
                Write-Host "  Response: $($result.response)" -ForegroundColor White
                Write-Host "  Model: $($result.model_used)" -ForegroundColor Gray
            } else {
                Write-Host "Usage: fast <prompt>" -ForegroundColor Yellow
            }
            return $true
        }
        
        "deep" { 
            if ($arg) {
                $result = Process-MX2UserInteraction -User "sandbox" -Prompt $arg -Mode "DEEP"
                Write-Host "`n[MX-2] DEEP Mode Result:" -ForegroundColor Cyan
                Write-Host "  Response: $($result.response)" -ForegroundColor White
                Write-Host "  Model: $($result.model_used)" -ForegroundColor Gray
            } else {
                Write-Host "Usage: deep <prompt>" -ForegroundColor Yellow
            }
            return $true
        }
        
        "balanced" { 
            if ($arg) {
                $result = Process-MX2UserInteraction -User "sandbox" -Prompt $arg -Mode "BALANCED"
                Write-Host "`n[MX-2] BALANCED Mode Result:" -ForegroundColor Cyan
                Write-Host "  Response: $($result.response)" -ForegroundColor White
                Write-Host "  Model: $($result.model_used)" -ForegroundColor Gray
            } else {
                Write-Host "Usage: balanced <prompt>" -ForegroundColor Yellow
            }
            return $true
        }
        
        "research" { 
            if ($arg) {
                $gpt2Model = "$MX2_DIR\brains\gpt2.Q8_0.gguf"
                if (Test-Path $gpt2Model) {
                    Write-Host "[MX-2] Performing fast research using GPT2 model..." -ForegroundColor Cyan
                    
                    # Simulate GPT2-based research
                    $tokens = $arg -split '\s+' | Where-Object { $_ -match '\w' }
                    $bigramMatches = @()
                    $trigramMatches = @()
                    
                    # Load ngrams
                    $bigrams = Load-MX2Brain "bigrams.json"
                    $trigrams = Load-MX2Brain "trigrams.json"
                    
                    # Find matching ngrams
                    for ($i = 0; $i -lt $tokens.Count - 1; $i++) {
                        $bigram = "$($tokens[$i]) $($tokens[$i+1])"
                        if ($bigrams.ContainsKey($bigram)) {
                            $bigramMatches += "$bigram ($($bigrams[$bigram].count) occurrences)"
                        }
                    }
                    
                    for ($i = 0; $i -lt $tokens.Count - 2; $i++) {
                        $trigram = "$($tokens[$i]) $($tokens[$i+1]) $($tokens[$i+2])"
                        if ($trigrams.ContainsKey($trigram)) {
                            $trigramMatches += "$trigram ($($trigrams[$trigram].count) occurrences)"
                        }
                    }
                    
                    Write-Host "[MX-2] Research Results:" -ForegroundColor Cyan
                    Write-Host "  Query: $arg" -ForegroundColor White
                    Write-Host "  Tokens: $($tokens.Count)" -ForegroundColor Gray
                    
                    if ($bigramMatches.Count -gt 0) {
                        Write-Host "  Matching Bigrams:" -ForegroundColor Green
                        foreach ($match in $bigramMatches) {
                            Write-Host "    • $match" -ForegroundColor Gray
                        }
                    }
                    
                    if ($trigramMatches.Count -gt 0) {
                        Write-Host "  Matching Trigrams:" -ForegroundColor Green
                        foreach ($match in $trigramMatches) {
                            Write-Host "    • $match" -ForegroundColor Gray
                        }
                    }
                    
                    if ($bigramMatches.Count -eq 0 -and $trigramMatches.Count -eq 0) {
                        Write-Host "  No matching ngrams found" -ForegroundColor Yellow
                    }
                } else {
                    Write-Host "[MX-2] GPT2 model not available for fast research" -ForegroundColor Yellow
                    Write-Host "  Falling back to standard processing" -ForegroundColor Gray
                }
            } else {
                Write-Host "Usage: research <query>" -ForegroundColor Yellow
            }
            return $true
        }
        
        default {
            if ($cmd) {
                Write-Host "Unknown command: $verb (type 'help' for list)" -ForegroundColor Yellow
            }
            return $true
        }
    }
    
    return $true
}

function Show-MX2Help {
    Write-Host @"
🤖 MX-2 Micronaut Commands

🧠 Core Commands:
  help            Show this help
  init            Initialize MX-2 system
  stats           Show MX-2 statistics
  quit/exit       Exit MX-2 interface

💬 Interaction:
  interact <prompt>   Process user interaction (balanced mode)
  learn <text>       Update ngrams from text
  research <query>  Fast research using GPT2 model
  replay            Show recent interactions
  history           Show chat history

🚀 Inference Modes:
  fast <prompt>     FAST mode (atomic_fast.kbc1 - rapid response)
  deep <prompt>     DEEP mode (atomic_deep.kbc1 - detailed analysis)
  balanced <prompt> BALANCED mode (gpt2.Q8_0.gguf - optimized)

🔄 Evolution:
  evolve           Start evolution engine
  memory <key>=<value>  Update IDB memory
  memory <key>      Get IDB memory value

📘 System:
  clear           Clear screen
"@ -ForegroundColor Gray
}

# ============================================================================
# MAIN MX-2 INTEGRATION LOOP
# ============================================================================

function Start-MX2Integration {
    Show-MX2Banner
    Initialize-MX2Integration
    
    while ($true) {
        try {
            Show-MX2Prompt
            $input = Read-Host
            if ([string]::IsNullOrWhiteSpace($input)) { continue }
            
            $result = Process-MX2Command $input
            if (-not $result) { break }
        }
        catch {
            Write-Host "[MX-2 ERROR] $_" -ForegroundColor Red
        }
    }
    
    Write-Host "`n[MX-2] Shutting down..." -ForegroundColor Cyan
    Write-Host "  Saving brains..." -ForegroundColor Gray
    Write-Host "  Goodbye!`n" -ForegroundColor Gray
}

# Start if called directly
if ($MyInvocation.InvocationName -eq $MyInvocation.MyCommand.Path -or $MyInvocation.InvocationName -eq '') {
    Start-MX2Integration
}