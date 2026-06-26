/**
 * Thin re-export so app code can `import { brandConfig } from "@/lib/brand"`
 * while the single source of truth stays in the root `brand.config.ts`.
 */
export { default as brandConfig, type BrandConfig } from "../../brand.config";
