# Measuring the visible artefact instead of the one carrying the answer

The instrument works, the number is real, and it is a number about something
adjacent to the question. Three instances, same shape:

| Read | What it actually reported | The answer was in |
|---|---|---|
| `1253` bars from `/api/history` | `dailyCount` in a debug **log line** | the response, capped at the requested 900 |
| a green `next build` route table | that the build **completed** | the per-route `○`/`ƒ` column, and then the emitted HTML |
| the ticker shown in the **DOM** | what the client had swapped to | the flight payload's `defaultSymbol` — what the SERVER sent |

The third nearly shipped a broken #300. The migration test asserted on the
rendered ticker, and the client hydrates to the remembered symbol *whether or
not the server got it right* — so a completely failed migration renders `CAG`
and passes. The seed had to be read out of the flight payload
(`defaultSymbol\":\"…\"`) precisely because that is the value the client has not
touched yet.

**Before trusting a measurement, name which layer produced the number.** A log
line is not a payload. A build completing is not a route being static. The DOM
is not the server's output. When a client can overwrite the thing being
measured, measure upstream of the client.
