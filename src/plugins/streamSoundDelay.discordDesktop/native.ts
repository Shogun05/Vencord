/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "node:crypto";

import { AudioRelay } from "@plugins/streamSoundDelay.discordDesktop/relay";
import { IpcMainInvokeEvent } from "electron";

const relays = new Map<string, { owner: number; relay: AudioRelay; }>();
const watchedContents = new Set<number>();

function getRelay(event: IpcMainInvokeEvent, id: string) {
    const entry = relays.get(id);
    if (!entry || entry.owner !== event.sender.id) throw new Error("Unknown stream audio relay.");
    return entry.relay;
}

export async function reserve(event: IpcMainInvokeEvent) {
    const owner = event.sender.id;
    if (Array.from(relays.values()).filter(entry => entry.owner === owner).length > 12)
        throw new Error("Too many stream audio relays.");
    if (!watchedContents.has(owner)) {
        watchedContents.add(owner);
        event.sender.once("destroyed", () => {
            for (const [id, entry] of relays) {
                if (entry.owner !== owner) continue;
                entry.relay.close();
                relays.delete(id);
            }
            watchedContents.delete(owner);
        });
    }
    const created: string[] = [];
    try {
        const pending = [] as { id: string; relay: AudioRelay; }[];
        for (let i = 0; i < 4; i++) {
            const id = randomUUID();
            const relay = new AudioRelay();
            relays.set(id, { owner, relay });
            created.push(id);
            pending.push({ id, relay });
        }
        const slots = await Promise.all(pending.map(async ({ id, relay }) => ({ id, port: await relay.bind() })));
        if (event.sender.isDestroyed()) throw new Error("Discord window closed during relay setup.");
        return slots;
    } catch (error) {
        for (const id of created) {
            relays.get(id)?.relay.close();
            relays.delete(id);
        }
        throw error;
    }
}

export function configure(event: IpcMainInvokeEvent, id: string, address: string, port: number, milliseconds: number, payloadTypes: number[]) {
    return getRelay(event, id).configure(address, port, milliseconds, payloadTypes);
}

export function setDelay(event: IpcMainInvokeEvent, id: string, milliseconds: number) {
    getRelay(event, id).setDelay(milliseconds);
}

export function checkConnections(event: IpcMainInvokeEvent, ids: string[]) {
    for (const id of ids) getRelay(event, id).checkError();
}

export function release(event: IpcMainInvokeEvent, id: string) {
    getRelay(event, id).close();
    relays.delete(id);
}
