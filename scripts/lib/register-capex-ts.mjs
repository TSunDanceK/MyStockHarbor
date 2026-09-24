// Register scripts/lib/capex-ts-hooks.mjs. Callers must use a dynamic import()
// after awaiting this module (see register-ts-here.mjs for why).
import { register } from "node:module";

register("./capex-ts-hooks.mjs", import.meta.url);
