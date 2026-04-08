const { createApp } = require("./app");
const { config } = require("./config");
const { stopDailyRefresh } = require("./services/exchange-rates");

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`Finance Tracker API listening on http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  stopDailyRefresh();
  server.close((error) => {
    if (error) {
      console.error("Failed to close HTTP server cleanly", error);
      process.exit(1);
      return;
    }

    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
