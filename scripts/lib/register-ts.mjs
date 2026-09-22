// Registers scripts/lib/ts-resolve.mjs. Used as `node --import
// ./scripts/lib/register-ts.mjs <script>` so a relay task can import the app's
// .ts modules directly. See ts-resolve.mjs for why.
import { register } from "node:module";
register("./ts-resolve.mjs", import.meta.url);
