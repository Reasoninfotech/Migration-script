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
    // 1. Gather all possible paths to check
    $paths = [];

    // Check NVM (Node Version Manager) in Hostinger's Home directory first
    $home = getenv('HOME');
    if ($home) {
        $nvmDir = $home . '/.nvm/versions/node';
        if (@is_dir($nvmDir)) {
            $versions = @glob($nvmDir . '/*/bin/node');
            if (!empty($versions)) {
                $latest = end($versions); // Get the latest installed version
                if ($latest) {
                    $paths[] = $latest;
                }
            }
        }
    }

    // Add standard binary paths
    $paths[] = 'node';
    $paths[] = '/usr/local/bin/node';
    $paths[] = '/usr/bin/node';
    $paths[] = '/bin/node';
    $paths[] = '/opt/node/bin/node';
    $paths[] = '/opt/cpanel/ea-nodejs18/bin/node';
    $paths[] = '/opt/cpanel/ea-nodejs20/bin/node';

    // 2. Test each path via shell command execution to bypass PHP open_basedir restrictions!
    foreach ($paths as $path) {
        // Run "node -v" to see if it executes and outputs a valid Node version
        $output = @shell_exec($path . ' -v 2>&1');
        if ($output && preg_match('/^v\d+/', trim($output))) {
            return $path;
        }
    }

    // 3. Fallback to just "node"
    return 'node';
}

$nodeBinary = findNodeBinary();
$command = $nodeBinary . ' run-all.js 2>&1';

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
