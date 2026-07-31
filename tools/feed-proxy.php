<?php
declare(strict_types=1);

// Feed-Proxy fuer Quellen, deren Bot-Schutz die GitHub-Actions-Runner blockt.
//
// Deployment: Diese Datei gehoert auf das externe Webhosting, nicht ins
// Vercel-Deployment. Sie laeuft dort unter public_html/gamerfeed/feed-proxy.php.
// Die Adresse des Endpunkts steht als GitHub-Secret FEED_PROXY_URL, damit sie
// nicht im oeffentlichen Repository auftaucht. Das Secret ersetzt keine
// Authentifizierung; Schutzgrenzen und Betrieb stehen in
// docs/deployment/feed-proxy.md.
//
// Diese Datei ist die Hauptkopie. Nach Aenderungen hier die Datei auf dem
// Hosting ersetzen - beide werden nicht automatisch abgeglichen.

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    header('Content-Type: text/plain; charset=utf-8');
    echo "Method not allowed\n";
    exit;
}

// === Isolierter Versionsfingerprint (Roadmap-Paket O4d) ===
//
// Beantwortet ausschliesslich die Frage, ob die hochgeladene Datei zur
// Hauptkopie im Repository gehoert. Der Zweig steht bewusst **vor** jeder
// anderen Pruefung:
//
// - Er ruft niemals den Upstream-Feed ab und fasst die Allowlist nicht an.
// - Er braucht kein cURL. Deshalb liegt er vor der cURL-Pruefung: ein Hosting
//   ohne cURL-Erweiterung soll seine Version trotzdem melden koennen, statt nur
//   "Proxy is not configured correctly" zu sagen.
//
// Der Fingerprint ist **nicht geheim**: er ist der Hash einer Datei, die
// oeffentlich im Repository liegt. Er verraet weder die Adresse dieses
// Endpunkts noch irgendein Secret.
if (($_GET['mode'] ?? '') === 'fingerprint') {
    $source = @file_get_contents(__FILE__);
    if ($source === false) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Fingerprint unavailable\n";
        exit;
    }

    // CRLF und einzelne CR werden auf LF vereinheitlicht. Ein Upload per FTP im
    // Textmodus oder ein Windows-Editor aendert die Zeilenenden, ohne eine
    // einzige Anweisung zu veraendern - das darf keinen Fehlalarm ausloesen.
    $canonical = str_replace(["\r\n", "\r"], "\n", $source);

    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'schemaVersion' => 1,
        'service'       => 'gamerfeed-feed-proxy',
        'algorithm'     => 'sha256',
        'fingerprint'   => hash('sha256', $canonical),
    ], JSON_UNESCAPED_SLASHES), "\n";
    exit;
}

if (!function_exists('curl_init')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Proxy is not configured correctly\n";
    exit;
}

$allowed = [
    'https://www.gamepro.de/rss/gamepro.rss',
];

$url = $_GET['url'] ?? '';

// Exakter Vergleich gegen die Liste - keine Praefix- oder Wildcard-Pruefung,
// sonst laesst sich die Allowlist mit praeparierten URLs umgehen.
if (!in_array($url, $allowed, true)) {
    // 422 unterscheidet die lokale Allowlist von einem echten Upstream-403.
    http_response_code(422);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not allowed\n";
    exit;
}

$maxBytes = 5 * 1024 * 1024;
$body = '';
$bodyLength = 0;
$tooLarge = false;

$ch = curl_init($url);
if ($ch === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Proxy is not configured correctly\n";
    exit;
}

try {
    $configured = curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_ENCODING       => '',
        CURLOPT_WRITEFUNCTION  => static function ($curl, string $chunk) use (&$body, &$bodyLength, &$tooLarge, $maxBytes): int {
            $chunkLength = strlen($chunk);
            if ($bodyLength + $chunkLength > $maxBytes) {
                $tooLarge = true;
                return 0;
            }

            $body .= $chunk;
            $bodyLength += $chunkLength;
            return $chunkLength;
        },
        CURLOPT_HTTPHEADER     => [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        ],
    ]);
} catch (Throwable $configurationError) {
    curl_close($ch);
    error_log('Feed proxy cURL configuration failed: ' . $configurationError->getMessage());
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Proxy is not configured correctly\n";
    exit;
}

if (!$configured) {
    curl_close($ch);
    error_log('Feed proxy cURL configuration failed');
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Proxy is not configured correctly\n";
    exit;
}

$result = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error  = curl_error($ch);
curl_close($ch);

if ($result === false) {
    header('Content-Type: text/plain; charset=utf-8');
    if ($tooLarge) {
        // 413 ist absichtlich nicht wiederholbar; die Node-Seite wiederholt 5xx.
        http_response_code(413);
        echo "Upstream response too large\n";
    } else {
        http_response_code(502);
        error_log("Feed proxy fetch failed: $error");
        echo "Upstream fetch failed\n";
    }
    exit;
}

if ($status < 100 || $status > 599) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Invalid upstream response\n";
    exit;
}

// Status der Quelle durchreichen, damit ein 403 nicht als Erfolg ankommt.
http_response_code($status);
header('Content-Type: application/rss+xml; charset=utf-8');
echo $body;
