const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };
export const useRouter = () => router;
export const usePathname = () => "/";
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const notFound = () => { throw new Error("notFound"); };
export const redirect = () => { throw new Error("redirect"); };
export const permanentRedirect = redirect;
