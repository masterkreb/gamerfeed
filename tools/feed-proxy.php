<?php
// Feed-Proxy fuer Quellen, deren Bot-Schutz die GitHub-Actions-Runner blockt.
//
// Deployment: Diese Datei gehoert auf das externe Webhosting, nicht ins
// Vercel-Deployment. Sie laeuft dort unter public_html/gamerfeed/feed-proxy.php.
// Die Adresse des Endpunkts steht als GitHub-Secret FEED_PROXY_URL, damit sie
// nicht im oeffentlichen Repository auftaucht.
//
// Diese Datei ist die Hauptkopie. Nach Aenderungen hier die Datei auf dem
// Hosting ersetzen - beide werden nicht automatisch abgeglichen.

$allowed = [
    'https://www.gamepro.de/rss/gamepro.rss',
];

$url = $_GET['url'] ?? '';

// Exakter Vergleich gegen die Liste - keine Praefix- oder Wildcard-Pruefung,
// sonst laesst sich die Allowlist mit praeparierten URLs umgehen.
if (!in_array($url, $allowed, true)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not allowed\n";
    exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_ENCODING       => '',
    CURLOPT_HTTPHEADER     => [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language: de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    ],
]);

$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error  = curl_error($ch);
curl_close($ch);

if ($body === false) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Fetch failed: $error\n";
    exit;
}

// Status der Quelle durchreichen, damit ein 403 nicht als Erfolg ankommt.
http_response_code($status);
header('Content-Type: application/rss+xml; charset=utf-8');
echo $body;
