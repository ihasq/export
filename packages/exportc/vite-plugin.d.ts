import type { Plugin } from "vite";

export interface ExportPluginOptions {
  /**
   * Development server URL
   * @default "http://localhost:8787"
   */
  dev?: string;

  /**
   * Development server port
   * @default 8787
   */
  port?: number;

  /**
   * Production Worker URL
   * Required for production builds
   * @example "https://my-api.workers.dev"
   */
  production?: string;

  /**
   * Export directory path (relative to project root)
   * @default "./export"
   */
  exportDir?: string;

  /**
   * Auto-start Wrangler dev server when running Vite in dev mode
   * @default true
   */
  autoStart?: boolean;
}

/**
 * Vite plugin for export integration
 *
 * Automatically starts Wrangler when you run `npm run dev` and allows
 * importing server exports using the "export/" prefix:
 *
 * ```ts
 * import { hello } from "export/";
 * import { utils } from "export/utils";
 * ```
 *
 * @example
 * // vite.config.ts
 * import { exportPlugin } from "exportc/vite";
 *
 * export default defineConfig({
 *   plugins: [
 *     exportPlugin({
 *       // Required for production builds
 *       production: "https://my-api.workers.dev"
 *     })
 *   ]
 * });
 */
export function exportPlugin(options?: ExportPluginOptions): Plugin;

export default exportPlugin;
