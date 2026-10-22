import { todayInIndia } from "./leaveDates.js";

export function indiaDay(now = new Date()) {
    const day = todayInIndia(now);
    const start = new Date(`${day}T00:00:00+05:30`);
    return { day, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
        isLate: now.getTime() > start.getTime() + 9 * 60 * 60 * 1000 };
}

export function indiaMonth(now = new Date()) {
    const [year, month] = todayInIndia(now).split("-").map(Number);
    const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
    return { start: new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`),
        end: new Date(`${next}-01T00:00:00+05:30`) };
}
