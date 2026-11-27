// Builds the vectrabot E2B template on top of the Supercharge desktop image.
//   E2B_API_KEY=... node build.mjs [name]
// Needs ./sandbox-host: the Linux amd64 workspace host from the vectrabot repo
// (cd backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o <here>/sandbox-host .).
import { Template, waitForURL } from "e2b";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] || "vectrabot-workspace";
const base = process.env.VECTRABOT_BASE_TEMPLATE || "supercharge-full-sandbox";
if (!existsSync(`${here}/sandbox-host`)) throw new Error("build ./sandbox-host first");

const template = Template({ fileContextPath: here })
  .fromTemplate(base)
  .copy("sandbox-host", "/opt/vectrabot/sandbox-host", { user: "root", mode: 0o755, forceUpload: true })
  .copy(["lockdown.sh", "run-host.sh", "start.sh"], "/opt/vectrabot/", { user: "root", mode: 0o755, forceUpload: true })
  .runCmd(
    [
      "printf 'user ALL=(root) NOPASSWD: /opt/vectrabot/lockdown.sh\\n' > /etc/sudoers.d/vectrabot-lockdown",
      "chmod 440 /etc/sudoers.d/vectrabot-lockdown",
      "curl -fsSL --retry 5 -o /usr/local/bin/supercharge https://github.com/supercharge-cli/supercharge-releases/releases/download/v1.4.44/supercharge-linux-x86_64",
      "chmod 755 /usr/local/bin/supercharge",
      "ln -sfn supercharge /usr/local/bin/sc",
      "/usr/local/bin/supercharge --version",
    ],
    { user: "root" },
  )
  .setStartCmd("/opt/vectrabot/start.sh", waitForURL("http://127.0.0.1:8790/health"));

const info = await Template.build(template, name, {
  cpuCount: Number(process.env.VECTRABOT_TEMPLATE_CPU || 4),
  memoryMB: Number(process.env.VECTRABOT_TEMPLATE_MEMORY_MB || 8192),
  onBuildLogs: (entry) => console.log(String(entry)),
});
console.log("BUILT", JSON.stringify(info));
