export class NextResponse extends Response { static json(b, i) { return new Response(JSON.stringify(b), i); } }
export const after = () => {};
export const connection = async () => {};
