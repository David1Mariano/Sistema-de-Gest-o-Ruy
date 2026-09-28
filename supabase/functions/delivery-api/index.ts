import { managementHandler } from '../_shared/handlers.mjs';
Deno.serve(managementHandler(Deno.env.toObject()));
