from datetime import date, datetime, timezone
from decimal import Decimal
from urllib.parse import quote

import httpx


YAHOO_CHART_URL = "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"


def fetch_market_prices(instruments: list[dict]) -> tuple[list[dict], list[str]]:
    prices, errors = [], []
    headers = {"User-Agent": "Mozilla/5.0 (MAPI personal finance app)"}
    with httpx.Client(timeout=5.0, follow_redirects=True, headers=headers) as client:
        for instrument in instruments:
            symbol = instrument["symbol"]
            try:
                response = client.get(
                    YAHOO_CHART_URL.format(symbol=quote(symbol, safe="")),
                    params={"interval": "1d", "range": "5d"},
                )
                response.raise_for_status()
                result = response.json()["chart"]["result"][0]
                meta = result["meta"]
                currency = meta.get("currency")
                if currency != instrument["currency"]:
                    raise ValueError(f"currency {currency or 'unknown'}")
                timestamps = result.get("timestamp") or []
                closes = result.get("indicators", {}).get("quote", [{}])[0].get("close") or []
                observations = [(timestamp, close) for timestamp, close in zip(timestamps, closes) if close is not None]
                if observations:
                    timestamp, value = observations[-1]
                else:
                    timestamp, value = meta.get("regularMarketTime"), meta.get("regularMarketPrice")
                if timestamp is None or value is None: raise ValueError("price unavailable")
                market_date = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date()
                prices.append({"instrument_id": instrument["id"], "date": market_date,
                               "price": Decimal(str(value)), "currency": currency})
            except Exception as exc:
                errors.append(f"{symbol}: {type(exc).__name__}")
    return prices, errors
