export function moneyInCents(value) {
    if (!["string", "number"].includes(typeof value) || String(value).trim() === "") return null;
    const amount = Number(value);
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 0.000001) return null;
    return cents;
}
