const os = require("os");
const pty = require("node-pty"); // Pseudo-terminal spawner
const WebSocket = require("ws"); // WebSocket library

const PORT = process.env.PORT || 8080; // Port for the WebSocket server
const WS_PATH = "/terminal"; // Path for WebSocket connections

// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ port: PORT, path: WS_PATH });

console.log(`🚀 WebSocket server started on ws://localhost:${PORT}${WS_PATH}`);
if (os.platform() !== "win32" && process.getuid && process.getuid() === 0) {
  console.warn(
    "\x1b[33m⚠️ WARNING: Server is running as root. This is not recommended for production.\x1b[0m",
  );
}
console.log("Waiting for client connections...");

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n🔗 Client connected: ${clientIp}`);

  // --- PTY Process Setup ---
  // Determine the shell based on the OS
  const shell =
    os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "sh";
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color", // Terminal type
    cols: 80, // Initial columns
    rows: 30, // Initial rows
    cwd: process.env.HOME || process.env.USERPROFILE, // User's home directory
    env: { ...process.env, LANG: "en_US.UTF-8" }, // Ensure UTF-8 for proper character display
  });

  console.log(
    `  ↳ PTY process created for ${clientIp} (PID: ${ptyProcess.pid}, Shell: ${shell})`,
  );

  // --- Data Flow: WebSocket -> PTY ---
  ws.on("message", (message) => {
    try {
      // The message from xterm-addon-attach is what the user types.
      // It can be a string or Buffer. node-pty's write method handles both.
      ptyProcess.write(message);
    } catch (e) {
      console.error(`Error writing to PTY for ${clientIp}:`, e);
      return;
    }
  });

  // --- Data Flow: PTY -> WebSocket ---
  ptyProcess.onData((data) => {
    try {
      // Send data from PTY (shell output) to the WebSocket client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    } catch (e) {
      // This can happen if the WebSocket closes abruptly.
      console.error(
        `Error sending PTY data to WebSocket for ${clientIp}:`,
        e.message,
      );
    }
  });

  // --- PTY Process Exit ---
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(
      `  ↳ PTY process for ${clientIp} (PID: ${ptyProcess.pid}) exited. Code: ${exitCode}, Signal: ${signal}`,
    );
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        `\\r\\n\\x1b[31mShell process exited (Code: ${exitCode || "N/A"}, Signal: ${signal || "N/A"}). Session terminated.\\x1b[0m\\r\\n`,
      );
      ws.close(1000, `PTY exited. Code: ${exitCode}, Signal: ${signal}`);
    }
  });

  // --- WebSocket Close ---
  ws.on("close", (code, reason) => {
    console.log(
      `🔌 Client disconnected: ${clientIp}. Code: ${code}, Reason: ${reason || "N/A"}`,
    );
    // Clean up the PTY process when the WebSocket connection closes
    if (ptyProcess && ptyProcess.pid && !ptyProcess.killed) {
      try {
        ptyProcess.kill();
        console.log(
          `  ↳ Killed PTY process for ${clientIp} (PID: ${ptyProcess.pid}) due to WebSocket close.`,
        );
      } catch (e) {
        console.error(`Error killing PTY for ${clientIp}:`, e);
      }
    }
  });

  // --- WebSocket Error ---
  ws.on("error", (error) => {
    console.error(`WebSocket error for client ${clientIp}:`, error);
    // ptyProcess cleanup will be handled by 'close' event which usually follows 'error'
  });
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down server...`);
  wss.close(() => {
    console.log("WebSocket server closed.");
    // Give PTYs a moment to be cleaned up by their respective ws.on('close') handlers
    setTimeout(() => {
      console.log("Exiting.");
      process.exit(0);
    }, 500);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
