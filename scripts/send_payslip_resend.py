#!/usr/bin/env python3
# Standalone payslip sender using the Resend API (POST https://api.resend.com/emails).
# Stdlib only — no pip installs. Needs RESEND_API_KEY in the environment; run with:
#   set -a && source .env && set +a && python3 scripts/send_payslip_resend.py
# Free-tier constraint: until a domain is verified in Resend, the sender must be
# onboarding@resend.dev and the only allowed recipient is the address the Resend
# account was signed up with.
import json
import os
import urllib.request


def send_payslip(email_address: str, payslip_data: dict) -> None:
    try:
        api_key = os.environ["RESEND_API_KEY"]  # KeyError -> caught below
        payload = json.dumps({
            "from": os.environ.get("MAIL_FROM", "onboarding@resend.dev"),
            "to": [email_address],
            "subject": f"[DEMO] Payslip — {payslip_data.get('employee', 'employee')} · {payslip_data.get('period', '')}",
            "html": "".join(f"<p><strong>{key}:</strong> {value}</p>" for key, value in payslip_data.items()),
        }).encode()
        request = urllib.request.Request(
            "https://api.resend.com/emails", data=payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            print("sent — Resend email id:", json.loads(response.read())["id"])
    except Exception as error:  # missing key, HTTP 4xx/5xx, network — report, don't crash
        print(f"payslip send failed: {type(error).__name__}: {error}")


if __name__ == "__main__":
    send_payslip("sageabdallah10@gmail.com", {
        "employee": "Sage Abdallah",
        "period": "FY26 week 3 (13–19 Jul 2026)",
        "gross_pay": "$2,310.00",
        "tax_withheld": "$467.50",
        "net_pay": "$1,842.50",
    })
