/**
 * Supabase Edge Function entry — bundles `gateway-logic.ts` (deploy keeps multi-file for MCP size limits).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import "./gateway-logic.ts";
