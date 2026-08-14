import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
var projectRoot = fileURLToPath(new URL(".", import.meta.url));
var hostBase = (process.env.VITE_BASE || "/").replace(/\/?$/, "/");
export default defineConfig({
    base: "".concat(hostBase, "director-desk/"),
    assetsInclude: ["**/*.fbx", "**/*.obj"],
    plugins: [react()],
    server: {
        fs: {
            allow: [
                projectRoot,
                resolve(projectRoot, "../模型库"),
            ],
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        pool: "threads",
        maxWorkers: 1,
        setupFiles: "./src/test/setup.ts",
    },
});
