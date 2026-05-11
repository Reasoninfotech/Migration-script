<?php
header('Content-Type: application/json');

// Ensure only POST requests are allowed
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method Not Allowed']);
    exit;
}

// Read raw JSON input
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, true);

if (!$input) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid JSON input']);
    exit;
}

// Extract inputs
$sourceShop = trim($input['sourceShop'] ?? '');
$sourceToken = trim($input['sourceToken'] ?? '');
$targetShop = trim($input['targetShop'] ?? '');
$targetToken = trim($input['targetToken'] ?? '');

// Simple validations
if (empty($sourceShop) || empty($sourceToken) || empty($targetShop) || empty($targetToken)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'All fields (Source/Target Shop URLs and Access Tokens) are required.']);
    exit;
}

// Clean up Shop URLs (e.g., remove http://, https://, and trailing slashes)
function cleanShopUrl($url) {
    $url = preg_replace('#^https?://#', '', $url);
    $url = rtrim($url, '/');
    if (strpos($url, '.') === false) {
        // If it's just a handles name (e.g. "my-store"), append myshopify.com
        $url .= '.myshopify.com';
    } elseif (strpos($url, 'myshopify.com') === false && substr_count($url, '.') === 1) {
        // If they wrote "my-store.com", keep it, but standard Shopify admin uses myshopify.com
    }
    return $url;
}

$sourceShopClean = cleanShopUrl($sourceShop);
$targetShopClean = cleanShopUrl($targetShop);

// Generate config.js content
$configContent = "export const CONFIG = {
  // Source Store Configuration
  source: {
    shop: " . json_encode($sourceShopClean) . ",
    // Replace with your Source Store Admin API Access Token (starts with shpat_ or shpca_)
    accessToken: " . json_encode($sourceToken) . ",
    apiVersion: \"2024-04\"
  },

  // Target Store Configuration
  target: {
    shop: " . json_encode($targetShopClean) . ",
    // Replace with your Target Store Admin API Access Token (starts with shpat_ or shpca_)
    accessToken: " . json_encode($targetToken) . ",
    apiVersion: \"2024-04\"
  }
};
";

// Attempt to write config.js
$configFile = __DIR__ . '/config.js';
if (file_put_contents($configFile, $configContent) === false) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Failed to write config.js. Check file permissions on the server.']);
    exit;
}

echo json_encode([
    'success' => true,
    'message' => 'Configuration updated successfully!',
    'data' => [
        'sourceShop' => $sourceShopClean,
        'targetShop' => $targetShopClean
    ]
]);
