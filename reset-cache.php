<?php
header('Content-Type: application/json');

// Ensure only POST requests are allowed
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method Not Allowed']);
    exit;
}

$mappingsFile = __DIR__ . '/id-mappings.json';

// Delete the id-mappings file if it exists
if (file_exists($mappingsFile)) {
    if (unlink($mappingsFile)) {
        echo json_encode([
            'success' => true,
            'message' => 'Migration cache successfully cleared!'
        ]);
    } else {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Failed to clear cache file. Check file permissions.'
        ]);
    }
} else {
    echo json_encode([
        'success' => true,
        'message' => 'Cache is already clean!'
    ]);
}
