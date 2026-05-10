"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Props = {
  currentSymbol: string;
};

function cleanInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").trim();
}

export default function EarningsSymbolPicker({ currentSymbol }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(currentSymbol);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanSymbol = cleanInput(value);
    if (!cleanSymbol) return;

    router.push(`/stock/${encodeURIComponent(cleanSymbol)}/earnings`);
  }

  return (
    <form onSubmit={onSubmit} className="earningsChangeStock">
      <div>
        <div className="smallLabel">Change stock</div>
        <p>Search another ticker to view its earnings page.</p>
      </div>

      <div className="earningsSearchRow">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Stock ticker"
          placeholder="AAPL"
        />

        <button type="submit">Open earnings →</button>
      </div>
    </form>
  );
}
