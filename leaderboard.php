<?php
// Simple flat-file leaderboard store for the HiperRoll game.
// GET  -> returns the top 10 scores as JSON.
// POST -> accepts {"name": "...", "score": 1234} and returns the updated top 10.
//
// No database needed: scores are kept in leaderboard.json next to this file.
// Works on any standard PHP shared hosting (e.g. HostGator) with no setup.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dataFile = __DIR__ . '/leaderboard.json';
$maxStored = 100;
$maxReturned = 10;

function hiperroll_read_entries($fp) {
    rewind($fp);
    $raw = stream_get_contents($fp);
    $entries = json_decode((string) $raw, true);
    return is_array($entries) ? $entries : [];
}

function hiperroll_top($entries, $limit) {
    usort($entries, function ($a, $b) {
        return ($b['score'] ?? 0) <=> ($a['score'] ?? 0);
    });
    return array_slice($entries, 0, $limit);
}

if (!file_exists($dataFile)) {
    @file_put_contents($dataFile, '[]');
}

$fp = fopen($dataFile, 'c+');
if (!$fp) {
    http_response_code(500);
    echo json_encode(['error' => 'storage unavailable']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    flock($fp, LOCK_SH);
    $entries = hiperroll_read_entries($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    echo json_encode(hiperroll_top($entries, $maxReturned));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    $name = isset($body['name']) ? trim(strip_tags((string) $body['name'])) : '';
    if ($name === '') $name = 'Jogador';
    $name = mb_substr($name, 0, 18);

    $score = isset($body['score']) ? (int) $body['score'] : -1;
    if ($score < 0 || $score > 5000000) {
        fclose($fp);
        http_response_code(400);
        echo json_encode(['error' => 'invalid score']);
        exit;
    }

    flock($fp, LOCK_EX);
    $entries = hiperroll_read_entries($fp);
    $entries[] = [
        'name' => $name,
        'score' => $score,
        'date' => gmdate('Y-m-d'),
    ];
    $entries = hiperroll_top($entries, $maxStored);

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($entries, JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    echo json_encode(hiperroll_top($entries, $maxReturned));
    exit;
}

fclose($fp);
http_response_code(405);
echo json_encode(['error' => 'method not allowed']);
