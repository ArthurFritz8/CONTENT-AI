import { handleVideoWorker } from "./handler.ts";
Deno.serve(req => handleVideoWorker(req));
