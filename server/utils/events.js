import PendingEvent from "../models/PendingEvent.js";

export async function queueEvent(name, data, session) {
    const [event] = await PendingEvent.create([{ name, data }], { session });
    return event;
}

// The stable event ID lets Inngest deduplicate a retry after delivery succeeds.
export async function deliverEvent(client, event) {
    try {
        await client.send({ id: event._id.toString(), name: event.name, data: event.data });
        await PendingEvent.deleteOne({ _id: event._id });
        return true;
    } catch (error) {
        console.error("Background event delivery pending:", error.message);
        return false;
    }
}
