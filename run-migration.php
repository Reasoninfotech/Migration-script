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

// Helper to execute a command via proc_open and return its trimmed stdout (safe from shell_exec/exec blocks)
function executeViaProcOpen($cmd) {
    $descriptorspec = [
        1 => ["pipe", "w"],
        2 => ["pipe", "w"]
    ];
    $process = @proc_open($cmd, $descriptorspec, $pipes);
    if (is_resource($process)) {
        $stdout = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);
        return trim($stdout);
    }
    return '';
}

// Helper to test if a Node path is executable and valid using proc_open (bypasses PHP open_basedir checks)
function testNodePath($path) {
    $descriptorspec = [
        1 => ["pipe", "w"],
        2 => ["pipe", "w"]
    ];
    $process = @proc_open($path . ' -v', $descriptorspec, $pipes);
    if (is_resource($process)) {
        $stdout = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($process);
        if ($code === 0 && preg_match('/^v\d+/', trim($stdout))) {
            return true;
        }
    }
    return false;
}

// Try to locate Node.js executable on the system dynamically (especially for Hostinger shared hosting environments)
function findNodeBinary() {
    $paths = [];

    // 1. Query the system where node is located using standard tools (via proc_open)
    $which = executeViaProcOpen('which node');
    if (!empty($which)) {
        $paths[] = $which;
    }

    $whereis = executeViaProcOpen('whereis node');
    if ($whereis) {
        // Output format: "node: /usr/bin/node /usr/local/bin/node"
        $parts = explode(' ', $whereis);
        foreach ($parts as $part) {
            $path = trim($part);
            if (!empty($path) && $path !== 'node:' && !in_array($path, $paths)) {
                $paths[] = $path;
            }
        }
    }

    // 2. Add standard shared hosting Node installation candidate paths
    $standardPaths = [
        '/usr/local/bin/node',
        '/usr/bin/node',
        '/bin/node',
        '/opt/node/bin/node',
        '/opt/alt/alt-nodejs18/root/usr/bin/node',
        '/opt/alt/alt-nodejs20/root/usr/bin/node'
    ];
    foreach ($standardPaths as $path) {
        if (!in_array($path, $paths)) {
            $paths[] = $path;
        }
    }

    // 3. Test each candidate path. The first one that responds to "-v" successfully is our winner!
    foreach ($paths as $path) {
        if (testNodePath($path)) {
            return $path;
        }
    }

    // 4. Fallback to default
    return 'node';
}

$nodeBinary = findNodeBinary();
$command = $nodeBinary . ' --js-flags="--no-wasm-trap-handler" --max-old-space-size=512 run-all.js 2>&1';

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
