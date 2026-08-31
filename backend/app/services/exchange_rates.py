from datetime import date
from decimal import Decimal

import httpx


FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rate/{currency}/CAD"


def fetch_cad_rates(currencies: tuple[str, ...] = ("USD", "UYU")) -> tuple[list[dict], list[str]]:
    rates, errors = [], []
    with httpx.Client(timeout=4.0, follow_redirects=True) as client:
        for currency in currencies:
            try:
                response = client.get(FRANKFURTER_URL.format(currency=currency))
                response.raise_for_status()
                payload = response.json()
                rates.append({"date": date.fromisoformat(payload["date"]), "from_currency": currency,
                              "to_currency": "CAD", "rate": Decimal(str(payload["rate"])),
                              "source": "frankfurter"})
            except Exception as exc:
                errors.append(f"{currency}: {type(exc).__name__}")
    return rates, errors
