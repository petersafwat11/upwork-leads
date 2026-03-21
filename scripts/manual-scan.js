const { runScan } = require("../index");

console.log("Starting manual scan...");
runScan()
  .then(() => {
    console.log("Manual scan completed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Manual scan failed:", err);
    process.exit(1);
  });
