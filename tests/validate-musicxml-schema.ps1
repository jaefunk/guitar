[CmdletBinding()]
param(
    [string]$Fixture
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Fixture)) {
    $Fixture = Join-Path $PSScriptRoot 'fixtures\guitar-tab-all-specs.musicxml'
}

$fixturePath = (Resolve-Path -LiteralPath $Fixture).Path
$schemaDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("musicxml-4.0-schema-" + [System.Guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $schemaDirectory | Out-Null

    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

    $schemaUrls = @{
        'musicxml.xsd' = 'https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema/musicxml.xsd'
        'xlink.xsd'    = 'https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema/xlink.xsd'
        'xml.xsd'      = 'https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema/xml.xsd'
    }

    $webClient = New-Object System.Net.WebClient
    try {
        foreach ($schemaName in $schemaUrls.Keys) {
            $webClient.DownloadFile($schemaUrls[$schemaName], (Join-Path $schemaDirectory $schemaName))
        }
    }
    finally {
        $webClient.Dispose()
    }

    $musicXmlSchemaPath = Join-Path $schemaDirectory 'musicxml.xsd'
    $musicXmlSchema = [System.IO.File]::ReadAllText($musicXmlSchemaPath)
    $importRewrites = @{
        'schemaLocation="http://www.musicxml.org/xsd/xml.xsd"'   = 'schemaLocation="xml.xsd"'
        'schemaLocation="http://www.musicxml.org/xsd/xlink.xsd"' = 'schemaLocation="xlink.xsd"'
    }

    foreach ($remoteImport in $importRewrites.Keys) {
        if (-not $musicXmlSchema.Contains($remoteImport)) {
            throw "Official MusicXML schema import was not found: $remoteImport"
        }

        $musicXmlSchema = $musicXmlSchema.Replace($remoteImport, $importRewrites[$remoteImport])
    }

    [System.IO.File]::WriteAllText(
        $musicXmlSchemaPath,
        $musicXmlSchema,
        (New-Object System.Text.UTF8Encoding($false))
    )

    $schemaSet = New-Object System.Xml.Schema.XmlSchemaSet
    $schemaSet.XmlResolver = New-Object System.Xml.XmlUrlResolver
    $null = $schemaSet.Add($null, $musicXmlSchemaPath)
    $schemaSet.Compile()

    $validationErrors = New-Object 'System.Collections.Generic.List[string]'
    $validationHandler = [System.Xml.Schema.ValidationEventHandler] {
        param($sender, $eventArgs)

        $validationErrors.Add(("{0}: {1}" -f $eventArgs.Severity, $eventArgs.Message))
    }

    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.ValidationType = [System.Xml.ValidationType]::Schema
    $settings.Schemas = $schemaSet
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
    $settings.XmlResolver = $null
    $settings.add_ValidationEventHandler($validationHandler)

    $reader = [System.Xml.XmlReader]::Create($fixturePath, $settings)
    try {
        while ($reader.Read()) {
        }
    }
    finally {
        $reader.Dispose()
    }

    if ($validationErrors.Count -gt 0) {
        Write-Host "MusicXML 4.0 XSD validation failed: $fixturePath"
        foreach ($validationError in $validationErrors) {
            Write-Host $validationError
        }

        exit 1
    }

    Write-Output "MusicXML 4.0 XSD validation passed: $fixturePath"
}
catch {
    Write-Host "MusicXML 4.0 XSD validation failed: $fixturePath"
    Write-Host $_.Exception.Message
    exit 1
}
finally {
    if (Test-Path -LiteralPath $schemaDirectory) {
        Remove-Item -LiteralPath $schemaDirectory -Recurse -Force
    }
}
