<?php
// Set streaming headers
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no'); // Tell Nginx/LiteSpeed not to buffer output

// Prevent session locking from blocking other requests
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

// Turn off all buffering
while (ob_get_level()) {
    ob_end_flush();
}
ob_implicit_flush(true);

// Helper function to send SSE event
function sendLogEvent($event, $data) {
    echo "event: " . $event . "\n";
    echo "data: " . json_encode($data) . "\n\n";
    if (ob_get_level() > 0) {
        ob_flush();
    }
    flush();
}

sendLogEvent('status', ['state' => 'running', 'message' => 'Spawning migration process...']);

// Try to locate Node.js executable on the system dynamically (especially for Hostinger shared hosting environments)
function findNodeBinary() {
    // 1. Try standard command lookups (non-Windows)
    if (strpos(strtolower(PHP_OS), 'win') === false) {
        $whichNode = shell_exec('which node 2>/dev/null');
        if ($whichNode) {
            $path = trim($whichNode);
            if (!empty($path) && file_exists($path) && is_executable($path)) {
                return $path;
            }
        }
    }

    // 2. Check NVM (Node Version Manager) in Hostinger's Home directory
    $home = getenv('HOME');
    if ($home) {
        $nvmDir = $home . '/.nvm/versions/node';
        if (is_dir($nvmDir)) {
            $versions = glob($nvmDir . '/*/bin/node');
            if (!empty($versions)) {
                $latest = end($versions); // Get the latest installed version
                if (file_exists($latest) && is_executable($latest)) {
                    return $latest;
                }
            }
        }
    }

    // 3. Check standard global hosting installation paths
    $commonPaths = [
        '/usr/local/bin/node',
        '/usr/bin/node',
        '/bin/node',
        '/opt/node/bin/node',
        '/opt/cpanel/ea-nodejs18/bin/node',
        '/opt/cpanel/ea-nodejs20/bin/node'
    ];

    foreach ($commonPaths as $path) {
        if (file_exists($path) && is_executable($path)) {
            return $path;
        }
    }

    // 4. Default fallback (works globally on local development)
    return 'node';
}

$nodeBinary = findNodeBinary();
$command = escapeshellcmd($nodeBinary) . ' run-all.js 2>&1';

$descriptorspec = [
    0 => ["pipe", "r"], // stdin
    1 => ["pipe", "w"], // stdout
    2 => ["pipe", "w"]  // stderr
];

$cwd = __DIR__;
$process = proc_open($command, $descriptorspec, $pipes, $cwd);

if (is_resource($process)) {
    // Close stdin since we don't need to write to it
    fclose($pipes[0]);

    // Read the output stream line-by-line
    while (!feof($pipes[1])) {
        $line = fgets($pipes[1]);
        if ($line !== false) {
            // Send log line to frontend
            sendLogEvent('log', ['text' => rtrim($line, "\r\n")]);
        }
    }

    // Clean up streams
    fclose($pipes[1]);
    fclose($pipes[2]);

    // Close process and get return code
    $returnCode = proc_close($process);

    if ($returnCode === 0) {
        sendLogEvent('status', ['state' => 'completed', 'message' => 'Migration completed successfully!']);
    } else {
        sendLogEvent('status', ['state' => 'failed', 'message' => 'Migration process exited with non-zero code: ' . $returnCode]);
    }
} else {
    sendLogEvent('status', ['state' => 'failed', 'message' => 'Failed to spawn the Node.js process. Please check if Node is installed and executable.']);
}
