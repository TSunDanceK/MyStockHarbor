// Register ts-resolve-app.mjs from inside a script (the app's `@/` alias and
// attribute-less JSON imports). Use a dynamic import() after awaiting this.
import { register } from "node:module";

register("./ts-resolve-app.mjs", import.meta.url);
